'use strict';
/** Photos kept in Firestore (PHOTO_STORE=firestore): the free-plan alternative to Firebase Storage. */
process.env.NODE_ENV = 'test';
process.env.PHOTO_STORE = 'firestore';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-campusfind';
process.env.FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT;
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.GCLOUD_PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.ADMIN_EMAIL = 'fsphotos-root@campus.test';
process.env.ADMIN_PASSWORD = 'Fsphotos-Root-Passphrase-41';
process.env.GLOBAL_LIMIT_PER_MIN = '100000';
process.env.REGISTER_LIMIT_PER_HOUR = '500'; // sign-up counters are shared through the database, so every test file needs a high limit
process.env.LOGIN_LIMIT_PER_15_MIN = '500';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { init } = require('../src/bootstrap');
const { createApp } = require('../src/app');
const listings = require('../src/repo/listings');
const { col } = require('../src/store');

let server; let base;

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
    res.buf = Buffer.from(await res.arrayBuffer());
    res.text = res.buf.toString('utf8');
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

async function post(c, fields, images) {
  const fd = new FormData();
  fd.append('_csrf', await c.token('/listings/new'));
  Object.entries({ title: 'Desk lamp, works well', category_id: '1', price_type: 'free', description: 'Collect from Hall 4, bring a bag.', contact: 'Message me', intent: 'publish', ...fields }).forEach(([k, v]) => fd.append(k, v));
  for (const [name, buf, type] of images) fd.append('images', new Blob([buf], { type }), name);
  return c.req('POST', '/listings/new', { multipart: fd });
}

test('photos in Firestore: upload is re-encoded to WebP, served, cached, and deleted with the listing', async () => {
  const c = new Client();
  const reg = await c.req('POST', '/register', { form: { _csrf: await c.token('/register'), name: 'Firestore Photos', email: 'fsphotos@campus.test', password: 'Meadow-Lantern-Quartz-7', agree: '1', dob: '1998-05-14' } });
  assert.equal(reg.status, 302);
  assert.match((await c.get('/listings/new')).text, /type="file"/, 'the uploader is shown');

  // A big, noisy JPEG with GPS-style EXIF data and a sideways orientation.
  const w = 1800; const h = 1200;
  const noise = Buffer.alloc(w * h * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761 >>> 24) & 255;
  const jpeg = await sharp(noise, { raw: { width: w, height: h, channels: 3 } })
    .withExif({ IFD0: { Copyright: 'secret-owner-tag' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' } })
    .jpeg({ quality: 70 }).toBuffer();
  assert.ok(jpeg.length < 3 * 1024 * 1024 && jpeg.length > 300_000, `fixture is a realistic photo (${jpeg.length} bytes)`);

  const made = await post(c, {}, [['holiday.jpg', jpeg, 'image/jpeg']]);
  assert.equal(made.status, 302, made.text.slice(0, 300));
  const id = Number(/\/listings\/(\d+)/.exec(made.headers.get('location'))[1]);
  const doc = await listings.get(id);
  assert.equal(doc.images.length, 1);
  const filename = doc.images[0].filename;
  assert.match(filename, /^[a-f0-9]{32}\.webp$/, 'stored as WebP with a random name');

  const stored = (await col('photos').doc(filename).get()).data();
  assert.ok(stored.size <= 900_000, `fits a document store row (${stored.size} bytes)`);
  assert.ok(stored.data_b64, 'photo bytes kept as base64 in Supabase');

  const img = await new Client().get(`/uploads/${filename}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/webp');
  assert.match(img.headers.get('cache-control'), /public.*s-maxage/);
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
  assert.match(img.headers.get('content-security-policy'), /sandbox/);
  assert.equal(img.buf.length, stored.size);
  const meta = await sharp(img.buf).metadata();
  assert.equal(meta.format, 'webp');
  assert.ok(Math.max(meta.width, meta.height) <= 1600, 'shrunk to at most 1600 px');
  assert.ok(!meta.exif, 'EXIF data (including location) is removed');
  assert.ok(!img.buf.includes(Buffer.from('secret-owner-tag')), 'no metadata text survives');

  assert.equal((await new Client().get('/uploads/' + '0'.repeat(32) + '.webp')).status, 404);
  assert.equal((await new Client().get('/uploads/../../etc/passwd')).status, 404);

  const page = await new Client().get(`/listings/${id}`);
  assert.match(page.text, new RegExp(`/uploads/${filename}`));

  // The admin overview counts the stored photos.
  const del = await c.req('POST', `/listings/${id}/delete`, { form: { _csrf: await c.token(`/listings/${id}`) } });
  assert.equal(del.status, 302);
  assert.equal((await col('photos').doc(filename).get()).exists, false, 'photo document is deleted with the listing');
  assert.equal((await new Client().get(`/uploads/${filename}`)).status, 404);
});

test('photos in Firestore: fake and corrupt images are rejected, small PNGs work, four photos allowed', async () => {
  const c = new Client();
  await c.req('POST', '/register', { form: { _csrf: await c.token('/register'), name: 'Second Uploader', email: 'fsphotos2@campus.test', password: 'Meadow-Lantern-Quartz-7', agree: '1', dob: '1998-05-14' } });

  const fake = await post(c, {}, [['evil.png', Buffer.from('<?php echo 1; ?> not an image at all'), 'image/png']]);
  assert.equal(fake.status, 400);
  assert.match(fake.text, /Only real JPG, PNG or WebP/);

  // Right magic bytes, but the picture itself is truncated garbage.
  const truncated = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
  const bad = await post(c, {}, [['broken.jpg', truncated, 'image/jpeg']]);
  assert.equal(bad.status, 400);
  assert.match(bad.text, /could not be read/);

  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#0a3' } }).png().toBuffer();
  const four = await post(c, {}, [['a.png', png, 'image/png'], ['b.png', png, 'image/png'], ['c.png', png, 'image/png'], ['d.png', png, 'image/png']]);
  assert.equal(four.status, 302);
  const id = Number(/\/listings\/(\d+)/.exec(four.headers.get('location'))[1]);
  const doc = await listings.get(id);
  assert.equal(doc.images.length, 4);
  assert.ok(doc.images.every((i) => /\.webp$/.test(i.filename)));
  assert.equal(doc.cover, doc.images[0].filename);
});
