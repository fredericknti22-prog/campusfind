'use strict';
/**
 * In-app chat. Three kinds of conversation share one collection:
 *   listing  conversations/{listing_id}-{starter_id}   a member asking a poster about a listing
 *   direct   conversations/dm-{lowId}-{highId}          two members talking one to one
 *   support  conversations/help-{user_id}               a member and the CampusFind team (help chat)
 *   conversations/{id}/messages/{auto}                  the messages, oldest first
 * Email addresses and phone numbers are never needed: members talk through the platform.
 * Support threads list only the member as a participant; staff reach them through the admin area.
 */
const { col, db, FieldValue, countOf } = require('../store');

const C = () => col('conversations');
const idFor = (listingId, starterId) => `${Number(listingId)}-${Number(starterId)}`;
const directId = (a, b) => { const [x, y] = [Number(a), Number(b)].sort((m, n) => m - n); return `dm-${x}-${y}`; };
const supportId = (userId) => `help-${Number(userId)}`;
const MAX_BODY = 1000;

function view(doc, me) {
  if (!doc) return null;
  const kind = doc.kind || 'listing';
  const otherId = kind === 'support' ? null : (doc.participants.find((x) => x !== me) ?? null);
  return { ...doc, kind, other_id: otherId, unread: doc[`unread_${me}`] || 0, is_owner: doc.owner_id === me };
}

async function get(cid, me) {
  const snap = await C().doc(String(cid)).get();
  if (!snap.exists) return null;
  const d = snap.data();
  if (!d.participants.includes(Number(me))) return null; // never reveal that a thread exists to a non-participant
  return view(d, Number(me));
}

async function forListing(listingId, starterId) {
  const snap = await C().doc(idFor(listingId, starterId)).get();
  return snap.exists ? snap.data() : null;
}

/** Newest first. Sorted in memory so no composite index is needed. */
async function listFor(me, limit = 100, { includeSupport = false } = {}) {
  const snap = await C().where('participants', 'array-contains', Number(me)).limit(300).get();
  return snap.docs.map((d) => view(d.data(), Number(me)))
    .filter((t) => includeSupport || t.kind !== 'support') // the help chat has its own page
    .sort((a, b) => b.updated_at - a.updated_at).slice(0, limit);
}

async function messagesOf(cid, limit = 200) {
  const snap = await C().doc(String(cid)).collection('messages').orderBy('created_at', 'asc').limitToLast(limit).get();
  return snap.docs.map((d) => d.data());
}

/**
 * Add a message, creating the thread on first contact. One batch: message, thread summary, unread counter.
 * `listing` is only used when a listing thread is created; `kind: 'direct'` starts a one-to-one chat.
 */
async function send({ listing = null, from, to, body, cid = null, kind = 'listing', flags = [], offer = null, returnIds = false }) {
  const text = String(body).slice(0, MAX_BODY);
  const id = cid || (kind === 'direct' ? directId(from, to) : idFor(listing.listing_id, from));
  const ref = C().doc(id);
  const msgRef = ref.collection('messages').doc();
  const now = Date.now();
  const batch = db.batch();
  const existing = await ref.get();
  const summary = {
    updated_at: now, last_body: text.slice(0, 140), last_sender_id: Number(from),
    [`unread_${to}`]: FieldValue.increment(1), [`unread_${from}`]: 0,
  };
  if (existing.exists) {
    batch.update(ref, summary);
  } else if (kind === 'direct') {
    batch.set(ref, {
      id, kind: 'direct', listing_id: null, listing_title: '', owner_id: Number(to), starter_id: Number(from),
      participants: [Number(from), Number(to)].sort((m, n) => m - n), created_at: now, ...summary,
    });
  } else {
    batch.set(ref, { kind: 'listing',
      id, listing_id: listing.listing_id, listing_title: String(listing.title).slice(0, 90),
      owner_id: listing.owner_id, starter_id: Number(from), participants: [listing.owner_id, Number(from)],
      created_at: now, ...summary,
    });
  }
  batch.set(msgRef, { id: msgRef.id, sender_id: Number(from), body: text, created_at: now, ...(flags.length ? { flags } : {}), ...(offer ? { offer } : {}) });
  // Seller responsiveness: a new listing thread is a question; the poster's first answer in it is a reply.
  const users = () => col('users');
  if (!existing.exists && kind === 'listing') {
    batch.set(users().doc(String(listing.owner_id)), { reply_stats: { asked: FieldValue.increment(1) } }, { merge: true });
  } else if (existing.exists && (existing.data().kind || 'listing') === 'listing' && Number(from) === existing.data().owner_id && !existing.data().first_reply_at) {
    const waited = now - existing.data().created_at;
    batch.update(ref, { first_reply_at: now });
    batch.set(users().doc(String(from)), { reply_stats: {
      replied: FieldValue.increment(1),
      within_hour: FieldValue.increment(waited <= 3_600_000 ? 1 : 0),
      within_day: FieldValue.increment(waited <= 86_400_000 ? 1 : 0),
    } }, { merge: true });
  }
  await batch.commit();
  return returnIds ? { cid: id, mid: msgRef.id } : id;
}

/** Messages newer than `since` (ms), for the live chat poll. */
async function messagesSince(cid, since, limit = 50) {
  const snap = await C().doc(String(cid)).collection('messages').where('created_at', '>', Number(since) || 0).orderBy('created_at', 'asc').limit(limit).get();
  return snap.docs.map((d) => d.data());
}

/* ---------------------------------------------------------------- help chat (support) */

/** The member's support thread, or null if they have never written to the team. */
async function supportThread(userId) {
  const snap = await C().doc(supportId(userId)).get();
  return snap.exists ? view(snap.data(), Number(userId)) : null;
}

/**
 * Post in a support thread. A member's message raises `staff_unread`; a staff reply raises the member's unread
 * count. `auto` marks the automatic first reply so it is never mistaken for a person.
 */
async function sendSupport({ userId, from, body, fromStaff = false, staffName = '', auto = false }) {
  const id = supportId(userId);
  const ref = C().doc(id);
  const msgRef = ref.collection('messages').doc();
  const now = Date.now();
  const text = String(body).slice(0, MAX_BODY);
  const existing = await ref.get();
  const summary = { updated_at: now, last_body: text.slice(0, 140), last_sender_id: Number(from), last_from_staff: Boolean(fromStaff) };
  // the automatic first reply is shown straight away and must not make a new chat look answered
  if (auto) { /* leave unread counts and status alone */ } else if (fromStaff) { summary[`unread_${Number(userId)}`] = FieldValue.increment(1); summary.staff_unread = 0; summary.status = 'answered'; }
  else { summary[`unread_${Number(userId)}`] = 0; summary.staff_unread = FieldValue.increment(1); summary.status = 'open'; }
  const batch = db.batch();
  if (existing.exists) batch.update(ref, summary);
  else batch.set(ref, { id, kind: 'support', user_id: Number(userId), participants: [Number(userId)], listing_id: null, listing_title: '', created_at: now, ...summary });
  batch.set(msgRef, { id: msgRef.id, sender_id: Number(from), body: text, created_at: now + (auto ? 1 : 0), from_staff: Boolean(fromStaff), staff_name: fromStaff ? String(staffName).slice(0, 60) : '', auto: Boolean(auto) });
  await batch.commit();
  return id;
}

/** Support threads for the staff inbox: waiting ones first, then newest. Sorted in memory (no composite index). */
async function supportQueue(limit = 200) {
  const snap = await C().where('kind', '==', 'support').limit(500).get();
  return snap.docs.map((d) => d.data())
    .sort((a, b) => (((b.staff_unread || 0) > 0) - ((a.staff_unread || 0) > 0)) || b.updated_at - a.updated_at)
    .slice(0, limit);
}
const supportWaiting = async () => (await supportQueue(500)).filter((t) => (t.staff_unread || 0) > 0).length;
async function markSupportRead(userId) { await C().doc(supportId(userId)).update({ staff_unread: 0 }); }

async function markRead(cid, me) {
  await C().doc(String(cid)).update({ [`unread_${Number(me)}`]: 0 });
}

async function unreadTotal(me) {
  const all = await listFor(me, 300, { includeSupport: true });
  return all.reduce((n, c) => n + (c.unread ? 1 : 0), 0);
}

/** Threads about one listing (used to tell people when an item is marked returned). */
async function byListing(listingId) {
  const snap = await C().where('listing_id', '==', Number(listingId)).limit(100).get();
  return snap.docs.map((d) => d.data());
}

/** Remove every thread a member took part in (account deletion). */
async function deleteForUser(me) {
  const snap = await C().where('participants', 'array-contains', Number(me)).get();
  for (const d of snap.docs) await db.recursiveDelete(d.ref);
  return snap.size;
}

/** Threads untouched for a year are deleted. Run at start-up and hourly. */
async function cleanupOld(days = 365) {
  const snap = await C().where('updated_at', '<', Date.now() - days * 86_400_000).limit(100).get();
  for (const d of snap.docs) await db.recursiveDelete(d.ref);
  return snap.size;
}

const countAll = () => countOf(C());

async function getMessage(cid, mid) {
  const s = await C().doc(String(cid)).collection('messages').doc(String(mid)).get();
  return s.exists ? s.data() : null;
}
const updateMessage = (cid, mid, patch) => C().doc(String(cid)).collection('messages').doc(String(mid)).update(patch);
const setThread = (cid, patch) => C().doc(String(cid)).update(patch);

module.exports = {
  MAX_BODY, idFor, directId, supportId, get, forListing, listFor, messagesOf, messagesSince, send, markRead, unreadTotal,
  supportThread, sendSupport, supportQueue, supportWaiting, markSupportRead, byListing, deleteForUser, cleanupOld, countAll, getMessage, updateMessage, setThread,
};
