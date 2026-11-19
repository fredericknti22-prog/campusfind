'use strict';
/**
 * Marketplace health for the admin overview: is CampusFind producing conversations and deals?
 * Read from chat thread summaries and the audit log (no message text). Campus scale: scans at most a few thousand docs.
 */
const { col } = require('../store');

const DAY = 86_400_000;

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function humanDuration(ms) {
  if (ms === null) return '—';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

async function summary(days = 30, now = Date.now()) {
  const since = now - days * DAY;
  const [threadSnap, logSnap, listingSnap] = await Promise.all([
    col('conversations').where('created_at', '>', since).limit(5000).get(),
    col('activity_logs').where('created_at', '>', since).limit(10000).get(),
    col('listings').where('published_at', '>', since).limit(3000).get(),
  ]);
  const threads = threadSnap.docs.map((d) => d.data()).filter((t) => (t.kind || 'listing') === 'listing');
  const answered = threads.filter((t) => t.first_reply_at);
  const counts = {};
  for (const d of logSnap.docs) { const a = d.data().action; counts[a] = (counts[a] || 0) + 1; }
  const published = listingSnap.docs.map((d) => d.data()).filter((l) => !l.deleted_at);
  const asked = new Set(threads.map((t) => Number(t.listing_id)));
  const withInterest = published.filter((l) => asked.has(Number(l.listing_id))).length;

  const offers = counts['offer.create'] || 0;
  const accepted = counts['offer.accepted'] || 0;
  return {
    days,
    chats: threads.length,
    replyRate: threads.length ? Math.round((answered.length / threads.length) * 100) : null,
    medianReply: humanDuration(median(answered.map((t) => t.first_reply_at - t.created_at))),
    offers, accepted,
    acceptRate: offers ? Math.round((accepted / offers) * 100) : null,
    deals: counts['listing.sold'] || 0,
    returned: counts['listing.returned'] || 0,
    published: published.length,
    interestRate: published.length ? Math.round((withInterest / published.length) * 100) : null,
  };
}

module.exports = { summary, median, humanDuration };
