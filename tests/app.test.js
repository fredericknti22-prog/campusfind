'use strict';
/**
 * End-to-end tests against the real HTTP stack AND the Firebase emulators (Auth, Firestore, Storage).
 * Covers doc section 25: authN, authZ, listings, search, reporting, moderation, abuse, uploads, errors,
 * plus the Super admin page and Firebase password recovery.
 *
 * Run: npm test   (starts the emulators, runs this file, shuts them down)
 */
process.env.NODE_ENV = 'test';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-campusfind';
process.env.FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT;
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.GCLOUD_PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.ADMIN_EMAIL = 'root@campus.test';
process.env.ADMIN_PASSWORD = 'Root-Password-123';
process.env.REGISTER_LIMIT_PER_HOUR = '500'; // the suite signs up many members from one address
process.env.LOGIN_LIMIT_PER_15_MIN = '500';
process.env.GLOBAL_LIMIT_PER_MIN = '100000'; // the suite sends hundreds of requests a minute from one address

const test = require('node:test');
const assert = require('node:assert/strict');

const { col } = require('../src/store');
const users = require('../src/repo/users');
const listingsRepo = require('../src/repo/listings');
const { init } = require('../src/bootstrap');
const { createApp } = require('../src/app');

let server; let base;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

class Client {
  constructor() { this.jar = new Map(); }
  async request(method, url, { form, multipart, headers = {} } = {}) {
    const h = { ...headers };
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    if (multipart) body = multipart;
    const res = await fetch(base + url, { method, headers: h, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const [k, v] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
      if (!v || attrs.some((a) => /max-age=0/i.test(a) || /expires=thu, 01 jan 1970/i.test(a))) this.jar.delete(k); else this.jar.set(k, v);
    }
    res.text = await res.text();
    return res;
  }
  get(url) { return this.request('GET', url); }
  async token(url = '/login') { const r = await this.get(url); const m = /name="_csrf" value="([^"]+)"/.exec(r.text); assert.ok(m, `no csrf on ${url}`); return m[1]; }
  async post(url, form, tokenFrom = '/login') { return this.request('POST', url, { form: { _csrf: await this.token(tokenFrom), ...form } }); }
}

const STRONG = 'Correct-Horse-Battery-9';
async function signup(name, email) {
  const c = new Client();
  const r = await c.post('/register', { name, email, password: STRONG, agree: '1', dob: '1998-05-14' }, '/register');
  assert.equal(r.status, 302, `register ${email}: ${r.text.slice(0, 300)}`);
  return c;
}
async function staffLogin(email, password) {
  const c = new Client();
  const r = await c.post('/admin/login', { email, password, next: '/admin' }, '/admin/login');
  assert.equal(r.status, 302, 'staff login should redirect');
  return c;
}
function listingForm(token, over = {}) {
  const fd = new FormData();
  fd.append('_csrf', token);
  const f = { title: 'Calculus textbook 9th ed', category_id: '1', location: 'Main library', price_type: 'fixed', price: '25', description: 'Barely used, no highlighting at all.', contact: 'Text 555-0100', intent: 'publish', ...over };
  Object.entries(f).forEach(([k, v]) => fd.append(k, v));
  return fd;
}
const where = async (collection, field, op, value) => (await col(collection).where(field, op, value).get()).docs.map((d) => d.data());
const idOf = (path) => Number(/\/listings\/(\d+)/.exec(path)[1]);

test.before(async () => {
  await init();
  await new Promise((resolve) => { server = createApp().listen(0, '127.0.0.1', resolve); });
  // keep idle connections open longer than the client reuses them, so a reused socket is never closed mid-request
  server.keepAliveTimeout = 65_000; server.headersTimeout = 66_000;
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });

const state = {};

test('health, pages and security headers', async () => {
  const c = new Client();
  assert.equal((await c.get('/healthz')).status, 200);
  const home = await c.get('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /Looking for something on/);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
  assert.doesNotMatch(home.text, /<script>[^<]/, 'no inline scripts allowed by CSP');
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  for (const p of ['/browse', '/rules', '/privacy', '/terms', '/cookies', '/moderation', '/copyright', '/legal', '/login', '/register', '/forgot']) assert.equal((await c.get(p)).status, 200, p);
  assert.equal((await c.get('/nope')).status, 404);
  const font = await fetch(base + '/fonts/inter-latin.woff2');
  assert.equal(font.status, 200, 'self-hosted font is served');
  assert.match(font.headers.get('content-type') || '', /font\/woff2|application\/font-woff2|octet-stream/);
});

test('first run created the super admin in Firebase Auth and Firestore, and seeded categories', async () => {
  const root = await users.getByEmail('root@campus.test');
  assert.ok(root && root.role === 'superadmin' && root.uid, 'super admin profile linked to an Auth uid');
  assert.ok((await col('categories').get()).size >= 8, 'default categories seeded');
});

test('registration: CSRF, validation, success, duplicate email', async () => {
  const c = new Client();
  const noToken = await c.request('POST', '/register', { form: { name: 'X Y', email: 'x@y.test', password: STRONG, agree: '1', dob: '1998-05-14' } });
  assert.equal(noToken.status, 403, 'POST without CSRF token must be rejected');
  const weak = await c.post('/register', { name: 'Weak Pass', email: 'weak@campus.test', password: 'short', agree: '1', dob: '1998-05-14' }, '/register');
  assert.equal(weak.status, 400);
  assert.match(weak.text, /at least 10 characters/);
  state.alice = await signup('Alice Mwangi', 'alice@campus.test');
  assert.equal((await state.alice.get('/profile')).status, 200, 'registered user is signed in');
  const alice = await users.getByEmail('alice@campus.test');
  assert.ok(alice.uid, 'Firestore profile is linked to a Firebase Auth user');
  assert.equal(JSON.stringify(alice).includes('password'), false, 'no password material stored in Firestore');
  const dup = await new Client().post('/register', { name: 'Alice Again', email: 'ALICE@campus.test', password: STRONG, agree: '1', dob: '1998-05-14' }, '/register');
  assert.equal(dup.status, 400);
  assert.match(dup.text, /already exists/);
});

test('authorization: anonymous and student cannot reach protected areas', async () => {
  const anon = new Client();
  const r = await anon.get('/listings/new');
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /^\/login/);
  assert.equal((await anon.get('/admin')).status, 302);
  assert.equal((await state.alice.get('/admin')).status, 403, 'student -> admin is denied');
  assert.equal((await state.alice.get('/admin/system')).status, 403);
  const post = await state.alice.post('/admin/system/settings', { registration_open: '0' }, '/profile');
  assert.equal(post.status, 403, 'student cannot POST super admin settings');
});

test('listings: create with photo in Storage, reject fake image, escape HTML, search', async () => {
  const c = state.alice;
  const token = await c.token('/listings/new');

  const fake = listingForm(token, { title: 'Fake image attempt' });
  fake.append('images', new Blob(['<?php echo 1; ?>'], { type: 'image/png' }), 'evil.png');
  const bad = await c.request('POST', '/listings/new', { multipart: fake });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /real JPG, PNG or WebP/);
  assert.equal((await where('listings', 'title', '==', 'Fake image attempt')).length, 0);

  assert.equal((await c.request('POST', '/listings/new', { multipart: listingForm('bogus') })).status, 403, 'multipart CSRF is enforced');

  const ok = listingForm(token, { title: 'Calculus <script>alert(1)</script> book' });
  ok.append('images', new Blob([PNG], { type: 'image/png' }), 'cover.png');
  const created = await c.request('POST', '/listings/new', { multipart: ok });
  assert.equal(created.status, 302, created.text.slice(0, 300));
  state.listingPath = created.headers.get('location');
  const detail = await new Client().get(state.listingPath);
  assert.equal(detail.status, 200);
  assert.doesNotMatch(detail.text, /<script>alert\(1\)/, 'user HTML must be escaped');
  assert.match(detail.text, /&lt;script&gt;/);
  assert.match(detail.text, /Contact details are for members/, 'visitors do not see contact info');
  assert.doesNotMatch(detail.text, /555-0100/);
  assert.match((await c.get(state.listingPath)).text, /555-0100/, 'members see contact info');
  const imgName = /\/uploads\/([a-f0-9]{32}\.png)/.exec(detail.text);
  assert.ok(imgName, 'image is attached');
  const img = await new Client().get(`/uploads/${imgName[1]}`);
  assert.equal(img.status, 200, 'photo is served from Firebase Storage');
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await new Client().get('/uploads/..%2f..%2fsecret.png')).status, 404);
  assert.equal((await new Client().get('/uploads/' + '0'.repeat(32) + '.png')).status, 404);

  assert.match((await new Client().get('/browse?q=calculus&category=textbooks')).text, /Calculus/);
  assert.match((await new Client().get('/browse?q=zzzznothing')).text, /No results found/);
  assert.match((await new Client().get('/browse?q=%25')).text, /No results found/, '% is matched literally');
  const cheap = await new Client().get('/browse?price_max=10');
  assert.doesNotMatch(cheap.text, /Calculus/, 'price filter excludes a $25 listing');
});

test('ownership: another member cannot edit or delete', async () => {
  state.bob = await signup('Bob Otieno', 'bob@campus.test');
  const id = idOf(state.listingPath);
  assert.equal((await state.bob.get(`/listings/${id}/edit`)).status, 403);
  assert.equal((await state.bob.post(`/listings/${id}/delete`, {}, '/profile')).status, 403);
  assert.equal((await listingsRepo.get(id)).deleted_at, null);
});

test('reporting: file, block self-report, de-duplicate', async () => {
  const id = idOf(state.listingPath);
  assert.equal((await state.alice.get(`/report?type=listing&id=${id}`)).status, 302, 'cannot report your own listing');
  const url = `/report?type=listing&id=${id}`;
  assert.equal((await state.bob.post('/report', { type: 'listing', id }, url)).status, 400);
  assert.equal((await state.bob.post('/report', { type: 'listing', id, reason: 'scam', details: 'asked me to pay first' }, url)).status, 302);
  assert.equal((await state.bob.post('/report', { type: 'listing', id, reason: 'scam' }, url)).status, 302);
  const human = (await where('reports', 'target_id', '==', id)).filter((r) => r.reporter_id !== null);
  assert.equal(human.length, 1, 'duplicate open report not created');
});

test('screening: scam phrase raises an automatic report', async () => {
  const c = state.alice;
  const r = await c.request('POST', '/listings/new', { multipart: listingForm(await c.token('/listings/new'), { title: 'Great laptop deal', description: 'Send money first via Western Union and I ship.' }) });
  assert.equal(r.status, 302);
  const flagged = await where('reports', 'reporter_id', '==', null);
  assert.equal(flagged.length, 1);
  assert.match(flagged[0].details, /payment-scam/);
});

test('moderation: super admin step-up login, resolve report, notify, audit', async () => {
  const bad = await new Client().post('/admin/login', { email: 'root@campus.test', password: 'wrong-wrong-wrong' }, '/admin/login');
  assert.equal(bad.status, 401);

  const root = await staffLogin('root@campus.test', 'Root-Password-123');
  state.root = root;
  const dash = await root.get('/admin');
  assert.equal(dash.status, 200);
  assert.match(dash.text, /Operations overview/);

  const id = idOf(state.listingPath);
  const rep = (await where('reports', 'target_id', '==', id)).find((r) => r.reporter_id !== null);
  const page = await root.get(`/admin/reports/${rep.report_id}`);
  assert.equal(page.status, 200);

  const noReason = await root.post('/admin/reports/' + rep.report_id + '/resolve', { outcome: 'remove', reason: '' }, `/admin/reports/${rep.report_id}`);
  assert.equal(noReason.status, 400, 'enforcement requires a reason');

  const done = await root.post(`/admin/reports/${rep.report_id}/resolve`, { outcome: 'remove', reason: 'Advance-payment scam' }, `/admin/reports/${rep.report_id}`);
  assert.equal(done.status, 302);
  assert.equal((await listingsRepo.get(id)).status, 'removed');
  assert.equal((await where('reports', 'report_id', '==', rep.report_id))[0].status, 'resolved');
  assert.ok((await where('moderation_actions', 'target_id', '==', id)).some((a) => a.action === 'remove' && a.target_type === 'listing'));
  assert.ok((await where('activity_logs', 'action', '==', 'moderation.listing.remove')).some((l) => l.entity_id === id), 'audit entry written');
  assert.match((await state.alice.get('/notifications')).text, /Your listing was removed/);
  assert.match((await state.bob.get('/notifications')).text, /Your report was reviewed/);
  assert.equal((await new Client().get(state.listingPath)).status, 404, 'removed listing is not public');
  assert.doesNotMatch((await new Client().get('/browse?q=calculus')).text, /Calculus &lt;script/);
});

test('super admin: system page, staff creation, role separation', async () => {
  const sys = await state.root.get('/admin/system');
  assert.equal(sys.status, 200);
  assert.match(sys.text, /System health/);
  assert.match(sys.text, /Create a staff account/);
  assert.match(sys.text, /demo-campusfind/, 'shows the Firebase project');

  const weak = await state.root.post('/admin/system/staff', { name: 'Mod One', email: 'mod@campus.test', role: 'moderator', password: 'short' }, '/admin/system');
  assert.equal(weak.status, 400);
  assert.equal((await state.root.post('/admin/system/staff', { name: 'Mod One', email: 'mod@campus.test', role: 'moderator', password: 'Moderator-Pass-77' }, '/admin/system')).status, 302);
  assert.equal((await state.root.post('/admin/system/staff', { name: 'Admin One', email: 'admin1@campus.test', role: 'admin', password: 'Administrator-Pass-77' }, '/admin/system')).status, 302);
  const dupStaff = await state.root.post('/admin/system/staff', { name: 'Mod Two', email: 'mod@campus.test', role: 'moderator', password: 'Moderator-Pass-77' }, '/admin/system');
  assert.equal(dupStaff.status, 400, 'duplicate staff email rejected by Firebase Auth');

  const mod = await staffLogin('mod@campus.test', 'Moderator-Pass-77');
  assert.equal((await mod.get('/admin/reports')).status, 200, 'moderator can work reports');
  assert.equal((await mod.get('/admin/system')).status, 403, 'moderator cannot open super admin');
  assert.equal((await mod.get('/admin/users')).status, 403, 'moderator cannot manage users');
  assert.equal((await mod.get('/admin/audit')).status, 403);

  const admin = await staffLogin('admin1@campus.test', 'Administrator-Pass-77');
  assert.equal((await admin.get('/admin/users')).status, 200);
  assert.equal((await admin.get('/admin/system')).status, 403, 'admin cannot open super admin');
  const bob = await users.getByEmail('bob@campus.test');
  const alice = await users.getByEmail('alice@campus.test');
  assert.equal((await admin.post(`/admin/users/${bob.user_id}/role`, { role: 'admin' }, `/admin/users/${bob.user_id}`)).status, 403, 'admin cannot change roles');
  assert.equal((await users.getById(bob.user_id)).role, 'student');

  const root = await users.getByEmail('root@campus.test');
  await state.root.post(`/admin/users/${root.user_id}/role`, { role: 'student' }, `/admin/users/${bob.user_id}`);
  assert.equal((await users.getById(root.user_id)).role, 'superadmin', 'cannot demote yourself');

  assert.equal((await state.root.post(`/admin/users/${bob.user_id}/role`, { role: 'moderator' }, `/admin/users/${bob.user_id}`)).status, 302);
  assert.equal((await users.getById(bob.user_id)).role, 'moderator');
  assert.ok((await where('activity_logs', 'action', '==', 'user.role_change')).length >= 1);

  assert.equal((await admin.post(`/admin/users/${bob.user_id}/action`, { action: 'ban', reason: 'testing guard' }, `/admin/users/${bob.user_id}`)).status, 400, 'staff cannot be sanctioned');
  assert.equal((await admin.post(`/admin/users/${alice.user_id}/action`, { action: 'warn', reason: 'Please read the rules' }, `/admin/users/${alice.user_id}`)).status, 302);
  assert.equal((await users.getById(alice.user_id)).warnings, 1);
});

test('demand insights: anonymous search counts, no-result searches, personal data never stored, staff only', async () => {
  const insights = require('../src/services/insights');
  const word = `unicornbike${Date.now().toString(36)}`;
  const v = new Client();
  await v.get(`/browse?q=${word}`);
  await v.get(`/browse?q=${word.toUpperCase()}&sort=oldest`); // same visitor, same search: counted once
  await new Client().get('/browse?q=call+me+0241234567');
  await new Client().get('/browse?q=me%40example.com');

  const s = await insights.summary(7);
  const hit = s.empty.find((x) => x.q === word);
  assert.ok(hit, 'a search with no results is listed');
  assert.equal(hit.count, 1, 'repeat searches by the same visitor are not double counted');
  assert.equal(hit.zero, 1);
  assert.ok(!s.top.some((x) => /0241234567|@/.test(x.q)), 'phone numbers and emails are never stored');
  assert.equal(insights.normalise('  Room   NEAR Library '), 'room near library');

  const page = await state.root.get('/admin/insights?days=7');
  assert.equal(page.status, 200);
  assert.match(page.text, /Wanted but not found/);
  assert.match(page.text, new RegExp(word));
  assert.notEqual((await state.alice.get('/admin/insights')).status, 200, 'members cannot see insights');
});

test('super admin: payment number and support email are set from the admin page, not Vercel', async () => {
  const settingsSvc = require('../src/services/settings');
  const b = (form) => state.root.post('/admin/system/business', form, '/admin/system');
  assert.match((await state.root.get('/admin/system')).text, /No payment number yet/);

  const bad = await b({ momo_number: '12345', support_email: 'not-an-email' });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /Enter a Ghana number/);
  assert.match(bad.text, /Enter a valid email address/);
  assert.equal(settingsSvc.momo().number, '', 'nothing saved on error');

  assert.equal((await b({ momo_number: '024 123 4567', momo_name: 'CampusFind Ventures', momo_network: 'MTN MoMo', support_email: 'Help@CampusFind.test' })).status, 302);
  assert.deepEqual(settingsSvc.momo(), { number: '0241234567', name: 'CampusFind Ventures', network: 'MTN MoMo' });
  assert.match((await new Client().get('/terms')).text, /mailto:help@campusfind\.test/, 'support email shown on legal pages');
  assert.match((await state.root.get('/admin/system')).text, /send Mobile Money to <strong>0241234567<\/strong>/);
  assert.equal((await state.alice.post('/admin/system/business', { momo_number: '0200000000' }, '/profile')).status, 403, 'members cannot change it');

  // back to empty so later tests see the defaults
  assert.equal((await b({ momo_number: '', momo_name: '', momo_network: '', support_email: '' })).status, 302);
  assert.equal(settingsSvc.momo().number, '');
});

test('super admin: settings, data export, sign-out-all', async () => {
  const s = (over) => state.root.post('/admin/system/settings', { registration_open: '1', posting_enabled: '1', listings_per_day: '10', reports_per_day: '10', ...over }, '/admin/system');
  await s({ registration_open: undefined, announcement: 'Exams week: be kind' });
  assert.equal((await new Client().get('/register')).status, 403, 'registration closed');
  assert.match((await new Client().get('/')).text, /Exams week: be kind/, 'announcement banner shown');

  await s({ maintenance_mode: '1' });
  assert.equal((await new Client().get('/browse')).status, 503, 'maintenance blocks visitors');
  assert.equal((await new Client().get('/healthz')).status, 200, 'health check stays up');
  assert.equal((await state.root.get('/admin')).status, 200, 'staff keep access during maintenance');
  await s({});
  assert.equal((await new Client().get('/browse')).status, 200);
  assert.equal((await new Client().get('/register')).status, 200);

  const exp = await state.root.post('/admin/system/backup', {}, '/admin/system');
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-disposition'), /campusfind-export-.*\.json/);
  const data = JSON.parse(exp.text);
  assert.ok(data.collections.users.length >= 4 && data.collections.listings.length >= 2);
  assert.equal(data.collections.sessions, undefined, 'sessions are never exported');
  assert.equal(JSON.stringify(data).includes(STRONG), false, 'no passwords in the export');

  const out = await state.root.post('/admin/system/signout-all', {}, '/admin/system');
  assert.equal(out.status, 302);
  assert.equal((await state.alice.get('/profile')).status, 302, 'other sessions were signed out');
  assert.equal((await state.root.get('/admin/system')).status, 200, 'own session survives');
});

test('login: lockout, generic errors, open-redirect defence', async () => {
  const victim = await signup('Lock Victim', 'lock@campus.test');
  victim.jar.clear();
  const c = new Client();
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/login', { email: 'lock@campus.test', password: 'wrong-password-1' })).status, 401);
  const locked = await c.post('/login', { email: 'lock@campus.test', password: STRONG });
  assert.equal(locked.status, 401);
  assert.match(locked.text, /Too many failed attempts/);
  const ghost = await new Client().post('/login', { email: 'nobody@campus.test', password: 'whatever-123' });
  assert.match(ghost.text, /Incorrect email or password/, 'unknown email gets the same message');

  const r = await new Client().post('/login', { email: 'alice@campus.test', password: STRONG, next: '//evil.example/steal' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/', 'protocol-relative next is ignored');
});

test('password recovery through Firebase Auth reset email', async () => {
  const c = new Client();
  const unknown = await c.post('/forgot', { email: 'nobody@campus.test' }, '/forgot');
  assert.equal(unknown.status, 200);
  assert.match(unknown.text, /reset link is on its way/, 'same message for unknown emails');

  const sent = await c.post('/forgot', { email: 'lock@campus.test' }, '/forgot');
  assert.match(sent.text, /reset link is on its way/);
  assert.match(sent.text, /Resend reset link/);
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const codes = (await (await fetch(`http://${host}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/oobCodes`)).json()).oobCodes;
  const mine = codes.filter((x) => x.email === 'lock@campus.test' && x.requestType === 'PASSWORD_RESET').pop();
  assert.ok(mine, 'Firebase generated a reset email');

  const form = await c.get(`/reset?oobCode=${encodeURIComponent(mine.oobCode)}`);
  assert.equal(form.status, 200);
  assert.match(form.text, /Update password/);
  assert.match((await c.get('/reset?oobCode=bogus')).text, /invalid or has expired/);

  const weak = await c.post('/reset', { oobCode: mine.oobCode, password: 'short' }, `/reset?oobCode=${encodeURIComponent(mine.oobCode)}`);
  assert.equal(weak.status, 400);
  const NEW = 'Fresh-Passphrase-4455';
  const done = await c.post('/reset', { oobCode: mine.oobCode, password: NEW }, `/reset?oobCode=${encodeURIComponent(mine.oobCode)}`);
  assert.equal(done.status, 302);
  assert.match((await new Client().post('/login', { email: 'lock@campus.test', password: STRONG })).text, /Incorrect email or password/, 'old password no longer works');
  const login = await new Client().post('/login', { email: 'lock@campus.test', password: NEW });
  assert.equal(login.status, 302, 'new password works and the earlier lockout was cleared');
  const reuse = await c.post('/reset', { oobCode: mine.oobCode, password: 'Another-Passphrase-99' }, '/forgot');
  assert.equal(reuse.status, 400, 'reset link is single use');
});

test('suspended and banned members cannot sign in; reinstated can', async () => {
  const alice = await users.getByEmail('alice@campus.test');
  await users.update(alice.user_id, { status: 'banned', status_reason: 'spam' });
  const r = await new Client().post('/login', { email: 'alice@campus.test', password: STRONG });
  assert.equal(r.status, 401);
  assert.match(r.text, /banned/);
  await users.update(alice.user_id, { status: 'suspended', status_reason: 'cooling off', status_until: Date.now() - 1000 });
  const lifted = await new Client().post('/login', { email: 'alice@campus.test', password: STRONG });
  assert.equal(lifted.status, 302, 'expired suspension is lifted automatically');
  assert.equal((await users.getById(alice.user_id)).status, 'active');
});

test('account deletion anonymises the member and removes listings and credential', async () => {
  const c = await signup('Dana Leaver', 'dana@campus.test');
  const made = await c.request('POST', '/listings/new', { multipart: listingForm(await c.token('/listings/new'), { title: 'Desk lamp to give away', price_type: 'free', description: 'Works perfectly, collect from Block C.' }) });
  const path1 = made.headers.get('location');
  assert.equal((await new Client().get(path1)).status, 200);
  const dana = await users.getByEmail('dana@campus.test');
  assert.equal((await c.post('/profile/delete', { password: 'nope-nope-nope' }, '/profile')).status, 302);
  assert.equal((await users.getById(dana.user_id)).deleted_at, null, 'wrong password deletes nothing');
  assert.equal((await c.post('/profile/delete', { password: STRONG }, '/profile')).status, 302);
  const row = await users.getById(dana.user_id);
  assert.ok(row.deleted_at && row.name === 'Deleted user' && row.email.startsWith('deleted-') && row.uid === null);
  assert.equal((await new Client().get(path1)).status, 404, 'listing gone after account deletion');
  assert.equal((await new Client().post('/login', { email: 'dana@campus.test', password: STRONG })).status, 401);
});

/* ====================================================================== */
/* Extended coverage: profiles, listing lifecycle, notifications, admin    */
/* ====================================================================== */
const ERIN_PW = 'Quartz-Meadow-Lantern-5';
const idFrom = (loc) => Number(/\/listings\/(\d+)/.exec(loc)[1]);
async function publish(c, over = {}) {
  const r = await c.request('POST', '/listings/new', { multipart: listingForm(await c.token('/listings/new'), over) });
  assert.equal(r.status, 302, `publish failed: ${r.text.slice(0, 200)}`);
  return r.headers.get('location');
}

test('profile: update, public page hides email, program toggle, validation', async () => {
  const erin = new Client();
  assert.equal((await erin.post('/register', { name: 'Erin Profile', email: 'erin@campus.test', password: ERIN_PW, agree: '1', dob: '1998-05-14' }, '/register')).status, 302);
  state.erin = erin;
  const base = { name: 'Erin P. Wanjiru', program: 'Computer Science', study_year: 'Year 2', bio: 'Loves hiking.' };

  assert.equal((await erin.post('/profile', { ...base, name: 'E' }, '/profile')).status, 400, 'name too short is rejected');
  assert.equal((await erin.post('/profile', { ...base, show_program: '1' }, '/profile')).status, 302);
  const row = await users.getByEmail('erin@campus.test');
  assert.equal(row.name, 'Erin P. Wanjiru');
  assert.equal(row.profile.program, 'Computer Science');
  const pub = await new Client().get(`/users/${row.user_id}`);
  assert.match(pub.text, /Erin P\. Wanjiru/);
  assert.match(pub.text, /Computer Science/);
  assert.doesNotMatch(pub.text, /erin@campus\.test/, 'email is never public');

  await erin.post('/profile', base, '/profile'); // show_program unchecked
  assert.doesNotMatch((await new Client().get(`/users/${row.user_id}`)).text, /Computer Science/, 'programme hidden when the member opts out');
  assert.equal((await new Client().get('/users/99999999')).status, 404);
  assert.equal((await new Client().get('/users/abc')).status, 404);
});

test('profile: password change needs the current password and applies in Firebase Auth', async () => {
  const erin = state.erin;
  const NEW = 'Violet-Harbor-Compass-8';
  assert.equal((await erin.post('/profile/password', { current_password: 'wrong-wrong-1', new_password: NEW }, '/profile')).status, 400);
  assert.equal((await erin.post('/profile/password', { current_password: ERIN_PW, new_password: 'short' }, '/profile')).status, 400);
  assert.equal((await erin.post('/profile/password', { current_password: ERIN_PW, new_password: NEW }, '/profile')).status, 302);
  assert.equal((await erin.get('/profile')).status, 200, 'current session survives the change');
  assert.equal((await new Client().post('/login', { email: 'erin@campus.test', password: ERIN_PW })).status, 401, 'old password rejected');
  assert.equal((await new Client().post('/login', { email: 'erin@campus.test', password: NEW })).status, 302, 'new password accepted');
  state.erinPw = NEW;
});

test('listing lifecycle: draft, publish with photos, edit, remove photo, close, reopen, delete', async () => {
  const c = state.erin;
  const visitor = () => new Client();

  const draftPath = await publish(c, { title: 'Lifecycle camping tent', intent: 'draft', category_id: '3' });
  const id = idFrom(draftPath);
  assert.equal((await visitor().get(draftPath)).status, 404, 'draft is not public');
  assert.equal((await c.get(draftPath)).status, 200, 'owner can open own draft');
  assert.doesNotMatch((await visitor().get('/browse?q=lifecycle')).text, /Lifecycle camping tent/);

  const edit = listingForm(await c.token(`/listings/${id}/edit`), { title: 'Lifecycle camping tent (2 person)', status: 'active', price: '45' });
  edit.append('images', new Blob([PNG], { type: 'image/png' }), 'one.png');
  edit.append('images', new Blob([PNG], { type: 'image/png' }), 'two.png');
  assert.equal((await c.request('POST', `/listings/${id}/edit`, { multipart: edit })).status, 302);
  let doc = await listingsRepo.get(id);
  assert.equal(doc.status, 'active');
  assert.equal(doc.images.length, 2);
  assert.equal(doc.price_cents, 4500);
  assert.equal(doc.cover, doc.images[0].filename);
  assert.match((await visitor().get(draftPath)).text, /Lifecycle camping tent \(2 person\)/, 'published edit is public');
  assert.equal((await visitor().get(`/uploads/${doc.images[1].filename}`)).status, 200);

  const tooMany = listingForm(await c.token(`/listings/${id}/edit`), { status: 'active', title: 'Lifecycle camping tent (2 person)' });
  for (let i = 0; i < 3; i++) tooMany.append('images', new Blob([PNG], { type: 'image/png' }), `x${i}.png`);
  assert.equal((await c.request('POST', `/listings/${id}/edit`, { multipart: tooMany })).status, 400, 'more than 4 photos is rejected');

  const removed = doc.images[1];
  const rm = listingForm(await c.token(`/listings/${id}/edit`), { status: 'active', title: 'Lifecycle camping tent (2 person)', price: '45' });
  rm.append('remove_image', removed.image_id);
  assert.equal((await c.request('POST', `/listings/${id}/edit`, { multipart: rm })).status, 302);
  doc = await listingsRepo.get(id);
  assert.equal(doc.images.length, 1);
  assert.equal((await visitor().get(`/uploads/${removed.filename}`)).status, 404, 'removed photo is deleted from Storage');

  const bad = listingForm(await c.token(`/listings/${id}/edit`), { title: 'No', status: 'active' });
  assert.equal((await c.request('POST', `/listings/${id}/edit`, { multipart: bad })).status, 400, 'invalid edit is rejected');

  assert.equal((await c.post(`/listings/${id}/status`, { status: 'closed' }, '/my/listings')).status, 302);
  assert.equal((await visitor().get(draftPath)).status, 404, 'closed listing is not public');
  assert.equal((await c.post(`/listings/${id}/status`, { status: 'active' }, '/my/listings')).status, 302);
  assert.equal((await visitor().get(draftPath)).status, 200, 'reopened listing is public again');
  assert.match((await c.get('/my/listings')).text, /Lifecycle camping tent/);

  assert.equal((await c.post(`/listings/${id}/delete`, {}, '/my/listings')).status, 302);
  assert.equal((await visitor().get(draftPath)).status, 404);
  assert.equal((await c.get(draftPath)).status, 404, 'even the owner cannot open a deleted listing');
  assert.doesNotMatch((await c.get('/my/listings')).text, /Lifecycle camping tent/);
  assert.equal((await visitor().get(`/uploads/${doc.images[0].filename}`)).status, 404, 'photos are removed on delete');
});

test('browse: sorting, price filter and out-of-range pages', async () => {
  const c = state.erin;
  await publish(c, { title: 'Sorttest Alpha', price: '50' });
  await publish(c, { title: 'Sorttest Beta', price: '10' });
  await publish(c, { title: 'Sorttest Gamma', price: '30' });
  const order = (html) => ['Alpha', 'Beta', 'Gamma'].map((n) => [n, html.indexOf(`Sorttest ${n}`)]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([n]) => n);
  assert.deepEqual(order((await new Client().get('/browse?q=sorttest&sort=price_asc')).text), ['Beta', 'Gamma', 'Alpha']);
  assert.deepEqual(order((await new Client().get('/browse?q=sorttest&sort=price_desc')).text), ['Alpha', 'Gamma', 'Beta']);
  assert.deepEqual(order((await new Client().get('/browse?q=sorttest&sort=newest')).text), ['Gamma', 'Beta', 'Alpha']);
  assert.deepEqual(order((await new Client().get('/browse?q=sorttest&price_max=35')).text), ['Gamma', 'Beta']);
  assert.equal((await new Client().get('/browse?page=999&sort=bogus&price_max=abc')).status, 200, 'bad query values fall back safely');
});

test('notifications: unread badge, then mark all read', async () => {
  const erin = await users.getByEmail('erin@campus.test');
  assert.equal((await state.root.post(`/admin/users/${erin.user_id}/action`, { action: 'warn', reason: 'Notification test' }, `/admin/users/${erin.user_id}`)).status, 302);
  const list = await state.erin.get('/notifications');
  assert.match(list.text, /Warning from moderators/);
  assert.match(list.text, /notif--unread/);
  assert.equal((await state.erin.post('/notifications/read', {}, '/notifications')).status, 302);
  assert.doesNotMatch((await state.erin.get('/notifications')).text, /notif--unread/, 'everything is marked read');
});

test('admin tools: hide/restore, feature, categories', async () => {
  const path1 = await publish(state.erin, { title: 'Admin tools desk chair', price: '20' });
  const id = idFrom(path1);

  assert.equal((await state.root.post(`/admin/listings/${id}/moderate`, { action: 'hide', reason: 'Checking details' }, '/admin/listings')).status, 302);
  assert.equal((await listingsRepo.get(id)).status, 'hidden');
  assert.equal((await new Client().get(path1)).status, 404, 'hidden listing is not public');
  assert.match((await state.erin.get('/notifications')).text, /Your listing was hidden/);
  assert.equal((await state.erin.post(`/listings/${id}/status`, { status: 'active' }, '/my/listings')).status, 302);
  assert.equal((await listingsRepo.get(id)).status, 'hidden', 'owner cannot undo a moderator action');
  assert.equal((await state.root.post(`/admin/listings/${id}/moderate`, { action: 'restore', reason: 'All good' }, '/admin/listings')).status, 302);
  assert.equal((await new Client().get(path1)).status, 200);

  assert.equal((await state.root.post(`/admin/listings/${id}/feature`, { on: '1' }, '/admin/listings')).status, 302);
  assert.ok((await listingsRepo.get(id)).is_featured);
  assert.match((await new Client().get('/')).text, /Featured/);
  await state.root.post(`/admin/listings/${id}/feature`, { on: '0' }, '/admin/listings');
  assert.ok(!(await listingsRepo.get(id)).is_featured);

  const add = await state.root.post('/admin/categories', { name: 'Tutoring Extras', icon: 'book', description: 'Extra classes' }, '/admin/categories');
  assert.equal(add.status, 302);
  assert.equal((await state.root.post('/admin/categories', { name: 'tutoring extras', icon: 'book' }, '/admin/categories')).status, 400, 'duplicate category name rejected');
  const cat = (await col('categories').where('name', '==', 'Tutoring Extras').get()).docs[0].data();
  assert.match((await new Client().get('/browse')).text, /Tutoring Extras/);
  const form = await state.erin.get('/listings/new');
  assert.match(form.text, /Tutoring Extras/, 'new category is selectable');
  assert.equal((await state.root.post(`/admin/categories/${cat.category_id}`, { name: 'Tutoring Extras', sort_order: '9' }, '/admin/categories')).status, 302);
  assert.doesNotMatch((await state.erin.get('/listings/new')).text, /Tutoring Extras/, 'deactivated category is not offered');
});

test('admin tools: restrict, suspend and reinstate a member', async () => {
  const erin = await users.getByEmail('erin@campus.test');
  const act = (form) => state.root.post(`/admin/users/${erin.user_id}/action`, form, `/admin/users/${erin.user_id}`);

  assert.equal((await act({ action: 'restrict', reason: 'Slow down on posting' })).status, 302);
  const login = new Client();
  assert.equal((await login.post('/login', { email: 'erin@campus.test', password: state.erinPw })).status, 302, 'restricted members can still sign in');
  const before = (await where('listings', 'owner_id', '==', erin.user_id)).length;
  assert.equal((await login.request('POST', '/listings/new', { multipart: listingForm(await login.token('/profile')) })).status, 302, 'restricted member is redirected away');
  assert.equal((await where('listings', 'owner_id', '==', erin.user_id)).length, before, 'restricted member cannot publish');

  assert.equal((await act({ action: 'suspend', days: '3', reason: 'Cooling off' })).status, 302);
  assert.equal((await login.get('/profile')).status, 302, 'suspension signs the member out immediately');
  const blocked = await new Client().post('/login', { email: 'erin@campus.test', password: state.erinPw });
  assert.equal(blocked.status, 401);
  assert.match(blocked.text, /suspended/);
  assert.doesNotMatch((await new Client().get('/browse?q=sorttest')).text, /Sorttest/, 'a suspended member\'s listings are hidden');

  assert.equal((await act({ action: 'reinstate', reason: 'Appeal accepted' })).status, 302);
  assert.equal((await new Client().post('/login', { email: 'erin@campus.test', password: state.erinPw })).status, 302);
  assert.match((await new Client().get('/browse?q=sorttest')).text, /Sorttest/, 'listings return after reinstatement');
});

test('error handling and housekeeping routes', async () => {
  const c = new Client();
  assert.equal((await c.get('/listings/abc')).status, 404);
  assert.equal((await c.get('/listings/99999999')).status, 404);
  assert.equal((await c.get('/uploads/not-a-photo')).status, 404);
  assert.equal((await state.root.get('/admin/reports/999999')).status, 404);
  assert.equal((await state.root.get('/admin/users/999999')).status, 404);
  assert.equal((await c.request('POST', '/listings/1/delete', { form: {} })).status, 403, 'POST without CSRF is rejected');
  const robots = await c.get('/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(robots.text, /Disallow: \/admin/);
  const fav = await c.get('/favicon.ico');
  assert.equal(fav.status, 301);
  assert.equal(fav.headers.get('location'), '/img/favicon.png');
  const page = await c.get('/');
  assert.match(page.text, /property="og:title"/, 'link-preview metadata is present');
  assert.match(page.headers.get('cache-control') || '', /no-store/, 'personalised pages are never cached');
});

test('legal documents: every page is published, complete and linked from the footer', async () => {
  const c = new Client();
  const expected = {
    '/terms': [/Terms of use/, /Limitation of liability/, /Governing law/, new RegExp(`Version ${require('../src/config').legal.version.replace('.', '\\.')}`), /Draft for legal review/],
    '/privacy': [/Privacy policy/, /Your rights/, /How long we keep data/, /Google Firebase/, /Children/],
    '/cookies': [/Cookie policy/, /__session/, /cf-theme/, /No advertising/],
    '/rules': [/Community rules/, /Scams, fraud/],
    '/moderation': [/Moderation &amp; appeals/, /How to appeal/, /30 days/],
    '/copyright': [/Copyright &amp; takedown/, /Counter-notice/, /good-faith/],
    '/legal': [/Legal information/, /Terms of use/, /Privacy policy/, /Cookie policy/],
  };
  for (const [path, patterns] of Object.entries(expected)) {
    const r = await c.get(path);
    assert.equal(r.status, 200, path);
    for (const re of patterns) assert.match(r.text, re, `${path} should match ${re}`);
  }
  const home = (await c.get('/')).text;
  for (const link of ['/terms', '/privacy', '/cookies', '/rules', '/moderation', '/copyright', '/legal']) {
    assert.ok(home.includes(`href="${link}"`), `footer links to ${link}`);
  }
  assert.doesNotMatch((await c.get('/terms')).text, /undefined|\[object/, 'no template leftovers');
  assert.match((await c.get('/privacy')).text, /message us in the <a href="\/help">Help centre<\/a>/, 'points to the Help centre when no support email is configured');
});

test('sign-up records which version of the terms was accepted', async () => {
  const c = await signup('Consent Check', 'consent@campus.test');
  assert.ok(c);
  const row = await users.getByEmail('consent@campus.test');
  assert.equal(row.terms_version, require('../src/config').legal.version);
  assert.ok(row.terms_accepted_at > Date.now() - 60_000);
  const staff = await users.getByEmail('root@campus.test');
  assert.equal(staff.terms_version, null, 'bootstrapped staff accounts carry no consent record');
});

test('installable web app: manifest, icons, shortcuts and head tags', async () => {
  const c = new Client();
  const res = await c.get('/manifest.webmanifest');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /manifest\+json/);
  const m = JSON.parse(res.text);
  assert.equal(m.name, 'CampusFind');
  assert.equal(m.display, 'standalone');
  assert.equal(m.scope, '/');
  assert.match(m.theme_color, /^#[0-9A-Fa-f]{6}$/);
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), 'has the required 192 and 512 icons');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'), 'has a maskable icon for adaptive launchers');
  for (const icon of m.icons) {
    const r = await fetch(base + icon.src);
    assert.equal(r.status, 200, icon.src);
    assert.equal(r.headers.get('content-type'), 'image/png', icon.src);
  }
  for (const s of m.shortcuts) assert.ok([200, 302].includes((await c.get(s.url)).status), `shortcut ${s.url} resolves`);
  const home = (await c.get('/')).text;
  assert.match(home, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(home, /apple-mobile-web-app-capable/);
  assert.match(home, /data-install/, 'install button is present (hidden until the browser offers installation)');
});

test('service worker: served correctly, pre-caches only files that exist, never caches pages', async () => {
  const sw = await fetch(base + '/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type') || '', /javascript/);
  assert.match(sw.headers.get('cache-control') || '', /no-cache/, 'worker updates are never held back by caching');
  const code = await sw.text();
  const listed = /const PRECACHE = \[([\s\S]*?)\];/.exec(code)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  assert.ok(listed.length >= 8 && listed.includes('/offline.html'));
  for (const url of listed) assert.equal((await fetch(base + url)).status, 200, `pre-cached file ${url} exists`);
  assert.match(code, /req\.method !== 'GET'/, 'form posts are never intercepted');
  assert.match(code, /req\.mode === 'navigate'[\s\S]*?fetch\(req\)\.catch/, 'pages are network-only with an offline fallback');
  assert.doesNotMatch(code, /cache\.put\([^)]*navigate/, 'HTML pages are not stored');
});

test('offline page is self-contained and CSP-clean', async () => {
  const r = await fetch(base + '/offline.html');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /You are not connected/);
  assert.doesNotMatch(html, /\sstyle=|\sonclick=|<script>[^<]/, 'no inline style or script (strict CSP)');
});

test('home: hero, header search and categories, listing cards, call-to-action buttons and lost & found shortcuts', async () => {
  const visitor = await new Client().get('/');
  assert.match(visitor.text, /class="mast"/, 'search-led masthead');
  assert.match(visitor.text, /class="home-board"/, 'feed + rail board layout');
  assert.match(visitor.text, /class="catstrip"/, 'sticky category strip');
  assert.match(visitor.text, /class="grid"/, 'listings are shown as a card grid');
  assert.match(visitor.text, /class="listing tone-/, 'each listing is a card');
  assert.match(visitor.text, /Looking for something on/);
  assert.match(visitor.text, /action="\/browse"[^>]*role="search"/);
  assert.match(visitor.text, /Browse all/);
  assert.match(visitor.text, /Create an account/);
  assert.match(visitor.text, /Report it and add a photo/);
  assert.match(visitor.text, /Post a photo and where you left it/);
  assert.match(visitor.text, /href="\/listings\/new\?category=lost-found&amp;kind=lost"/);
  assert.doesNotMatch(visitor.text, /My account/, 'visitors see sign in / join, not the account menu');

  const member = new Client();
  assert.equal((await member.post('/login', { email: 'erin@campus.test', password: state.erinPw })).status, 302);
  const memberHome = await member.get('/');
  assert.match(memberHome.text, /Welcome back,/);
  assert.match(memberHome.text, /My account/);
  assert.match(memberHome.text, /Welcome back, /, 'signed-in members are greeted by name');
  assert.doesNotMatch(memberHome.text, /Create an account/, 'the sign-up button is for visitors only');
  assert.match(memberHome.text, /class="btn btn--accent btn--sm cf-post" href="\/listings\/new"/, 'the Post button is always in the header');
});

test('"Report a lost / found item" shortcuts preselect the category and pre-fill the title', async () => {
  const erin = new Client();
  assert.equal((await erin.post('/login', { email: 'erin@campus.test', password: state.erinPw })).status, 302);
  const lost = await erin.get('/listings/new?category=lost-found&kind=lost');
  assert.equal(lost.status, 200);
  assert.match(lost.text, /value="Lost: "/);
  assert.match(lost.text, /<option value="\d+" selected>Lost &amp; Found<\/option>/);
  const found = await erin.get('/listings/new?category=lost-found&kind=found');
  assert.match(found.text, /value="Found: "/);
  const plain = await erin.get('/listings/new?category=bogus&kind=nonsense');
  assert.equal(plain.status, 200);
  assert.doesNotMatch(plain.text, /value="Lost: "|value="Found: "/, 'unknown values are ignored safely');
  const anon = await new Client().get('/listings/new?category=lost-found&kind=lost');
  assert.equal(anon.status, 302);
  assert.match(anon.headers.get('location'), /^\/login\?next=/, 'visitors are sent to sign in and returned afterwards');
});


/* ------------------------------------------------------------------ legal-risk checks (COPPA, GDPR fonts, CIPA, DMCA) */
const isoDate = (d) => d.toISOString().slice(0, 10);
const yearsAgo = (years, dayShift = 0) => {
  const n = new Date();
  return isoDate(new Date(Date.UTC(n.getUTCFullYear() - years, n.getUTCMonth(), n.getUTCDate() + dayShift)));
};

test('age gate: date of birth is required, under-age sign-ups are refused and remembered, nothing is stored', async () => {
  const email = 'kid@campus.test';
  const c = new Client();
  const none = await c.post('/register', { name: 'No Birthday', email: 'nodob@campus.test', password: STRONG, agree: '1' }, '/register');
  assert.equal(none.status, 400);
  assert.match(none.text, /Enter your date of birth/);
  assert.equal(await users.getByEmail('nodob@campus.test'), null);

  const fake = await c.post('/register', { name: 'Feb Thirty', email: 'feb@campus.test', password: STRONG, agree: '1', dob: '2000-02-31' }, '/register');
  assert.equal(fake.status, 400, 'an impossible date is not accepted');

  const kid = await c.post('/register', { name: 'Young Person', email, password: STRONG, agree: '1', dob: yearsAgo(12) }, '/register');
  assert.equal(kid.status, 403);
  assert.match(kid.text, /at least 16/);
  assert.equal(await users.getByEmail(email), null, 'no account is created');

  // The same browser cannot simply retry with a different date.
  const retry = await c.post('/register', { name: 'Young Person', email, password: STRONG, agree: '1', dob: '1990-01-01' }, '/login');
  assert.equal(retry.status, 403);
  assert.equal((await c.get('/register')).status, 403, 'the form is not shown again');
  assert.equal(await users.getByEmail(email), null);

  // A different browser is not affected, and the exact 16th birthday is accepted.
  const ok = new Client();
  const today = await ok.post('/register', { name: 'Just Sixteen', email: 'sixteen@campus.test', password: STRONG, agree: '1', dob: yearsAgo(16) }, '/register');
  assert.equal(today.status, 302, 'turning 16 today is allowed');
  const dayBefore = await new Client().post('/register', { name: 'Almost Sixteen', email: 'almost@campus.test', password: STRONG, agree: '1', dob: yearsAgo(16, 1) }, '/register');
  assert.equal(dayBefore.status, 403, 'one day short of 16 is refused');

  const stored = await users.getByEmail('sixteen@campus.test');
  assert.equal(stored.min_age_confirmed, 16);
  assert.ok(stored.age_confirmed_at);
  assert.ok(!JSON.stringify(stored).includes(yearsAgo(16)), 'the date of birth itself is never stored');
  assert.ok(!('dob' in stored));
});

test('registration form asks for a date of birth and the policies explain it', async () => {
  const form = await new Client().get('/register');
  assert.match(form.text, /name="dob_d"[\s\S]*name="dob_m"[\s\S]*name="dob_y"/);
  assert.match(form.text, /We do not store it/);
  assert.match((await new Client().get('/privacy')).text, /do not store it/);
  assert.match((await new Client().get('/terms')).text, /at least <strong>16 years old<\/strong>/);
});

test('no third-party hosts: fonts and scripts are self-hosted, no session replay or analytics', async () => {
  const own = new URL(base).host;
  const external = (text) => {
    const hits = [];
    for (const m of text.matchAll(/(?:src|href|action|data-src)=["'](https?:)?\/\/([^/"'\s]+)/gi)) {
      if (m[2] !== own && m[2] !== new URL(require('../src/config').baseUrl).host) hits.push(m[0]);
    }
    for (const m of text.matchAll(/url\(\s*["']?(https?:)?\/\/([^/)"'\s]+)/gi)) hits.push(m[0]);
    for (const m of text.matchAll(/@import\s+(?:url\()?["']?(https?:)?\/\//gi)) hits.push(m[0]);
    return hits;
  };
  const c = new Client();
  for (const p of ['/', '/browse', '/login', '/register', '/terms', '/privacy', '/cookies', '/copyright', '/rules', '/legal']) {
    const r = await c.get(p);
    assert.equal(r.status, 200, p);
    const csp = r.headers.get('content-security-policy') || '';
    assert.match(csp, /font-src 'self'/, 'fonts may only come from this site');
    assert.match(csp, /script-src 'self'/, 'scripts may only come from this site');
    assert.doesNotMatch(csp, /googleapis|gstatic|hotjar|fullstory|clarity|logrocket|mouseflow|segment|mixpanel/i);
    assert.deepEqual(external(r.text), [], `${p} loads nothing from another host`);
    assert.doesNotMatch(r.text, /fonts\.googleapis|fonts\.gstatic|hotjar|fullstory|logrocket|mouseflow|clarity\.ms|google-analytics|googletagmanager/i, p);
  }
  const css = await c.get('/css/app.css');
  assert.equal(css.status, 200);
  assert.deepEqual(external(css.text), [], 'the stylesheet has no external urls');
  assert.match(css.text, /url\(["']?\/fonts\/inter-latin\.woff2/, 'the font is served from /fonts');
  assert.equal((await c.get('/fonts/inter-latin.woff2')).status, 200);
  assert.match((await c.get('/cookies')).text, /No session-replay, screen-recording or keystroke-capture tools/);
});

test('copyright page names the designated agent for takedown notices and never claims a registration it does not have', async () => {
  const r = await new Client().get('/copyright');
  assert.equal(r.status, 200);
  assert.match(r.text, /Designated agent for notices/);
  assert.match(r.text, /Notices of claimed copyright infringement go to our designated agent/);
  assert.match(r.text, /registration with the US Copyright Office is in progress/);
  assert.doesNotMatch(r.text, /DMCA-\d{7}/);
  assert.match((await new Client().get('/privacy')).text, /We do not send marketing or promotional email/);
});

test('lost & found form: photo uploader is offered with guidance that matches lost or found', async () => {
  const c = await signup('Photo Tips', 'phototips@campus.test');
  const found = (await c.get('/listings/new?category=lost-found&kind=found')).text;
  assert.match(found, /type="file"[^>]*name="images"|name="images"[^>]*type="file"/, 'a photo uploader is present');
  assert.match(found, /Add a photo of the item/);
  assert.match(found, /<div class="lf-tip" data-lf-tip>/, 'the tip is visible for lost & found');
  assert.match(found, /<p class="lf-tip__found">/, 'found-item advice is shown');
  assert.match(found, /<p class="lf-tip__lost" hidden>/, 'lost-item advice is hidden for a found item');
  assert.match(found, /Do not photograph ID cards/);
  assert.match(found, /data-lf-category="\d+"/, 'the form tells app.js which category is lost & found');

  const lost = (await c.get('/listings/new?category=lost-found&kind=lost')).text;
  assert.match(lost, /<p class="lf-tip__lost">/);
  assert.match(lost, /<p class="lf-tip__found" hidden>/);

  const plain = (await c.get('/listings/new')).text;
  assert.match(plain, /<div class="lf-tip" data-lf-tip hidden>/, 'hidden for other categories until Lost & Found is chosen');
  assert.match(plain, /<span data-photo-legend>Photos<\/span>/);

  const home = (await new Client().get('/')).text;
  assert.match(home, /add a photo/i, 'the home page invites a photo with a lost report');
  assert.match(home, /Post a photo and where you left it/);
});
test('search visibility: robots points to the sitemap, sitemap lists live listings, structured data on home and listing pages', async () => {
  const c = await signup('Sena Visible', 'sena@campus.test');
  const loc = await publish(c, { title: 'Physics textbook <b>bold</b> edition', price: '40' });
  const id = idOf(loc);
  listingsRepo.invalidate();

  const robots = await new Client().get('/robots.txt');
  assert.match(robots.headers.get('content-type') || '', /text\/plain/);
  assert.match(robots.text, /Disallow: \/admin/);
  assert.match(robots.text, /Sitemap: http.+\/sitemap\.xml/);

  const sm = await new Client().get('/sitemap.xml');
  assert.equal(sm.status, 200);
  assert.match(sm.headers.get('content-type') || '', /xml/);
  assert.match(sm.text, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(sm.text, new RegExp(`/listings/${id}</loc><lastmod>\\d{4}-\\d{2}-\\d{2}</lastmod>`));
  assert.match(sm.text, /\/browse\?category=textbooks/);
  assert.doesNotMatch(sm.text, /\/admin|\/messages|\/login/, 'private pages never appear in the sitemap');

  const ld = (text) => JSON.parse(/<script type="application\/ld\+json">(.+?)<\/script>/.exec(text)[1]);
  const home = ld((await new Client().get('/')).text);
  assert.ok(home['@graph'].some((n) => n['@type'] === 'WebSite' && n.potentialAction['@type'] === 'SearchAction'));

  const detail = await new Client().get(`/listings/${id}`);
  assert.doesNotMatch(detail.text, /<b>bold<\/b>/, 'listing text inside structured data cannot break out of the script tag');
  const g = ld(detail.text)['@graph'];
  const product = g.find((n) => n['@type'] === 'Product');
  assert.equal(product.offers.price, '40.00');
  assert.equal(product.offers.priceCurrency, 'GHS');
  assert.ok(g.some((n) => n['@type'] === 'BreadcrumbList'));
});

test('posters: owners print a QR poster for live listings; staff get the launch kit; others are refused', async () => {
  const c = await signup('Kwame Poster', 'kwame.poster@campus.test');
  const id = idOf(await publish(c, { title: 'Desk lamp poster test', price: '30' }));
  const detail = await c.get(`/listings/${id}`);
  assert.match(detail.text, new RegExp(`href="/listings/${id}/poster"`), 'owner sees the poster link');

  const p = await c.get(`/listings/${id}/poster`);
  assert.equal(p.status, 200);
  assert.match(p.text, /<svg[^>]+viewBox/, 'QR code is drawn inline');
  assert.match(p.text, /Desk lamp poster test/);
  assert.match(p.text, /data-print/);
  assert.doesNotMatch(p.text, /555-0100/, 'contact details are not printed');

  assert.doesNotMatch((await new Client().get(`/listings/${id}`)).text, /\/poster"/, 'visitors do not see the poster link');
  const other = await signup('Ama Other', 'ama.other@campus.test');
  assert.equal((await other.get(`/listings/${id}/poster`)).status, 403);
  assert.equal((await new Client().get(`/listings/${id}/poster`)).status, 302);

  assert.equal((await c.get('/admin/launch-kit')).status === 200, false, 'members cannot open the launch kit');
  const kit = await state.root.get('/admin/launch-kit');
  assert.equal(kit.status, 200);
  assert.equal((kit.text.match(/class="poster poster--site"/g) || []).length, 3);
  assert.equal((kit.text.match(/<svg/g) || []).length >= 3, true);
});

test('freshness: listings get a reminder, expire after 30 days, renew in one tap; business listings never expire', async () => {
  const fresh = require('../src/services/freshness');
  const DAY = 86_400_000;
  const c = await signup('Efua Fresh', 'efua.fresh@campus.test');
  const oldId = idOf(await publish(c, { title: 'Old rice cooker freshness' }));
  const dueId = idOf(await publish(c, { title: 'Nearly due kettle freshness' }));
  const newId = idOf(await publish(c, { title: 'Brand new fan freshness' }));
  await listingsRepo.update(oldId, { published_at: Date.now() - 31 * DAY });
  await listingsRepo.update(dueId, { published_at: Date.now() - 28 * DAY });

  const early = await c.request('POST', `/listings/${newId}/renew`, { form: { _csrf: await c.token('/my/listings') } });
  assert.equal(early.status, 302);
  assert.equal((await listingsRepo.get(newId)).renewed_at, undefined, 'a fresh listing cannot be renewed yet');

  const r = await fresh.sweep({ force: true });
  assert.ok(r.expired >= 1 && r.reminded >= 1);
  const old = await listingsRepo.get(oldId);
  assert.equal(old.status, 'closed');
  assert.equal(old.outcome, 'expired');
  assert.equal((await listingsRepo.get(dueId)).status, 'active');
  assert.equal((await listingsRepo.get(newId)).status, 'active');
  const notes = await where('notifications', 'title', '==', '“Old rice cooker freshness” has expired');
  assert.equal(notes.length, 1);
  assert.equal((await where('notifications', 'title', '==', 'Is “Nearly due kettle freshness” still available?')).length, 1);
  await fresh.sweep({ force: true });
  assert.equal((await where('notifications', 'title', '==', 'Is “Nearly due kettle freshness” still available?')).length, 1, 'only one reminder');

  listingsRepo.invalidate();
  assert.doesNotMatch((await c.get('/browse?q=freshness')).text, /Old rice cooker/, 'expired listings leave Browse');
  const mine = await c.get('/my/listings');
  assert.match(mine.text, /badge--expired/);
  assert.match(mine.text, new RegExp(`/listings/${oldId}/renew`));
  assert.match((await c.get(`/listings/${oldId}`)).text, /This listing has expired/);
  assert.equal((await new Client().get(`/listings/${oldId}`)).status, 404, 'visitors no longer see it');

  const other = await signup('Yaw Other', 'yaw.other@campus.test');
  assert.equal((await other.request('POST', `/listings/${oldId}/renew`, { form: { _csrf: await other.token('/my/listings') } })).status, 403);

  const ok = await c.request('POST', `/listings/${oldId}/renew`, { form: { _csrf: await c.token('/my/listings') } });
  assert.equal(ok.status, 302);
  const renewed = await listingsRepo.get(oldId);
  assert.equal(renewed.status, 'active');
  assert.equal(renewed.outcome, null);
  assert.ok(renewed.renewed_at > Date.now() - 60_000);

  const bizCat = (await require('../src/repo/categories').all()).find((x) => x.slug === 'business');
  const bizId = idOf(await publish(c, { title: 'Hostel freshness exempt', category_id: String(bizCat.category_id) }));
  const paid = await c.request('POST', `/listings/${bizId}/promote`, { form: { _csrf: await c.token(`/listings/${bizId}/promote`), product: 'business' } });
  await require('../src/services/payments').fulfil(Number(/\/orders\/(\d+)/.exec(paid.headers.get('location'))[1]));
  await listingsRepo.update(bizId, { published_at: Date.now() - 90 * DAY });
  await fresh.sweep({ force: true });
  assert.equal((await listingsRepo.get(bizId)).status, 'active', 'business listings never expire');
});

test('verified members: Firebase sends the link, /reset applies it, badges show; university emails are Verified student', async () => {
  const oob = async (email) => {
    const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const codes = (await (await fetch(`http://${host}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/oobCodes`)).json()).oobCodes;
    return codes.filter((x) => x.email === email && x.requestType === 'VERIFY_EMAIL').pop();
  };
  const c = await signup('Abena Student', 'abena@st.ug.edu.gh');
  const me = await users.getByEmail('abena@st.ug.edu.gh');
  const id = idOf(await publish(c, { title: 'Verified seller test item' }));
  assert.doesNotMatch((await c.get(`/users/${me.user_id}`)).text, /Verified student/);
  assert.match((await c.get('/profile')).text, /Get the Verified student badge/);

  const sent = await c.post('/profile/verify', {}, '/profile');
  assert.equal(sent.status, 302);
  const code = await oob('abena@st.ug.edu.gh');
  assert.ok(code, 'Firebase generated a verification email');
  assert.match((await c.get('/profile')).text, /a moment ago|sent a verification link/);
  await c.post('/profile/verify', {}, '/profile');
  assert.match((await c.get('/profile')).text, /a moment ago/, 'resends are throttled');

  assert.equal((await new Client().get('/reset?mode=verifyEmail&oobCode=bogus')).status, 302);
  assert.equal((await users.getByEmail('abena@st.ug.edu.gh')).email_verified_at, undefined, 'a bad code verifies nobody');
  const applied = await c.get(`/reset?mode=verifyEmail&oobCode=${encodeURIComponent(code.oobCode)}`);
  assert.equal(applied.headers.get('location'), '/profile#verify');
  assert.ok((await users.getByEmail('abena@st.ug.edu.gh')).email_verified_at);

  assert.match((await new Client().get(`/users/${me.user_id}`)).text, /pf-badge--student/);
  assert.match((await new Client().get(`/listings/${id}`)).text, /Verified student/);

  // A personal address gets "Email verified", picked up from Firebase even when the link was opened on Firebase's own page.
  const g = await signup('Kojo Gmail', 'kojo.verify@gmail.test');
  const kojo = await users.getByEmail('kojo.verify@gmail.test');
  await require('../src/firebase').auth.updateUser(kojo.uid, { emailVerified: true });
  assert.match((await g.get('/profile')).text, /Email verified/);
  assert.match((await new Client().get(`/users/${kojo.user_id}`)).text, /pf-badge--verified/);
  assert.equal(require('../src/services/verify').isStudentEmail('x@knust.edu.gh'), true);
  assert.equal(require('../src/services/verify').isStudentEmail('x@edu.gh.evil.com'), false);
});

test('browse: verified mark on listing cards and a "Verified sellers only" filter', async () => {
  const v = await signup('Esi Verified', 'esi.v@st.knust.edu.gh');
  const esi = await users.getByEmail('esi.v@st.knust.edu.gh');
  await users.update(esi.user_id, { email_verified_at: Date.now() });
  users.forget(esi.user_id);
  await publish(v, { title: 'Trustmark verified lamp' });
  const n = await signup('Nii Unverified', 'nii.u@campus.test');
  await publish(n, { title: 'Trustmark unverified lamp' });
  listingsRepo.invalidate();

  const all = await new Client().get('/browse?q=trustmark');
  assert.match(all.text, /Trustmark verified lamp/);
  assert.match(all.text, /Trustmark unverified lamp/);
  assert.match(all.text, /vmark vmark--student/);
  const only = await new Client().get('/browse?q=trustmark&verified=1');
  assert.match(only.text, /Trustmark verified lamp/);
  assert.doesNotMatch(only.text, /Trustmark unverified lamp/);
  assert.match(only.text, /Sellers: Verified only/);
  assert.match(only.text, /name="verified" value="1" checked/);
});

test('chat: quick messages on listings and "usually replies" from real reply times', async () => {
  const seller = await signup('Adwoa Replies', 'adwoa.r@campus.test');
  const sel = await users.getByEmail('adwoa.r@campus.test');
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(idOf(await publish(seller, { title: `Reply speed item ${i}` })));
  const buyer = await signup('Fiifi Buyer', 'fiifi.b@campus.test');
  const page = await buyer.get(`/listings/${ids[0]}`);
  assert.match(page.text, /data-fill="Is this still available\?"/);
  assert.doesNotMatch(page.text, /Usually replies/, 'no label before three answered chats');
  for (const id of ids) {
    const r = await buyer.post(`/listings/${id}/message`, { body: 'Hi, is this still available?' }, `/listings/${id}`);
    assert.equal(r.status, 302);
    const cid = `${id}-${(await users.getByEmail('fiifi.b@campus.test')).user_id}`;
    const tok = await seller.token(`/messages/${cid}`);
    const rep = await seller.request('POST', `/messages/${cid}`, { form: { _csrf: tok, body: 'Yes it is!' } });
    assert.ok([200, 302].includes(rep.status), `reply ${rep.status}`);
    await seller.request('POST', `/messages/${cid}`, { form: { _csrf: tok, body: 'Second reply does not count again' } });
  }
  const stats = (await users.getByEmail('adwoa.r@campus.test')).reply_stats;
  assert.deepEqual({ asked: stats.asked, replied: stats.replied, within_hour: stats.within_hour }, { asked: 3, replied: 3, within_hour: 3 });
  assert.match((await new Client().get(`/listings/${ids[1]}`)).text, /Usually replies within an hour/);
  assert.match((await new Client().get(`/users/${sel.user_id}`)).text, /Usually replies within an hour/);
});

test('staff two-step sign-in: enrolment is enforced, codes are checked, replay and guessing are blocked, secrets never exported', async () => {
  const config = require('../src/config');
  const totp = require('../src/lib/totp');
  const { createAccount } = require('../src/services/auth');
  const prev = config.security.staff2fa;
  config.security.staff2fa = true;
  try {
    const PW = 'Granite-Harbor-Violet-71';
    const mod = await createAccount({ name: 'Mo Twofactor', email: 'mo.2fa@campus.test', password: PW, role: 'moderator' });
    const c = new Client();
    assert.equal((await c.post('/admin/login', { email: 'mo.2fa@campus.test', password: PW, next: '/admin' }, '/admin/login')).status, 302);
    const gate = await c.get('/admin');
    assert.equal(gate.status, 302);
    assert.equal(gate.headers.get('location'), '/admin/2fa/setup', 'staff without two-step sign-in are sent to set it up');

    const setup = await c.get('/admin/2fa/setup');
    assert.match(setup.text, /<svg/);
    const secret = /data-tfa-key>([A-Z2-7 ]+)</.exec(setup.text)[1].replace(/ /g, '');
    assert.equal((await c.get('/admin/2fa/setup')).text.includes(setup.text.match(/data-tfa-key>[^<]+/)[0]), true, 'reloading keeps the same secret');
    assert.equal((await c.post('/admin/2fa/setup', { code: '000000' }, '/admin/2fa/setup')).status, 400);
    const done = await c.post('/admin/2fa/setup', { code: totp.codeAt(secret, totp.counterNow()) }, '/admin/2fa/setup');
    assert.equal(done.status, 200);
    const codes = [...done.text.matchAll(/<code>([0-9a-f]{5}-[0-9a-f]{5})<\/code>/g)].map((m) => m[1]);
    assert.equal(codes.length, 8);
    assert.equal((await c.get('/admin')).status, 200, 'admin area opens once enrolled');

    const stored = await users.getByEmail('mo.2fa@campus.test');
    assert.ok(stored.totp_secret.startsWith('v1.') && !stored.totp_secret.includes(secret), 'secret is stored encrypted');
    assert.ok(!JSON.stringify(stored.totp_recovery).includes(codes[0]), 'recovery codes are stored hashed');

    const login = (code) => new Client().post('/admin/login', { email: 'mo.2fa@campus.test', password: PW, code, next: '/admin' }, '/admin/login');
    assert.equal((await login('')).status, 401, 'password alone is no longer enough');
    assert.equal((await login(totp.codeAt(secret, totp.counterNow()))).status, 401, 'a code already used cannot be replayed');
    assert.equal((await login(totp.codeAt(secret, totp.counterNow() + 1))).status, 302, 'the next code works');
    assert.equal((await login(codes[0])).status, 302, 'a recovery code works once');
    assert.equal((await login(codes[0])).status, 401, 'and only once');
    for (let i = 0; i < 4; i++) await login('123456');
    const locked = await login(totp.codeAt(secret, totp.counterNow() + 1));
    assert.equal(locked.status, 401);
    assert.match(locked.text, /Too many failed attempts/, 'five wrong codes lock the account');
    await users.update(mod.user_id, { locked_until: null });

    // A super admin can reset it; exports never contain the secret.
    assert.equal((await state.root.get(`/admin/users/${mod.user_id}`)).status, 302, "the super admin without two-step sign-in is also sent to set it up");
    config.security.staff2fa = false;
    const reset = await state.root.request('POST', `/admin/users/${mod.user_id}/reset-2fa`, { form: { _csrf: await state.root.token(`/admin/users/${mod.user_id}`) } });
    assert.equal(reset.status, 302);
    assert.equal((await users.getById(mod.user_id)).totp_secret, null);
    const backup = await state.root.request('POST', '/admin/system/backup', { form: { _csrf: await state.root.token('/admin/system') } });
    assert.equal(backup.status, 200);
    assert.doesNotMatch(backup.text, /"totp_(secret|recovery|pending)"/);
  } finally {
    config.security.staff2fa = prev;
  }
});

test('hardening: HSTS-ready headers, security.txt, admin pages never cached', async () => {
  const st = await new Client().get('/.well-known/security.txt');
  assert.equal(st.status, 200);
  assert.match(st.text, /^Contact: http.+\/help$/m);
  assert.match(st.text, /^Expires: \d{4}-/m);
  const h = (await new Client().get('/')).headers;
  assert.equal(h.get('x-frame-options'), 'DENY');
  assert.equal(h.get('x-content-type-options'), 'nosniff');
  assert.match(h.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(h.get('x-powered-by'), null);
  const adm = await state.root.get('/admin');
  assert.match(adm.headers.get('cache-control') || '', /no-store/);
});

test('devices: members see where they are signed in, sign out one or all others, and are told about a new browser', async () => {
  const PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
  const LAPTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';
  const a = await signup('Akos Devices', 'akos.dev@campus.test');
  const me = await users.getByEmail('akos.dev@campus.test');
  const loginAs = async (ua) => {
    const c = new Client();
    const tok = await c.token('/login');
    const r = await c.request('POST', '/login', { form: { _csrf: tok, email: 'akos.dev@campus.test', password: STRONG }, headers: { 'user-agent': ua } });
    assert.equal(r.status, 302);
    return c;
  };
  const phone = await loginAs(PHONE);
  const laptop = await loginAs(LAPTOP);
  const alerts = await where('notifications', 'user_id', '==', me.user_id);
  assert.ok(alerts.some((n) => n.title === 'New sign-in: Edge on Windows'), 'a new browser triggers an alert');
  await loginAs(LAPTOP);
  assert.equal((await where('notifications', 'user_id', '==', me.user_id)).filter((n) => n.title === 'New sign-in: Edge on Windows').length, 1, 'a known browser does not');

  const page = await phone.get('/profile');
  assert.match(page.text, /Where you’re signed in/);
  assert.match(page.text, /Chrome on Android<\/strong> <span class="badge badge--active">This device/);
  assert.match(page.text, /Edge on Windows/);
  const sess = await where('sessions', 'user_id', '==', me.user_id);
  for (const s of sess) assert.ok(!page.text.includes(s.session_hash), 'session ids never appear on the page');

  // sign out one device
  const ids = [...page.text.matchAll(/\/profile\/sessions\/([0-9a-f]{16})\/revoke/g)].map((m) => m[1]);
  assert.ok(ids.length >= 2);
  const tok = await phone.token('/profile');
  const other = await signup('Not Akos', 'not.akos@campus.test');
  assert.equal((await other.request('POST', `/profile/sessions/${ids[0]}/revoke`, { form: { _csrf: await other.token('/profile') } })).status, 302);
  assert.equal((await where('sessions', 'user_id', '==', me.user_id)).length, sess.length, 'nobody can sign out someone else');
  await phone.request('POST', `/profile/sessions/${ids[0]}/revoke`, { form: { _csrf: tok } });
  assert.equal((await where('sessions', 'user_id', '==', me.user_id)).length, sess.length - 1);

  // sign out everywhere else
  await phone.request('POST', '/profile/sessions/others', { form: { _csrf: tok } });
  assert.equal((await where('sessions', 'user_id', '==', me.user_id)).length, 1);
  assert.equal((await laptop.get('/profile')).status, 302, 'the laptop is signed out');
  assert.equal((await phone.get('/profile')).status, 200, 'this device stays signed in');
  assert.equal((await a.get('/profile')).status, 302);
});

test('chat safety: one-time codes are never sent; scam patterns warn the reader (not the sender, not staff)', async () => {
  const seller = await signup('Scam Seller', 'scam.seller@campus.test');
  const id = idOf(await publish(seller, { title: 'Chat safety phone' }));
  const buyer = await signup('Careful Buyer', 'careful.buyer@campus.test');
  const b = await users.getByEmail('careful.buyer@campus.test');
  assert.equal((await buyer.post(`/listings/${id}/message`, { body: 'Hi, is this still available?' }, `/listings/${id}`)).status, 302);
  const cid = `${id}-${b.user_id}`;
  const send = async (c, body) => c.request('POST', `/messages/${cid}`, { form: { _csrf: await c.token(`/messages/${cid}`), body } });

  await send(seller, 'Yes. Please pay the deposit first via MoMo then I deliver');
  await send(seller, 'Also send me the verification code you just received');
  const before = (await messages()).length;
  await send(buyer, 'ok my code is 482913');
  assert.equal((await messages()).length, before, 'a message with a one-time code is not sent');
  assert.match((await buyer.get(`/messages/${cid}`)).text, /this was not sent/);

  const view = await buyer.get(`/messages/${cid}`);
  assert.equal((view.text.match(/class="bubble__warn"/g) || []).length, 2, 'the reader sees one warning per risky message');
  assert.match(view.text, /most common scam/);
  assert.match(view.text, /Never share a PIN/);
  assert.doesNotMatch((await seller.get(`/messages/${cid}`)).text, /class="bubble__warn"/, 'the sender is not shown warnings about their own messages');
  const live = JSON.parse((await buyer.get(`/messages/${cid}/updates?since=0`)).text);
  assert.ok(live.messages.some((m) => m.warn.length), 'live updates carry the warnings too');

  async function messages() { return (await col('conversations').doc(cid).collection('messages').get()).docs; }
});

test('report a chat message: the exact message is attached server-side; nothing else from the chat; forged refs refused', async () => {
  const seller = await signup('Rude Seller', 'rude.seller@campus.test');
  const s = await users.getByEmail('rude.seller@campus.test');
  const id = idOf(await publish(seller, { title: 'Message report item' }));
  const buyer = await signup('Reporting Buyer', 'reporting.buyer@campus.test');
  const b = await users.getByEmail('reporting.buyer@campus.test');
  await buyer.post(`/listings/${id}/message`, { body: 'Hi, is it available? (private line)' }, `/listings/${id}`);
  const cid = `${id}-${b.user_id}`;
  await seller.request('POST', `/messages/${cid}`, { form: { _csrf: await seller.token(`/messages/${cid}`), body: 'Pay the deposit first or forget it, idiot' } });
  const msgs = (await col('conversations').doc(cid).collection('messages').orderBy('created_at').get()).docs.map((d) => d.data());
  const bad = msgs.find((m) => m.sender_id === s.user_id);
  const mine = msgs.find((m) => m.sender_id === b.user_id);

  const chat = await buyer.get(`/messages/${cid}`);
  assert.ok(chat.text.includes(`/report?type=user&amp;id=${s.user_id}&amp;msg=${encodeURIComponent(`${cid}~${bad.id}`)}`), 'a report link on their message');
  assert.equal((chat.text.match(/class="bubble__report"/g) || []).length, 1, 'no report link on your own messages');

  const ref = `${cid}~${bad.id}`;
  const form = await buyer.get(`/report?type=user&id=${s.user_id}&msg=${encodeURIComponent(ref)}`);
  assert.match(form.text, /forget it, idiot/);
  // forged: my own message, or someone else's chat
  assert.doesNotMatch((await buyer.get(`/report?type=user&id=${s.user_id}&msg=${encodeURIComponent(`${cid}~${mine.id}`)}`)).text, /private line/);
  const outsider = await signup('Out Sider', 'out.sider@campus.test');
  assert.doesNotMatch((await outsider.get(`/report?type=user&id=${s.user_id}&msg=${encodeURIComponent(ref)}`)).text, /forget it, idiot/, 'outsiders cannot pull messages from a chat');

  const sent = await buyer.request('POST', '/report', { form: { _csrf: await buyer.token('/profile'), type: 'user', id: String(s.user_id), msg: ref, reason: 'harassment', details: 'Rude' } });
  assert.equal(sent.status, 302);
  assert.equal(sent.headers.get('location'), `/messages/${cid}`);
  const rep = (await where('reports', 'target_id', '==', s.user_id)).pop();
  assert.equal(rep.evidence.body, 'Pay the deposit first or forget it, idiot');
  assert.deepEqual(rep.evidence.flags, ['pay-first']);
  const adminView = await state.root.get(`/admin/reports/${rep.report_id}`);
  assert.match(adminView.text, /Reported chat message/);
  assert.match(adminView.text, /forget it, idiot/);
  assert.doesNotMatch(adminView.text, /private line/, 'moderators see only the reported message');
});

test('blocking: no messages either way, blocked listings hidden for the blocker, report still works, unblock restores', async () => {
  const pest = await signup('Pesky Pest', 'pesky.pest@campus.test');
  const p = await users.getByEmail('pesky.pest@campus.test');
  const lid = idOf(await publish(pest, { title: 'Blockable bicycle' }));
  const me = await signup('Calm Member', 'calm.member@campus.test');
  const m = await users.getByEmail('calm.member@campus.test');
  await me.post(`/listings/${lid}/message`, { body: 'Hi, is it available?' }, `/listings/${lid}`);
  const cid = `${lid}-${m.user_id}`;

  const b = await me.request('POST', `/users/${p.user_id}/block`, { form: { _csrf: await me.token(`/users/${p.user_id}`) } });
  assert.equal(b.status, 302);
  listingsRepo.invalidate();
  assert.doesNotMatch((await me.get('/browse?q=blockable')).text, /Blockable bicycle/, 'the blocker no longer sees their listings');
  assert.match((await new Client().get('/browse?q=blockable')).text, /Blockable bicycle/, 'everyone else still does');

  const count = async () => (await col('conversations').doc(cid).collection('messages').get()).size;
  const n = await count();
  await pest.request('POST', `/messages/${cid}`, { form: { _csrf: await pest.token(`/messages/${cid}`), body: 'Why are you ignoring me' } });
  await pest.request('POST', `/users/${m.user_id}/message`, { form: { _csrf: await pest.token(`/users/${m.user_id}`), body: 'New chat attempt' } });
  assert.equal(await count(), n, 'the blocked member cannot message');
  assert.equal((await where('conversations', 'id', '==', `dm-${Math.min(p.user_id, m.user_id)}-${Math.max(p.user_id, m.user_id)}`)).length, 0);
  await me.request('POST', `/messages/${cid}`, { form: { _csrf: await me.token(`/messages/${cid}`), body: 'One more thing' } });
  assert.equal(await count(), n, 'the blocker cannot message either until they unblock');
  assert.match((await me.get(`/messages/${cid}`)).text, /You blocked this member/);
  assert.match((await me.get(`/report?type=user&id=${p.user_id}`)).text, /Send report/, 'reporting still works after a block');
  assert.match((await me.get('/profile')).text, /Blocked members[\s\S]*Pesky Pest/);

  // staff cannot be blocked
  const root = await users.getByEmail('root@campus.test');
  await me.request('POST', `/users/${root.user_id}/block`, { form: { _csrf: await me.token('/profile') } });
  assert.ok(!((await users.getByEmail('calm.member@campus.test')).blocked || []).includes(root.user_id));

  await me.request('POST', `/users/${p.user_id}/unblock`, { form: { _csrf: await me.token('/profile'), back: 'profile' } });
  await me.request('POST', `/messages/${cid}`, { form: { _csrf: await me.token(`/messages/${cid}`), body: 'Back to normal' } });
  assert.equal(await count(), n + 1, 'messaging works again after unblocking');
});

test('safety signals: block counts and scam-message counts surface a member to moderators, without any message text', async () => {
  const shady = await signup('Shady Seller', 'shady.seller@campus.test');
  const sh = await users.getByEmail('shady.seller@campus.test');
  const lid = idOf(await publish(shady, { title: 'Signals test phone' }));
  const victims = [];
  for (const n of ['one', 'two']) {
    const v = await signup(`Victim ${n}`, `victim.${n}@campus.test`);
    const vu = await users.getByEmail(`victim.${n}@campus.test`);
    await v.post(`/listings/${lid}/message`, { body: 'Hi, still available?' }, `/listings/${lid}`);
    const cid = `${lid}-${vu.user_id}`;
    await shady.request('POST', `/messages/${cid}`, { form: { _csrf: await shady.token(`/messages/${cid}`), body: 'Secret wording: pay the deposit first then I deliver' } });
    victims.push(v);
  }
  // a third scam-like message, and repeated block/unblock does not inflate counts
  const v0 = await users.getByEmail('victim.one@campus.test');
  await shady.request('POST', `/messages/${lid}-${v0.user_id}`, { form: { _csrf: await shady.token(`/messages/${lid}-${v0.user_id}`), body: 'Send me the verification code you got' } });
  for (const v of victims) {
    const tok = await v.token(`/users/${sh.user_id}`);
    await v.request('POST', `/users/${sh.user_id}/block`, { form: { _csrf: tok } });
    await v.request('POST', `/users/${sh.user_id}/block`, { form: { _csrf: tok } });
  }
  await victims[1].request('POST', `/users/${sh.user_id}/unblock`, { form: { _csrf: await victims[1].token('/profile') } });
  await victims[1].request('POST', `/users/${sh.user_id}/unblock`, { form: { _csrf: await victims[1].token('/profile') } });
  await victims[1].request('POST', `/users/${sh.user_id}/block`, { form: { _csrf: await victims[1].token(`/users/${sh.user_id}`) } });

  const u = await users.getByEmail('shady.seller@campus.test');
  assert.equal(u.blocked_by_count, 2);
  assert.equal(u.chat_flags['pay-first'], 2);
  assert.equal(u.chat_flags['asks-code'], 1);

  const page = await state.root.get('/admin/signals');
  assert.equal(page.status, 200);
  assert.match(page.text, new RegExp(`/admin/users/${sh.user_id}">Shady Seller`));
  assert.doesNotMatch(page.text, /Secret wording/, 'no message text reaches moderators');
  assert.match((await state.root.get(`/admin/users/${sh.user_id}`)).text, /Blocked by <strong>2<\/strong> members/);
  assert.equal((await victims[0].get('/admin/signals')).status === 200, false, 'members cannot open it');
});

test('offers: buyer offers in chat, seller accepts (listing reserved) or declines, buyer withdraws, rules enforced', async () => {
  const seller = await signup('Offer Seller', 'offer.seller@campus.test');
  const lid = idOf(await publish(seller, { title: 'Offerable desk chair', price: '200', price_type: 'negotiable' }));
  const buyer = await signup('Offer Buyer', 'offer.buyer@campus.test');
  const bu = await users.getByEmail('offer.buyer@campus.test');
  await buyer.post(`/listings/${lid}/message`, { body: 'Hi, is it available?' }, `/listings/${lid}`);
  const cid = `${lid}-${bu.user_id}`;
  const post = async (c, url, form = {}) => c.request('POST', url, { form: { _csrf: await c.token(`/messages/${cid}`), ...form } });
  const msgs = async () => (await col('conversations').doc(cid).collection('messages').orderBy('created_at').get()).docs.map((d) => d.data());

  assert.match((await buyer.get(`/messages/${cid}`)).text, /Make an offer/);
  assert.doesNotMatch((await seller.get(`/messages/${cid}`)).text, /Make an offer/, 'sellers do not get the offer box');
  await post(buyer, `/messages/${cid}/offer`, { amount: 'abc' });
  await post(seller, `/messages/${cid}/offer`, { amount: '150' });
  assert.equal((await msgs()).filter((m) => m.offer).length, 0, 'bad amounts and seller offers are refused');

  await post(buyer, `/messages/${cid}/offer`, { amount: '150' });
  await post(buyer, `/messages/${cid}/offer`, { amount: '160' });
  let offers = (await msgs()).filter((m) => m.offer);
  assert.equal(offers.length, 1, 'one open offer at a time');
  assert.equal(offers[0].offer.amount_cents, 15000);
  assert.match((await seller.get(`/messages/${cid}`)).text, /Accept and reserve/);

  await post(buyer, `/messages/${cid}/offer/${offers[0].id}/accept`);
  assert.equal((await msgs()).find((m) => m.id === offers[0].id).offer.status, 'pending', 'the buyer cannot accept their own offer');
  await post(buyer, `/messages/${cid}/offer/${offers[0].id}/withdraw`);
  assert.equal((await msgs()).find((m) => m.id === offers[0].id).offer.status, 'withdrawn');

  await post(buyer, `/messages/${cid}/offer`, { amount: '170' });
  offers = (await msgs()).filter((m) => m.offer && m.offer.status === 'pending');
  await post(seller, `/messages/${cid}/offer/${offers[0].id}/accept`);
  const l = await listingsRepo.get(lid);
  assert.equal(l.reserved_for, bu.user_id);
  assert.equal(l.reserved_cents, 17000);
  assert.ok((await msgs()).some((m) => /Offer accepted/.test(m.body)));
  listingsRepo.invalidate();
  assert.match((await new Client().get(`/listings/${lid}`)).text, /Reserved\./);
  assert.match((await new Client().get('/browse?q=offerable')).text, /Reserved/);
  await post(buyer, `/messages/${cid}/offer`, { amount: '100' });
  assert.equal((await msgs()).filter((m) => m.offer && m.offer.status === 'pending').length, 0, 'no new offers on a reserved listing');

  await seller.request('POST', `/listings/${lid}/unreserve`, { form: { _csrf: await seller.token('/my/listings') } });
  assert.equal((await listingsRepo.get(lid)).reserved_for, null);
  const outsider = await signup('Offer Outsider', 'offer.outsider@campus.test');
  assert.equal((await outsider.request('POST', `/messages/${cid}/offer`, { form: { _csrf: await outsider.token('/profile'), amount: '10' } })).status, 404);
});

test('mark as sold: closes the listing, invites the reserved buyer to review, tells other askers, shows on the seller profile', async () => {
  const seller = await signup('Sold Seller', 'sold.seller@campus.test');
  const se = await users.getByEmail('sold.seller@campus.test');
  const lid = idOf(await publish(seller, { title: 'Sellable lamp deal', price: '80', price_type: 'negotiable' }));
  const buyer = await signup('Sold Buyer', 'sold.buyer@campus.test');
  const bu = await users.getByEmail('sold.buyer@campus.test');
  const other = await signup('Late Asker', 'late.asker@campus.test');
  const ou = await users.getByEmail('late.asker@campus.test');
  for (const c of [buyer, other]) await c.post(`/listings/${lid}/message`, { body: 'Hi, is it available?' }, `/listings/${lid}`);
  const cid = `${lid}-${bu.user_id}`;
  await seller.request('POST', `/messages/${cid}`, { form: { _csrf: await seller.token(`/messages/${cid}`), body: 'Yes it is' } });
  await buyer.request('POST', `/messages/${cid}/offer`, { form: { _csrf: await buyer.token(`/messages/${cid}`), amount: '70' } });
  const offer = (await col('conversations').doc(cid).collection('messages').get()).docs.map((d) => d.data()).find((m) => m.offer);
  await seller.request('POST', `/messages/${cid}/offer/${offer.id}/accept`, { form: { _csrf: await seller.token(`/messages/${cid}`) } });

  assert.match((await seller.get('/my/listings')).text, /Mark as sold/);
  assert.equal((await buyer.request('POST', `/listings/${lid}/sold`, { form: { _csrf: await buyer.token('/profile') } })).status, 403, 'only the owner can mark it sold');
  const r = await seller.request('POST', `/listings/${lid}/sold`, { form: { _csrf: await seller.token('/my/listings') } });
  assert.equal(r.status, 302);
  const l = await listingsRepo.get(lid);
  assert.equal(l.status, 'closed');
  assert.equal(l.outcome, 'sold');
  assert.equal(l.sold_to, bu.user_id);
  assert.equal(l.sold_cents, 7000);
  assert.equal(l.reserved_for, null);

  assert.ok((await where('notifications', 'user_id', '==', bu.user_id)).some((n) => /Deal done/.test(n.title) && n.link === `/users/${se.user_id}#reviews`));
  assert.ok((await where('notifications', 'user_id', '==', ou.user_id)).some((n) => /no longer available/.test(n.title)));
  assert.equal((await new Client().get(`/listings/${lid}`)).status, 404, 'sold listings leave the public site');
  assert.match((await seller.get(`/listings/${lid}`)).text, /Sold\.<\/strong> This deal is done/);
  assert.match((await new Client().get(`/users/${se.user_id}`)).text, /<dt>Sold<\/dt><dd>1<\/dd>/);
  assert.match((await buyer.get(`/users/${se.user_id}`)).text, /name="rating"/, 'the buyer can now review the seller');

  // services cannot be "sold"
  const svc = (await require('../src/repo/categories').all()).find((x) => x.slug === 'services');
  const sid = idOf(await publish(seller, { title: 'Tutoring not sellable', category_id: String(svc.category_id) }));
  await seller.request('POST', `/listings/${sid}/sold`, { form: { _csrf: await seller.token('/my/listings') } });
  assert.equal((await listingsRepo.get(sid)).status, 'active');
});

test('marketplace health: the admin overview counts chats, replies, offers and deals from the last 30 days', async () => {
  const h = require('../src/services/health');
  assert.equal(h.median([5, 1, 3]), 3);
  assert.equal(h.median([]), null);
  assert.equal(h.humanDuration(90_000), '2 min');
  assert.equal(h.humanDuration(3 * 3_600_000), '3 h');
  const s = await h.summary(30);
  assert.ok(s.chats >= 1, 'earlier tests started chats');
  assert.ok(s.offers >= 2 && s.accepted >= 1 && s.deals >= 1, 'earlier tests made offers and a deal');
  assert.ok(s.replyRate > 0 && s.replyRate <= 100);
  const page = await state.root.get('/admin');
  assert.equal(page.status, 200);
  assert.match(page.text, /Marketplace health, last 30 days/);
  assert.match(page.text, /Deals marked done<\/dt><dd>\d+/);
});

test("what's new: owner publishes a note; existing members see it once until 'Got it'; newer members do not; optional notification", async () => {
  const wn = require('../src/services/whatsNew');
  assert.ok((await wn.list()).length >= 1, 'the first note is seeded at start-up');
  const early = await signup('Early Member', 'early.member@campus.test');
  const r = await state.root.request('POST', '/admin/updates', { form: { _csrf: await state.root.token('/admin/updates'), title: 'Dark mode polish', items: '- Better contrast\nFaster chat\n', notify: '1' } });
  assert.equal(r.status, 302);
  await wn.refresh(true);
  const home = await early.get('/browse');
  assert.match(home.text, /What's new: Dark mode polish/);
  assert.match(home.text, /<li>Better contrast<\/li>/, 'bullet characters are stripped');
  const me = await users.getByEmail('early.member@campus.test');
  assert.ok((await where('notifications', 'user_id', '==', me.user_id)).some((n) => n.title === "What's new: Dark mode polish"));
  const seen = await early.request('POST', '/whats-new/seen', { form: { _csrf: await early.token('/browse'), back: '/browse' } });
  assert.equal(seen.headers.get('location'), '/browse');
  assert.doesNotMatch((await early.get('/browse')).text, /What's new: Dark mode polish/, 'gone after Got it');
  const late = await signup('Late Member', 'late.member@campus.test');
  assert.doesNotMatch((await late.get('/browse')).text, /class="wn-banner/, 'members who joined later do not see old news');
  assert.match((await new Client().get('/whats-new')).text, /Dark mode polish[\s\S]*A cleaner CampusFind/);
  assert.equal((await early.request('POST', '/admin/updates', { form: { _csrf: await early.token('/browse'), title: 'Hack', items: 'x' } })).status, 403, 'members cannot publish');
  assert.equal((await wn.list()).filter((n) => n.title === 'Hack').length, 0);
  const bad = await state.root.request('POST', '/admin/updates', { form: { _csrf: await state.root.token('/admin/updates'), title: 'x', items: '' } });
  assert.equal(bad.status, 400);
});

test('saved listings: savers hear about price drops, reserved, available again and sold; ordinary edits stay quiet', async () => {
  const seller = await signup('Watch Seller', 'watch.seller@campus.test');
  const lid = idOf(await publish(seller, { title: 'Watched rice cooker', price: '120', price_type: 'negotiable' }));
  const fan = await signup('Watch Fan', 'watch.fan@campus.test');
  const fu = await users.getByEmail('watch.fan@campus.test');
  await fan.request('POST', `/listings/${lid}/save`, { form: { _csrf: await fan.token(`/listings/${lid}`) } });
  const mine = async () => (await where('notifications', 'user_id', '==', fu.user_id)).filter((n) => n.type === 'saved').map((n) => n.title);
  const edit = async (over) => seller.request('POST', `/listings/${lid}/edit`, { multipart: listingForm(await seller.token(`/listings/${lid}/edit`), { title: 'Watched rice cooker', price_type: 'negotiable', price: '120', status: 'active', ...over }) });

  await edit({ description: 'Now with a steamer tray, works perfectly.' });
  assert.equal((await mine()).length, 0, 'a plain edit does not notify');
  await edit({ price: '150' });
  assert.equal((await mine()).length, 0, 'a price rise does not notify');
  await edit({ price: '90' });
  assert.ok((await mine()).includes('Price drop: “Watched rice cooker”'));
  const n = (await where('notifications', 'user_id', '==', fu.user_id)).find((x) => x.title.startsWith('Price drop'));
  assert.match(n.body, /Now GH₵90.*was GH₵150/);

  const buyer = await signup('Watch Buyer', 'watch.buyer@campus.test');
  const bu = await users.getByEmail('watch.buyer@campus.test');
  await buyer.post(`/listings/${lid}/message`, { body: 'Hi, is it available?' }, `/listings/${lid}`);
  const cid = `${lid}-${bu.user_id}`;
  await buyer.request('POST', `/messages/${cid}/offer`, { form: { _csrf: await buyer.token(`/messages/${cid}`), amount: '80' } });
  const offer = (await col('conversations').doc(cid).collection('messages').get()).docs.map((d) => d.data()).find((m) => m.offer);
  await seller.request('POST', `/messages/${cid}/offer/${offer.id}/accept`, { form: { _csrf: await seller.token(`/messages/${cid}`) } });
  assert.ok((await mine()).includes('“Watched rice cooker” is reserved'));
  await seller.request('POST', `/listings/${lid}/unreserve`, { form: { _csrf: await seller.token('/my/listings') } });
  assert.ok((await mine()).includes('“Watched rice cooker” is available again'));
  await seller.request('POST', `/listings/${lid}/sold`, { form: { _csrf: await seller.token('/my/listings') } });
  assert.ok((await mine()).includes('“Watched rice cooker” has been sold'));
  const sellerNotes = (await where('notifications', 'user_id', '==', (await users.getByEmail('watch.seller@campus.test')).user_id)).filter((x) => x.type === 'saved');
  assert.equal(sellerNotes.length, 0, 'the owner is never notified about their own listing');
});

test('every text field in the views declares a type, so it always gets the site styling (no bare black boxes on iPhone)', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'src', 'views');
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') && files.push(path.join(d, e.name))));
  walk(dir);
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/<input\b[^>]*>/g)) if (!/\btype=/.test(m[0])) offenders.push(`${path.basename(f)}: ${m[0].slice(0, 80)}`);
  }
  assert.deepEqual(offenders, []);
});

test('phone notifications: subscribe, every notification is pushed (title, short body, link only), dead devices removed, keys stay server-side', async () => {
  const push = require('../src/services/push');
  const sent = [];
  push.setSender(async (sub, payload) => {
    if (sub.endpoint.includes('gone')) { const e = new Error('gone'); e.statusCode = 410; throw e; }
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
  });
  try {
    const c = await signup('Push Member', 'push.member@campus.test');
    const me = await users.getByEmail('push.member@campus.test');
    const key = JSON.parse((await c.get('/push/key')).text).key;
    assert.ok(/^[A-Za-z0-9_-]{80,}$/.test(key), 'public key served');
    assert.equal((await new Client().get('/push/key')).status, 302, 'signed-in members only');
    const sub = (endpoint) => JSON.stringify({ endpoint, keys: { p256dh: 'BP' + 'a'.repeat(80), auth: 'x'.repeat(22) } });
    const tok = await c.token('/profile');
    assert.equal((await c.request('POST', '/push/subscribe', { form: { _csrf: tok, subscription: sub('https://push.example.test/abc') } })).status, 200);
    assert.equal((await c.request('POST', '/push/subscribe', { form: { _csrf: tok, subscription: sub('https://push.example.test/gone') } })).status, 200);
    assert.equal((await c.request('POST', '/push/subscribe', { form: { _csrf: tok, subscription: sub('http://insecure.test/x') } })).status, 400, 'only https push services');
    assert.equal((await c.request('POST', '/push/subscribe', { form: { _csrf: tok, subscription: 'not json' } })).status, 400);
    assert.equal(await push.count(me.user_id), 2);

    await require('../src/services/notify').notify(me.user_id, { type: 'message', title: 'New offer: GH₵40', body: 'Open the chat to accept or decline.', link: '/messages/1-2' });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].payload, { title: 'New offer: GH₵40', body: 'Open the chat to accept or decline.', url: '/messages/1-2' });
    assert.equal(await push.count(me.user_id), 1, 'a device the push service says is gone is removed');

    const backup = await state.root.request('POST', '/admin/system/backup', { form: { _csrf: await state.root.token('/admin/system') } });
    assert.doesNotMatch(backup.text, /privateKey/, 'the push signing key is never exported');
    await c.request('POST', '/push/unsubscribe', { form: { _csrf: tok, subscription: sub('https://push.example.test/abc') } });
    assert.equal(await push.count(me.user_id), 0);
    assert.match((await c.get('/profile')).text, /data-push hidden/, 'the switch is on the profile (shown by the browser when supported)');
  } finally {
    push.setSender((s, p, o) => require('web-push').sendNotification(s, p, o));
  }
});

test('get the app: /app explains install for Android and iPhone, carries the notifications switch; nudge and chat hint are in place', async () => {
  const anon = await new Client().get('/app');
  assert.equal(anon.status, 200);
  assert.match(anon.text, /Add to Home Screen/);
  assert.match(anon.text, /Sign in to get a buzz/);
  const c = await signup('App Member', 'app.member@campus.test');
  const page = await c.get('/app');
  assert.match(page.text, /data-push hidden/, 'signed-in members get the switch');
  assert.doesNotMatch(page.text, /data-app-nudge/, 'no nudge on the app page itself');
  assert.match((await c.get('/browse')).text, /data-app-nudge hidden/, 'nudge is rendered hidden; the phone decides whether to show it');
  assert.doesNotMatch((await new Client().get('/browse')).text, /data-app-nudge/, 'visitors are not nudged');
  const seller = await signup('Hint Seller', 'hint.seller@campus.test');
  const lid = idOf(await publish(seller, { title: 'Push hint lamp' }));
  await c.post(`/listings/${lid}/message`, { body: 'Hi, is it available?' }, `/listings/${lid}`);
  const me = await users.getByEmail('app.member@campus.test');
  assert.match((await c.get(`/messages/${lid}-${me.user_id}`)).text, /data-push-hint hidden/);
});

test('browser smoke: theme.js and app.js run without errors on the main pages, as a phone and as a computer', async () => { try { await smoke(); } catch (e) { console.log('SMOKE CRASH', e && e.stack); throw e; } });
async function smoke() {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const fs = require('fs');
  const path = require('path');
  const scripts = ['theme.js', 'app.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8'));

  const seller = await signup('Smoke Seller', 'smoke.seller@campus.test');
  const lid = idOf(await publish(seller, { title: 'Smoke test desk' }));
  const buyer = await signup('Smoke Buyer', 'smoke.buyer@campus.test');
  const bu = await users.getByEmail('smoke.buyer@campus.test');
  await buyer.post(`/listings/${lid}/message`, { body: 'Hi, is it available?' }, `/listings/${lid}`);
  const visits = [
    [new Client(), ['/', '/browse', `/listings/${lid}`, '/login', '/register', '/pricing', '/help', '/app', '/whats-new', '/terms']],
    [buyer, ['/', '/browse', `/listings/${lid}`, '/listings/new', '/profile', '/my/listings', '/messages', `/messages/${lid}-${bu.user_id}`, '/saved', '/alerts', '/notifications', '/orders', '/app', `/users/${bu.user_id}`]],
    [state.root, ['/admin', '/admin/orders', '/admin/reports', '/admin/users', '/admin/system', '/admin/updates', '/admin/insights']],
  ];

  const problems = [];
  for (const phone of [true, false]) {
    for (const [client, paths] of visits) {
      for (const p of paths) {
        const res = await client.get(p);
        if (res.status !== 200) { problems.push(`${p}: HTTP ${res.status}`); continue; }
        const vc = new VirtualConsole();
        const errs = [];
        vc.on('jsdomError', (e) => { if (!/Not implemented|Could not parse CSS/i.test(e.message)) errs.push(e.message); });
        const dom = new JSDOM(res.text, { url: base + p, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
        const w = dom.window;
        w.matchMedia = (q) => ({ matches: phone ? /max-width|pointer: coarse/.test(q) : /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
        w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
        w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
        w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
        w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ messages: [] }), text: async () => '' });
        if (phone) Object.defineProperty(w.navigator, 'maxTouchPoints', { value: 5 });
        w.addEventListener('error', (e) => errs.push(e.message || String(e.error)));
        for (const src of scripts) { try { w.eval(src); } catch (e) { errs.push(`${e.name}: ${e.message}`); } }
        try {
          w.dispatchEvent(new w.Event('DOMContentLoaded')); w.dispatchEvent(new w.Event('load'));
          // poke the controls people use most
          for (const sel of ['[data-theme-toggle]', '[data-panel-open]', '[data-panel-close]', '[data-copy]', '[data-fill]', '[data-print]', '[data-app-nudge-x]', 'details.menu > summary']) {
            const el = w.document.querySelector(sel);
            if (el) { if (sel === '[data-print]') w.print = () => {}; el.click(); }
          }
        } catch (e) { errs.push(`${e.name}: ${e.message}`); }
        await new Promise((r) => setTimeout(r, 20));
        w.close();
        for (const e of errs) problems.push(`${phone ? 'phone' : 'computer'} ${p}: ${e}`);
      }
    }
  }
  if (problems.length) console.log('SMOKE PROBLEMS', JSON.stringify(problems, null, 1));
  assert.deepEqual(problems, []);
}

test('error alerts: server crashes and browser script errors are grouped, scrubbed, shown to the owner, and alert once', async () => {
  const errorLog = require('../src/services/errorLog');
  errorLog.resetAlertBudget();
  // a browser report (no CSRF token needed; nothing but a counter changes)
  const send = async (message, p) => fetch(base + '/errors/client', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ message, stack: 'TypeError: x\n    at http://localhost/js/app.js?v=abc:276:15', path: p || '/listings/123456?q=secret' }) });
  assert.equal((await send('installBtns.forEach is not a function, call 024 412 3456 or kofi@demo.campus')).status, 204);
  await send('installBtns.forEach is not a function, call 024 412 3456 or kofi@demo.campus');
  assert.equal((await fetch(base + '/errors/client', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{not json' })).status, 204, 'garbage is ignored');

  // a real server crash: make one route throw
  const users = require('../src/repo/users');
  const orig = users.getById;
  users.getById = async () => { throw new Error('Simulated database outage'); };
  try { assert.equal((await new Client().get('/users/1')).status, 500); } finally { users.getById = orig; }

  const rows = await errorLog.list();
  const client = rows.find((r) => r.source === 'client' && /installBtns/.test(r.message));
  assert.ok(client, 'browser error recorded');
  assert.equal(client.count, 2, 'the same error is grouped and counted');
  assert.equal(client.path, '/listings/:id', 'query strings and ids are dropped from paths');
  assert.doesNotMatch(client.message, /kofi@|412 3456/, 'emails and phone numbers are scrubbed');
  assert.match(client.frame, /\/js\/app\.js:276:15/);
  assert.ok(rows.some((r) => r.source === 'server' && /Simulated database outage/.test(r.message)));

  const root = await users.getByEmail('root@campus.test');
  const alerts = (await where('notifications', 'user_id', '==', root.user_id)).filter((n) => /error on/.test(n.title));
  assert.ok(alerts.length >= 2 && alerts.filter((n) => /browser error/.test(n.title)).length === 1, 'one alert per new kind of error: ' + JSON.stringify(alerts.map((n) => n.title)));

  const page = await state.root.get('/admin/errors');
  assert.match(page.text, /Simulated database outage/);
  const r = await state.root.request('POST', `/admin/errors/${client.id}/resolve`, { form: { _csrf: await state.root.token('/admin/errors') } });
  assert.equal(r.status, 302);
  assert.ok(!(await errorLog.list()).some((x) => x.id === client.id), 'Mark fixed clears it');
  const member = await signup('Err Member', 'err.member@campus.test');
  assert.equal((await member.get('/admin/errors')).status === 200, false);
});

test("registration: date of birth uses menus; today's date is a typo (not a 24-hour block); a real under-age is still blocked", async () => {
  const c = new Client();
  const form = (await c.get('/register')).text;
  assert.match(form, /name="dob_d"/); assert.match(form, /name="dob_m"/); assert.match(form, /name="dob_y"/);
  assert.doesNotMatch(form, /type="date"/, 'no native date picker that pre-fills today');
  const now = new Date();
  const base = { name: 'Menu Joiner', email: 'menu.joiner@campus.test', password: 'Granite-Harbor-Violet-71', agree: '1' };
  const slip = await c.post('/register', { ...base, dob_d: String(now.getUTCDate()), dob_m: String(now.getUTCMonth() + 1), dob_y: String(now.getUTCFullYear()) }, '/register');
  assert.equal(slip.status, 400);
  assert.match(slip.text, /That date is too recent/);
  const ok = await c.post('/register', { ...base, dob_d: '14', dob_m: '5', dob_y: '1999' }, '/register');
  assert.equal(ok.status, 302, 'the same browser can register straight after the slip');
  assert.ok(await users.getByEmail('menu.joiner@campus.test'));

  const kid = new Client();
  const y = now.getUTCFullYear() - 12;
  const blocked = await kid.post('/register', { ...base, email: 'kid@campus.test', dob_d: '1', dob_m: '1', dob_y: String(y) }, '/register');
  assert.equal(blocked.status, 403);
  assert.equal((await kid.post('/register', { ...base, email: 'kid@campus.test', dob_d: '1', dob_m: '1', dob_y: '1990' }, '/login')).status, 403, 'a genuine under-age answer is remembered for a day');

  // a block saved before this fix (no version marker) no longer stops anyone
  const old = new Client();
  await old.get('/register');
  const tok = await old.token('/register');
  const sess = (await col('sessions').where('csrf_token', '==', tok).get()).docs[0];
  await sess.ref.update({ age_block_until: Date.now() + 86_400_000 });
  assert.equal((await old.get('/register')).status, 200, 'old blocks are ignored');
});

test('pay first: Pricing goes straight to payment; the listing is chosen after; Business posts wait for payment; Pro perks follow', async () => {
  const payments = require('../src/services/payments');
  const pro = require('../src/services/pro');
  const c = await signup('Pay First', 'pay.first@campus.test');
  const me = await users.getByEmail('pay.first@campus.test');
  const lid = idOf(await publish(c, { title: 'Pay first lamp' }));

  // Pricing: one tap = an order with no listing yet
  const pricing = await c.get('/pricing');
  assert.match(pricing.text, /action="\/pricing\/featured\/buy"/);
  assert.match(pricing.text, /Every paid plan makes you a Pro seller/);
  const buy = await c.request('POST', '/pricing/featured/buy', { form: { _csrf: await c.token('/pricing') } });
  const orderId = Number(/\/orders\/(\d+)/.exec(buy.headers.get('location'))[1]);
  const order = await require('../src/repo/orders').get(orderId);
  assert.equal(order.listing_id, null, 'nothing is chosen or applied before payment');
  assert.equal(order.status, 'awaiting_payment');
  assert.equal((await listingsRepo.get(lid)).is_featured, 0);
  assert.equal(pro.isPro(await users.getById(me.user_id)), false);

  await payments.fulfil(orderId);
  const after = await users.getById(me.user_id);
  assert.ok(pro.isPro(after), 'payment makes the member a Pro seller');
  const orderPage = await c.get(`/orders/${orderId}`);
  assert.match(orderPage.text, /Choose the listing to promote/);
  assert.match(orderPage.text, new RegExp(`name="listing_id" value="${lid}"`));
  const apply = await c.request('POST', `/orders/${orderId}/apply`, { form: { _csrf: await c.token(`/orders/${orderId}`), listing_id: String(lid) } });
  assert.equal(apply.status, 302);
  assert.equal((await listingsRepo.get(lid)).is_featured, 1, 'the promotion starts once the listing is chosen');
  const again = await c.request('POST', `/orders/${orderId}/apply`, { form: { _csrf: await c.token(`/orders/${orderId}`), listing_id: String(lid) } });
  assert.match(again.headers.get('location'), new RegExp(`/orders/${orderId}`), 'a payment is used once');

  // Business: saved as a draft, sent to payment, live after payment
  const bizCat = (await require('../src/repo/categories').all()).find((x) => x.slug === 'business');
  const other = await signup('Biz Owner', 'biz.owner.pay@campus.test');
  const form = await other.get('/listings/new?category=business');
  assert.match(form.text, /Business listings need payment before they go live/);
  const r = await other.request('POST', '/listings/new', { multipart: listingForm(await other.token('/listings/new'), { title: 'Paid hostel rooms', category_id: String(bizCat.category_id) }) });
  assert.match(r.headers.get('location'), /\/promote$/, 'sent to payment');
  const bid = idOf(r.headers.get('location'));
  assert.equal((await listingsRepo.get(bid)).status, 'draft');
  listingsRepo.invalidate();
  assert.doesNotMatch((await new Client().get('/business')).text, /Paid hostel rooms/, 'not listed before payment');
  const promote = await other.get(`/listings/${bid}/promote`);
  assert.match(promote.text, /Pay to publish your business/);
  assert.doesNotMatch(promote.text, /value="featured"/, 'business drafts pay for a Business plan');
  const p = await other.request('POST', `/listings/${bid}/promote`, { form: { _csrf: await other.token(`/listings/${bid}/promote`), product: 'business' } });
  await payments.fulfil(Number(/\/orders\/(\d+)/.exec(p.headers.get('location'))[1]));
  const live = await listingsRepo.get(bid);
  assert.equal(live.status, 'active', 'live once paid');
  listingsRepo.invalidate();
  assert.match((await new Client().get('/business')).text, /Paid hostel rooms/);

  // Perks: badge, photo limit, stats
  const owner = await users.getByEmail('biz.owner.pay@campus.test');
  assert.equal(pro.photoLimit(owner), 10);
  assert.equal(pro.photoLimit({ pro_until: 0 }), 4);
  assert.match((await new Client().get(`/users/${owner.user_id}`)).text, /Pro seller/);
  assert.match((await other.get('/my/listings')).text, /class="small manage__stats"/, 'Pro sellers see stats');
  const free = await signup('Free Seller', 'free.seller.pay@campus.test');
  assert.match((await free.get('/my/listings')).text, /Pro sellers see views, saves and chats/);
});
