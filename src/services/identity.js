'use strict';
/**
 * Firebase Authentication password flows via the Identity Toolkit REST API.
 * (The Admin SDK can create users and verify tokens but cannot check a password, so sign-in,
 *  reset emails and reset confirmation use these endpoints with the project's Web API key.)
 * Firebase stores and hashes credentials and sends the password-reset email itself.
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

/** Firebase emails the member a reset link (action URL is set in the console to <BASE_URL>/reset). */
const sendPasswordReset = (email) => call('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email });

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

/** Firebase emails the member a link to confirm their address. */
const sendVerifyEmail = (idToken) => call('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken });

/** Apply the code from a verification link. Resolves { email }. */
async function applyVerifyCode(oobCode) {
  const r = await call('accounts:update', { oobCode });
  return { email: String(r.email || '').toLowerCase() };
}

module.exports = { IdentityError, signInWithPassword, sendPasswordReset, verifyResetCode, confirmPasswordReset, signInWithCustomToken, sendVerifyEmail, applyVerifyCode };
