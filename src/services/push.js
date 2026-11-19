'use strict';
/**
 * Phone notifications (Web Push). No app store and no email service: the browser's own push service delivers them.
 * Android Chrome works in the browser; iPhone needs CampusFind added to the Home Screen (iOS 16.4+).
 *
 *   secrets/vapid             { publicKey, privateKey }  created on first use; server-only (Firestore rules deny clients)
 *   push_subs/{sha256(url)}   { user_id, endpoint, keys, ua, created_at }
 *
 * notify() calls sendTo() for every in-app notification. A push only carries the title, a short body and the link;
 * nothing private (no message text beyond the 120-character preview already in the notification).
 * Dead subscriptions (404/410 from the push service) are deleted automatically.
 */
const crypto = require('crypto');
const webpush = require('web-push');
const config = require('../config');
const { col } = require('../store');

const MAX_PER_USER = 10;
let keys = null;

async function vapid() {
  if (keys) return keys;
  const ref = col('secrets').doc('vapid');
  const snap = await ref.get();
  if (snap.exists) keys = snap.data();
  else {
    const fresh = webpush.generateVAPIDKeys();
    try { await ref.create({ ...fresh, created_at: Date.now() }); keys = fresh; } catch (err) { keys = (await ref.get()).data(); } // another server created it first
  }
  const contact = config.baseUrl.startsWith('https://') ? config.baseUrl : 'mailto:noreply@campusfind.invalid';
  webpush.setVapidDetails(contact, keys.publicKey, keys.privateKey);
  return keys;
}

const publicKey = async () => (await vapid()).publicKey;
const idFor = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 40);

/** Validate a PushSubscription JSON from the browser. Returns a clean object or null. */
function clean(raw) {
  let s = raw;
  if (typeof s === 'string') { try { s = JSON.parse(s); } catch (e) { return null; } }
  if (!s || typeof s.endpoint !== 'string' || !s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string') return null;
  let url;
  try { url = new URL(s.endpoint); } catch (e) { return null; }
  if (url.protocol !== 'https:' || s.endpoint.length > 1000 || s.keys.p256dh.length > 200 || s.keys.auth.length > 100) return null;
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}

async function subscribe(userId, raw, ua = '') {
  const sub = clean(raw);
  if (!sub) return false;
  await col('push_subs').doc(idFor(sub.endpoint)).set({ user_id: Number(userId), ...sub, ua: String(ua).slice(0, 160), created_at: Date.now() });
  // keep the newest few per member
  const mine = (await col('push_subs').where('user_id', '==', Number(userId)).get()).docs.sort((a, b) => b.data().created_at - a.data().created_at);
  await Promise.all(mine.slice(MAX_PER_USER).map((d) => d.ref.delete()));
  return true;
}

async function unsubscribe(userId, raw) {
  const sub = clean(raw);
  if (!sub) return;
  const ref = col('push_subs').doc(idFor(sub.endpoint));
  const snap = await ref.get();
  if (snap.exists && snap.data().user_id === Number(userId)) await ref.delete();
}

const count = async (userId) => (await col('push_subs').where('user_id', '==', Number(userId)).get()).size;
const deleteForUser = async (userId) => Promise.all((await col('push_subs').where('user_id', '==', Number(userId)).get()).docs.map((d) => d.ref.delete()));

let sender = (sub, payload, opts) => webpush.sendNotification(sub, payload, opts);
const setSender = (fn) => { sender = fn; }; // tests

/** Push a notification to every device of a member. Never throws; returns how many were delivered. */
async function sendTo(userId, { title, body = '', link = '/notifications' }) {
  try {
    const subs = (await col('push_subs').where('user_id', '==', Number(userId)).limit(MAX_PER_USER).get()).docs;
    if (!subs.length) return 0;
    await vapid();
    const payload = JSON.stringify({ title: String(title).slice(0, 120), body: String(body).slice(0, 160), url: link && String(link).startsWith('/') ? link : '/notifications' });
    let ok = 0;
    await Promise.all(subs.map(async (d) => {
      const s = d.data();
      try {
        await sender({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 60 * 60 * 24, urgency: 'normal' });
        ok += 1;
      } catch (err) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) await d.ref.delete().catch(() => {});
        else console.error('[push] send failed:', err && (err.statusCode || err.message));
      }
    }));
    return ok;
  } catch (err) {
    console.error('[push] could not send:', err.message);
    return 0;
  }
}

module.exports = { publicKey, subscribe, unsubscribe, sendTo, count, deleteForUser, clean, setSender };
