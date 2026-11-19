'use strict';
/**
 * Small Firestore helpers shared by the repositories.
 *
 * Data model (collections):
 *   users/{user_id}           account + embedded profile (uid links to Firebase Auth)
 *   categories/{category_id}
 *   listings/{listing_id}     embeds images[] and a cover filename
 *   reports/{report_id}
 *   moderation_actions/{auto}
 *   activity_logs/{auto}
 *   notifications/{auto}
 *   sessions/{sha256(token)}
 *   settings/platform
 *   counters/{name}           sequential ids for users, listings, reports, categories
 * Access is server-only: firestore.rules denies every client request.
 */
const { db, FieldValue } = require('./firebase');

const col = (name) => db.collection(name);

/** Human-friendly sequential ids (user #12, report #7). Cheap enough at campus scale. */
async function nextId(name) {
  const ref = db.collection('counters').doc(name);
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const n = (snap.exists ? snap.data().n : 0) + 1;
    t.set(ref, { n });
    return n;
  });
}

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/** Batched get by ids. Returns Map<string id, data>. */
async function getMany(collection, ids) {
  const uniq = [...new Set(ids.filter((x) => x !== null && x !== undefined).map(String))];
  const out = new Map();
  for (const part of chunk(uniq, 200)) {
    const snaps = await db.getAll(...part.map((id) => db.collection(collection).doc(id)));
    snaps.forEach((s) => { if (s.exists) out.set(s.id, s.data()); });
  }
  return out;
}

async function countOf(query) {
  const snap = await query.count().get();
  return snap.data().count;
}

/** Delete every document a query matches, in safe batches. Returns how many were deleted. */
async function deleteWhere(query, { except = null } = {}) {
  let total = 0;
  for (;;) {
    const snap = await query.limit(400).get();
    const docs = snap.docs.filter((d) => d.id !== except);
    if (!docs.length) break; // nothing left that we are allowed to delete
    const batch = db.batch();
    docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += docs.length;
    if (snap.size < 400) break;
  }
  return total;
}

module.exports = { db, FieldValue, col, nextId, chunk, getMany, countOf, deleteWhere };
