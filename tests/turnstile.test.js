'use strict';
/** Cloudflare Turnstile: when configured, protected forms require a siteverify-approved token for the right action and hostname. */
process.env.NODE_ENV = 'test';
process.env.PHOTOS_ENABLED = 'false';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-campusfind';
process.env.FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT;
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.GCLOUD_PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.ADMIN_EMAIL = 'ts-root@campus.test';
process.env.ADMIN_PASSWORD = 'Quartz-Lantern-Meadow-71';
process.env.GLOBAL_LIMIT_PER_MIN = '100000';
process.env.REGISTER_LIMIT_PER_HOUR = '500';
process.env.LOGIN_LIMIT_PER_15_MIN = '500';
// Cloudflare's published always-pass test sitekey; the secret and siteverify are faked below, nothing leaves the machine.
process.env.TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
process.env.TURNSTILE_SECRET = 'test-secret-not-real';
process.env.TURNSTILE_HOSTNAMES = 'campusfind.test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { init } = require('../src/bootstrap');
const { createApp } = require('../src/app');
const turnstile = require('../src/services/turnstile');
const users = require('../src/repo/users');

let server; let base;
const RUN = Date.now().toString(36);
const PW = 'Meadow-Lantern-Quartz-7';

// Fake siteverify: token "good-<action>" passes for that action on the approved host; others fail as Cloudflare would.
const calls = [];
let outage = false;
turnstile._setFetch(async (url, opts) => {
  const body = new URLSearchParams(opts.body);
  calls.push({ url, secret: body.get('secret'), response: body.get('response') });
  if (outage) throw new Error('network down');
  const tok = body.get('response');
  const m = /^good-([\w-]+)(?:@(.+))?$/.exec(tok);
  const json = m ? { success: true, action: m[1], hostname: m[2] || 'campusfind.test' } : { success: false, 'error-codes': ['invalid-input-response'] };
  return { ok: true, json: async () => json };
});

class Client {
  constructor() { this.jar = new Map(); }
  async req(method, url, { form } = {}) {
    const h = {};
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    const res = await fetch(base + url, { method, headers: h, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); this.jar.set(pair.slice(0, i), pair.slice(i + 1)); }
    res.text = await res.text();
    return res;
  }
  get(u) { return this.req('GET', u); }
  async token(u) { return /name="_csrf" value="([^"]+)"/.exec((await this.get(u)).text)[1]; }
  async post(u, form, from) { return this.req('POST', u, { form: { _csrf: await this.token(from), ...form } }); }
}
const reg = (c, email, extra = {}) => c.post('/register', { name: 'Ama Test', email, password: PW, agree: '1', dob: '1998-05-14', ...extra }, '/register');

test.before(async () => {
  await init();
  await new Promise((resolve) => { server = createApp().listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });

test('widget and security policy appear only on protected forms, with the right action', async () => {
  const c = new Client();
  for (const [url, action] of [['/register', 'signup'], ['/login', 'login'], ['/forgot', 'forgot'], ['/admin/login', 'staff-login']]) {
    const r = await c.get(url);
    assert.match(r.text, new RegExp(`class="cf-turnstile ts-box" data-sitekey="1x00000000000000000000AA" data-action="${action}"`), url);
    assert.match(r.text, /src="https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js"/);
  }
  const csp = (await c.get('/login')).headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' https:\/\/challenges\.cloudflare\.com/);
  assert.match(csp, /frame-src https:\/\/challenges\.cloudflare\.com/);
  assert.ok(!(await c.get('/')).text.includes('cf-turnstile'), 'no widget on pages that do not need it');
});

test('sign-up: no token, a forged token, the wrong action or the wrong host are all refused', async () => {
  const c = new Client();
  const cases = [{}, { 'cf-turnstile-response': 'forged' }, { 'cf-turnstile-response': 'good-login' }, { 'cf-turnstile-response': 'good-signup@evil.example' }];
  for (const [i, extra] of cases.entries()) {
    const email = `ts-bad${i}.${RUN}@campus.test`;
    const r = await reg(c, email, extra);
    assert.equal(r.status, 403, JSON.stringify(extra));
    assert.match(r.text, /complete the security check/);
    assert.equal(await users.getByEmail(email), null, 'no account was created');
  }
  assert.ok(calls.every((x) => x.url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify' && x.secret === 'test-secret-not-real'));
});

test('sign-up and sign-in work with a valid token for their own action', async () => {
  const email = `ts-ok.${RUN}@campus.test`;
  const c = new Client();
  const r = await reg(c, email, { 'cf-turnstile-response': 'good-signup' });
  assert.equal(r.status, 302);
  assert.ok(await users.getByEmail(email));
  const d = new Client();
  const bad = await d.post('/login', { email, password: PW }, '/login');
  assert.equal(bad.status, 403);
  const ok = await d.post('/login', { email, password: PW, 'cf-turnstile-response': 'good-login' }, '/login');
  assert.equal(ok.status, 302);
});

test('fails closed when Cloudflare cannot be reached', async () => {
  outage = true;
  try {
    const email = `ts-down.${RUN}@campus.test`;
    const r = await reg(new Client(), email, { 'cf-turnstile-response': 'good-signup' });
    assert.equal(r.status, 403);
    assert.equal(await users.getByEmail(email), null);
  } finally { outage = false; }
});
