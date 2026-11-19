'use strict';
/**
 * Paid promotions: products, Paystack checkout, and fulfilment.
 *
 * Rules that keep the money side safe:
 *  - Prices come only from config, never from the browser.
 *  - A promotion is applied only after the payment is CONFIRMED with Paystack (amount, currency and reference all
 *    match the order), or after an admin confirms a manual payment.
 *  - Fulfilment runs in a Firestore transaction and is idempotent: the browser callback and the webhook can both
 *    arrive, in any order, and the promotion is applied exactly once.
 *  - Nothing here stores card or Mobile Money details.
 */
const crypto = require('crypto');
const config = require('../config');
const orders = require('../repo/orders');
const listings = require('../repo/listings');
const { col, db } = require('../store');
const { audit } = require('./audit');
const { notify } = require('./notify');
const { formatMoney } = require('../lib/validate');

const P = config.payments;
const DAY = 86_400_000;

const PRODUCTS = {
  featured: {
    key: 'featured', name: 'Featured listing', price: P.prices.featured, days: 7,
    tagline: 'Stand out for a week',
    includes: ['Gold “Featured” badge', 'Shown in the Featured section on the home page', '7 days, then it goes back to normal'],
  },
  business: {
    key: 'business', name: 'Business advertisement', price: P.prices.business, days: P.businessDays,
    tagline: 'For shops, services and campus businesses',
    includes: ['“Business” badge on your advertisement', 'Shown in the Local businesses section on the home page', `${P.businessDays} days of visibility`],
  },
  premium: {
    key: 'premium', name: 'Premium business promotion', price: P.prices.premium, days: P.businessDays,
    tagline: 'Maximum visibility',
    includes: ['Everything in Business advertisement', 'Featured placement for the full period', 'Gold “Premium” badge', `${P.businessDays} days of visibility`],
  },
};
const productList = () => Object.values(PRODUCTS);

const onlinePaymentsOn = () => Boolean(P.paystackSecret);
const money = (pesewas) => formatMoney(pesewas);

/* ---------------------------------------------------------------- Paystack client (replaceable in tests) */
async function paystackFetch(path, { method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`https://api.paystack.co${path}`, {
      method,
      headers: { authorization: `Bearer ${P.paystackSecret}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.status === false) throw new Error(`Paystack ${res.status}: ${String(json.message || '').slice(0, 120)}`);
    return json;
  } finally { clearTimeout(timer); }
}
let paystack = paystackFetch;
const setPaystackClient = (fn) => { paystack = fn || paystackFetch; };

async function initializeCheckout(order, user) {
  const json = await paystack('/transaction/initialize', {
    method: 'POST',
    body: {
      email: user.email, amount: order.amount, currency: order.currency, reference: order.reference,
      callback_url: `${config.baseUrl}/pay/callback`,
      metadata: { order_id: order.order_id, listing_id: order.listing_id, product: order.product },
    },
  });
  return json.data.authorization_url;
}

/** Ask Paystack whether this reference was really paid, for the right amount. */
async function confirmWithProvider(order) {
  const json = await paystack(`/transaction/verify/${encodeURIComponent(order.reference)}`);
  const d = json.data || {};
  const ok = d.status === 'success' && Number(d.amount) === order.amount && String(d.currency).toUpperCase() === order.currency && d.reference === order.reference;
  return { ok, status: d.status || 'unknown' };
}

/* ---------------------------------------------------------------- creating orders */
async function createOrder({ user, listing, productKey }) {
  const product = PRODUCTS[productKey];
  if (!product) throw Object.assign(new Error('Unknown product'), { code: 'BAD_PRODUCT' });
  const online = onlinePaymentsOn();
  const order = await orders.create({
    user_id: user.user_id, listing_id: listing.listing_id, listing_title: String(listing.title).slice(0, 90),
    product: product.key, product_name: product.name, days: product.days,
    amount: product.price, currency: config.currency.code,
    provider: online ? 'paystack' : 'manual', status: online ? 'pending' : 'awaiting_payment',
    reference: '', // set below once the order id is known
  });
  const reference = `CF-${order.order_id}-${crypto.randomBytes(5).toString('hex')}`;
  await orders.update(order.order_id, { reference: online ? reference : `CF-${order.order_id}` });
  order.reference = online ? reference : `CF-${order.order_id}`;
  return order;
}

/* ---------------------------------------------------------------- fulfilment */
function applyProduct(listing, order, now) {
  const featuredBase = Math.max(now, listing.is_featured ? listing.featured_until || 0 : 0);
  const promoBase = Math.max(now, listing.promo_until || 0);
  const patch = {};
  if (order.product === 'featured') {
    patch.is_featured = 1; patch.featured_until = featuredBase + order.days * DAY;
  } else if (order.product === 'business') {
    patch.promo_tier = listing.promo_tier === 'premium' && (listing.promo_until || 0) > now ? 'premium' : 'business';
    patch.promo_until = promoBase + order.days * DAY;
  } else if (order.product === 'premium') {
    patch.promo_tier = 'premium'; patch.promo_until = promoBase + order.days * DAY;
    patch.is_featured = 1; patch.featured_until = featuredBase + order.days * DAY;
  }
  patch.updated_at = now;
  return patch;
}

/**
 * Mark an order paid and apply the promotion, exactly once.
 * Returns { applied: boolean } where false means it had already been fulfilled.
 */
async function fulfil(orderId, { by = null, provider = null } = {}) {
  const oref = orders.ref(orderId);
  const result = await db.runTransaction(async (tx) => {
    const osnap = await tx.get(oref);
    if (!osnap.exists) return { applied: false, missing: true };
    const order = osnap.data();
    if (order.status === 'paid') return { applied: false, order };
    if (['cancelled', 'refunded'].includes(order.status)) return { applied: false, order, blocked: order.status };
    const lref = col('listings').doc(String(order.listing_id));
    const lsnap = await tx.get(lref);
    const now = Date.now();
    const lpatch = lsnap.exists ? applyProduct(lsnap.data(), order, now) : null;
    tx.update(oref, { status: 'paid', paid_at: now, confirmed_by: by, provider: provider || order.provider });
    if (lpatch) tx.update(lref, lpatch);
    return { applied: true, order: { ...order, status: 'paid', paid_at: now }, now };
  });
  if (result.applied) {
    listings.invalidate();
    await notify(result.order.user_id, {
      type: 'system', title: `Payment received: ${result.order.product_name}`,
      body: `Your promotion for “${result.order.listing_title}” is now active for ${result.order.days} days.`, link: `/listings/${result.order.listing_id}`,
    });
    await audit({ actor: by ? { user_id: by.user_id, role: by.role } : null, action: 'order.paid', entityType: 'order', entityId: result.order.order_id, meta: { product: result.order.product, amount: result.order.amount, provider: provider || result.order.provider } });
  }
  return result;
}

/** Take back the days an order added (refund). Does not touch other purchases beyond subtracting this order's days. */
async function revoke(order) {
  const l = await listings.get(order.listing_id);
  if (!l) return;
  const now = Date.now();
  const patch = { updated_at: now };
  const back = order.days * DAY;
  if (order.product === 'featured' || order.product === 'premium') {
    const until = (l.featured_until || 0) - back;
    if (until <= now) { patch.is_featured = 0; patch.featured_until = null; } else patch.featured_until = until;
  }
  if (order.product === 'business' || order.product === 'premium') {
    const until = (l.promo_until || 0) - back;
    if (until <= now) { patch.promo_tier = null; patch.promo_until = null; } else patch.promo_until = until;
  }
  await listings.update(order.listing_id, patch);
}

/** Verify a Paystack webhook signature (HMAC SHA-512 of the raw body with the secret key). */
function validSignature(rawBody, signature) {
  if (!P.paystackSecret || !signature) return false;
  const expected = crypto.createHmac('sha512', P.paystackSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected); const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ----- housekeeping: unpaid Mobile Money orders expire ----- */
const STALE_DAYS = 7;
let lastSweep = 0;
/**
 * Cancel manual orders still unpaid after STALE_DAYS and tell the member. Orders where the member reported paying
 * are never touched: a person must check those. There is no scheduler on Vercel's free plan, so this runs lazily when
 * someone opens an orders page, at most every 10 minutes per instance. Never throws.
 */
async function expireStale({ force = false, now = Date.now() } = {}) {
  if (!force && now - lastSweep < 10 * 60_000) return 0;
  lastSweep = now;
  try {
    const snap = await orders.O().where('status', '==', 'awaiting_payment').limit(500).get();
    const cutoff = now - STALE_DAYS * DAY;
    let n = 0;
    for (const d of snap.docs) {
      const o = d.data();
      if (o.provider !== 'manual' || o.claimed_at || !(o.created_at < cutoff)) continue;
      await orders.update(o.order_id, { status: 'cancelled', cancelled_at: now, cancel_reason: 'expired' });
      await notify(o.user_id, {
        type: 'system', title: `Order #${o.order_id} expired`,
        body: `We did not receive payment within ${STALE_DAYS} days, so the order was cancelled. Nothing was charged. If you still want the promotion, order again from My listings.`,
        link: `/orders/${o.order_id}`,
      });
      n += 1;
    }
    if (n) console.log(`[payments] expired ${n} unpaid order(s)`);
    return n;
  } catch (err) {
    console.error('[payments] could not expire old orders:', err.message);
    return 0;
  }
}

module.exports = { STALE_DAYS, expireStale, PRODUCTS, productList, onlinePaymentsOn, money, createOrder, initializeCheckout, confirmWithProvider, fulfil, revoke, validSignature, setPaystackClient };
