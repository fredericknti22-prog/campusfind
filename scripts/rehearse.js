'use strict';
/**
 * Deployment rehearsal: exercises the app THROUGH Firebase Hosting -> Cloud Function (the production topology),
 * running on the local emulators. Run:  npm run rehearse
 * Checks the full member journey including a multipart photo upload, which is the part most likely to
 * behave differently inside Cloud Functions.
 */
const base = process.env.REHEARSE_BASE || 'http://127.0.0.1:5000';
const ADMIN_EMAIL = process.env.REHEARSE_ADMIN_EMAIL || 'owner@campusfind.local';
const ADMIN_PASSWORD = process.env.REHEARSE_ADMIN_PASSWORD || 'Owner-Passw0rd-2026';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PASS = 'Rehearsal-Passphrase-42';
const tag = Date.now().toString(36);

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
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const [k, v] = [pair.slice(0, i), pair.slice(i + 1)];
      if (!v || attrs.some((a) => /max-age=0/i.test(a))) this.jar.delete(k); else this.jar.set(k, v);
    }
    res.text_ = await res.text();
    return res;
  }
  get(u) { return this.req('GET', u); }
  async tok(u) { const m = /name="_csrf" value="([^"]+)"/.exec((await this.get(u)).text_); if (!m) throw new Error('no csrf on ' + u); return m[1]; }
  async post(u, form, from = '/login') { return this.req('POST', u, { form: { _csrf: await this.tok(from), ...form } }); }
}

const results = [];
const step = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`Rehearsing through ${base}\n`);
  let up = false;
  for (let i = 0; i < 90 && !up; i++) {
    try { up = (await fetch(base + '/healthz')).status === 200; } catch (_) { /* still starting */ }
    if (!up) await sleep(2000);
  }
  step('Hosting -> function is reachable and Firestore answers the health check', up);
  if (!up) process.exit(1);

  const home = await new Client().get('/');
  step('home page renders through Hosting', home.status === 200 && home.text_.includes('Looking for something?'));
  step('manifest and service worker are served', (await fetch(base + '/manifest.webmanifest')).status === 200 && (await fetch(base + '/sw.js')).status === 200);

  const seller = new Client();
  let r = await seller.post('/register', { name: 'Rehearsal Seller', email: `seller-${tag}@rehearsal.test`, password: PASS, agree: '1', dob: '1998-05-14' }, '/register');
  step('form POST works through the function (register)', r.status === 302, r.status === 302 ? '' : `HTTP ${r.status}: ${r.text_.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300)} | cookies sent: ${[...seller.jar.keys()].join(',') || 'none'}`);

  const fd = new FormData();
  fd.append('_csrf', await seller.tok('/listings/new'));
  Object.entries({ title: `Rehearsal bicycle ${tag}`, category_id: '2', location: 'Bike shed', price_type: 'fixed', price: '80', description: 'Sturdy commuter bicycle, new tyres, includes lock.', contact: 'WhatsApp 555-0199', intent: 'publish' }).forEach(([k, v]) => fd.append(k, v));
  fd.append('images', new Blob([PNG], { type: 'image/png' }), 'bike.png');
  r = await seller.req('POST', '/listings/new', { multipart: fd });
  const path = r.headers.get('location');
  step('multipart photo upload works through the function', r.status === 302 && /\/listings\/\d+/.test(path || ''), path || `HTTP ${r.status}: ${r.text_.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/.*?(There (is|are)[^]*?)(Title|$)/, '$1').slice(0, 400)}`);

  const page = (await new Client().get(path)).text_;
  const photo = /\/uploads\/([a-f0-9]{32}\.png)/.exec(page);
  step('listing page shows the photo, contact hidden from visitors', Boolean(photo) && !page.includes('555-0199'));
  step('photo is served back from Storage through Hosting', photo && (await fetch(`${base}/uploads/${photo[1]}`)).status === 200);
  step('search finds the listing', (await new Client().get(`/browse?q=bicycle+${tag}`)).text_.includes(`Rehearsal bicycle ${tag}`));

  const buyer = new Client();
  await buyer.post('/register', { name: 'Rehearsal Buyer', email: `buyer-${tag}@rehearsal.test`, password: PASS, agree: '1', dob: '1998-05-14' }, '/register');
  const id = /\/listings\/(\d+)/.exec(path)[1];
  r = await buyer.post('/report', { type: 'listing', id, reason: 'spam', details: 'Rehearsal report' }, `/report?type=listing&id=${id}`);
  step('buyer files a report', r.status === 302);

  const admin = new Client();
  r = await admin.post('/admin/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, next: '/admin' }, '/admin/login');
  step('super admin passes the extra password check (first-run admin was created)', r.status === 302);
  const rid = [...(await admin.get('/admin/reports')).text_.matchAll(/\/admin\/reports\/(\d+)/g)].map((m) => Number(m[1])).sort((a, b) => b - a)[0];
  r = await admin.post(`/admin/reports/${rid}/resolve`, { outcome: 'warn', reason: 'Rehearsal: please keep posts relevant.' }, `/admin/reports/${rid}`);
  step('admin resolves the report', Boolean(rid) && r.status === 302);
  step('seller receives the notification', (await seller.get('/notifications')).text_.includes('Warning from moderators'));

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} rehearsal steps passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
