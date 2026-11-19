'use strict';
/**
 * Seller reviews. Only members who chatted with the seller about one of the seller's listings (and got a reply)
 * can review them. Reviews show straight away; anyone can report one, and staff can remove it.
 */
const express = require('express');
const reviews = require('../repo/reviews');
const users = require('../repo/users');
const messages = require('../repo/messages');
const { audit } = require('../services/audit');
const { notify } = require('../services/notify');
const { requireLogin, requireActive, can } = require('../middleware/auth');

const router = express.Router();
const clean = (s) => String(s || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/** True when the reviewer asked about one of the seller's listings in a chat and the seller replied. */
async function canReview(reviewerId, sellerId) {
  if (!reviewerId || Number(reviewerId) === Number(sellerId)) return false;
  const threads = (await messages.listFor(Number(reviewerId), 200)).filter((t) => t.kind === 'listing' && Number(t.owner_id) === Number(sellerId) && Number(t.starter_id) === Number(reviewerId));
  for (const t of threads) {
    const msgs = await messages.messagesOf(t.id, 200);
    if (msgs.some((m) => Number(m.sender_id) === Number(sellerId))) return true;
  }
  return false;
}

router.post('/users/:id/review', requireLogin, requireActive, async (req, res) => {
  const sellerId = /^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : null;
  const seller = sellerId ? await users.getById(sellerId) : null;
  const back = `/users/${sellerId}#reviews`;
  if (!seller || seller.deleted_at || seller.status === 'banned') return res.status(404).render('error', { status: 404, title: 'Member not found', message: 'This profile is not available.' });
  if (!(await canReview(req.user.user_id, sellerId))) {
    req.flash('error', 'You can review a seller after you have chatted with them about one of their listings and they have replied.');
    return res.redirect(back);
  }
  const rating = Number.parseInt(req.body.rating, 10);
  const body = clean(req.body.body).slice(0, 500);
  if (!(rating >= 1 && rating <= 5)) {
    req.flash('error', 'Choose a rating from 1 to 5 stars.');
    return res.redirect(back);
  }
  const r = await reviews.upsert({ reviewerId: req.user.user_id, sellerId, rating, body });
  if (r.blocked) {
    req.flash('error', 'Your review was removed by a moderator and cannot be edited.');
    return res.redirect(back);
  }
  await audit({ actor: req.user, action: r.created ? 'review.create' : 'review.update', entityType: 'user', entityId: sellerId, meta: { rating }, ip: req.ip });
  if (r.created) {
    await notify(sellerId, { type: 'system', title: `${req.user.name.split(' ')[0]} left you a ${rating}-star review`, body: body ? body.slice(0, 200) : 'No comment added.', link: `/users/${sellerId}#reviews` });
  }
  req.flash('success', r.created ? 'Thanks. Your review is on the profile now.' : 'Your review was updated.');
  res.redirect(back);
});

router.post('/users/:id/review/delete', requireLogin, async (req, res) => {
  const sellerId = /^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : null;
  const r = sellerId ? await reviews.mine(req.user.user_id, sellerId) : null;
  if (r && r.status === 'visible') {
    await reviews.remove(r.id);
    await audit({ actor: req.user, action: 'review.delete', entityType: 'user', entityId: sellerId, ip: req.ip });
    req.flash('success', 'Your review was deleted.');
  }
  res.redirect(`/users/${sellerId}#reviews`);
});

/* staff: remove a review straight from the profile (kept for the record, hidden from everyone) */
router.post('/reviews/:id/remove', requireLogin, async (req, res) => {
  if (!can(req.user, 'reports')) return res.status(403).render('error', { status: 403, title: 'Not allowed', message: 'Only moderators can remove reviews.' });
  const r = await reviews.get(req.params.id);
  if (!r) return res.status(404).render('error', { status: 404, title: 'Review not found', message: 'It may already have been removed.' });
  await reviews.hide(r.id, req.user.user_id);
  await audit({ actor: req.user, action: 'review.remove', entityType: 'user', entityId: r.seller_id, meta: { reviewer: r.reviewer_id, rating: r.rating }, ip: req.ip });
  await notify(r.reviewer_id, { type: 'system', title: 'Your review was removed', body: 'A moderator removed a review you wrote because it broke the Community rules.', link: '/rules' });
  req.flash('success', 'Review removed.');
  res.redirect(`/users/${r.seller_id}#reviews`);
});

module.exports = router;
module.exports.canReview = canReview;
