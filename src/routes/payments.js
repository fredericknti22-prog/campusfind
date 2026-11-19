'use strict';
const listings = require('../repo/listings');
/** Pricing, paid promotions, order history and the admin order tools. */
const express = require('express');
const config = require('../config');
const payments = require('../services/payments');
const orders = require('../repo/orders');
const users = require('../repo/users');
const { getMany } = require('../store');
const { audit } = require('../services/audit');
const { notify } = require('../services/notify');
const { sharedRateLimit } = require('../middleware/sharedLimit');
const { requireLogin, requireActive, requireStaff, loadListingForOwner } = require('../middleware/auth');

const router = express.Router();
const orderLimiter = sharedRateLimit({
  name: 'order', windowMs: 3600_000, max: 12, key: (req) => `order:${req.user ? req.user.user_id : req.ip}`,
  message: 'You have started a lot of orders in the last hour. Please try again later.',
});

/* ----- public price list ----- */
router.get('/pricing', (req, res) => res.render('pricing', { products: payments.productList(), online: payments.onlinePaymentsOn() }));

/* ----- pay first from the Pricing page; the listing is chosen after payment ----- */
router.post('/pricing/:product/buy', requireLogin, requireActive, orderLimiter, async (req, res) => {
  if (!payments.PRODUCTS[req.params.product]) { req.flash('error', 'Choose one of the promotions.'); return res.redirect('/pricing'); }
  const order = await payments.createOrder({ user: req.user, listing: null, productKey: req.params.product });
  await audit({ actor: req.user, action: 'order.create', entityType: 'order', entityId: order.order_id, meta: { product: order.product, provider: order.provider, payFirst: true }, ip: req.ip });
  if (order.provider === 'paystack') {
    try { return res.redirect(await payments.initializeCheckout(order, req.user)); } catch (err) {
      console.error('[payments] could not start checkout:', err.message);
      await orders.update(order.order_id, { status: 'failed' });
      req.flash('error', 'We could not open the payment page just now. Nothing was charged. Please try again in a moment.');
      return res.redirect('/pricing');
    }
  }
  return res.redirect(`/orders/${order.order_id}`);
});

router.post('/orders/:id/apply', requireLogin, async (req, res) => {
  const id = /^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : null;
  const lid = /^\d{1,9}$/.test(String(req.body.listing_id || '')) ? Number(req.body.listing_id) : null;
  if (!id || !lid) { req.flash('error', 'Choose a listing.'); return res.redirect(id ? `/orders/${id}` : '/orders'); }
  const r = await payments.applyToListing(id, req.user, lid);
  if (r.ok) { req.flash('success', `Done. “${String(r.listing.title).slice(0, 60)}” is promoted for ${r.order.days} days.`); return res.redirect(`/listings/${lid}`); }
  req.flash('error', { used: 'This payment has already been used for a listing.', 'not-live': 'Choose one of your live listings.', forbidden: 'You can only promote your own listings.' }[r.error] || 'That did not work. Please try again.');
  return res.redirect(`/orders/${id}`);
});

/* ----- choose a promotion for a listing ----- */
router.get('/listings/:id/promote', requireLogin, loadListingForOwner, (req, res) => {
  if (req.listing.status !== 'active' && !req.listing.awaiting_payment) {
    req.flash('info', 'Only live listings can be promoted. Make the listing live first.');
    return res.redirect('/my/listings');
  }
  const forBusiness = Boolean(req.listing.awaiting_payment);
  res.render('promote', { l: req.listing, products: payments.productList().filter((p) => !forBusiness || p.key !== 'featured'), online: payments.onlinePaymentsOn(), forBusiness });
});

router.post('/listings/:id/promote', requireLogin, requireActive, orderLimiter, loadListingForOwner, async (req, res) => {
  const l = req.listing;
  if (l.status !== 'active' && !l.awaiting_payment) {
    req.flash('error', 'Only live listings can be promoted.');
    return res.redirect('/my/listings');
  }
  if (!payments.PRODUCTS[req.body.product] || (l.awaiting_payment && req.body.product === 'featured')) {
    req.flash('error', 'Choose one of the promotions.');
    return res.redirect(`/listings/${l.listing_id}/promote`);
  }
  const order = await payments.createOrder({ user: req.user, listing: l, productKey: req.body.product });
  await audit({ actor: req.user, action: 'order.create', entityType: 'order', entityId: order.order_id, meta: { product: order.product, provider: order.provider }, ip: req.ip });
  if (order.provider === 'paystack') {
    try {
      return res.redirect(await payments.initializeCheckout(order, req.user));
    } catch (err) {
      console.error('[payments] could not start checkout:', err.message);
      await orders.update(order.order_id, { status: 'failed' });
      req.flash('error', 'We could not open the payment page just now. Nothing was charged. Please try again in a moment.');
      return res.redirect(`/listings/${l.listing_id}/promote`);
    }
  }
  return res.redirect(`/orders/${order.order_id}`);
});

/* ----- Paystack sends the member back here after paying ----- */
router.get('/pay/callback', requireLogin, async (req, res) => {
  const reference = String(req.query.reference || req.query.trxref || '').slice(0, 80);
  const order = reference ? await orders.byReference(reference) : null;
  if (!order || order.user_id !== req.user.user_id || order.provider !== 'paystack') {
    return res.status(404).render('error', { status: 404, title: 'Order not found', message: 'We could not find that payment.' });
  }
  if (order.status !== 'paid') {
    let confirmed = { ok: false };
    try { confirmed = await payments.confirmWithProvider(order); } catch (err) { console.error('[payments] verify failed:', err.message); }
    if (confirmed.ok) await payments.fulfil(order.order_id, { provider: 'paystack' });
    else {
      req.flash('info', 'We have not received confirmation of this payment yet. If you were charged, your promotion will switch on automatically within a few minutes.');
      return res.redirect(`/orders/${order.order_id}`);
    }
  }
  req.flash('success', 'Payment received. Your promotion is live.');
  res.redirect(`/listings/${order.listing_id}`);
});

/* ----- my orders ----- */
router.get('/orders', requireLogin, async (req, res) => {
  await payments.expireStale();
  res.render('myOrders', { items: await orders.byUser(req.user.user_id) });
});

async function myOrder(req, res) {
  const id = /^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : null;
  const order = id ? await orders.get(id) : null;
  if (!order || order.user_id !== req.user.user_id) {
    res.status(404).render('error', { status: 404, title: 'Order not found', message: 'That order does not exist.' });
    return null;
  }
  return order;
}

router.get('/orders/:id', requireLogin, async (req, res) => {
  const order = await myOrder(req, res);
  if (!order) return;
  const choices = order.status === 'paid' && order.needs_listing
    ? (await listings.byOwner(req.user.user_id)).filter((l) => !l.deleted_at && (l.status === 'active' || l.awaiting_payment)).sort((a, b) => b.updated_at - a.updated_at)
    : [];
  res.render('orderDetail', { order, choices, instructions: config.payments.manualInstructions, momo: require('../services/settings').momo() });
});

/* ----- member reports a Mobile Money payment so staff can match it ----- */
router.post('/orders/:id/paid', requireLogin, requireActive, async (req, res) => {
  const order = await myOrder(req, res);
  if (!order) return;
  if (order.provider !== 'manual' || order.status !== 'awaiting_payment') {
    req.flash('error', 'This order is not waiting for a Mobile Money payment.');
    return res.redirect(`/orders/${order.order_id}`);
  }
  const ref = String(req.body.payer_ref || '').trim().replace(/\s+/g, '').slice(0, 40);
  if (!/^[A-Za-z0-9.\-]{4,40}$/.test(ref)) {
    req.flash('error', 'Enter the transaction ID from your Mobile Money message (letters and numbers, at least 4).');
    return res.redirect(`/orders/${order.order_id}#paid`);
  }
  await orders.update(order.order_id, { payer_ref: ref, claimed_at: Date.now() });
  await audit({ actor: req.user, action: 'order.claim_paid', entityType: 'order', entityId: order.order_id, meta: { payer_ref: ref }, ip: req.ip });
  // tell everyone who can confirm orders, so the payment is checked without anyone polling the Orders page
  const { can } = require('../middleware/auth');
  const team = (await users.staff()).filter((u) => can(u, 'orders') && u.user_id !== req.user.user_id);
  await Promise.all(team.map((u) => notify(u.user_id, {
    type: 'system', title: `Payment reported for order #${order.order_id}`,
    body: `${req.user.name} says they sent ${payments.money(order.amount)} by Mobile Money. Transaction ID ${ref}. Check your MoMo history, then confirm it.`,
    link: '/admin/orders',
  })));
  req.flash('success', 'Thanks. We will check the payment and switch your promotion on, usually within a few hours.');
  res.redirect(`/orders/${order.order_id}`);
});

router.post('/orders/:id/cancel', requireLogin, async (req, res) => {
  const order = await myOrder(req, res);
  if (!order) return;
  // Only manual orders can be cancelled by the member. An online order may already be mid-payment.
  if (order.provider === 'manual' && order.status === 'awaiting_payment') {
    await orders.update(order.order_id, { status: 'cancelled' });
    await audit({ actor: req.user, action: 'order.cancel', entityType: 'order', entityId: order.order_id, ip: req.ip });
    req.flash('success', 'Order cancelled.');
  } else {
    req.flash('error', 'This order cannot be cancelled.');
  }
  res.redirect('/orders');
});

/* ----- admin: orders ----- */
router.get('/admin/orders', requireStaff('orders'), async (req, res) => {
  await payments.expireStale();
  const items = await orders.recent(200);
  const people = await getMany('users', items.map((o) => o.user_id));
  const since = Date.now() - 30 * 86_400_000;
  const paid30 = items.filter((o) => o.status === 'paid' && o.paid_at > since);
  res.render('adminOrders', {
    items: items.map((o) => ({ ...o, who: people.get(String(o.user_id)) || null })),
    revenue30: paid30.reduce((n, o) => n + o.amount, 0), paidCount30: paid30.length,
    waiting: items.filter((o) => ['awaiting_payment', 'pending'].includes(o.status)).length,
    claimed: items.filter((o) => o.status === 'awaiting_payment' && o.claimed_at).length,
  });
});

router.post('/admin/orders/:id/confirm', requireStaff('orders'), async (req, res) => {
  const order = /^\d{1,9}$/.test(req.params.id) ? await orders.get(Number(req.params.id)) : null;
  if (!order || !['awaiting_payment', 'pending'].includes(order.status)) {
    req.flash('error', 'That order cannot be confirmed.');
    return res.redirect('/admin/orders');
  }
  const r = await payments.fulfil(order.order_id, { by: req.user, provider: 'manual' });
  req.flash(r.applied ? 'success' : 'info', r.applied ? `Order #${order.order_id} confirmed. The promotion is now live.` : 'That order was already paid.');
  res.redirect('/admin/orders');
});

router.post('/admin/orders/:id/refund', requireStaff('orders'), async (req, res) => {
  const order = /^\d{1,9}$/.test(req.params.id) ? await orders.get(Number(req.params.id)) : null;
  if (!order || order.status !== 'paid') {
    req.flash('error', 'Only paid orders can be refunded.');
    return res.redirect('/admin/orders');
  }
  await payments.revoke(order);
  await orders.update(order.order_id, { status: 'refunded', refunded_at: Date.now(), refunded_by: req.user.user_id });
  await audit({ actor: req.user, action: 'order.refund', entityType: 'order', entityId: order.order_id, meta: { amount: order.amount }, ip: req.ip });
  await notify(order.user_id, { type: 'system', title: `Order #${order.order_id} refunded`, body: 'The promotion was removed. The money is returned to you separately.', link: '/orders' });
  req.flash('success', `Order #${order.order_id} marked refunded and the promotion removed. Send the money back to the member yourself (Paystack dashboard or Mobile Money).`);
  res.redirect('/admin/orders');
});

/* ----- Paystack webhook (mounted in app.js before body parsing, so it receives the raw bytes) ----- */
async function webhook(req, res) {
  const raw = req.body;
  if (!Buffer.isBuffer(raw) || !payments.validSignature(raw, req.get('x-paystack-signature'))) return res.status(401).end();
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch (_) { return res.status(400).end(); }
  try {
    const ref = event && event.event === 'charge.success' && event.data && event.data.reference;
    if (ref) {
      const order = await orders.byReference(String(ref).slice(0, 80));
      if (order && order.provider === 'paystack' && order.status !== 'paid') {
        const confirmed = await payments.confirmWithProvider(order);
        if (confirmed.ok) await payments.fulfil(order.order_id, { provider: 'paystack' });
      }
    }
  } catch (err) {
    console.error('[payments] webhook handling failed:', err.message);
    return res.status(500).end(); // Paystack retries
  }
  return res.status(200).end();
}

module.exports = router;
module.exports.webhook = webhook;
