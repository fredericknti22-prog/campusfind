'use strict';
/**
 * Saved-listing alerts: members who saved a listing hear about the changes that matter to a buyer:
 * a lower price (or now free), reserved for someone else, available again, sold or closed.
 * Ordinary edits (typos, photos) do not notify anyone.
 */
const { col } = require('../store');
const { notify } = require('./notify');
const { formatMoney } = require('../lib/validate');

async function savers(listingId) {
  const snap = await col('favorites').where('listing_id', '==', Number(listingId)).limit(1000).get();
  return snap.docs.map((d) => Number(d.data().user_id));
}

function message(l, change, extra = {}) {
  const t = `“${String(l.title).slice(0, 60)}”`;
  switch (change) {
    case 'price-drop': return { title: `Price drop: ${t}`, body: extra.free ? 'It is now free.' : `Now ${formatMoney(extra.now)} (was ${formatMoney(extra.was)}).` };
    case 'reserved': return { title: `${t} is reserved`, body: 'The seller accepted an offer from someone. We will tell you if it becomes available again.' };
    case 'available': return { title: `${t} is available again`, body: 'Message the seller soon if you are still interested.' };
    case 'sold': return { title: `${t} has been sold`, body: 'It is no longer available. Search alerts can tell you when something similar is posted.' };
    case 'closed': return { title: `${t} is no longer available`, body: 'The poster closed this listing.' };
    default: return null;
  }
}

/** Tell everyone who saved the listing (except the owner and anyone in `exclude`). Never throws. */
async function notifyChange(l, change, { exclude = [], ...extra } = {}) {
  try {
    const msg = message(l, change, extra);
    if (!msg) return 0;
    const skip = new Set([Number(l.owner_id), ...exclude.map(Number)]);
    const who = (await savers(l.listing_id)).filter((id) => !skip.has(id));
    let batch = col('notifications').firestore.batch(); let n = 0;
    for (const id of who) {
      await notify(id, { type: 'saved', ...msg, link: `/listings/${l.listing_id}` }, { batch });
      n += 1;
      if (n % 400 === 0) { await batch.commit(); batch = col('notifications').firestore.batch(); }
    }
    if (n % 400) await batch.commit();
    return who.length;
  } catch (err) {
    console.error('[saved] could not notify savers:', err.message);
    return 0;
  }
}

/** Compare prices before and after an edit. Returns notifyChange extras for a drop, or null. */
function priceDrop(before, after) {
  const was = ['fixed', 'negotiable'].includes(before.price_type) ? before.price_cents : null;
  if (after.price_type === 'free' && before.price_type !== 'free') return { free: true };
  const now = ['fixed', 'negotiable'].includes(after.price_type) ? after.price_cents : null;
  if (was != null && now != null && now < was) return { was, now };
  return null;
}

module.exports = { notifyChange, priceDrop, savers };
