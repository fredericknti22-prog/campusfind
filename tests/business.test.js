'use strict';
/** Business and Lost & Found: the built-in category migration, the two dedicated pages and their filters. */
process.env.NODE_ENV = 'test';
process.env.PHOTOS_ENABLED = 'false';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-campusfind';
process.env.FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT;
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.GCLOUD_PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.ADMIN_EMAIL = 'biz-root@campus.test';
process.env.ADMIN_PASSWORD = 'Quartz-Lantern-Meadow-71';
process.env.GLOBAL_LIMIT_PER_MIN = '100000';
process.env.REGISTER_LIMIT_PER_HOUR = '500';
process.env.LOGIN_LIMIT_PER_15_MIN = '500';

const test = require('node:test');
const assert = require('node:assert/strict');
const { init } = require('../src/bootstrap');
const { createApp } = require('../src/app');
const { col } = require('../src/store');
const categories = require('../src/repo/categories');
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
async function post(c, categoryId, title, extra = {}) {
  const r = await c.post('/listings/new', { title, category_id: String(categoryId), price_type: 'none', description: 'Details are in the description, please message me.', contact: 'Ask me', intent: 'publish', ...extra }, '/listings/new');
  assert.equal(r.status, 302, r.text.slice(0, 200));
  const id = Number(/\/listings\/(\d+)/.exec(r.headers.get('location'))[1]);
  if (/\/promote$/.test(r.headers.get('location'))) await payForBusiness(c, id); // Business listings go live once paid
  return id;
}

async function payForBusiness(c, id) {
  const p = await c.post(`/listings/${id}/promote`, { product: 'business' }, `/listings/${id}/promote`);
  const orderId = Number(/\/orders\/(\d+)/.exec(p.headers.get('location'))[1]);
  await require('../src/services/payments').fulfil(orderId);
}

test.before(async () => {
  await init();
  await new Promise((resolve) => { server = createApp().listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });

test('categories: Business exists with its own colour, and the migration restores it exactly once', async () => {
  const biz = (await categories.all(true)).filter((c) => c.slug === 'business');
  assert.equal(biz.length, 1);
  assert.equal(biz[0].tone, 8);
  assert.equal(biz[0].icon, 'store');

  // an older database without it: remove it, run the migration twice, expect one copy and nothing else touched
  const before = (await categories.all(true)).length;
  await col('categories').doc(String(biz[0].category_id)).delete();
  categories.invalidate();
  await categories.ensureDefaults();
  await categories.ensureDefaults();
  const after = await categories.all(true);
  assert.equal(after.filter((c) => c.slug === 'business').length, 1);
  assert.equal(after.length, before);
  // it sits before Lost & Found in the built-in order
  const order = after.map((c) => c.slug);
  assert.ok(order.indexOf('business') < order.indexOf('lost-found'));

  // two servers starting together must still leave a single Business category
  const restored = after.find((c) => c.slug === 'business');
  await col('categories').doc(String(restored.category_id)).delete();
  categories.invalidate();
  await Promise.all([categories.ensureDefaults(), categories.ensureDefaults()]);
  const once = (await categories.all(true)).filter((c) => c.slug === 'business');
  assert.equal(once.length, 1);

  // a duplicate already in the database is folded away, and its listings follow the copy we keep
  await col('categories').doc('99').set({
    category_id: 99, name: 'Business', slug: 'business', description: 'dup', icon: 'store', tone: 8, sort_order: 50, is_active: 1,
  });
  await col('listings').doc('9901').set({ listing_id: 9901, category_id: 99, title: 'Duplicate category listing', deleted_at: null });
  categories.invalidate();
  await categories.ensureDefaults();
  const left = (await categories.all(true)).filter((c) => c.slug === 'business');
  assert.equal(left.length, 1);
  assert.equal(left[0].category_id, once[0].category_id);
  assert.equal((await col('listings').doc('9901').get()).data().category_id, once[0].category_id);
});

test('header: Business and Lost & found are first-class links and the first category chips', async () => {
  const c = new Client();
  const { text } = await c.get('/');
  // all navigation lives in the side panel now
  const main = text.split('aria-label="Main">')[1].split('</nav>')[0];
  assert.match(main, /<a href="\/business" class="sp-link[^"]*"/, 'Business is a main menu item');
  assert.match(main, /<a href="\/lost-found" class="sp-link[^"]*"/, 'Lost & found is a main menu item');
  const catNav = text.split('aria-label="Categories">')[1].split('</nav>')[0];
  const chips = [...catNav.matchAll(/href="([^"]+)" class="sp-link tone-\d/g)].map((m) => m[1]);
  assert.equal(chips[0], '/business');
  assert.equal(chips[1], '/lost-found');
  assert.match(text, /class="catstrip"/, 'sticky category strip on home');
  assert.match(text, /class="rail-card"[^>]*href="\/business"/);
  assert.match(text, /class="rail-card"[^>]*href="\/lost-found"/);
});

test('business page lists Business listings, and the active nav item is marked', async () => {
  const { c } = await member('Efua Mensah', 'biz');
  const bizId = (await categories.all(true)).find((x) => x.slug === 'business').category_id;
  const id = await post(c, bizId, `Campus Smoothie Bar ${RUN}`, { price_type: 'fixed', price: '15' });

  const page = await new Client().get('/business');
  assert.equal(page.status, 200);
  assert.match(page.text, /Sell to every student on campus/);
  assert.match(page.text, /Hostel managers/);
  assert.match(page.text, /Food vendors/);
  assert.ok(page.text.includes(`/listings/${id}`), 'the new business shows in the directory');
  assert.match(page.text, /href="\/business" class="sp-link is-active" aria-current="page"/);
  assert.match(page.text, /class="cat-tag"/);
});

test('business types: hostels, vendors and shops filter separately, and the type is dropped outside Business', async () => {
  const { c } = await member('Yaw Darko', 'types');
  const all = await categories.all(true);
  const bizId = all.find((x) => x.slug === 'business').category_id;
  const hostel = await post(c, bizId, `Hilltop Hostel ${RUN}`, { business_type: 'hostel', price_type: 'fixed', price: '900' });
  const food = await post(c, bizId, `Mama Esi Waakye ${RUN}`, { business_type: 'food' });
  const bogus = await post(c, bizId, `Mystery Seller ${RUN}`, { business_type: '<script>' });
  const outside = await post(c, all.find((x) => x.slug === 'electronics').category_id, `Old Phone ${RUN}`, { business_type: 'hostel' });

  const listings = require('../src/repo/listings');
  assert.equal((await listings.get(hostel)).business_type, 'hostel');
  assert.equal((await listings.get(food)).business_type, 'food');
  assert.equal((await listings.get(bogus)).business_type, null, 'an unknown type is ignored');
  assert.equal((await listings.get(outside)).business_type, null, 'a type outside Business is ignored');

  const v = new Client();
  const onlyHostels = await v.get('/business?type=hostel');
  assert.equal(onlyHostels.status, 200);
  assert.ok(onlyHostels.text.includes(`/listings/${hostel}`));
  assert.ok(!onlyHostels.text.includes(`/listings/${food}`));
  assert.match(onlyHostels.text, /class="seg__tab is-active" href="\/business\?type=hostel" aria-current="page"/);
  assert.match(onlyHostels.text, /Business · Hostel &amp; rooms/);

  const odd = await v.get('/business?type=nope');
  assert.equal(odd.status, 200);
  assert.ok(odd.text.includes(`/listings/${hostel}`) && odd.text.includes(`/listings/${food}`), 'an unknown filter shows everything');

  const form = await c.get('/listings/new?category=business&type=hostel');
  assert.match(form.text, /<option value="hostel" selected>Hostel &amp; rooms<\/option>/);
});

test('lost & found board: Lost and Found tabs filter, counts add up, report links carry the kind', async () => {
  const { c } = await member('Kwame Boateng', 'lf');
  const lfId = (await categories.all(true)).find((x) => x.slug === 'lost-found').category_id;
  const lost = await post(c, lfId, `Lost: green water bottle ${RUN}`);
  const found = await post(c, lfId, `Found: grey scarf ${RUN}`);

  const v = new Client();
  const all = await v.get('/lost-found');
  assert.equal(all.status, 200);
  assert.ok(all.text.includes(`/listings/${lost}`) && all.text.includes(`/listings/${found}`));
  assert.match(all.text, /\/listings\/new\?category=lost-found&amp;kind=lost/);
  assert.match(all.text, /\/listings\/new\?category=lost-found&amp;kind=found/);

  const onlyLost = await v.get('/lost-found?kind=lost');
  assert.ok(onlyLost.text.includes(`/listings/${lost}`));
  assert.ok(!onlyLost.text.includes(`/listings/${found}`));
  assert.match(onlyLost.text, /class="seg__tab is-active" href="\/lost-found\?kind=lost" aria-current="page"/);

  const onlyFound = await v.get('/lost-found?kind=found');
  assert.ok(onlyFound.text.includes(`/listings/${found}`));
  assert.ok(!onlyFound.text.includes(`/listings/${lost}`));

  // an unknown filter falls back to the whole board instead of failing
  const odd = await v.get('/lost-found?kind=<script>');
  assert.equal(odd.status, 200);
  assert.ok(odd.text.includes(`/listings/${lost}`) && odd.text.includes(`/listings/${found}`));
  assert.ok(!odd.text.includes('<script>'));
});

test('new listing form opens on the Business category from the directory button', async () => {
  const { c } = await member('Ama Owusu', 'form');
  const page = await c.get('/listings/new?category=business');
  assert.equal(page.status, 200);
  assert.match(page.text, /<option value="\d+" selected>Business<\/option>/);
});

test('business listings are never public without a paid Business advertisement, including old unpaid ones', async () => {
  const { c, user } = await member('Kofi Boateng', 'unpaid');
  const bizId = (await categories.all(true)).find((x) => x.slug === 'business').category_id;
  const listings = require('../src/repo/listings');
  const now = Date.now();
  // a business listing from before payment was required: live, never paid, no requires_payment flag
  const legacy = await listings.create({
    owner_id: user.user_id, category_id: bizId, title: `Old shop ${RUN}`, description: 'Posted before business ads were paid.',
    price_type: 'none', price_cents: null, location: '', contact: 'Ask me', business_type: null,
    status: 'active', created_at: now - 20 * 86_400_000, updated_at: now, published_at: now - 20 * 86_400_000, images: [], cover: null,
  });
  const id = legacy.listing_id;

  await require('../src/services/freshness').sweep({ force: true });
  const closed = await listings.get(id);
  assert.equal(closed.status, 'closed', 'an unpaid business listing is taken down');
  assert.equal(closed.outcome, 'unpaid');
  assert.ok(closed.awaiting_payment && closed.requires_payment);
  assert.ok(!(await new Client().get('/business')).text.includes(`/listings/${id}`), 'not in the directory');

  // the owner cannot put it back up for free, by re-opening or by renewing
  const reopen = await c.post(`/listings/${id}/status`, { status: 'active' }, '/my/listings');
  assert.match(reopen.headers.get('location'), new RegExp(`/listings/${id}/promote$`));
  const renew = await c.post(`/listings/${id}/renew`, {}, '/my/listings');
  assert.match(renew.headers.get('location'), new RegExp(`/listings/${id}/promote$`));
  assert.equal((await listings.get(id)).status, 'closed');

  // once the Business advertisement is paid and confirmed it goes live
  await payForBusiness(c, id);
  const live = await listings.get(id);
  assert.equal(live.status, 'active');
  assert.ok(Number(live.promo_until) > Date.now());
  assert.ok((await new Client().get('/business')).text.includes(`/listings/${id}`), 'listed once paid');
});
