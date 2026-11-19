'use strict';
/**
 * Offers inside a listing chat. The buyer proposes a price; the seller accepts or declines; the buyer can withdraw.
 * Accepting reserves the listing for that buyer (other people see "Reserved") until the seller frees it or closes it.
 * One open offer per conversation. Offers are messages, so they appear in the chat history for both sides.
 */
const express = require('express');
const messages = require('../repo/messages');
const listings = require('../repo/listings');
const users = require('../repo/users');
const { requireLogin, requireActive, loadListingForOwner } = require('../middleware/auth');
const { sharedRateLimit } = require('../middleware/sharedLimit');
const { notify } = require('../services/notify');
const { audit } = require('../services/audit');
const { formatMoney } = require('../lib/validate');
const blocks = require('../services/blocks');

const router = express.Router();
const offerLimit = sharedRateLimit({ name: 'offer', windowMs: 60 * 60_000, max: 20, key: (req) => `offer:${req.user ? req.user.user_id : req.ip}`, message: 'You have made a lot of offers. Try again later.' });
const MAX_CENTS = 100_000_000; // GH₵1,000,000

const offerable = (l) => Boolean(l && !l.deleted_at && l.status === 'active' && !l.reserved_for && ['fixed', 'negotiable'].includes(l.price_type));
const title = (l) => String(l.title).slice(0, 60);

async function loadListingThread(req, res) {
  const t = /^[\w-]{1,40}$/.test(req.params.cid) ? await messages.get(req.params.cid, req.user.user_id) : null;
  if (!t || t.kind !== 'listing') { res.status(404).render('error', { status: 404, title: 'Conversation not found', message: 'It may have been deleted, or it belongs to someone else.' }); return null; }
  return t;
}

router.post('/messages/:cid/offer', requireLogin, requireActive, offerLimit, async (req, res) => {
  const t = await loadListingThread(req, res);
  if (!t) return;
  const back = `/messages/${t.id}#latest`;
  const fail = (m) => { req.flash('error', m); return res.redirect(back); };
  if (t.starter_id !== req.user.user_id) return fail('Only the buyer can make an offer.');
  const [listing, seller] = await Promise.all([listings.get(t.listing_id), users.getById(t.owner_id)]);
  if (!offerable(listing)) return fail('This listing cannot take offers right now.');
  if (!seller || blocks.messageBlock(req.user, seller)) return fail('This member cannot receive offers from you.');
  if (t.pending_offer_id) return fail('You already have an offer waiting. Withdraw it first to make a new one.');
  const raw = String(req.body.amount || '').replace(/[,\s]/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(raw)) return fail('Enter an amount in cedis, for example 120 or 120.50.');
  const cents = Math.round(parseFloat(raw) * 100);
  if (cents < 100 || cents > MAX_CENTS) return fail('Offers must be between GH₵1 and GH₵1,000,000.');

  const offer = { amount_cents: cents, status: 'pending', by: req.user.user_id };
  const body = `Offer: ${formatMoney(cents)}${listing.price_cents ? ` (asking ${formatMoney(listing.price_cents)})` : ''}`;
  const { mid } = await messages.send({ listing, from: req.user.user_id, to: t.owner_id, body, cid: t.id, offer, returnIds: true });
  await messages.setThread(t.id, { pending_offer_id: mid });
  await notify(t.owner_id, { type: 'message', title: `New offer: ${formatMoney(cents)} for “${title(listing)}”`, body: 'Open the chat to accept or decline.', link: `/messages/${t.id}` });
  await audit({ actor: req.user, action: 'offer.create', entityType: 'listing', entityId: listing.listing_id, meta: { cents }, ip: req.ip });
  res.redirect(back);
});

router.post('/messages/:cid/offer/:mid/:decision', requireLogin, async (req, res) => {
  const t = await loadListingThread(req, res);
  if (!t) return;
  const back = `/messages/${t.id}#latest`;
  const fail = (m) => { req.flash('error', m); return res.redirect(back); };
  const decision = ['accept', 'decline', 'withdraw'].includes(req.params.decision) ? req.params.decision : null;
  const msg = /^[\w-]{1,40}$/.test(req.params.mid) ? await messages.getMessage(t.id, req.params.mid) : null;
  if (!decision || !msg || !msg.offer) return fail('That offer could not be found.');
  if (msg.offer.status !== 'pending') return fail('That offer has already been answered.');
  const isSeller = req.user.user_id === t.owner_id;
  if ((decision === 'withdraw') === isSeller || (decision !== 'withdraw' && !isSeller)) return fail('You cannot do that with this offer.');
  const listing = await listings.get(t.listing_id);
  if (decision === 'accept' && !offerable(listing)) return fail('This listing is no longer available, so the offer cannot be accepted.');

  const status = { accept: 'accepted', decline: 'declined', withdraw: 'withdrawn' }[decision];
  await messages.updateMessage(t.id, msg.id, { 'offer.status': status, 'offer.answered_at': Date.now() });
  await messages.setThread(t.id, { pending_offer_id: null });
  const amount = formatMoney(msg.offer.amount_cents);
  const other = isSeller ? t.starter_id : t.owner_id;
  const text = {
    accepted: `Offer accepted: ${amount}. The listing is now reserved for you. Agree a busy, public place to meet, check the item, then pay.`,
    declined: `Offer of ${amount} declined.`,
    withdrawn: `Offer of ${amount} withdrawn.`,
  }[status];
  await messages.send({ listing, from: req.user.user_id, to: other, body: text, cid: t.id });
  if (status === 'accepted') {
    await listings.update(listing.listing_id, { reserved_for: t.starter_id, reserved_at: Date.now(), reserved_cents: msg.offer.amount_cents });
    await require('../services/savedWatch').notifyChange(listing, 'reserved', { exclude: [t.starter_id] });
  }
  await notify(other, { type: 'message', title: `${status === 'accepted' ? 'Offer accepted' : status === 'declined' ? 'Offer declined' : 'Offer withdrawn'}: “${title(listing || { title: t.listing_title })}”`, body: text, link: `/messages/${t.id}` });
  await audit({ actor: req.user, action: `offer.${status}`, entityType: 'listing', entityId: t.listing_id, ip: req.ip });
  res.redirect(back);
});

/* the seller frees a reserved listing (the deal fell through) */
router.post('/listings/:id/unreserve', requireLogin, loadListingForOwner, async (req, res) => {
  if (req.listing.reserved_for) {
    await listings.update(req.listing.listing_id, { reserved_for: null, reserved_at: null, reserved_cents: null });
    await require('../services/savedWatch').notifyChange(req.listing, 'available', { exclude: [req.listing.reserved_for] });
    await audit({ actor: req.user, action: 'listing.unreserve', entityType: 'listing', entityId: req.listing.listing_id, ip: req.ip });
  }
  req.flash('success', 'The listing is available again. Buyers can make offers.');
  res.redirect(req.body.back === 'listing' ? `/listings/${req.listing.listing_id}` : '/my/listings');
});

/* the seller marks the deal done: closes the listing and invites the reserved buyer to review */
router.post('/listings/:id/sold', requireLogin, loadListingForOwner, async (req, res) => {
  const [l] = await listings.hydrate([req.listing]);
  const { soldLabel } = require('../lib/deals');
  if (l.status !== 'active' || !soldLabel(l)) {
    req.flash('error', 'Only live items and rooms can be marked as sold.');
    return res.redirect(`/listings/${l.listing_id}`);
  }
  const now = Date.now();
  const buyer = l.reserved_for || null;
  await listings.update(l.listing_id, {
    status: 'closed', outcome: 'sold', sold_at: now, sold_to: buyer, sold_cents: buyer ? l.reserved_cents || null : null,
    reserved_for: null, reserved_at: null, reserved_cents: null, updated_at: now,
  });
  if (buyer) {
    await notify(buyer, {
      type: 'system', title: `Deal done: “${title(l)}”`,
      body: `${String(req.user.name).split(' ')[0]} marked it as complete. How did it go? A short review helps other students.`,
      link: `/users/${req.user.user_id}#reviews`,
    });
  }
  // Tell anyone else who asked about it, so nobody keeps waiting.
  const threads = await messages.byListing(l.listing_id);
  await Promise.all(threads.filter((t) => t.starter_id !== buyer && t.starter_id !== req.user.user_id).map((t) => notify(t.starter_id, {
    type: 'message', title: `Update: “${title(l)}” is no longer available`, body: 'The poster marked it as sold.', link: `/messages/${t.id}`,
  })));
  await require('../services/savedWatch').notifyChange(l, 'sold', { exclude: [buyer, ...threads.map((t) => t.starter_id)].filter(Boolean) });
  await audit({ actor: req.user, action: 'listing.sold', entityType: 'listing', entityId: l.listing_id, meta: { buyer }, ip: req.ip });
  req.flash('success', buyer ? 'Marked as sold. We asked the buyer to leave you a review.' : 'Marked as sold. Congratulations!');
  res.redirect(req.body.back === 'listing' ? `/listings/${l.listing_id}` : '/my/listings');
});

module.exports = router;
module.exports.offerable = offerable;
