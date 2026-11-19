'use strict';
/**
 * "What's new": short notes about changes to CampusFind, written by the owner in Admin › What's new.
 *   updates/{id}  { id, title, items: [string], created_at, by }
 * Signed-in members see the newest note once (a small banner) until they dismiss it; /whats-new lists them all.
 * Members who joined after a note was published never see it (it is not news to them).
 */
const { col } = require('../store');
const users = require('../repo/users');
const { notify } = require('./notify');

const U = () => col('updates');
let cache = { at: 0, latest: null };

async function refresh(force = false) {
  if (!force && Date.now() - cache.at < 60_000) return cache.latest;
  try {
    const snap = await U().orderBy('created_at', 'desc').limit(1).get();
    cache = { at: Date.now(), latest: snap.empty ? null : snap.docs[0].data() };
  } catch (err) {
    cache = { at: Date.now(), latest: cache.latest };
  }
  return cache.latest;
}

/** The note this member has not seen yet, or null. Synchronous (uses the cache filled by refresh). */
function unseenFor(u) {
  const n = cache.latest;
  if (!u || !n) return null;
  const seen = Math.max(Number(u.seen_update_at) || 0, Number(u.created_at) || 0);
  return n.created_at > seen ? n : null;
}

async function list(limit = 30) {
  const snap = await U().orderBy('created_at', 'desc').limit(limit).get();
  return snap.docs.map((d) => d.data());
}

/** Publish a note. With notifyAll, every active member also gets it in Notifications. */
async function publish({ title, items, by = null, notifyAll = false, at = Date.now(), id = null }) {
  const ref = id ? U().doc(id) : U().doc();
  const doc = { id: ref.id, title: String(title).slice(0, 90), items: items.map((x) => String(x).slice(0, 160)).slice(0, 8), created_at: at, by };
  if (id) await ref.create(doc); // fixed id: several servers starting at once cannot publish it twice
  else await ref.set(doc);
  await refresh(true);
  let sent = 0;
  if (notifyAll) {
    const members = (await users.recent(5000)).filter((u) => !u.deleted_at && ['active', 'restricted'].includes(u.status));
    let batch = col('notifications').firestore.batch();
    for (const u of members) {
      await notify(u.user_id, { type: 'system', title: `What's new: ${doc.title}`, body: doc.items.slice(0, 3).join(' · '), link: '/whats-new' }, { batch, push: false });
      sent += 1;
      if (sent % 400 === 0) { await batch.commit(); batch = col('notifications').firestore.batch(); }
    }
    if (sent % 400) await batch.commit();
  }
  return { doc, sent };
}

const markSeen = (u) => users.update(u.user_id, { seen_update_at: Date.now() });

/** First run: tell existing members about the November 2026 redesign and new features. */
async function seedFirst() {
  const any = await U().limit(1).get();
  if (!any.empty) return;
  try {
  await publish({
    id: 'first-redesign-2026-11',
    title: 'A cleaner CampusFind',
    items: [
      'On computers, the menu is now a slim bar at the top, with a Categories dropdown.',
      'Your chats, saved listings and settings are under your picture, top right.',
      'Make an offer in chat. Sellers can accept and reserve the item for you.',
      'Saved a listing? We tell you when its price drops, or when it is reserved or sold.',
      'Block members, report a single message, and see where you are signed in.',
    ],
  });
  } catch (err) {
    if (err.code !== 6) console.error('[whats-new] seed failed:', err.message); // 6 = ALREADY_EXISTS: another server won
  }
}

module.exports = { refresh, unseenFor, list, publish, markSeen, seedFirst };
