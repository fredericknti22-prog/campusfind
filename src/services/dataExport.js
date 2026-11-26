'use strict';
/**
 * "Download my data": a member's own data as one JSON file (access and portability rights,
 * Data Protection Act 2012 (Act 843) and the Privacy policy).
 *
 * Built from allowlists, so new internal fields (security counters, moderation scores,
 * other members' details) never leak into an export by accident.
 */
const { col, getMany } = require('../store');
const listings = require('../repo/listings');
const messages = require('../repo/messages');
const reviews = require('../repo/reviews');
const alerts = require('../repo/alerts');
const favorites = require('../repo/favorites');
const orders = require('../repo/orders');
const reports = require('../repo/reports');
const assistant = require('./assistant');

const FORMAT = 'campusfind-export/1';
const iso = (ms) => (typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : null);
const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
};
const DATE_KEYS = /(_at|_until)$/;
/** Convert epoch-ms timestamps to ISO strings so the file is readable without code. */
function dates(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = DATE_KEYS.test(k) && typeof v === 'number' ? iso(v) : v;
  return out;
}

function account(u) {
  const p = u.profile || {};
  return dates({
    ...pick(u, ['user_id', 'name', 'email', 'role', 'status', 'created_at', 'last_login_at', 'email_verified_at',
      'terms_version', 'terms_accepted_at', 'age_confirmed_at', 'min_age_confirmed', 'warnings']),
    two_step_sign_in: Boolean(u.totp_secret),
    profile: pick(p, ['bio', 'program', 'study_year', 'show_program']),
  });
}

const LISTING_KEYS = ['listing_id', 'kind', 'title', 'description', 'category_id', 'price_cents', 'currency', 'condition',
  'location', 'contact', 'status', 'views', 'is_featured', 'featured_until', 'created_at', 'updated_at', 'published_at',
  'expires_at', 'sold_at', 'deleted_at', 'awaiting_payment'];
const listing = (l) => dates({ ...pick(l, LISTING_KEYS), photos: (l.images || []).map((im) => im.filename).filter(Boolean) });

/** Conversations: your messages and the other side's, but only names and text, never their account details. */
async function conversations(userId) {
  const threads = await messages.listFor(userId, 300, { includeSupport: true });
  const others = await getMany('users', [...new Set(threads.map((t) => t.other_id).filter((x) => x !== null && x !== undefined).map(String))]);
  const out = [];
  for (const t of threads) {
    const msgs = await messages.messagesOf(t.id, 1000);
    out.push({
      kind: t.kind || 'listing',
      listing_id: t.listing_id || null,
      listing_title: t.listing_title || '',
      with: t.kind === 'support' ? 'CampusFind support' : ((others.get(String(t.other_id)) || {}).name || 'Deleted user'),
      started_at: iso(t.created_at),
      messages: msgs.map((m) => ({
        from: Number(m.sender_id) === Number(userId) ? 'you' : (t.kind === 'support' ? 'support' : 'them'),
        text: m.body || '',
        ...(m.offer ? { offer: pick(m.offer, ['amount_cents', 'status']) } : {}),
        sent_at: iso(m.created_at),
      })),
    });
  }
  return out;
}

async function build(user) {
  const id = Number(user.user_id);
  const [mine, convo, aboutMe, written, myAlerts, saved, myOrders, myReports, notes, chat] = await Promise.all([
    listings.byOwner(id),
    conversations(id),
    reviews.forSeller(id, 300),
    col('reviews').where('reviewer_id', '==', id).limit(300).get().then((s) => s.docs.map((d) => d.data())),
    alerts.byUser(id),
    favorites.listingIds(id),
    orders.byUser(id, 300),
    reports.byReporter(id),
    col('notifications').where('user_id', '==', id).limit(500).get().then((s) => s.docs.map((d) => d.data())),
    assistant.history(id),
  ]);
  return {
    format: FORMAT,
    generated_at: new Date().toISOString(),
    about: 'Your personal data held by CampusFind. Other members appear only by name. Passwords are held by Firebase Authentication and are never stored or exported.',
    account: account(user),
    listings: mine.map(listing),
    conversations: convo,
    reviews_about_you: aboutMe.map((r) => dates(pick(r, ['rating', 'body', 'created_at', 'updated_at']))),
    reviews_you_wrote: written.map((r) => dates(pick(r, ['seller_id', 'rating', 'body', 'created_at', 'updated_at']))),
    search_alerts: myAlerts.map((a) => dates(pick(a, ['q', 'category', 'price_max_cents', 'created_at']))),
    saved_listing_ids: saved,
    orders: myOrders.map((o) => dates(pick(o, ['order_id', 'product', 'listing_id', 'amount_cents', 'currency', 'status', 'reference', 'created_at', 'paid_at']))),
    reports_you_made: myReports.map((r) => dates(pick(r, ['target_type', 'target_id', 'reason', 'details', 'status', 'created_at']))),
    notifications: notes.map((n) => dates(pick(n, ['type', 'title', 'body', 'link', 'is_read', 'created_at']))),
    assistant_chat: chat.map((m) => pick(m, ['role', 'content'])).filter((m) => typeof m.content === 'string'),
  };
}

const filename = (user) => `campusfind-data-${Number(user.user_id)}-${new Date().toISOString().slice(0, 10)}.json`;

module.exports = { build, filename, FORMAT };
