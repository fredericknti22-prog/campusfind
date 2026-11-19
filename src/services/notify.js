'use strict';
/** In-app notifications (FR-10). */
const { col, countOf } = require('../store');

const unreadCache = new Map(); // user_id -> { n, at }

async function notify(userId, { type, title, body = '', link = null }, { batch = null, push = true } = {}) {
  if (!userId) return;
  const ref = col('notifications').doc();
  const doc = {
    id: ref.id, user_id: Number(userId), type,
    title: String(title).slice(0, 140), body: String(body).slice(0, 600), link,
    is_read: 0, created_at: Date.now(),
  };
  unreadCache.delete(Number(userId));
  if (batch) batch.set(ref, doc);
  else await ref.set(doc);
  if (push) {
    // a phone notification too; capped at 4 s so a slow push service never delays the page
    await Promise.race([require('./push').sendTo(userId, doc), new Promise((r) => { const t = setTimeout(r, 4000); if (t.unref) t.unref(); })]);
  }
}

async function unreadCount(userId) {
  const hit = unreadCache.get(userId);
  if (hit && Date.now() - hit.at < 20_000) return hit.n;
  const n = await countOf(col('notifications').where('user_id', '==', Number(userId)).where('is_read', '==', 0));
  unreadCache.set(userId, { n, at: Date.now() });
  return n;
}

async function list(userId, limit = 60) {
  const snap = await col('notifications').where('user_id', '==', Number(userId)).orderBy('created_at', 'desc').limit(limit).get();
  return snap.docs.map((d) => d.data());
}

async function markAllRead(userId) {
  const snap = await col('notifications').where('user_id', '==', Number(userId)).where('is_read', '==', 0).limit(400).get();
  if (!snap.empty) {
    const batch = col('notifications').firestore.batch();
    snap.docs.forEach((d) => batch.update(d.ref, { is_read: 1 }));
    await batch.commit();
  }
  unreadCache.delete(Number(userId));
}

/** Mark the unread notifications that point at one page (for example a message thread) as read. */
async function markReadByLink(userId, link) {
  const snap = await col('notifications').where('user_id', '==', Number(userId)).where('is_read', '==', 0).limit(200).get();
  const hits = snap.docs.filter((d) => d.data().link === link);
  if (hits.length) {
    const batch = col('notifications').firestore.batch();
    hits.forEach((d) => batch.update(d.ref, { is_read: 1 }));
    await batch.commit();
  }
  unreadCache.delete(Number(userId));
}

module.exports = { notify, unreadCount, list, markAllRead, markReadByLink };
