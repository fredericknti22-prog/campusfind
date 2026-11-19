'use strict';
/**
 * Orders for paid promotions.
 *   orders/{order_id}
 * Money is stored in pesewas. Card and Mobile Money details never reach this app: Paystack handles them.
 */
const { col, nextId, countOf } = require('../store');

const O = () => col('orders');
const ref = (id) => O().doc(String(id));

async function create(doc) {
  const order_id = await nextId('orders');
  const now = Date.now();
  const full = { order_id, status: 'pending', created_at: now, paid_at: null, ...doc };
  await ref(order_id).set(full);
  return full;
}

async function get(id) {
  const s = await ref(id).get();
  return s.exists ? s.data() : null;
}

async function byReference(reference) {
  const q = await O().where('reference', '==', String(reference)).limit(1).get();
  return q.empty ? null : q.docs[0].data();
}

/** Newest first, sorted in memory so no composite index is needed. */
async function byUser(userId, limit = 100) {
  const q = await O().where('user_id', '==', Number(userId)).limit(300).get();
  return q.docs.map((d) => d.data()).sort((a, b) => b.created_at - a.created_at).slice(0, limit);
}

async function recent(limit = 200) {
  const q = await O().orderBy('created_at', 'desc').limit(limit).get();
  return q.docs.map((d) => d.data());
}

const update = (id, patch) => ref(id).update(patch);
const countByStatus = (status) => countOf(O().where('status', '==', status));

module.exports = { O, ref, create, get, byReference, byUser, recent, update, countByStatus };
