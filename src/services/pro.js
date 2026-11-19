'use strict';
/**
 * Paid members ("Pro sellers"). Every confirmed payment makes the member Pro for that promotion's period:
 *   users.pro_until  (ms)  extended by the order's days each time a payment is confirmed
 * Perks while Pro: gold "Pro seller" badge, 10 photos per listing (instead of 4), listings stay live 60 days and
 * never expire during the Pro period, and listing stats (views, saves, chats) in My listings.
 */
const config = require('../config');
const { col, FieldValue } = require('../store');

const DAY = 86_400_000;
const PRO_PHOTOS = 10;
const PRO_LIVE_DAYS = 60;

const isPro = (u) => Boolean(u && Number(u.pro_until) > Date.now());
const photoLimit = (u) => (isPro(u) ? PRO_PHOTOS : config.limits.imagesPerListing);

/** Extend the member's Pro period by `days` from now (or from the end of the current period). */
async function grant(userId, days, now = Date.now()) {
  const ref = col('users').doc(String(userId));
  const snap = await ref.get();
  if (!snap.exists) return 0;
  const until = Math.max(now, Number(snap.data().pro_until) || 0) + days * DAY;
  await ref.update({ pro_until: until });
  require('../repo/users').forget(userId);
  return until;
}

/** Views, saves and chats for each of a member's listings (Pro perk). */
async function stats(ownerId, listingIds) {
  if (!listingIds.length) return new Map();
  const [favs, threads] = await Promise.all([
    Promise.all(Array.from({ length: Math.ceil(listingIds.length / 30) }, (_, i) => col('favorites').where('listing_id', 'in', listingIds.slice(i * 30, i * 30 + 30).map(Number)).get())).then((snaps) => ({ docs: snaps.flatMap((x) => x.docs) })),
    col('conversations').where('owner_id', '==', Number(ownerId)).limit(1000).get(),
  ]);
  const out = new Map(listingIds.map((id) => [Number(id), { saves: 0, chats: 0 }]));
  for (const d of favs.docs) { const s = out.get(Number(d.data().listing_id)); if (s) s.saves += 1; }
  for (const d of threads.docs) { const t = d.data(); const s = out.get(Number(t.listing_id)); if (s && (t.kind || 'listing') === 'listing') s.chats += 1; }
  return out;
}

module.exports = { DAY, PRO_PHOTOS, PRO_LIVE_DAYS, isPro, photoLimit, grant, stats, FieldValue };
