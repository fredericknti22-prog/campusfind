'use strict';
/**
 * Listing freshness: a listing stays live for LIVE_DAYS from when it was published or last renewed.
 * Three days before the end the owner gets one reminder; after that it is closed with outcome 'expired'
 * and the owner can renew it in one tap. Business listings and listings with a running paid promotion never expire.
 * Runs lazily (at most every 10 minutes) when Browse or the home page is opened, because the free hosting plan has no cron.
 */
const listings = require('../repo/listings');
const { col } = require('../store');
const { notify } = require('./notify');
const { isFeaturedNow, promoTierNow } = require('../views/components');

const DAY = 86_400_000;
const LIVE_DAYS = 30;
const REMIND_DAYS = 3;
const RENEW_WINDOW_DAYS = 7; // a live listing can be renewed during its last week

const startOf = (l) => Number(l.renewed_at || l.published_at || l.created_at || 0);
const liveUntil = (l) => startOf(l) + LIVE_DAYS * DAY;
const exempt = (l) => l.cat_slug === 'business' || isFeaturedNow(l) || Boolean(promoTierNow(l));
const isExpired = (l) => l.status === 'closed' && l.outcome === 'expired';
/** Can the owner renew now? Expired listings always; live ones only in their last week. */
const canRenew = (l, now = Date.now()) => isExpired(l) || (l.status === 'active' && !exempt(l) && liveUntil(l) - now <= RENEW_WINDOW_DAYS * DAY);

let lastSweep = 0;
async function sweep({ force = false, now = Date.now() } = {}) {
  if (!force && now - lastSweep < 10 * 60_000) return { expired: 0, reminded: 0 };
  lastSweep = now;
  let expired = 0; let reminded = 0;
  try {
    const snap = await col('listings').where('status', '==', 'active').limit(3000).get();
    const raw = snap.docs.map((d) => d.data()).filter((l) => !l.deleted_at);
    for (const l of await listings.hydrate(raw)) {
      if (exempt(l)) continue;
      const end = liveUntil(l);
      const title = String(l.title).slice(0, 60);
      if (end <= now) {
        await listings.update(l.listing_id, { status: 'closed', outcome: 'expired', expired_at: now, updated_at: now });
        await notify(l.owner_id, {
          type: 'system', title: `“${title}” has expired`,
          body: `Listings stay up for ${LIVE_DAYS} days so Browse only shows things that are still available. If it is, renew it in one tap from My listings.`,
          link: '/my/listings',
        });
        expired += 1;
      } else if (end - now <= REMIND_DAYS * DAY && !(Number(l.reminded_at) >= startOf(l))) {
        await listings.update(l.listing_id, { reminded_at: now });
        await notify(l.owner_id, {
          type: 'system', title: `Is “${title}” still available?`,
          body: `It will be hidden in ${Math.max(1, Math.ceil((end - now) / DAY))} day(s). Renew it from My listings to keep it up for another ${LIVE_DAYS} days, or mark it closed if it has gone.`,
          link: '/my/listings',
        });
        reminded += 1;
      }
    }
    if (expired || reminded) console.log(`[freshness] expired ${expired}, reminded ${reminded}`);
  } catch (err) {
    console.error('[freshness] sweep failed:', err.message);
  }
  return { expired, reminded };
}

module.exports = { LIVE_DAYS, RENEW_WINDOW_DAYS, liveUntil, canRenew, isExpired, exempt, sweep };
