'use strict';
/**
 * Production-mode behaviour (NODE_ENV=production) against the Firebase emulators:
 * HTTPS enforcement behind a proxy, cookie flags, security headers, compression, caching and start-up checks.
 */
process.env.NODE_ENV = 'production';
process.env.CAMPUSFIND_SKIP_DOTENV = '1'; // hermetic: ignore the developer's real .env
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-campusfind';
process.env.FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT;
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.GCLOUD_PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.ADMIN_EMAIL = 'prod-root@campus.test';
process.env.ADMIN_PASSWORD = 'Prod-Root-Passphrase-77';

const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const { init } = require('../src/bootstrap');
const { createApp } = require('../src/app');

let server; let base;
const get = (url, headers = {}) => fetch(base + url, { headers, redirect: 'manual' });

test.before(async () => {
  await init();
  await new Promise((resolve) => { server = createApp().listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });

test('production defaults', () => {
  assert.equal(config.isProd, true);
  assert.equal(config.session.cookieName, '__session', 'only __session survives Firebase Hosting');
  assert.equal(config.trustProxy, 1);
});

test('plain HTTP behind the proxy is redirected to HTTPS, but health checks are not', async () => {
  const r = await get('/browse?q=desk', { 'x-forwarded-proto': 'http' });
  assert.equal(r.status, 308);
  assert.match(r.headers.get('location'), /^https:\/\/127\.0\.0\.1:\d+\/browse\?q=desk$/, 'same host and path, https scheme');
  assert.equal((await get('/healthz', { 'x-forwarded-proto': 'http' })).status, 200, 'load-balancer health checks stay plain');
  assert.equal((await get('/', { 'x-forwarded-proto': 'https' })).status, 200);
});

test('session cookie is Secure, HttpOnly, SameSite=Lax and named __session', async () => {
  const r = await get('/login', { 'x-forwarded-proto': 'https' });
  assert.equal(r.status, 200);
  const cookie = r.headers.getSetCookie().find((c) => c.startsWith('__session='));
  assert.ok(cookie, 'session cookie is issued when a form is rendered');
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
});

test('security headers are present in production', async () => {
  const r = await get('/', { 'x-forwarded-proto': 'https' });
  assert.match(r.headers.get('strict-transport-security') || '', /max-age=\d+/);
  assert.match(r.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-powered-by'), null, 'framework is not advertised');
  assert.match(r.headers.get('cache-control') || '', /no-store/);
});

test('responses are compressed and static assets are cacheable', async () => {
  const page = await fetch(base + '/browse', { headers: { 'accept-encoding': 'gzip', 'x-forwarded-proto': 'https' } });
  assert.equal(page.headers.get('content-encoding'), 'gzip');
  // pages link the stylesheet with a content version; that exact URL may be cached for a year, the bare one must revalidate
  const href = /<link rel="stylesheet" href="(\/css\/app\.css\?v=[0-9a-f]{12})">/.exec(await page.text())[1];
  const css = await get(href, { 'x-forwarded-proto': 'https' });
  assert.match(css.headers.get('cache-control') || '', /max-age=31536000, immutable/);
  const bare = await get('/css/app.css', { 'x-forwarded-proto': 'https' });
  assert.match(bare.headers.get('cache-control') || '', /no-cache/);
  const font = await get('/fonts/inter-latin.woff2', { 'x-forwarded-proto': 'https' });
  assert.match(font.headers.get('cache-control') || '', /immutable/);
  assert.match((await get('/robots.txt')).headers.get('content-type') || '', /text\/plain/);
});

test('start-up refuses a production deploy without a Storage bucket', () => {
  const env = { ...process.env, FIRESTORE_EMULATOR_HOST: '', FIREBASE_AUTH_EMULATOR_HOST: '', FIREBASE_STORAGE_EMULATOR_HOST: '', FIREBASE_STORAGE_BUCKET: '', FIREBASE_WEB_API_KEY: 'x', NODE_ENV: 'production' };
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 1, 'process exits with an error');
  assert.match(r.stderr, /FIREBASE_STORAGE_BUCKET/);
});

test('vercel serverless entry point boots and answers HTTP requests', async () => {
  const http = require('http');
  const handler = require('../api/index');
  const vServer = http.createServer(handler);
  await new Promise((resolve) => vServer.listen(0, '127.0.0.1', resolve));
  const vBase = `http://127.0.0.1:${vServer.address().port}`;
  try {
    const res = await fetch(`${vBase}/healthz`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, 'ok');
  } finally {
    vServer.close();
  }
});
