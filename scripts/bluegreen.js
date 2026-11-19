'use strict';
/**
 * Blue/green deployments on Vercel.
 *
 *   node scripts/bluegreen.js status     which colour is live, which is idle, and their URLs
 *   node scripts/bluegreen.js stage      build the current code as the IDLE colour (not live), then smoke-test it
 *   node scripts/bluegreen.js promote    switch the live domain to the staged colour (instant, no downtime)
 *   node scripts/bluegreen.js rollback   switch the live domain back to the previous colour
 *
 * How it maps to Vercel: every deployment is an immutable build with its own URL. "Live" is whichever build the
 * production domain points at. `stage` runs `vercel deploy --prod --skip-domain` (a production build that is NOT
 * attached to the domain), `promote` runs `vercel promote <url>`. The previous colour stays built, so rollback is
 * one command. Both colours use the production environment variables and database.
 *
 * State lives in .deploy/bluegreen.json (git- and deploy-ignored). Smoke tests need the staged URL to be reachable:
 * if Vercel Deployment Protection is on, set VERCEL_AUTOMATION_BYPASS_SECRET (Project > Settings > Deployment
 * Protection > Protection Bypass for Automation).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STATE = path.join(ROOT, '.deploy', 'bluegreen.json');
const LIVE_DOMAIN = process.env.LIVE_DOMAIN || 'campusfind-ruby.vercel.app';
const other = (c) => (c === 'blue' ? 'green' : 'blue');

function load() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { live: null, staged: null, previous: null, history: [] }; }
}
function save(s) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
}
function vercel(args) {
  const r = spawnSync('vercel', args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`vercel ${args.join(' ')} failed:\n${(r.stderr || r.stdout || '').slice(-1500)}`);
  return `${r.stdout}\n${r.stderr}`;
}
const urlIn = (text) => (text.match(/https:\/\/[a-z0-9-]+\.vercel\.app/g) || []).filter((u) => !u.includes(LIVE_DOMAIN)).pop();

/**
 * Fetch a path from a protected staged build. With VERCEL_AUTOMATION_BYPASS_SECRET set, plain fetch is used; otherwise
 * `vercel curl` does it with the CLI's own login and the project's existing bypass token (never printed or stored here).
 */
function viaVercelCurl(base, p) {
  const r = spawnSync('vercel', ['curl', p, '--deployment', base, '--', '-s', '-i', '--max-redirs', '0'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 20 * 1024 * 1024 });
  const raw = (r.stdout || '').replace(/\r\n/g, '\n');
  const blocks = raw.split(/\n\n/);
  let i = 0;
  while (i < blocks.length - 1 && /^HTTP\/[\d.]+ 1\d\d/.test(blocks[i])) i += 1; // skip 100-continue
  const head = blocks[i] || '';
  const status = Number((/^HTTP\/[\d.]+ (\d{3})/.exec(head) || [])[1] || 0);
  const headers = new Map(head.split('\n').slice(1).map((l) => [l.slice(0, l.indexOf(':')).trim().toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
  const body = blocks.slice(i + 1).join('\n\n');
  return { status, headers: { get: (k) => headers.get(k.toLowerCase()) || null }, text: async () => body };
}

async function smoke(base) {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const headers = secret ? { 'x-vercel-protection-bypass': secret } : {};
  const checks = [];
  const get = async (p) => (secret ? fetch(base + p, { headers, redirect: 'manual' }) : viaVercelCurl(base, p));
  const check = async (name, fn) => {
    try { await fn(); checks.push(['ok', name]); } catch (e) { checks.push(['FAIL', `${name}: ${e.message}`]); }
  };
  const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
  let home = '';
  await check('health check answers', async () => {
    const r = await get('/healthz');
    if (r.status === 401 || r.status === 403) throw new Error(`${r.status}: the staged URL is protected; set VERCEL_AUTOMATION_BYPASS_SECRET`);
    expect(r.status === 200, `status ${r.status}`);
  });
  await check('home page renders with the side panel', async () => {
    const r = await get('/'); home = await r.text();
    expect(r.status === 200, `status ${r.status}`);
    expect(home.includes('id="side-panel"'), 'side panel missing');
  });
  for (const p of ['/browse', '/business', '/lost-found', '/help', '/pricing', '/terms', '/privacy', '/disclaimer', '/login', '/register']) {
    await check(`${p} returns 200`, async () => { const r = await get(p); expect(r.status === 200, `status ${r.status}`); });
  }
  await check('members-only pages ask visitors to sign in', async () => { const r = await get('/messages'); expect(r.status === 302, `status ${r.status}`); });
  await check('security headers are present', async () => {
    const r = await get('/');
    expect(/default-src 'self'/.test(r.headers.get('content-security-policy') || ''), 'no CSP');
    expect(r.headers.get('x-frame-options') === 'DENY', 'no X-Frame-Options');
  });
  await check('versioned stylesheet loads', async () => {
    const m = /href="(\/css\/app\.css\?v=[0-9a-f]{12})"/.exec(home);
    expect(m, 'no versioned stylesheet link');
    const r = await get(m[1]);
    expect(r.status === 200 && (r.headers.get('content-type') || '').includes('text/css'), `status ${r.status}`);
  });
  await check('this build knows it is not live yet', async () => {
    expect(/data-env="candidate"/.test(home), 'test-environment banner missing on the staged URL');
  });
  return checks;
}

async function main() {
  const cmd = process.argv[2] || 'status';
  const s = load();

  if (cmd === 'status') {
    console.log(`Live domain : https://${LIVE_DOMAIN}`);
    console.log(`Live colour : ${s.live ? `${s.live.color}  ${s.live.url}  (since ${s.live.at})` : 'not recorded yet (run stage then promote)'}`);
    console.log(`Staged      : ${s.staged ? `${s.staged.color}  ${s.staged.url}  smoke tests ${s.staged.smoke}` : 'nothing staged'}`);
    console.log(`Rollback to : ${s.previous ? `${s.previous.color}  ${s.previous.url}` : 'nothing yet'}`);
    return;
  }

  if (cmd === 'stage') {
    const color = s.live ? other(s.live.color) : 'green';
    console.log(`Building the current code as ${color.toUpperCase()} (idle; the live site is not touched)...`);
    const out = vercel(['deploy', '--prod', '--skip-domain', '--yes', '--env', `DEPLOY_COLOR=${color}`, '--build-env', `DEPLOY_COLOR=${color}`]);
    const url = urlIn(out);
    if (!url) throw new Error(`could not find the deployment URL in Vercel's output:\n${out.slice(-800)}`);
    console.log(`${color} build ready at ${url}\nRunning smoke tests...`);
    const checks = await smoke(url);
    checks.forEach(([st, name]) => console.log(`  ${st === 'ok' ? 'ok  ' : 'FAIL'}  ${name}`));
    const passed = checks.every(([st]) => st === 'ok');
    s.staged = { color, url, at: new Date().toISOString(), smoke: passed ? 'passed' : 'FAILED' };
    save(s);
    console.log(passed ? `\nAll checks passed. Try it yourself at ${url}, then run: npm run bg:promote` : '\nSome checks failed. Fix them and stage again; the live site is unchanged.');
    if (!passed) process.exitCode = 1;
    return;
  }

  if (cmd === 'promote') {
    if (!s.staged) throw new Error('Nothing staged. Run: npm run bg:stage');
    if (s.staged.smoke !== 'passed' && !process.argv.includes('--force')) throw new Error('The staged build failed its smoke tests. Fix and stage again (or pass --force).');
    console.log(`Switching https://${LIVE_DOMAIN} to ${s.staged.color.toUpperCase()} (${s.staged.url})...`);
    vercel(['promote', s.staged.url, '--yes']);
    const r = await fetch(`https://${LIVE_DOMAIN}/healthz`);
    console.log(`Live health check: ${r.status}`);
    s.history.push({ color: s.staged.color, url: s.staged.url, at: new Date().toISOString(), action: 'promote' });
    s.previous = s.live; s.live = { color: s.staged.color, url: s.staged.url, at: new Date().toISOString() }; s.staged = null;
    save(s);
    console.log(`${s.live.color.toUpperCase()} is live.${s.previous ? ` ${s.previous.color} stays ready for: npm run bg:rollback` : ''}`);
    return;
  }

  if (cmd === 'rollback') {
    if (!s.previous) throw new Error('No previous colour recorded to roll back to.');
    console.log(`Switching https://${LIVE_DOMAIN} back to ${s.previous.color.toUpperCase()} (${s.previous.url})...`);
    vercel(['promote', s.previous.url, '--yes']);
    s.history.push({ color: s.previous.color, url: s.previous.url, at: new Date().toISOString(), action: 'rollback' });
    const was = s.live; s.live = { ...s.previous, at: new Date().toISOString() }; s.previous = was;
    save(s);
    console.log(`${s.live.color.toUpperCase()} is live again.`);
    return;
  }

  console.error('Usage: node scripts/bluegreen.js status|stage|promote|rollback');
  process.exitCode = 2;
}

main().catch((e) => { console.error(e.message); process.exit(1); });
