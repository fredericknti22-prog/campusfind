'use strict';
/**
 * Seller reviews: one review per (reviewer, seller) pair, which the reviewer can edit or delete.
 *   reviews/{reviewer_id}_{seller_id}
 * Reviews show straight away. Anyone can report one; staff can remove it (status 'removed', kept for the record).
 */
const { col, deleteWhere } = require('../store');

const R = () => col('reviews');
const idFor = (reviewerId, sellerId) => `${Number(reviewerId)}_${Number(sellerId)}`;

async function get(id) {
  if (!/^\d{1,9}_\d{1,9}$/.test(String(id))) return null;
  const s = await R().doc(String(id)).get();
  return s.exists ? s.data() : null;
}

const mine = (reviewerId, sellerId) => get(idFor(reviewerId, sellerId));

/** Visible reviews about a seller, newest first (sorted in memory: no composite index). */
async function forSeller(sellerId, limit = 50) {
  const snap = await R().where('seller_id', '==', Number(sellerId)).limit(300).get();
  return snap.docs.map((d) => d.data()).filter((r) => r.status === 'visible').sort((a, b) => b.updated_at - a.updated_at).slice(0, limit);
}

/** { avg, count } over visible reviews, avg rounded to one decimal; count 0 means no rating yet. */
async function summary(sellerId) {
  const all = await forSeller(sellerId, 300);
  if (!all.length) return { avg: 0, count: 0 };
  return { avg: Math.round((all.reduce((n, r) => n + r.rating, 0) / all.length) * 10) / 10, count: all.length };
}

/** Create or update the reviewer's review of the seller. Returns { review, created }. */
async function upsert({ reviewerId, sellerId, rating, body }) {
  const id = idFor(reviewerId, sellerId);
  const existing = await get(id);
  const now = Date.now();
  const doc = {
    id, reviewer_id: Number(reviewerId), seller_id: Number(sellerId), rating, body,
    status: 'visible', created_at: existing ? existing.created_at : now, updated_at: now,
  };
  // a review removed by staff stays removed: editing it does not bring it back
  if (existing && existing.status === 'removed') return { review: existing, created: false, blocked: true };
  await R().doc(id).set(doc);
  return { review: doc, created: !existing };
}

const remove = (id) => R().doc(String(id)).delete();
const hide = (id, staffId) => R().doc(String(id)).set({ status: 'removed', removed_by: Number(staffId), removed_at: Date.now() }, { merge: true });
/** Account deletion: reviews written by the member and reviews about them both go. */
async function deleteForUser(userId) {
  await deleteWhere(R().where('reviewer_id', '==', Number(userId)));
  await deleteWhere(R().where('seller_id', '==', Number(userId)));
}

module.exports = { idFor, get, mine, forSeller, summary, upsert, remove, hide, deleteForUser };
