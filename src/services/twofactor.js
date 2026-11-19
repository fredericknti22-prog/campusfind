'use strict';
/**
 * Two-step sign-in for staff: password plus a 6-digit code from an authenticator app (or a one-time recovery code).
 * Required for every staff account when config.security.staff2fa is on (the default in production).
 * Five wrong codes lock the account for 15 minutes, the same as wrong passwords.
 * Break-glass: set STAFF_2FA_RESET_EMAIL in the hosting environment, open any page once, then remove it.
 */
const config = require('../config');
const users = require('../repo/users');
const totp = require('../lib/totp');

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;
const isStaffRole = (u) => Boolean(u && ['superadmin', 'admin', 'moderator'].includes(u.role));

const required = (u) => Boolean(config.security.staff2fa && isStaffRole(u));
const enabled = (u) => Boolean(u && u.totp_secret);
const recoveryLeft = (u) => (Array.isArray(u && u.totp_recovery) ? u.totp_recovery.length : 0);

/** Check a code for a member with two-step sign-in. Resolves 'totp' | 'recovery' | null (and records failures). */
async function check(u, code) {
  const raw = String(code || '').trim();
  let result = null;
  if (/^[0-9a-f]{5}-?[0-9a-f]{5}$/i.test(raw)) {
    const h = totp.hashCode(raw);
    const list = Array.isArray(u.totp_recovery) ? u.totp_recovery : [];
    if (list.includes(h)) {
      await users.update(u.user_id, { totp_recovery: list.filter((x) => x !== h), totp_failures: 0 });
      result = 'recovery';
    }
  } else {
    const secret = totp.open(u.totp_secret);
    const counter = secret ? totp.verify(secret, raw, { lastCounter: Number(u.totp_last) || -1 }) : null;
    if (counter !== null) {
      await users.update(u.user_id, { totp_last: counter, totp_failures: 0 });
      result = 'totp';
    }
  }
  if (!result) {
    const fails = (Number(u.totp_failures) || 0) + 1;
    await users.update(u.user_id, fails >= MAX_FAILS ? { totp_failures: 0, locked_until: Date.now() + LOCK_MS } : { totp_failures: fails });
  }
  return result;
}

/** The secret being set up (kept, encrypted, until confirmed, so reloading the page shows the same QR code). */
async function pendingSecret(u) {
  const existing = u.totp_pending ? totp.open(u.totp_pending) : null;
  if (existing) return existing;
  const secret = totp.generateSecret();
  await users.update(u.user_id, { totp_pending: totp.seal(secret) });
  return secret;
}

/** Confirm setup with a first code. Resolves the recovery codes to show once, or null if the code is wrong. */
async function confirm(u, code) {
  const secret = u.totp_pending ? totp.open(u.totp_pending) : null;
  const counter = secret ? totp.verify(secret, code) : null;
  if (counter === null) return null;
  const codes = totp.recoveryCodes();
  await users.update(u.user_id, {
    totp_secret: totp.seal(secret), totp_pending: null, totp_last: counter, totp_failures: 0,
    totp_recovery: codes.map(totp.hashCode), totp_enabled_at: Date.now(),
  });
  return codes;
}

async function newRecoveryCodes(u) {
  const codes = totp.recoveryCodes();
  await users.update(u.user_id, { totp_recovery: codes.map(totp.hashCode) });
  return codes;
}

const reset = (userId) => users.update(userId, { totp_secret: null, totp_pending: null, totp_last: null, totp_recovery: null, totp_enabled_at: null, totp_failures: 0 });

let breakGlassDone = false;
/** Emergency reset for a locked-out owner, controlled from the hosting environment. */
async function breakGlass() {
  if (breakGlassDone) return;
  breakGlassDone = true;
  const email = String(process.env.STAFF_2FA_RESET_EMAIL || '').trim().toLowerCase();
  if (!email) return;
  const u = await users.getByEmail(email).catch(() => null);
  if (u && enabled(u)) {
    await reset(u.user_id);
    console.warn(`[2fa] two-step sign-in was reset for ${email} by STAFF_2FA_RESET_EMAIL. Remove that variable now.`);
  }
}

/** Fields that must never leave the server (data exports). */
const SECRET_FIELDS = ['totp_secret', 'totp_pending', 'totp_recovery', 'totp_last', 'totp_failures'];

module.exports = { required, enabled, recoveryLeft, check, pendingSecret, confirm, newRecoveryCodes, reset, breakGlass, SECRET_FIELDS, MAX_FAILS };
