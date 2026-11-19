'use strict';
const { col, nextId, countOf, FieldValue } = require('../store');
const categories = require('./categories');
const users = require('./users');

const L = () => col('listings');

/* Public views read from a short-lived snapshot of the newest 500 active listings and filter/sort in memory.
   That keeps search flexible without a search service. Past a few thousand active listings, move search
   to a dedicated index (Algolia / Typesense / Vertex AI Search). */
const SNAPSHOT_LIMIT = 500;
const SNAPSHOT_TTL = 10_000;
let snapshot = { at: 0, items: null };
const invalidate = () => { snapshot = { at: 0, items: null }; };

async function get(id) {
  if (id === null || id === undefined) return null;
  const s = await L().doc(String(id)).get();
  return s.exists ? s.data() : null;
}

async function create(data) {
  const id = await nextId('listings');
  const doc = {
    images: [], cover: null, views: 0, is_featured: 0, featured_until: null, deleted_at: null,
    ...data, listing_id: id,
  };
  await L().doc(String(id)).set(doc);
  invalidate();
  return doc;
}

async function update(id, patch) {
  await L().doc(String(id)).update(patch);
  invalidate();
}

const bumpViews = (id) => L().doc(String(id)).update({ views: FieldValue.increment(1) });

/** Newest active, non-deleted listings whose owners are in good standing, with category fields attached. */
async function activeSnapshot() {
  if (snapshot.items && Date.now() - snapshot.at < SNAPSHOT_TTL) return snapshot.items;
  const snap = await L().where('status', '==', 'active').orderBy('published_at', 'desc').limit(SNAPSHOT_LIMIT).get();
  const raw = snap.docs.map((d) => d.data()).filter((l) => !l.deleted_at);
  const ok = await users.visibleOwners(raw.map((l) => l.owner_id));
  const items = (await hydrate(raw.filter((l) => ok.has(Number(l.owner_id))))).map((l) => ({ ...l, owner_name: users.ownerName(l.owner_id), owner_trust: users.ownerTrust(l.owner_id) }));
  snapshot = { at: Date.now(), items };
  return items;
}

async function hydrate(items) {
  const cats = await categories.all();
  const map = new Map(cats.map((c) => [c.category_id, c]));
  return items.map((l) => {
    const c = map.get(l.category_id) || {};
    return { ...l, cat_name: c.name || 'Uncategorised', cat_slug: c.slug || '', cat_icon: c.icon || 'tag', cat_tone: c.tone || 0 };
  });
}

async function byOwner(ownerId) {
  const snap = await L().where('owner_id', '==', Number(ownerId)).get();
  return snap.docs.map((d) => d.data());
}

async function recent(limit = 500) {
  const snap = await L().orderBy('created_at', 'desc').limit(limit).get();
  return snap.docs.map((d) => d.data());
}

const countActive = () => countOf(L().where('status', '==', 'active').where('deleted_at', '==', null));
const countLive = () => countOf(L().where('deleted_at', '==', null));
const countOwned = (ownerId) => countOf(L().where('owner_id', '==', Number(ownerId)).where('deleted_at', '==', null));

/** Lost & found items marked as returned to their owner. Cached for a minute: it only feeds a number on the home page. */
let returnedCache = { n: 0, at: 0 };
async function countReturned() {
  if (Date.now() - returnedCache.at < 60_000) return returnedCache.n;
  const n = await countOf(L().where('outcome', '==', 'returned').where('deleted_at', '==', null));
  returnedCache = { n, at: Date.now() };
  return n;
}

module.exports = { get, create, update, bumpViews, activeSnapshot, hydrate, byOwner, recent, countActive, countLive, countOwned, countReturned, invalidate };
