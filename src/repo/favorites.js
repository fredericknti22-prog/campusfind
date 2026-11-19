'use strict';
/**
 * Saved listings ("favourites"). Private to the member who saved them.
 *   favorites/{user_id}_{listing_id}
 */
const { col, deleteWhere } = require('../store');

const F = () => col('favorites');
const idFor = (userId, listingId) => `${Number(userId)}_${Number(listingId)}`;
const MAX_SAVED = 300;

async function has(userId, listingId) {
  return (await F().doc(idFor(userId, listingId)).get()).exists;
}

/** Newest saved first. Sorted in memory, so no composite index is needed. */
async function listingIds(userId) {
  const snap = await F().where('user_id', '==', Number(userId)).limit(MAX_SAVED + 50).get();
  return snap.docs.map((d) => d.data()).sort((a, b) => b.created_at - a.created_at).map((x) => x.listing_id);
}

/** Save. Returns false when the member already has the maximum number of saved listings. */
async function add(userId, listingId) {
  if ((await listingIds(userId)).length >= MAX_SAVED) return false;
  await F().doc(idFor(userId, listingId)).set({ user_id: Number(userId), listing_id: Number(listingId), created_at: Date.now() });
  return true;
}

const remove = (userId, listingId) => F().doc(idFor(userId, listingId)).delete();
const deleteForUser = (userId) => deleteWhere(F().where('user_id', '==', Number(userId)));

module.exports = { MAX_SAVED, has, add, remove, listingIds, deleteForUser };
