'use strict';
/**
 * Cloudflare Turnstile bot check on the forms bots target (sign-up, sign-in, password reset, reports, staff sign-in).
 * Off until TURNSTILE_SITE_KEY, TURNSTILE_SECRET and TURNSTILE_HOSTNAMES are all set; then every protected POST must
 * carry a token that Cloudflare's siteverify accepts for the expected action and an approved hostname.
 * Fails closed: if siteverify cannot be reached or answers oddly, the request is refused.
 * The browser never talks to siteverify; only this server does.
 */
const config = require('../config');

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const ACTION = /^[A-Za-z0-9_-]{1,32}$/;
let fetchImpl = (...args) => fetch(...args); // replaceable in tests

const settings = () => config.turnstile;
const enabled = () => Boolean(settings().siteKey && settings().secret && settings().hostnames.length);

/** Returns { ok: true } or { ok: false, reason } for a protected POST. */
async function verify(req, action) {
  if (!enabled()) return { ok: true, skipped: true };
  if (!ACTION.test(action)) throw new Error(`invalid Turnstile action ${action}`);
  const token = req.body && req.body['cf-turnstile-response'];
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return { ok: false, reason: 'missing-token' };
  let result;
  try {
    const r = await fetchImpl(SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret: settings().secret, response: token, remoteip: req.ip || '' }),
    });
    if (!r.ok) throw new Error(`siteverify ${r.status}`);
    result = await r.json();
  } catch (err) {
    console.error('[turnstile] siteverify unavailable:', err.message);
    return { ok: false, reason: 'unavailable' };
  }
  if (!result || result.success !== true) return { ok: false, reason: 'rejected' };
  if (result.action !== action) return { ok: false, reason: 'wrong-action' };
  if (!settings().hostnames.includes(result.hostname)) return { ok: false, reason: 'wrong-hostname' };
  return { ok: true };
}

const MESSAGE = 'Please complete the security check and try again.';

module.exports = { enabled, verify, MESSAGE, siteKey: () => settings().siteKey, _setFetch: (fn) => { fetchImpl = fn; } };
