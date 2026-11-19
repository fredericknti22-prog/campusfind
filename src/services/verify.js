'use strict';
/**
 * Verified members. Firebase Authentication sends and checks the verification email (no email service of our own):
 *   1. the server signs in as the member with a short-lived custom token and asks Firebase to email a VERIFY_EMAIL link;
 *   2. the link lands on <BASE_URL>/reset (the project's action URL) with mode=verifyEmail, or on Firebase's own page;
 *   3. either way we read the result back from Firebase and stamp users.email_verified_at.
 * A verified address on a university domain (*.edu.gh, plus STUDENT_DOMAINS) earns the "Verified student" badge.
 */
const { auth } = require('../firebase');
const users = require('../repo/users');
const identity = require('./identity');

const { isStudentEmail, level } = require('../lib/trust');

const RESEND_MS = 2 * 60_000;


async function mark(u) {
  if (u.email_verified_at) return u;
  const at = Date.now();
  await users.update(u.user_id, { email_verified_at: at });
  return { ...u, email_verified_at: at };
}

/** Ask Firebase whether the member has confirmed their address (covers links opened on Firebase's own page). */
async function refresh(u) {
  if (!u || u.email_verified_at || !u.uid) return u;
  try {
    const rec = await auth.getUser(u.uid);
    return rec.emailVerified ? mark(u) : u;
  } catch (err) {
    return u;
  }
}

/** Email a verification link. Resolves 'sent' | 'already' | 'wait'. Throws identity.IdentityError on Firebase errors. */
async function send(u) {
  const fresh = await refresh(u);
  if (fresh.email_verified_at) return 'already';
  if (u.verify_sent_at && Date.now() - u.verify_sent_at < RESEND_MS) return 'wait';
  const token = await auth.createCustomToken(u.uid);
  const { idToken } = await identity.signInWithCustomToken(token);
  await identity.sendVerifyEmail(idToken);
  await users.update(u.user_id, { verify_sent_at: Date.now() });
  return 'sent';
}

/** Apply the code from a verification link. Resolves the verified member, or null if the code is bad or used. */
async function apply(oobCode) {
  try {
    const { email } = await identity.applyVerifyCode(oobCode);
    const u = email ? await users.getByEmail(email) : null;
    return u ? mark(u) : null;
  } catch (err) {
    return null;
  }
}

module.exports = { isStudentEmail, level, refresh, send, apply, RESEND_MS };
