'use strict';
const { db, col, nextId, chunk, countOf } = require('../store');

const DEFAULTS = [
  ['Textbooks & Study', 'textbooks', 'Course books, notes, past papers and study gear.', 'book'],
  ['Electronics', 'electronics', 'Laptops, phones, chargers, calculators and more.', 'laptop'],
  ['Housing & Roommates', 'housing', 'Rooms, sublets, roommate searches and moving help.', 'home'],
  ['Services & Tutoring', 'services', 'Tutoring, printing, repairs, rides and other student services.', 'tool'],
  ['Jobs & Opportunities', 'opportunities', 'Part-time work, internships, volunteering and research roles.', 'briefcase'],
  ['Events & Clubs', 'events', 'Society events, tryouts, workshops and meetups.', 'calendar'],
  ['Business', 'business', 'Hostels, food vendors, shops and services selling to students. Advertise to the whole campus.', 'store'],
  ['Lost & Found', 'lost-found', 'Report something you lost or found around campus.', 'compass'],
  ['Free Items', 'free', 'Items offered free of charge.', 'gift'],
];

/** Each category keeps its own colour (CSS classes tone-0 to tone-8). Existing categories keep the tones they already have. */
const TONES = { textbooks: 0, electronics: 1, housing: 2, services: 3, opportunities: 4, events: 5, 'lost-found': 6, free: 7, business: 8 };
const TONE_COUNT = 9;

let cache = null;
let at = 0;

async function all(force = false) {
  if (!force && cache && Date.now() - at < 60_000) return cache;
  const snap = await col('categories').get();
  cache = snap.docs.map((d) => d.data()).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  at = Date.now();
  return cache;
}
const invalidate = () => { cache = null; };
const active = async () => (await all()).filter((c) => c.is_active);

async function byId(id) {
  return (await all()).find((c) => c.category_id === Number(id)) || null;
}

async function seedDefaults() {
  const snap = await col('categories').limit(1).get();
  if (!snap.empty) return;
  const batch = db.batch();
  DEFAULTS.forEach(([name, slug, description, icon], i) => {
    const id = i + 1;
    batch.set(col('categories').doc(String(id)), {
      category_id: id, name, slug, description, icon, tone: TONES[slug] ?? i % TONE_COUNT, sort_order: i, is_active: 1,
    });
  });
  batch.set(col('counters').doc('categories'), { n: DEFAULTS.length });
  await batch.commit();
  invalidate();
}

/**
 * Adds any built-in category an older database does not have yet (the Business category, for example).
 * Never changes or re-activates a category an admin has already edited.
 */
async function ensureDefaults() {
  // One transaction so two servers starting together cannot insert the same built-in category twice.
  const added = await db.runTransaction(async (t) => {
    const snap = await t.get(col('categories'));
    const counterRef = col('counters').doc('categories');
    const counter = await t.get(counterRef);
    let n = counter.exists ? Number(counter.data().n) || 0 : 0;
    const list = snap.docs.map((d) => d.data());
    const have = new Set(list.map((c) => c.slug));
    const used = new Set(list.map((c) => Number(c.category_id)));
    let wrote = false;
    for (const [name, slug, description, icon] of DEFAULTS) {
      if (have.has(slug)) continue;
      do { n += 1; } while (used.has(n));
      used.add(n);
      const at = DEFAULTS.findIndex((d) => d[1] === slug);
      const before = list.filter((c) => {
        const i = DEFAULTS.findIndex((d) => d[1] === c.slug);
        return i >= 0 && i < at;
      });
      const sort_order = before.length ? Math.max(...before.map((c) => c.sort_order)) + 0.5 : -0.5;
      const doc = { category_id: n, name, slug, description, icon, tone: TONES[slug] ?? 0, sort_order, is_active: 1 };
      t.set(col('categories').doc(String(n)), doc);
      list.push(doc);
      have.add(slug);
      wrote = true;
    }
    if (wrote) t.set(counterRef, { n });
    return wrote;
  });
  if (added) invalidate();
  await collapseBuiltinDuplicates();
}

/** Keep one copy of each built-in category and point its listings at that copy. */
async function collapseBuiltinDuplicates() {
  const builtin = new Set(DEFAULTS.map((d) => d[1]));
  const groups = new Map();
  for (const c of await all(true)) {
    if (!builtin.has(c.slug)) continue;
    if (!groups.has(c.slug)) groups.set(c.slug, []);
    groups.get(c.slug).push(c);
  }
  let changed = false;
  for (const copies of groups.values()) {
    if (copies.length < 2) continue;
    copies.sort((a, b) => a.category_id - b.category_id);
    const keep = copies[0].category_id;
    for (const extra of copies.slice(1)) {
      const listings = await col('listings').where('category_id', '==', extra.category_id).get();
      for (const part of chunk(listings.docs, 400)) {
        const batch = db.batch();
        part.forEach((d) => batch.update(d.ref, { category_id: keep }));
        await batch.commit();
      }
      await col('categories').doc(String(extra.category_id)).delete();
      changed = true;
    }
  }
  if (changed) invalidate();
}

async function create({ name, slug, description, icon }) {
  const list = await all(true);
  const id = await nextId('categories');
  const doc = {
    category_id: id, name, slug, description, icon, tone: list.length % TONE_COUNT,
    sort_order: Math.max(0, ...list.map((c) => c.sort_order)) + 1, is_active: 1,
  };
  await col('categories').doc(String(id)).set(doc);
  invalidate();
  return doc;
}

async function update(id, patch) {
  await col('categories').doc(String(id)).update(patch);
  invalidate();
}

/** Live (non-deleted) listing count for the admin page. */
const listingCount = (id) => countOf(col('listings').where('category_id', '==', Number(id)).where('deleted_at', '==', null));

module.exports = { all, active, byId, seedDefaults, ensureDefaults, create, update, invalidate, listingCount };
