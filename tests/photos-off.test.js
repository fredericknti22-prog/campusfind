'use strict';
/** Behaviour with PHOTOS_ENABLED=false (running without Firebase Storage). */
process.env.NODE_ENV = 'test';
process.env.PHOTOS_ENABLED = 'false';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-campusfind';
process.env.FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT;
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.GCLOUD_PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.ADMIN_EMAIL = 'photos-root@campus.test';
process.env.ADMIN_PASSWORD = 'Photos-Root-Passphrase-31';
process.env.GLOBAL_LIMIT_PER_MIN = '100000';
process.env.REGISTER_LIMIT_PER_HOUR = '500'; // sign-up counters are shared through the database, so every test file needs a high limit
process.env.LOGIN_LIMIT_PER_15_MIN = '500';

const test = require('node:test');
const assert = require('node:assert/strict');
const { init } = require('../src/bootstrap');
const { createApp } = require('../src/app');
const listings = require('../src/repo/listings');

let server; let base;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

class Client {
  constructor() { this.jar = new Map(); }
  async req(method, url, { form, multipart } = {}) {
    const h = {};
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    if (multipart) body = multipart;
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
}

test.before(async () => {
  await init();
  await new Promise((resolve) => { server = createApp().listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });

test('with photos off: no uploader, uploads are ignored, nothing is served from Storage', async () => {
  const c = new Client();
  const reg = await c.req('POST', '/register', { form: { _csrf: await c.token('/register'), name: 'No Photos', email: 'nophotos@campus.test', password: 'Meadow-Lantern-Quartz-7', agree: '1', dob: '1998-05-14' } });
  assert.equal(reg.status, 302);

  const form = await c.get('/listings/new');
  assert.equal(form.status, 200);
  assert.doesNotMatch(form.text, /type="file"/, 'no photo uploader is shown');
  assert.doesNotMatch(form.text, /Photos <span/, 'no photo section');

  const fd = new FormData();
  fd.append('_csrf', await c.token('/listings/new'));
  Object.entries({ title: 'Desk lamp, works well', category_id: '1', price_type: 'free', description: 'Collect from Hall 4, bring a bag.', contact: 'Message me', intent: 'publish' }).forEach(([k, v]) => fd.append(k, v));
  fd.append('images', new Blob([PNG], { type: 'image/png' }), 'sneaky.png');
  const made = await c.req('POST', '/listings/new', { multipart: fd });
  assert.equal(made.status, 302, 'listing is still created');
  const id = Number(/\/listings\/(\d+)/.exec(made.headers.get('location'))[1]);
  const doc = await listings.get(id);
  assert.equal(doc.images.length, 0, 'a smuggled-in photo is ignored');
  assert.equal(doc.cover, null);

  assert.equal((await new Client().get('/uploads/' + '0'.repeat(32) + '.png')).status, 404);
  const page = await new Client().get(`/listings/${id}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /No photographs provided/);
});
