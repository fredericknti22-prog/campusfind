'use strict';
/** Saved listings: save, unsave, privacy, unavailable listings, and cleanup. */
process.env.NODE_ENV = 'test';
process.env.PHOTOS_ENABLED = 'false';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-campusfind';
process.env.FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT;
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.GCLOUD_PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.ADMIN_EMAIL = 'saved-root@campus.test';
process.env.ADMIN_PASSWORD = 'Quartz-Lantern-Meadow-71';
process.env.GLOBAL_LIMIT_PER_MIN = '100000';
process.env.REGISTER_LIMIT_PER_HOUR = '500';
process.env.LOGIN_LIMIT_PER_15_MIN = '500';

const test = require('node:test');
const assert = require('node:assert/strict');
const { init } = require('../src/bootstrap');
const { createApp } = require('../src/app');
const listings = require('../src/repo/listings');
const favorites = require('../src/repo/favorites');
const users = require('../src/repo/users');

let server; let base;
const RUN = Date.now().toString(36);
const PW = 'Meadow-Lantern-Quartz-7';

class Client {
  constructor() { this.jar = new Map(); }
  async req(method, url, { form } = {}) {
    const h = {};
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
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

async function member(name, tag) {
  const c = new Client();
  const email = `${tag}.${RUN}@campus.test`;
  const r = await c.post('/register', { name, email, password: PW, agree: '1', dob: '1998-05-14' }, '/register');
  assert.equal(r.status, 302, `register ${email}`);
  return { c, email, user: await users.getByEmail(email) };
}
async function newListing(c, title) {
  const r = await c.post('/listings/new', { title, category_id: '1', price_type: 'fixed', price: '40', description: 'In good condition, collect from the library.', contact: 'Ask me', intent: 'publish' }, '/listings/new');
  assert.equal(r.status, 302, r.text.slice(0, 200));
  return Number(/\/listings\/(\d+)/.exec(r.headers.get('location'))[1]);
}

test.before(async () => {
  await init();
  await new Promise((resolve) => { server = createApp().listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });

test('saving: save and unsave from a listing, and see it on the Saved page', async () => {
  const owner = await member('Sally Seller', 'sally');
  const buyer = await member('Bo Buyer', 'bo');
  const id = await newListing(owner.c, 'Graphing calculator, barely used');

  assert.match((await buyer.c.get(`/listings/${id}`)).text, /aria-pressed="false">[^]*?Save/, 'a Save button is offered');
  assert.doesNotMatch((await owner.c.get(`/listings/${id}`)).text, /class="save-form"/, 'no Save button on your own listing');
  assert.doesNotMatch((await new Client().get(`/listings/${id}`)).text, /class="save-form"/, 'visitors do not see it');

  const saved = await buyer.c.post(`/listings/${id}/save`, {}, `/listings/${id}`);
  assert.equal(saved.status, 302);
  assert.equal(saved.headers.get('location'), `/listings/${id}`);
  assert.equal(await favorites.has(buyer.user.user_id, id), true);
  assert.match((await buyer.c.get(`/listings/${id}`)).text, /aria-pressed="true">[^]*?Saved/, 'the button now says Saved');

  const page = await buyer.c.get('/saved');
  assert.equal(page.status, 200);
  assert.match(page.text, /Graphing calculator, barely used/);
  assert.match(page.text, /Remove from saved/);

  // Saved lists are private
  const other = await member('Nosy Nora', 'nora');
  assert.doesNotMatch((await other.c.get('/saved')).text, /Graphing calculator/);
  assert.match((await other.c.get('/saved')).text, /Nothing saved yet/);

  // Unsave from the Saved page returns there
  const removed = await buyer.c.post(`/listings/${id}/save`, { next: '/saved' }, '/saved');
  assert.equal(removed.headers.get('location'), '/saved');
  assert.equal(await favorites.has(buyer.user.user_id, id), false);
  assert.match((await buyer.c.get('/saved')).text, /Nothing saved yet/);
});

test('saving: protections', async () => {
  const owner = await member('Olga Owner', 'olga');
  const buyer = await member('Ben Browser', 'ben');
  const id = await newListing(owner.c, 'Desk chair, ergonomic');

  // CSRF and sign-in
  assert.equal((await buyer.c.req('POST', `/listings/${id}/save`, { form: {} })).status, 403, 'CSRF is enforced');
  const anon = await new Client().post(`/listings/${id}/save`, {}, '/login'); // visitors only get a CSRF token on the sign-in form
  assert.equal(anon.status, 302);
  assert.match(anon.headers.get('location'), /\/login/);
  assert.equal((await new Client().get('/saved')).status, 302, 'visitors are sent to sign in');

  // Not your own listing, not a missing one
  const own = await owner.c.post(`/listings/${id}/save`, {}, '/pricing');
  assert.equal(own.status, 302);
  assert.equal(await favorites.has(owner.user.user_id, id), false);
  const missing = await buyer.c.post('/listings/999999/save', {}, '/pricing');
  assert.equal(missing.status, 302);
  assert.equal(await favorites.has(buyer.user.user_id, 999999), false);

  // An open redirect is not possible through "next"
  const evil = await buyer.c.post(`/listings/${id}/save`, { next: 'https://evil.example/' }, '/pricing');
  assert.equal(evil.headers.get('location'), `/listings/${id}`);
});

test('saving: closed or removed listings disappear from the page, can still be unsaved, and cannot be newly saved', async () => {
  const owner = await member('Cora Closer', 'cora');
  const buyer = await member('Dan Saver', 'dan');
  const id = await newListing(owner.c, 'Mini fridge, works well');
  await buyer.c.post(`/listings/${id}/save`, {}, `/listings/${id}`);
  assert.match((await buyer.c.get('/saved')).text, /Mini fridge/);

  await listings.update(id, { status: 'closed' });
  const after = (await buyer.c.get('/saved')).text;
  assert.doesNotMatch(after, /Mini fridge, works well/, 'closed listings are not shown');
  assert.match(after, /1 saved listing is no longer available/);

  // Unsaving still works, and a closed listing cannot be saved afresh
  await buyer.c.post(`/listings/${id}/save`, { next: '/saved' }, '/saved');
  assert.equal(await favorites.has(buyer.user.user_id, id), false);
  await buyer.c.post(`/listings/${id}/save`, {}, '/pricing');
  assert.equal(await favorites.has(buyer.user.user_id, id), false, 'a closed listing cannot be newly saved');
  await buyer.c.get('/saved'); // shows and clears the one-off message from the failed save above
  assert.doesNotMatch((await buyer.c.get('/saved')).text, /no longer available/, 'the notice is gone once nothing is stale');
});

test('saving: newest first, and saves are deleted with the account', async () => {
  const owner = await member('Eli Lister', 'eli');
  const buyer = await member('Fay Collector', 'fay');
  const first = await newListing(owner.c, 'First saved item');
  const second = await newListing(owner.c, 'Second saved item');
  await buyer.c.post(`/listings/${first}/save`, {}, '/pricing');
  await new Promise((r) => setTimeout(r, 15));
  await buyer.c.post(`/listings/${second}/save`, {}, '/pricing');
  const text = (await buyer.c.get('/saved')).text;
  assert.ok(text.indexOf('Second saved item') < text.indexOf('First saved item'), 'the most recently saved comes first');
  assert.deepEqual(await favorites.listingIds(buyer.user.user_id), [second, first]);

  assert.equal(await favorites.deleteForUser(buyer.user.user_id), 2);
  assert.deepEqual(await favorites.listingIds(buyer.user.user_id), []);
  assert.match((await buyer.c.get('/privacy')).text, /Saved listings:/, 'the privacy policy mentions saved listings');
});
