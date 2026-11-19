'use strict';
const { db, col, nextId, countOf } = require('../store');

const R = () => col('reports');
const OPEN = ['pending', 'reviewing'];

async function get(id) {
  if (id === null || id === undefined) return null;
  const s = await R().doc(String(id)).get();
  return s.exists ? s.data() : null;
}

/**
 * Create a report. Enforces one open report per reporter per target inside a transaction.
 * Returns { report } or { duplicate: true }. Automated flags (reporter_id null) skip the per-reporter rule.
 */
async function create({ reporter_id = null, target_type, target_id, owner_id, reason, details = '', evidence = null }) {
  const id = await nextId('reports');
  const ref = R().doc(String(id));
  const doc = {
    report_id: id, reporter_id, target_type, target_id: Number(target_id), owner_id: Number(owner_id),
    reason, details, status: 'pending', reviewer_id: null, resolution: null, resolution_note: null,
    created_at: Date.now(), resolved_at: null,
    ...(evidence ? { evidence } : {}),
  };
  const result = await db.runTransaction(async (t) => {
    const existing = await t.get(
      R().where('reporter_id', '==', reporter_id).where('target_type', '==', target_type).where('target_id', '==', Number(target_id))
    );
    if (existing.docs.some((d) => OPEN.includes(d.data().status))) return { duplicate: true };
    t.set(ref, doc);
    return { report: doc };
  });
  return result;
}

const update = (id, patch) => R().doc(String(id)).update(patch);

async function openOnes() {
  const [a, b] = await Promise.all(OPEN.map((s) => R().where('status', '==', s).get()));
  return [...a.docs, ...b.docs].map((d) => d.data()).sort((x, y) => x.created_at - y.created_at);
}

/** Reports for the admin queue in a given view. */
async function list(status) {
  if (status === 'open') return openOnes();
  if (status === 'pending' || status === 'reviewing') {
    const snap = await R().where('status', '==', status).get();
    return snap.docs.map((d) => d.data()).sort((x, y) => x.created_at - y.created_at);
  }
  const q = status === 'all' ? R().orderBy('created_at', 'desc') : R().where('status', '==', status).orderBy('created_at', 'desc');
  return (await q.limit(300).get()).docs.map((d) => d.data());
}

async function forTarget(type, targetId) {
  const snap = await R().where('target_type', '==', type).where('target_id', '==', Number(targetId)).get();
  return snap.docs.map((d) => d.data()).sort((a, b) => b.created_at - a.created_at);
}

async function byReporter(userId) {
  const snap = await R().where('reporter_id', '==', Number(userId)).get();
  return snap.docs.map((d) => d.data());
}

async function byOwner(userId) {
  const snap = await R().where('owner_id', '==', Number(userId)).get();
  return snap.docs.map((d) => d.data()).sort((a, b) => b.created_at - a.created_at);
}

const countOpen = async () => (await Promise.all(OPEN.map((s) => countOf(R().where('status', '==', s))))).reduce((a, b) => a + b, 0);
const countByReason = (reason) => countOf(R().where('reason', '==', reason));

module.exports = { OPEN, get, create, update, list, openOnes, forTarget, byReporter, byOwner, countOpen, countByReason };
