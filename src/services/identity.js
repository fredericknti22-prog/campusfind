'use strict';
/**
 * Firebase Authentication password flows via the Identity Toolkit REST API.
 * (The Admin SDK can create users and verify tokens but cannot check a password, so sign-in,
 *  reset emails and reset confirmation use these endpoints with the project's Web API key.)
 * Forgotten-password and resend: Firebase Auth stores the credential and emails the reset link
 * (set the console action URL to <BASE_URL>/reset). No second auth provider (e.g. Supabase).
 */
const config = require('../config');

const base = config.firebase.emulator
  ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}/identitytoolkit.googleapis.com/v1`
  : 'https://identitytoolkit.googleapis.com/v1';

class IdentityError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function call(endpoint, body) {
  let res;
  try {
    res = await fetch(`${base}/${endpoint}?key=${encodeURIComponent(config.firebase.webApiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new IdentityError('NETWORK');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String((json.error && json.error.message) || 'UNKNOWN').split(' : ')[0];
    throw new IdentityError(code);
  }
  return json;
}

/** Resolves { uid } for a correct email/password, throws IdentityError otherwise. */
async function signInWithPassword(email, password) {
  const r = await call('accounts:signInWithPassword', { email, password, returnSecureToken: false });
  return { uid: r.localId };
}

/** Firebase emails the member a reset link that opens <BASE_URL>/reset (also set the console action URL to match). */
function sendPasswordReset(email) {
  const body = { requestType: 'PASSWORD_RESET', email };
  // continueUrl needs an authorized domain; skip on the Auth emulator.
  if (!config.firebase.emulator) {
    body.continueUrl = `${config.baseUrl}/reset`;
    body.canHandleCodeInApp = false;
  }
  return call('accounts:sendOobCode', body);
}

/** Check an oobCode from the reset link. Resolves { email }. */
async function verifyResetCode(oobCode) {
  const r = await call('accounts:resetPassword', { oobCode });
  return { email: String(r.email || '').toLowerCase() };
}

const confirmPasswordReset = (oobCode, newPassword) => call('accounts:resetPassword', { oobCode, newPassword });

/** Exchange a server-made custom token for an ID token (needed to ask for a verification email). */
async function signInWithCustomToken(token) {
  const r = await call('accounts:signInWithCustomToken', { token, returnSecureToken: true });
  return { idToken: r.idToken };
}

/** Firebase emails the member a link to confirm their address (lands on <BASE_URL>/reset?mode=verifyEmail). */
function sendVerifyEmail(idToken) {
  const body = { requestType: 'VERIFY_EMAIL', idToken };
  if (!config.firebase.emulator) {
    body.continueUrl = `${config.baseUrl}/reset`;
    body.canHandleCodeInApp = false;
  }
  return call('accounts:sendOobCode', body);
}

/** Apply the code from a verification link. Resolves { email }. */
async function applyVerifyCode(oobCode) {
  const r = await call('accounts:update', { oobCode });
  return { email: String(r.email || '').toLowerCase() };
}

module.exports = { IdentityError, signInWithPassword, sendPasswordReset, verifyResetCode, confirmPasswordReset, signInWithCustomToken, sendVerifyEmail, applyVerifyCode };
