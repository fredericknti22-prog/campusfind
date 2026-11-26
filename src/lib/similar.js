'use strict';
/**
 * "Similar listings" under a listing: other live listings a buyer of this one may want.
 * Pure ranking over the active snapshot (no extra database reads):
 *   same category +3, each shared title word +2, price within half either way +1, newest first on ties.
 * A candidate needs the same category or a shared title word. The poster's own other listings are left
 * out (their profile link covers those), and so are members the viewer has blocked.
 */
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'sale', 'new', 'used', 'good', 'great', 'very', 'like', 'lost', 'found',
  'free', 'cheap', 'selling', 'sell', 'buy', 'available', 'one', 'two', 'set', 'pair', 'item', 'items', 'near', 'campus']);

function words(title) {
  return new Set(String(title || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)));
}

function similar(listing, pool, { limit = 4, hidden = new Set() } = {}) {
  if (!listing) return [];
  const mine = words(listing.title);
  const price = Number(listing.price_cents) || 0;
  const scored = [];
  for (const c of pool) {
    if (c.listing_id === listing.listing_id || Number(c.owner_id) === Number(listing.owner_id)) continue;
    if (hidden.has(Number(c.owner_id))) continue;
    const sameCat = c.category_id === listing.category_id;
    let shared = 0;
    for (const w of words(c.title)) if (mine.has(w)) shared += 1;
    if (!sameCat && !shared) continue;
    const p = Number(c.price_cents) || 0;
    const closePrice = price > 0 && p > 0 && p >= price / 2 && p <= price * 1.5;
    scored.push({ c, score: (sameCat ? 3 : 0) + shared * 2 + (closePrice ? 1 : 0), at: c.published_at || c.created_at || 0 });
  }
  scored.sort((a, b) => b.score - a.score || b.at - a.at);
  return scored.slice(0, limit).map((s) => s.c);
}

module.exports = { similar, words };
