'use strict';
/** Rate limits that hold across server instances (Firestore-backed) */
process.env.NODE_ENV = 'test';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-campusfind';
process.env.FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { sharedRateLimit, cleanupRateLimits } = require('../src/middleware/sharedLimit');
const { col } = require('../src/store');

function appWith(limiter) {
  const app = express();
  app.set('trust proxy', true);
  app.use((req, res, next) => { res.render = (view, data) => res.send(`${view}:${data.status}`); next(); });
  app.post('/try', limiter, (req, res) => res.send('ok'));
  return new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}/try` })); });
}
const hit = (url, ip) => fetch(url, { method: 'POST', headers: { 'x-forwarded-for': ip } });

test.after(() => setTimeout(() => process.exit(0), 200).unref());

test('shared limit: attempts spread over two separate instances still add up', async () => {
  const name = `test-${Date.now()}`;
  // Two limiters with the same name behave like two server processes: separate memory, same database.
  const A = await appWith(sharedRateLimit({ name, windowMs: 60 * 60_000, max: 3 }));
  const B = await appWith(sharedRateLimit({ name, windowMs: 60 * 60_000, max: 3 }));
  try {
    assert.equal((await hit(A.url, '203.0.113.7')).status, 200);
    assert.equal((await hit(A.url, '203.0.113.7')).status, 200);
    assert.equal((await hit(B.url, '203.0.113.7')).status, 200, 'third attempt overall is still allowed');
    const blocked = await hit(B.url, '203.0.113.7');
    assert.equal(blocked.status, 429, 'the fourth attempt is refused even though instance B has only counted two');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0, 'tells the client when to come back');
    assert.equal(await blocked.text(), 'error:429');

    // A different client is unaffected.
    assert.equal((await hit(B.url, '198.51.100.9')).status, 200);
    assert.equal((await hit(A.url, '198.51.100.9')).status, 200);

    // Nothing in the database identifies the client.
    const docs = (await col('rate_limits').where('name', '==', name).get()).docs;
    assert.equal(docs.length, 2, 'one counter per client and window');
    const dump = JSON.stringify(docs.map((d) => ({ id: d.id, ...d.data() })));
    assert.ok(!dump.includes('203.0.113.7') && !dump.includes('198.51.100.9'), 'no IP address is stored');
    assert.ok(docs.every((d) => /^[a-f0-9]{64}$/.test(d.id)), 'documents are keyed by a hash');
    const counts = docs.map((d) => d.data().count).sort();
    assert.deepEqual(counts, [2, 4], 'the blocked attempt is counted too, so a patient attacker cannot creep under the limit');
  } finally { A.s.close(); B.s.close(); }
});

test('cleanup removes finished windows and keeps current ones', async () => {
  const old = col('rate_limits').doc('expired-window');
  const fresh = col('rate_limits').doc('current-window');
  await old.set({ name: 'x', count: 9, window: 1, expires_at: Date.now() - 60_000 });
  await fresh.set({ name: 'x', count: 1, window: 2, expires_at: Date.now() + 3_600_000 });
  await cleanupRateLimits();
  assert.equal((await old.get()).exists, false);
  assert.equal((await fresh.get()).exists, true);
  await fresh.delete();
});
