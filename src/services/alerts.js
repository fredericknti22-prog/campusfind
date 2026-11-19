'use strict';
/**
 * Search alerts: when a listing goes live for the first time, notify every member whose saved search matches it.
 * Matching uses exactly the same rules as /browse, so an alert never fires for something the search would not show.
 */
const alerts = require('../repo/alerts');
const listingsRepo = require('../repo/listings');
const users = require('../repo/users');
const { notify } = require('./notify');
const { formatMoney } = require('../lib/validate');

const termsOf = (q) => String(q || '').toLowerCase().split(' ').filter(Boolean).slice(0, 5);

/** Same rules as the browse filters: every keyword appears, same category, at or under the max price (free always counts). */
function matches(alert, l) {
  const terms = termsOf(alert.q);
  if (terms.length) {
    const hay = `${l.title} ${l.description} ${l.location || ''}`.toLowerCase();
    if (!terms.every((t) => hay.includes(t))) return false;
  }
  if (alert.category && l.cat_slug !== alert.category) return false;
  if (alert.price_max_cents != null && !(l.price_type === 'free' || l.price_cents == null || l.price_cents <= alert.price_max_cents)) return false;
  return true;
}

/** Short human label for an alert, e.g. "room · Housing & Roommates · up to GH₵500". */
function describe(alert, categories = []) {
  const cat = alert.category ? (categories.find((c) => c.slug === alert.category) || {}).name || alert.category : '';
  const parts = [alert.q ? `“${alert.q}”` : '', cat, alert.price_max_cents != null ? `up to ${formatMoney(alert.price_max_cents)}` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'All new listings';
}

/**
 * Call after a listing becomes active for the first time. Never throws: an alert problem must not break posting.
 * Members are not alerted about their own listings, and suspended or deleted members get nothing.
 */
async function onListingLive(listingId) {
  try {
    const raw = await listingsRepo.get(listingId);
    if (!raw || raw.status !== 'active' || raw.deleted_at) return 0;
    const [l] = await listingsRepo.hydrate([raw]);
    const hits = (await alerts.all()).filter((a) => a.user_id !== l.owner_id && matches(a, l));
    if (!hits.length) return 0;
    // one notification per member even if several of their alerts match
    const byMember = new Map();
    for (const a of hits) if (!byMember.has(a.user_id)) byMember.set(a.user_id, a);
    let sent = 0;
    for (const [userId, a] of byMember) {
      const u = await users.getById(userId);
      if (!u || u.deleted_at || u.status === 'suspended' || u.status === 'banned') continue;
      await notify(userId, {
        type: 'system',
        title: `New match for your alert: ${String(l.title).slice(0, 80)}`,
        body: `${l.cat_name}${l.price_cents != null ? ` · ${formatMoney(l.price_cents)}` : l.price_type === 'free' ? ' · Free' : ''}${l.location ? ` · ${l.location}` : ''}. Matches your search ${describe(a)}.`,
        link: `/listings/${l.listing_id}`,
      });
      await alerts.bump(a.id);
      sent += 1;
    }
    return sent;
  } catch (err) {
    console.error('[alerts] could not send alerts for listing', listingId, err.message);
    return 0;
  }
}

module.exports = { matches, describe, onListingLive, termsOf };
