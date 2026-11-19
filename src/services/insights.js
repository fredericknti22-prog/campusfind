'use strict';
/**
 * Demand insights: what members search for on /browse, and which searches find nothing.
 * Counted per day and per search, with no user id, IP or session stored. One small document per (day, search):
 *   search_stats/{YYYYMMDD}_{key}   { day, q, category, count, zero, last_at }
 * Searches that look like personal data (an @, or a run of 7+ digits such as a phone number) are never recorded.
 */
const crypto = require('crypto');
const { col, FieldValue } = require('../store');

const S = () => col('search_stats');
const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');

/** Lower-case, single spaces, at most 60 characters. Returns '' for searches that must not be stored. */
function normalise(q) {
  const s = String(q || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!s) return '';
  if (s.includes('@') || /\d[\d\s-]{6,}\d/.test(s)) return '';
  return s;
}

// one count per visitor per search per 10 minutes on this instance, so paging and re-sorting do not inflate numbers
const recent = new Map();
function seenRecently(key, who) {
  const k = `${who}|${key}`;
  const now = Date.now();
  if (recent.size > 5000) for (const [kk, at] of recent) if (now - at > 600_000) recent.delete(kk);
  if (recent.has(k) && now - recent.get(k) < 600_000) return true;
  recent.set(k, now);
  return false;
}

/** Record one browse search. Never throws and never blocks a search for long. */
async function record({ q, category = '', total, who = '' }) {
  try {
    const text = normalise(q);
    if (!text && !category) return;
    const id = crypto.createHash('sha1').update(`${text}|${category}`).digest('hex').slice(0, 16);
    if (seenRecently(id, who)) return;
    const day = dayKey();
    await S().doc(`${day}_${id}`).set({
      day, q: text, category: category || '', count: FieldValue.increment(1),
      zero: FieldValue.increment(total === 0 ? 1 : 0), last_at: Date.now(),
    }, { merge: true });
  } catch (err) {
    console.error('[insights] could not record a search:', err.message);
  }
}

/** Totals over the last `days` days: { top, empty, totalSearches, emptySearches } with the most frequent first. */
async function summary(days = 30) {
  const since = dayKey(Date.now() - (days - 1) * 86_400_000);
  const snap = await S().where('day', '>=', since).limit(20000).get();
  const merged = new Map();
  let totalSearches = 0; let emptySearches = 0;
  for (const d of snap.docs) {
    const x = d.data();
    const key = `${x.q}|${x.category}`;
    const m = merged.get(key) || { q: x.q, category: x.category, count: 0, zero: 0, last_at: 0 };
    m.count += x.count || 0; m.zero += x.zero || 0; m.last_at = Math.max(m.last_at, x.last_at || 0);
    merged.set(key, m);
    totalSearches += x.count || 0; emptySearches += x.zero || 0;
  }
  const all = [...merged.values()];
  return {
    days, totalSearches, emptySearches,
    top: all.filter((x) => x.q).sort((a, b) => b.count - a.count || b.last_at - a.last_at).slice(0, 25),
    empty: all.filter((x) => x.zero > 0).sort((a, b) => b.zero - a.zero || b.last_at - a.last_at).slice(0, 25),
    categories: all.filter((x) => !x.q && x.category).sort((a, b) => b.count - a.count).slice(0, 15),
  };
}

module.exports = { normalise, record, summary, dayKey };
