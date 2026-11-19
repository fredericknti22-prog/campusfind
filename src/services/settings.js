'use strict';
/** Platform-wide switches, editable only by a super admin (page: /admin/system). Stored in settings/platform. */
const { col } = require('../store');
const config = require('../config');

const DEFAULTS = {
  registration_open: '1',
  posting_enabled: '1',
  assistant_enabled: '1',
  maintenance_mode: '0',
  announcement: '',
  listings_per_day: String(config.limits.listingsPerDay),
  reports_per_day: String(config.limits.reportsPerDay),
  // Payment and contact details a super admin can set in /admin/system without touching Vercel.
  // Empty means "use the environment variable" (MOMO_NUMBER, MOMO_NAME, MOMO_NETWORK, SUPPORT_EMAIL).
  momo_number: '',
  momo_name: '',
  momo_network: '',
  support_email: '',
};

const TTL = 30_000;
let cache = { ...DEFAULTS };
let loadedAt = 0;

const ref = () => col('settings').doc('platform');

/** Refresh the in-memory copy when stale. Called once per request by the session middleware. */
async function refresh(force = false) {
  if (!force && Date.now() - loadedAt < TTL) return cache;
  const snap = await ref().get();
  cache = { ...DEFAULTS };
  if (snap.exists) {
    const data = snap.data();
    for (const k of Object.keys(DEFAULTS)) if (typeof data[k] === 'string') cache[k] = data[k];
  }
  loadedAt = Date.now();
  return cache;
}

const all = () => ({ ...cache });
const get = (key) => cache[key];
const bool = (key) => cache[key] === '1';
const int = (key) => Number.parseInt(cache[key], 10) || 0;

async function set(key, value, userId) {
  if (!(key in DEFAULTS)) throw new Error(`Unknown setting: ${key}`);
  await ref().set({ [key]: String(value), updated_by: userId || null, updated_at: Date.now() }, { merge: true });
  cache[key] = String(value);
}

/** The Mobile Money account members pay into: admin setting first, then the environment. */
const momo = () => ({
  number: cache.momo_number || config.payments.momo.number,
  name: cache.momo_name || config.payments.momo.name,
  network: cache.momo_network || config.payments.momo.network,
});
/** Public support mailbox: admin setting first, then SUPPORT_EMAIL. Empty means "use the Help centre". */
const supportEmail = () => cache.support_email || config.legal.supportEmail;

module.exports = { refresh, all, get, bool, int, set, momo, supportEmail, DEFAULTS };
