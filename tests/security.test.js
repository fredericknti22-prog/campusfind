'use strict';
/** Security regressions, including the findings of the OWASP ZAP active scan (see SECURITY-REPORT.md). */
process.env.NODE_ENV = 'test';
process.env.PHOTOS_ENABLED = 'false';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-campusfind';
process.env.FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT;
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.GCLOUD_PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.ADMIN_EMAIL = 'sec-root@campus.test';
process.env.ADMIN_PASSWORD = 'Quartz-Lantern-Meadow-71';
process.env.GLOBAL_LIMIT_PER_MIN = '100000';
process.env.REGISTER_LIMIT_PER_HOUR = '500';
process.env.LOGIN_LIMIT_PER_15_MIN = '500';

const test = require('node:test');
const assert = require('node:assert/strict');
const { init } = require('../src/bootstrap');
const { createApp } = require('../src/app');
const identity = require('../src/services/identity');

let server; let base;

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
}

test.before(async () => {
  await init();
  await new Promise((resolve) => { server = createApp().listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });

test('login: malformed emails (the ZAP "SQL injection" timing probe) never reach Firebase Auth', async () => {
  const original = identity.signInWithPassword;
  let calls = 0;
  identity.signInWithPassword = async (...args) => { calls += 1; return original(...args); };
  try {
    const payloads = [
      'case randomblob(1000000000) when not null then 1 else 1 end',
      "' OR '1'='1",
      'a'.repeat(300) + '@example.com',
      '<script>alert(1)</script>@x.io',
    ];
    for (const email of payloads) {
      const c = new Client();
      const t0 = Date.now();
      const r = await c.req('POST', '/login', { form: { _csrf: await c.token('/login'), email, password: 'whatever-123' } });
      assert.equal(r.status, 401, email);
      assert.match(r.text, /Incorrect email or password\./);
      assert.ok(!r.text.includes('<script>alert(1)</script>'), 'the email is escaped when shown back');
      assert.ok(Date.now() - t0 < 1500, 'answered without slow downstream work');
    }
    // an absurdly long password is rejected the same way
    const c = new Client();
    const r = await c.req('POST', '/login', { form: { _csrf: await c.token('/login'), email: 'someone@campus.test', password: 'x'.repeat(5000) } });
    assert.equal(r.status, 401);
    assert.equal(calls, 0, 'Firebase Auth was never called for malformed input');
  } finally {
    identity.signInWithPassword = original;
  }
});

test('reflected input is escaped on search and directory pages (ZAP: user-controllable attributes)', async () => {
  const c = new Client();
  const evil = '"><script>alert(1)</script>';
  for (const url of [`/browse?q=${encodeURIComponent(evil)}`, `/browse?category=${encodeURIComponent(evil)}`,
    `/business?type=${encodeURIComponent(evil)}`, `/lost-found?kind=${encodeURIComponent(evil)}`]) {
    const r = await c.get(url);
    assert.equal(r.status, 200, url);
    assert.ok(!r.text.includes('<script>alert(1)</script>'), `${url} reflects raw HTML`);
    assert.ok(!r.text.includes('"><script'), `${url} breaks out of an attribute`);
  }
});

test('security headers are present on every page', async () => {
  const r = await new Client().get('/');
  const csp = r.headers.get('content-security-policy') || '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/, 'no unsafe-inline or unsafe-eval for scripts');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.ok(r.headers.get('permissions-policy'));
});

test('state-changing requests without a CSRF token are refused', async () => {
  const c = new Client();
  await c.get('/login'); // has a session, but sends no token
  const r = await c.req('POST', '/login', { form: { email: 'someone@campus.test', password: 'whatever-123' } });
  assert.ok(r.status >= 400 && r.status < 500, `expected a 4xx, got ${r.status}`);
  const r2 = await c.req('POST', '/listings/new', { form: { title: 'x' } });
  assert.ok(r2.status >= 300 && r2.status !== 200, 'no listing is created');
});

test('legal: every policy page renders, is linked from the footer and the hub, and states its version', async () => {
  const c = new Client();
  const pages = [['/terms', 'Terms of use'], ['/privacy', 'Privacy policy'], ['/cookies', 'Cookie policy'], ['/data-protection', 'Data protection policy'],
    ['/business-terms', 'Seller &amp; business terms'], ['/refunds', 'Payments &amp; refund policy'], ['/disclaimer', 'Disclaimer'],
    ['/moderation', 'Moderation'], ['/copyright', 'Copyright']];
  const home = (await c.get('/')).text;
  const hub = (await c.get('/legal')).text;
  for (const [url, title] of pages) {
    const r = await c.get(url);
    assert.equal(r.status, 200, url);
    assert.ok(r.text.includes(title), `${url} shows its title`);
    assert.match(r.text, /Version \d+\.\d+ · Last updated/);
    assert.ok(home.includes(`href="${url}"`), `${url} is linked in the footer`);
    if (url !== '/rules') assert.ok(hub.includes(`href="${url}"`), `${url} is on the legal hub`);
  }
  assert.match((await c.get('/data-protection')).text, /Act 843/);
  assert.match((await c.get('/refunds')).text, /never renews automatically/);
});

test('the motion script is self-hosted and allowed by the CSP (no third-party scripts)', async () => {
  const r = await new Client().get('/');
  const srcs = [...r.text.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.some((s) => /^\/js\/motion\.js\?v=[0-9a-f]{12}$/.test(s)), 'motion.js is linked with a content version');
  assert.ok(srcs.every((s) => s.startsWith('/')), `external script found: ${srcs.join(', ')}`);
  assert.ok(!/<script>(?!<\/script>)/.test(r.text.replace(/<script[^>]*src=[^>]*><\/script>/g, '')), 'no inline scripts');
});

test('owner handover: SUPERADMIN_EMAIL promotes only an existing account, once, with an audit record', async () => {
  const { promoteConfiguredOwner } = require('../src/services/auth');
  const users = require('../src/repo/users');
  const { col } = require('../src/store');
  const RUN2 = Date.now().toString(36);
  const email = `owner.${RUN2}@campus.test`;

  process.env.SUPERADMIN_EMAIL = `nobody.${RUN2}@campus.test`;
  assert.equal(await promoteConfiguredOwner(), null, 'nothing happens for an email nobody registered');
  assert.equal(await users.getByEmail(process.env.SUPERADMIN_EMAIL), null, 'no account is ever created');

  const c = new Client();
  const reg = await c.req('POST', '/register', { form: { _csrf: await c.token('/register'), name: 'Ernest Owner', email, password: 'Meadow-Lantern-Quartz-7', agree: '1', dob: '1998-05-14' } });
  assert.equal(reg.status, 302);
  process.env.SUPERADMIN_EMAIL = email.toUpperCase(); // matching ignores case
  const id = await promoteConfiguredOwner();
  assert.ok(id);
  assert.equal((await users.getById(id)).role, 'superadmin');
  assert.equal(await promoteConfiguredOwner(), null, 'running again changes nothing');
  const logs = (await col('activity_logs').where('action', '==', 'user.role_change').get()).docs.map((d) => d.data());
  assert.ok(logs.some((l) => Number(l.entity_id) === id && /SUPERADMIN_EMAIL/.test(l.meta || '')), 'the promotion is audited');
  delete process.env.SUPERADMIN_EMAIL;
});
