'use strict';
const { col, nextId, getMany, countOf, FieldValue } = require('../store');

const U = () => col('users');

async function getById(id) {
  if (id === null || id === undefined) return null;
  const snap = await U().doc(String(id)).get();
  return snap.exists ? snap.data() : null;
}

async function getByEmail(email) {
  const q = await U().where('email', '==', email).limit(1).get();
  return q.empty ? null : q.docs[0].data();
}

async function getByUid(uid) {
  const q = await U().where('uid', '==', uid).limit(1).get();
  return q.empty ? null : q.docs[0].data();
}

async function create({ uid, name, email, role = 'student', consent = null }) {
  const id = await nextId('users');
  const now = Date.now();
  const doc = {
    user_id: id, uid, name, email, role,
    status: 'active', status_reason: null, status_until: null,
    warnings: 0, false_reports: 0, failed_logins: 0, locked_until: null,
    created_at: now, last_login_at: null, deleted_at: null,
    terms_version: consent ? consent.version : null, terms_accepted_at: consent ? now : null,
    // Only the outcome of the age check is kept, never the date of birth itself.
    age_confirmed_at: consent && consent.minAge ? now : null, min_age_confirmed: consent && consent.minAge ? consent.minAge : null,
    profile: { bio: '', program: '', study_year: '', show_program: 1, updated_at: now },
  };
  await U().doc(String(id)).set(doc);
  return doc;
}

/** Any change may alter visibility of the owner's listings, so drop the owner cache entry. */
async function update(id, patch) {
  await U().doc(String(id)).update(patch);
  ownerCache.delete(Number(id));
}

const increment = (id, field, n = 1) => update(id, { [field]: FieldValue.increment(n) });

/** Newest accounts first (admin lists filter in memory; campus scale). */
async function recent(limit = 500) {
  const snap = await U().orderBy('created_at', 'desc').limit(limit).get();
  return snap.docs.map((d) => d.data());
}

async function createdSince(ms) {
  const snap = await U().where('created_at', '>=', ms).select('created_at').get();
  return snap.docs.map((d) => d.data().created_at);
}

const staff = async () => {
  const snap = await U().where('role', 'in', ['superadmin', 'admin', 'moderator']).get();
  return snap.docs.map((d) => d.data()).filter((u) => !u.deleted_at);
};

const countByRole = (role) => countOf(U().where('role', '==', role));
const countAll = () => countOf(U().where('deleted_at', '==', null));
const countSince = (ms) => countOf(U().where('created_at', '>', ms));
const countLocked = () => countOf(U().where('locked_until', '>', Date.now()));
const suspended = async () => (await U().where('status', '==', 'suspended').get()).docs.map((d) => d.data());

/* ---- owner visibility: listings of banned / suspended / deleted members stay out of public views ---- */
const ownerCache = new Map();
async function visibleOwners(ids) {
  const now = Date.now();
  const need = [];
  for (const id of new Set(ids.map(Number))) {
    const c = ownerCache.get(id);
    if (!c || now - c.at > 30_000) need.push(id);
  }
  if (need.length) {
    const found = await getMany('users', need);
    for (const id of need) {
      const u = found.get(String(id));
      ownerCache.set(id, { at: now, ok: Boolean(u && !u.deleted_at && ['active', 'restricted'].includes(u.status)), name: u && !u.deleted_at ? u.name : '', trust: u && !u.deleted_at ? require('../lib/trust').level(u) : null });
    }
  }
  return new Set(ids.map(Number).filter((id) => ownerCache.get(id) && ownerCache.get(id).ok));
}

const forget = (id) => ownerCache.delete(Number(id));
/** Display name of a member whose standing was just checked by visibleOwners (empty when unknown). */
const ownerName = (id) => (ownerCache.get(Number(id)) || {}).name || '';
/** 'student' | 'email' | null for a member whose standing was just checked by visibleOwners. */
const ownerTrust = (id) => (ownerCache.get(Number(id)) || {}).trust || null;

module.exports = {
  forget, getById, getByEmail, getByUid, create, update, increment, recent, createdSince, staff,
  countByRole, countAll, countSince, countLocked, suspended, visibleOwners, ownerName, ownerTrust,
};
