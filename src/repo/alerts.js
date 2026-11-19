'use strict';
/**
 * Search alerts: a member saves a search (keywords, category, max price) and is notified when a matching
 * listing goes live for the first time. Private to the member who saved it.
 *   alerts/{auto id}
 */
const { col, deleteWhere, FieldValue } = require('../store');

const A = () => col('alerts');
const MAX_ALERTS = 10;

/** Newest first. Sorted in memory, so no composite index is needed. */
async function byUser(userId) {
  const snap = await A().where('user_id', '==', Number(userId)).limit(MAX_ALERTS + 10).get();
  return snap.docs.map((d) => d.data()).sort((a, b) => b.created_at - a.created_at);
}

/** Every alert, for matching a newly live listing. Campus scale: a few thousand at most. */
async function all(limit = 5000) {
  return (await A().limit(limit).get()).docs.map((d) => d.data());
}

/** Save an alert. Returns 'max' when the member already has the maximum, 'duplicate' when the same search exists. */
async function add(userId, { q, category, price_max_cents }) {
  const mine = await byUser(userId);
  if (mine.some((a) => a.q === q && a.category === category && a.price_max_cents === price_max_cents)) return 'duplicate';
  if (mine.length >= MAX_ALERTS) return 'max';
  const ref = A().doc();
  await ref.set({ id: ref.id, user_id: Number(userId), q, category, price_max_cents, created_at: Date.now(), hits: 0 });
  return ref.id;
}

/** Delete one of the member's own alerts. Returns false if it is not theirs. */
async function remove(userId, id) {
  if (!/^[A-Za-z0-9]{10,40}$/.test(String(id))) return false;
  const ref = A().doc(String(id));
  const snap = await ref.get();
  if (!snap.exists || snap.data().user_id !== Number(userId)) return false;
  await ref.delete();
  return true;
}

const bump = (id) => A().doc(id).set({ hits: FieldValue.increment(1), last_hit_at: Date.now() }, { merge: true });
const deleteForUser = (userId) => deleteWhere(A().where('user_id', '==', Number(userId)));

module.exports = { MAX_ALERTS, byUser, all, add, remove, bump, deleteForUser };
