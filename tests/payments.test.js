'use strict';
/** Paid promotions: pricing, Paystack checkout (scripted, no network), webhook, manual payment, refunds. */
process.env.NODE_ENV = 'test';
process.env.PHOTOS_ENABLED = 'false';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit_secret';
process.env.MANUAL_PAYMENT_INSTRUCTIONS = 'Send Mobile Money to 024 000 0000 (CampusFind).';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-campusfind';
process.env.FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT;
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.GCLOUD_PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.ADMIN_EMAIL = 'pay-root@campus.test';
process.env.ADMIN_PASSWORD = 'Quartz-Lantern-Meadow-63';
process.env.GLOBAL_LIMIT_PER_MIN = '100000';
process.env.REGISTER_LIMIT_PER_HOUR = '500';
process.env.LOGIN_LIMIT_PER_15_MIN = '500';
process.env.BASE_URL = 'https://campusfind.example';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const config = require('../src/config');
const { init } = require('../src/bootstrap');
const { createApp } = require('../src/app');
const listings = require('../src/repo/listings');
const orders = require('../src/repo/orders');
const users = require('../src/repo/users');
const payments = require('../src/services/payments');
const notifications = require('../src/services/notify');

let server; let base;
const RUN = Date.now().toString(36);
const PW = 'Meadow-Lantern-Quartz-7';
const DAY = 86_400_000;

class Client {
  constructor() { this.jar = new Map(); }
  async req(method, url, { form, raw, headers = {} } = {}) {
    const h = { ...headers };
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    if (raw !== undefined) { h['content-type'] = 'application/json'; body = raw; }
    const res = await fetch(base + url, { method, headers: h, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    res.text = await res.text();
    return res;
  }
  get(u) { return this.req('GET', u); }
  async token(u) { return /name="_csrf" value="([^"]+)"/.exec((await this.get(u)).text)[1]; }
  async post(u, form, from = '/pricing') { return this.req('POST', u, { form: { _csrf: await this.token(from), ...form } }); }
}

async function member(name, tag = name.split(' ')[0].toLowerCase()) {
  const c = new Client();
  const email = `${tag}.${RUN}@campus.test`;
  const r = await c.post('/register', { name, email, password: PW, agree: '1', dob: '1998-05-14' }, '/register');
  assert.equal(r.status, 302, `register ${email}`);
  return { c, email };
}
const ADMIN = { email: `ops.${RUN}@campus.test`, password: 'Quartz-Lantern-Meadow-63' };
let adminReady = false;
async function admin() {
  // The first-run super admin only exists when the database was empty, so make a staff account for this file.
  if (!adminReady) {
    await require('../src/services/auth').createAccount({ name: 'Ops Admin', email: ADMIN.email, password: ADMIN.password, role: 'admin' });
    adminReady = true;
  }
  const c = new Client();
  const r = await c.post('/admin/login', { email: ADMIN.email, password: ADMIN.password, next: '/admin' }, '/admin/login');
  assert.equal(r.status, 302, 'staff login');
  return c;
}
async function newListing(c, over = {}) {
  const r = await c.post('/listings/new', { title: 'Business cards printing', category_id: '1', price_type: 'none', description: 'Fast, cheap printing on campus.', contact: 'Ask me', intent: 'publish', ...over }, '/listings/new');
  assert.equal(r.status, 302, r.text.slice(0, 200));
  return Number(/\/listings\/(\d+)/.exec(r.headers.get('location'))[1]);
}

/** A scripted Paystack. `paid` decides what verification says. */
function fakePaystack({ paid = true, amountOverride = null } = {}) {
  const calls = [];
  const fn = async (path, opts = {}) => {
    calls.push({ path, opts });
    if (path === '/transaction/initialize') {
      return { status: true, data: { authorization_url: `https://checkout.paystack.test/pay/${opts.body.reference}`, reference: opts.body.reference } };
    }
    if (path.startsWith('/transaction/verify/')) {
      const reference = decodeURIComponent(path.split('/').pop());
      const order = await orders.byReference(reference);
      return { status: true, data: { status: paid ? 'success' : 'failed', amount: amountOverride ?? order.amount, currency: order.currency, reference } };
    }
    throw new Error(`unexpected Paystack call ${path}`);
  };
  fn.calls = calls;
  return fn;
}
const sign = (body) => crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(body).digest('hex');

test.before(async () => {
  await init();
  await new Promise((resolve) => { server = createApp().listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { payments.setPaystackClient(null); server.close(); setTimeout(() => process.exit(0), 200).unref(); });

/* ------------------------------------------------------------------ price list */
test('pricing page lists the free tier and the three paid promotions in Ghana cedis, with no automatic renewal', async () => {
  const r = await new Client().get('/pricing');
  assert.equal(r.status, 200);
  for (const s of [/Basic student listing/, /Free/, /Featured listing/, /GH₵10\b/, /Business advertisement/, /GH₵50\b/, /Premium business promotion/, /GH₵100\b/, /no automatic renewal/i, /never charge you again/i]) assert.match(r.text, s);
  assert.match((await new Client().get('/')).text, /href="\/pricing"/, 'linked from the footer');
  assert.deepEqual(Object.values(payments.PRODUCTS).map((p) => [p.key, p.price, p.days]), [['featured', 1000, 7], ['business', 5000, 30], ['premium', 10000, 30]]);
});

test('listing prices are shown in cedis', async () => {
  const { c } = await member('Cedi Seller');
  const id = await newListing(c, { title: 'Desk for sale', price_type: 'fixed', price: '25.50' });
  assert.match((await new Client().get(`/listings/${id}`)).text, /GH₵25\.50/);
  assert.doesNotMatch((await new Client().get(`/listings/${id}`)).text, /\$25/);
});

/* ------------------------------------------------------------------ online checkout */
test('online checkout: pay for a featured listing, confirmed with Paystack, applied once', async () => {
  const ps = fakePaystack();
  payments.setPaystackClient(ps);
  const { c, email } = await member('Fiona Featured');
  const id = await newListing(c);
  assert.match((await c.get(`/listings/${id}`)).text, /Promote/);

  // The price on screen sits next to the button
  const page = (await c.get(`/listings/${id}/promote`)).text;
  assert.match(page, /Pay GH₵10 · 7 days/);
  assert.match(page, /No automatic renewal/);

  const start = await c.post(`/listings/${id}/promote`, { product: 'featured', amount: '1', price: '0.01' }, `/listings/${id}/promote`);
  assert.equal(start.status, 302);
  assert.match(start.headers.get('location'), /^https:\/\/checkout\.paystack\.test\/pay\/CF-\d+-[a-f0-9]{10}$/);
  const init = ps.calls.find((x) => x.path === '/transaction/initialize').opts.body;
  assert.equal(init.amount, 1000, 'the amount comes from the server, never from the browser');
  assert.equal(init.currency, 'GHS');
  assert.equal(init.email, email);
  assert.equal(init.callback_url, 'https://campusfind.example/pay/callback');

  const order = await orders.byReference(init.reference);
  assert.equal(order.status, 'pending');
  assert.equal(order.provider, 'paystack');
  assert.ok(!(await listings.get(id)).is_featured, 'nothing is applied before payment is confirmed');

  const back = await c.get(`/pay/callback?reference=${init.reference}`);
  assert.equal(back.status, 302);
  assert.equal(back.headers.get('location'), `/listings/${id}`);
  const l1 = await listings.get(id);
  assert.equal(l1.is_featured, 1);
  const days = (l1.featured_until - Date.now()) / DAY;
  assert.ok(days > 6.99 && days <= 7.01, `featured for seven days (${days.toFixed(2)})`);
  assert.equal((await orders.get(order.order_id)).status, 'paid');
  const note = (await notifications.list((await users.getByEmail(email)).user_id)).find((n) => /Payment received/.test(n.title));
  assert.ok(note, 'the member is told');
  assert.match((await new Client().get('/')).text, /Featured/);

  // The browser callback arriving twice, or the webhook after it, does not extend the promotion again
  await c.get(`/pay/callback?reference=${init.reference}`);
  assert.equal((await listings.get(id)).featured_until, l1.featured_until, 'applied exactly once');
  const body = JSON.stringify({ event: 'charge.success', data: { reference: init.reference } });
  const hook = await new Client().req('POST', '/pay/webhook', { raw: body, headers: { 'x-paystack-signature': sign(body) } });
  assert.equal(hook.status, 200);
  assert.equal((await listings.get(id)).featured_until, l1.featured_until, 'webhook after callback changes nothing');

  // Buying again extends from the end of the current period
  const again = await c.post(`/listings/${id}/promote`, { product: 'featured' }, `/listings/${id}/promote`);
  const ref2 = ps.calls.filter((x) => x.path === '/transaction/initialize').at(-1).opts.body.reference;
  assert.equal(again.status, 302);
  await c.get(`/pay/callback?reference=${ref2}`);
  const extended = (await listings.get(id)).featured_until - l1.featured_until;
  assert.ok(Math.abs(extended - 7 * DAY) < 5_000, 'a second purchase adds seven more days');
});

test('checkout refuses tampering, strangers, unknown products and listings that are not live', async () => {
  payments.setPaystackClient(fakePaystack());
  const { c } = await member('Owen Owner');
  const { c: other } = await member('Mallory Other');
  const id = await newListing(c);

  const bad = await c.post(`/listings/${id}/promote`, { product: 'free-forever' }, `/listings/${id}/promote`);
  assert.equal(bad.status, 302);
  assert.match(bad.headers.get('location'), /\/promote$/);
  assert.equal((await orders.byUser((await users.getByEmail(`owen.${RUN}@campus.test`)).user_id)).length, 0, 'no order for an unknown product');

  assert.equal((await other.post(`/listings/${id}/promote`, { product: 'premium' }, '/pricing')).status, 403, 'cannot buy for someone else\'s listing');
  assert.equal((await new Client().req('POST', `/listings/${id}/promote`, { form: { product: 'featured' } })).status, 403, 'CSRF is enforced');

  await c.post(`/listings/${id}/status`, { status: 'closed' }, '/my/listings');
  const closed = await c.post(`/listings/${id}/promote`, { product: 'featured' }, '/pricing');
  assert.equal(closed.status, 302);
  assert.equal(closed.headers.get('location'), '/my/listings');
  assert.equal((await orders.byUser((await users.getByEmail(`owen.${RUN}@campus.test`)).user_id)).length, 0);
});

test('a payment is never applied unless Paystack confirms the right amount', async () => {
  const { c, email } = await member('Wanda Wrong');
  const id = await newListing(c);
  const uid = (await users.getByEmail(email)).user_id;

  for (const [label, ps] of [['unpaid', fakePaystack({ paid: false })], ['wrong amount', fakePaystack({ amountOverride: 100 })]]) {
    payments.setPaystackClient(ps);
    await c.post(`/listings/${id}/promote`, { product: 'premium' }, `/listings/${id}/promote`);
    const order = (await orders.byUser(uid))[0];
    const back = await c.get(`/pay/callback?reference=${order.reference}`);
    assert.match(back.headers.get('location'), new RegExp(`/orders/${order.order_id}$`), label);
    assert.ok(!(await listings.get(id)).promo_tier, `${label}: not applied`);
    assert.equal((await orders.get(order.order_id)).status, 'pending', `${label}: still pending`);
    // another member cannot confirm it either
    const { c: thief } = await member('Thief Member', `thief${label.replace(/\W/g, '')}`);
    assert.equal((await thief.get(`/pay/callback?reference=${order.reference}`)).status, 404);
    await orders.update(order.order_id, { status: 'cancelled' });
  }
});

/* ------------------------------------------------------------------ webhook */
test('webhook: needs a valid signature, tolerates junk, and fulfils a real payment without a session', async () => {
  const ps = fakePaystack();
  payments.setPaystackClient(ps);
  const { c, email } = await member('Hank Hook');
  const id = await newListing(c);
  await c.post(`/listings/${id}/promote`, { product: 'business' }, `/listings/${id}/promote`);
  const order = (await orders.byUser((await users.getByEmail(email)).user_id))[0];
  const body = JSON.stringify({ event: 'charge.success', data: { reference: order.reference } });
  const anon = new Client();

  assert.equal((await anon.req('POST', '/pay/webhook', { raw: body })).status, 401, 'no signature');
  assert.equal((await anon.req('POST', '/pay/webhook', { raw: body, headers: { 'x-paystack-signature': 'abc' } })).status, 401, 'bad signature');
  assert.equal((await anon.req('POST', '/pay/webhook', { raw: body.replace('success', 'tampered'), headers: { 'x-paystack-signature': sign(body) } })).status, 401, 'signature does not match the body');
  assert.equal((await anon.req('POST', '/pay/webhook', { raw: 'not json', headers: { 'x-paystack-signature': sign('not json') } })).status, 400);
  assert.ok(!(await listings.get(id)).promo_tier, 'nothing applied yet');

  const other = JSON.stringify({ event: 'charge.success', data: { reference: 'CF-999999-unknown' } });
  assert.equal((await anon.req('POST', '/pay/webhook', { raw: other, headers: { 'x-paystack-signature': sign(other) } })).status, 200, 'unknown references are ignored politely');
  const ignored = JSON.stringify({ event: 'transfer.success', data: {} });
  assert.equal((await anon.req('POST', '/pay/webhook', { raw: ignored, headers: { 'x-paystack-signature': sign(ignored) } })).status, 200);

  const ok = await anon.req('POST', '/pay/webhook', { raw: body, headers: { 'x-paystack-signature': sign(body) } });
  assert.equal(ok.status, 200);
  const l = await listings.get(id);
  assert.equal(l.promo_tier, 'business');
  assert.ok(Math.abs((l.promo_until - Date.now()) / DAY - config.payments.businessDays) < 0.01);
  assert.ok(!l.is_featured, 'a business advertisement is not a featured placement');

  // Shown on the home page and cards
  const home = (await new Client().get('/')).text;
  assert.match(home, /class="tag tag--blue">[^]*?Business/, 'a business advert is labelled on its card');
  assert.match((await new Client().get(`/listings/${id}`)).text, /Business/);
});

/* ------------------------------------------------------------------ premium */
test('premium promotion is a business advert plus featured placement for the full period', async () => {
  const ps = fakePaystack();
  payments.setPaystackClient(ps);
  const { c, email } = await member('Pia Premium');
  const id = await newListing(c, { title: 'Campus laundry service' });
  await c.post(`/listings/${id}/promote`, { product: 'premium' }, `/listings/${id}/promote`);
  const order = (await orders.byUser((await users.getByEmail(email)).user_id))[0];
  assert.equal(order.amount, 10000);
  await c.get(`/pay/callback?reference=${order.reference}`);
  const l = await listings.get(id);
  assert.equal(l.promo_tier, 'premium');
  assert.equal(l.is_featured, 1);
  assert.ok(l.featured_until > Date.now() + 29 * DAY);
  const home = (await new Client().get('/')).text;
  assert.match(home, /class="tag tag--gold">[^]*?Premium/, 'a premium promotion is labelled on its card');

  // Buying a plain business ad on top does not downgrade the premium badge
  await c.post(`/listings/${id}/promote`, { product: 'business' }, `/listings/${id}/promote`);
  const second = (await orders.byUser((await users.getByEmail(email)).user_id)).find((o) => o.product === 'business');
  await c.get(`/pay/callback?reference=${second.reference}`);
  assert.equal((await listings.get(id)).promo_tier, 'premium');
});

/* ------------------------------------------------------------------ manual payment + admin */
test('manual payment: order number and instructions, admin confirms, member can cancel only while unpaid, refunds take the days back', async () => {
  const saved = config.payments.paystackSecret;
  config.payments.paystackSecret = ''; // no online payments
  try {
    const { c, email } = await member('Mia Manual');
    const uid = (await users.getByEmail(email)).user_id;
    const id = await newListing(c);
    assert.match((await c.get(`/listings/${id}/promote`)).text, /Order for GH₵10 · 7 days/);

    const made = await c.post(`/listings/${id}/promote`, { product: 'featured' }, `/listings/${id}/promote`);
    assert.equal(made.status, 302);
    const order = (await orders.byUser(uid))[0];
    assert.equal(made.headers.get('location'), `/orders/${order.order_id}`);
    assert.equal(order.provider, 'manual');
    assert.equal(order.status, 'awaiting_payment');
    assert.equal(order.reference, `CF-${order.order_id}`);

    const page = (await c.get(`/orders/${order.order_id}`)).text;
    assert.match(page, /How to pay/);
    assert.match(page, /Send Mobile Money to 024 000 0000/);
    assert.match(page, new RegExp(`CF-${order.order_id}`));
    assert.match(page, /GH₵10/);
    assert.match((await c.get('/orders')).text, new RegExp(`Order #${order.order_id}`));
    assert.ok(!(await listings.get(id)).is_featured, 'not applied until an admin confirms');

    // Other members cannot see or cancel it; staff screens are closed to members
    const { c: nosy } = await member('Nosy Neighbour');
    assert.equal((await nosy.get(`/orders/${order.order_id}`)).status, 404);
    assert.equal((await nosy.post(`/orders/${order.order_id}/cancel`, {}, '/pricing')).status, 404);
    assert.notEqual((await c.get('/admin/orders')).status, 200);

    // A cancelled order cannot be confirmed
    await c.post(`/orders/${order.order_id}/cancel`, {}, '/orders');
    assert.equal((await orders.get(order.order_id)).status, 'cancelled');

    await c.post(`/listings/${id}/promote`, { product: 'featured' }, `/listings/${id}/promote`);
    const order2 = (await orders.byUser(uid))[0];

    const a = await admin(); // staff exist before the member reports paying, so they are notified
    // With a MoMo number published, the member can report the transaction ID so staff can match the payment
    config.payments.momo.number = '0241234567';
    try {
      assert.match((await c.get(`/orders/${order2.order_id}`)).text, /I have sent the money/);
      assert.equal((await c.post(`/orders/${order2.order_id}/paid`, { payer_ref: '1' }, `/orders/${order2.order_id}`)).status, 302);
      assert.equal((await orders.get(order2.order_id)).claimed_at, undefined, 'too-short ID rejected');
      assert.equal((await nosy.post(`/orders/${order2.order_id}/paid`, { payer_ref: 'ABC12345' }, '/pricing')).status, 404, 'only the buyer can report payment');
      assert.equal((await c.post(`/orders/${order2.order_id}/paid`, { payer_ref: ' 7788 9900 11 ' }, `/orders/${order2.order_id}`)).status, 302);
      const claimed = await orders.get(order2.order_id);
      assert.equal(claimed.payer_ref, '7788990011');
      assert.ok(claimed.claimed_at);
      assert.equal(claimed.status, 'awaiting_payment', 'reporting a payment never activates the promotion by itself');
      const staffUser = await users.getByEmail(ADMIN.email);
      const staffNotes = await notifications.list(staffUser.user_id);
      assert.ok(staffNotes.some((n) => n.title === `Payment reported for order #${order2.order_id}` && /7788990011/.test(n.body)), 'staff are notified');
      const detail = (await c.get(`/orders/${order2.order_id}`)).text;
      assert.match(detail, /we are checking your payment/);
      assert.doesNotMatch(detail, /I have sent the money/);
    } finally { config.payments.momo.number = ''; }

    const list = await a.get('/admin/orders');
    assert.equal(list.status, 200);
    assert.match(list.text, /Confirm payment received/);
    assert.match(list.text, /Member says paid/);
    assert.match(list.text, /7788990011/);
    assert.match(list.text, new RegExp(`CF-${order2.order_id}`));

    const confirm = await a.post(`/admin/orders/${order2.order_id}/confirm`, {}, '/admin/orders');
    assert.equal(confirm.status, 302);
    assert.equal((await orders.get(order2.order_id)).status, 'paid');
    assert.equal((await orders.get(order2.order_id)).provider, 'manual');
    assert.equal((await listings.get(id)).is_featured, 1);
    assert.equal((await a.post(`/admin/orders/${order2.order_id}/confirm`, {}, '/admin/orders')).status, 302, 'confirming twice is harmless');
    assert.ok(Math.abs((await listings.get(id)).featured_until - Date.now() - 7 * DAY) < 10_000, 'applied once');
    const cancelPaid = await c.post(`/orders/${order2.order_id}/cancel`, {}, '/orders');
    assert.equal(cancelPaid.status, 302);
    assert.equal((await orders.get(order2.order_id)).status, 'paid', 'a paid order cannot be cancelled by the member');

    assert.match((await a.get('/admin/orders')).text, /GH₵10/, 'revenue shows on the admin page');

    // Refund removes the promotion
    const refund = await a.post(`/admin/orders/${order2.order_id}/refund`, {}, '/admin/orders');
    assert.equal(refund.status, 302);
    assert.equal((await orders.get(order2.order_id)).status, 'refunded');
    const after = await listings.get(id);
    assert.ok(!after.is_featured && !after.featured_until, 'the featured days are taken back');
    assert.equal((await a.post(`/admin/orders/${order2.order_id}/refund`, {}, '/admin/orders')).status, 302);
    assert.equal((await orders.get(order2.order_id)).status, 'refunded');
  } finally { config.payments.paystackSecret = saved; }
});

test('unpaid Mobile Money orders expire after 7 days; reported, fresh and online orders are left alone', async () => {
  const { c, email } = await member('Ezra Expire');
  const uid = (await users.getByEmail(email)).user_id;
  const old = Date.now() - 8 * DAY;
  const base = { user_id: uid, listing_id: 1, listing_title: 'Old lamp', product: 'featured', product_name: 'Featured listing', amount: 1000, currency: 'GHS', days: 7 };
  const stale = await orders.create({ ...base, provider: 'manual', status: 'awaiting_payment', created_at: old, reference: 'CF-X1' });
  const reported = await orders.create({ ...base, provider: 'manual', status: 'awaiting_payment', created_at: old, reference: 'CF-X2', claimed_at: old + DAY, payer_ref: '12345678' });
  const fresh = await orders.create({ ...base, provider: 'manual', status: 'awaiting_payment', created_at: Date.now() - DAY, reference: 'CF-X3' });
  const online = await orders.create({ ...base, provider: 'paystack', status: 'pending', created_at: old, reference: 'CF-X4' });

  assert.ok((await payments.expireStale({ force: true })) >= 1);
  assert.equal((await orders.get(stale.order_id)).status, 'cancelled');
  assert.equal((await orders.get(stale.order_id)).cancel_reason, 'expired');
  assert.equal((await orders.get(reported.order_id)).status, 'awaiting_payment', 'a reported payment waits for a person');
  assert.equal((await orders.get(fresh.order_id)).status, 'awaiting_payment');
  assert.equal((await orders.get(online.order_id)).status, 'pending', 'online orders are never expired here');

  const note = (await notifications.list(uid)).find((n) => n.title === `Order #${stale.order_id} expired`);
  assert.ok(note && /Nothing was charged/.test(note.body), 'member is told');
  assert.match((await c.get('/orders')).text, /Expired, not paid/);
  assert.match((await c.get(`/orders/${stale.order_id}`)).text, /This order expired/);
  assert.equal(await payments.expireStale({ force: true }), 0, 'running again changes nothing');
});

test('a failed start leaves no charge and no promotion', async () => {
  payments.setPaystackClient(async () => { throw new Error('Paystack is down'); });
  const { c, email } = await member('Frank Failed');
  const id = await newListing(c);
  const r = await c.post(`/listings/${id}/promote`, { product: 'featured' }, `/listings/${id}/promote`);
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /\/promote$/);
  const order = (await orders.byUser((await users.getByEmail(email)).user_id))[0];
  assert.equal(order.status, 'failed');
  assert.ok(!(await listings.get(id)).is_featured);
});
