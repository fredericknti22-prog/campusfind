'use strict';
/**
 * Accounts and credentials.
 * Credentials live in Firebase Authentication (hashed by Google, never stored by this app).
 * The Firestore users/{id} document holds role, status and profile and links to Auth through `uid`.
 */
const crypto = require('crypto');
const { auth, adminReady } = require('../firebase');
const config = require('../config');
const users = require('../repo/users');
const identity = require('./identity');
const { audit } = require('./audit');
const { notify } = require('./notify');
const { checkEmail } = require('../lib/validate');

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

class AccountError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** Create the Firebase Auth user and the matching profile document. */
async function createAccount({ name, email, password, role = 'student', consent = null }) {
  let uid;
  try {
    if (adminReady) {
      const record = await auth.createUser({ email, password, displayName: name, emailVerified: false });
      uid = record.uid;
    } else {
      uid = (await identity.signUp(email, password, name)).uid;
    }
  } catch (err) {
    if (err.code === 'auth/email-already-exists' || err.code === 'EMAIL_EXISTS') throw new AccountError('EMAIL_EXISTS');
    if (err.code === 'auth/invalid-password' || err.code === 'WEAK_PASSWORD') throw new AccountError('WEAK_PASSWORD');
    if (err.code === 'auth/invalid-email' || err.code === 'INVALID_EMAIL') throw new AccountError('INVALID_EMAIL');
    throw err;
  }
  try {
    return await users.create({ uid, name, email, role, consent });
  } catch (err) {
    if (adminReady) await auth.deleteUser(uid).catch(() => {}); // do not leave an orphaned credential behind
    throw err;
  }
}

/**
 * Verify credentials with lockout. Returns { user } or { error }.
 * The password is always checked against Firebase (even for unknown emails) so timing does not reveal
 * which addresses exist. Banned or suspended members are told why only after a correct password.
 */
async function authenticate(email, password, ip, { staffOnly = false } = {}) {
  const generic = 'Incorrect email or password.';
  // Malformed input never reaches Firestore or Firebase Auth: it cannot match an account, and passing it on would
  // let anyone make the identity service do work (found by an OWASP ZAP active scan on /login).
  if (checkEmail(email) || typeof password !== 'string' || !password || password.length > 1024) {
    await audit({ action: 'auth.login_failed', entityType: 'user', entityId: null, ip, meta: { reason: 'malformed' } });
    return { error: generic };
  }
  const user = await users.getByEmail(email);
  const now = Date.now();

  if (user && !user.deleted_at && user.locked_until && user.locked_until > now) {
    const mins = Math.ceil((user.locked_until - now) / 60000);
    await audit({ action: 'auth.login_blocked', entityType: 'user', entityId: user.user_id, ip });
    return { error: `Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.` };
  }

  let uid = null;
  try {
    uid = (await identity.signInWithPassword(email, String(password || ''))).uid;
  } catch (err) {
    if (err.code === 'TOO_MANY_ATTEMPTS_TRY_LATER') return { error: 'Too many failed attempts. Please wait a few minutes and try again.' };
    if (err.code === 'NETWORK') return { error: 'Sign-in is temporarily unavailable. Please try again shortly.' };
    // any other code (wrong password, unknown email, disabled) is treated as a failed attempt
  }

  const valid = Boolean(uid && user && !user.deleted_at && user.uid === uid);
  if (!valid) {
    if (user && !user.deleted_at) {
      const fails = (user.failed_logins || 0) + 1;
      if (fails >= MAX_FAILS) {
        await users.update(user.user_id, { failed_logins: 0, locked_until: now + LOCK_MS });
        await audit({ action: 'auth.account_locked', entityType: 'user', entityId: user.user_id, ip });
      } else {
        await users.update(user.user_id, { failed_logins: fails });
      }
    }
    await audit({ action: 'auth.login_failed', entityType: 'user', entityId: user ? user.user_id : null, ip });
    return { error: generic };
  }

  if (staffOnly && !['superadmin', 'admin', 'moderator'].includes(user.role)) {
    await audit({ actor: user, action: 'admin.denied', entityType: 'user', entityId: user.user_id, ip });
    return { error: generic };
  }

  if (user.status === 'suspended' && user.status_until && user.status_until <= now) {
    await users.update(user.user_id, { status: 'active', status_reason: null, status_until: null });
    user.status = 'active';
  }
  if (user.status === 'banned') return { error: `This account has been banned.${user.status_reason ? ' Reason: ' + user.status_reason : ''}` };
  if (user.status === 'suspended') {
    const until = user.status_until ? ` until ${new Date(user.status_until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
    return { error: `This account is suspended${until}.${user.status_reason ? ' Reason: ' + user.status_reason : ''}` };
  }
  return { user };
}

/** Change a password in Firebase Auth and sign the member out everywhere else. */
async function setPassword(user, newPassword) {
  await auth.updateUser(user.uid, { password: newPassword });
  await auth.revokeRefreshTokens(user.uid);
}

/** Remove the credential so the address can never sign in again (account deletion). */
async function removeCredential(user) {
  try { await auth.deleteUser(user.uid); } catch (err) { if (err.code !== 'auth/user-not-found') throw err; }
}

/** Create the first super admin on an empty project. */
/**
 * Owner handover: when SUPERADMIN_EMAIL is set, the account already registered with that email becomes a super admin
 * at start-up. It never creates an account, does nothing if the account is missing or deleted, runs at most once per
 * account (it skips anyone already a super admin), and is written to the audit log. Remove the variable afterwards.
 */
async function promoteConfiguredOwner() {
  const email = String(process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) return null;
  const u = await users.getByEmail(email);
  if (!u || u.deleted_at) { console.log(`[auth] SUPERADMIN_EMAIL ${email}: no registered account, nothing changed.`); return null; }
  if (u.role === 'superadmin') { console.log(`[auth] SUPERADMIN_EMAIL ${email}: already a super admin.`); return null; }
  await users.update(u.user_id, { role: 'superadmin' });
  users.forget(u.user_id);
  await audit({ action: 'user.role_change', entityType: 'user', entityId: u.user_id, meta: { from: u.role, to: 'superadmin', via: 'SUPERADMIN_EMAIL' } });
  await notify(u.user_id, { type: 'system', title: 'You are now a super admin', body: 'You can manage CampusFind from the Admin area. Staff re-enter their password to open it.', link: '/admin' });
  console.log(`[auth] ${email} promoted to super admin (SUPERADMIN_EMAIL).`);
  return u.user_id;
}

async function bootstrapSuperAdmin() {
  if ((await users.countByRole('superadmin')) > 0) return;
  const email = config.bootstrapAdmin.email || 'admin@campusfind.local';
  const generated = !config.bootstrapAdmin.password;
  const password = config.bootstrapAdmin.password || crypto.randomBytes(12).toString('base64url');
  let doc;
  try {
    doc = await createAccount({ name: config.bootstrapAdmin.name, email, password, role: 'superadmin' });
  } catch (err) {
    if (err.code !== 'EMAIL_EXISTS') throw err;
    // The email already exists in Firebase Auth: link it, promoting it if it already has a profile document.
    const existing = await users.getByEmail(email);
    if (existing) {
      await users.update(existing.user_id, { role: 'superadmin' });
      await audit({ action: 'system.bootstrap_promote', entityType: 'user', entityId: existing.user_id });
      return;
    }
    let uid = null;
    if (adminReady) {
      uid = (await auth.getUserByEmail(email)).uid;
    } else if (!generated) {
      // Without Admin SDK we can only recover the uid by signing in with ADMIN_PASSWORD.
      try { uid = (await identity.signInWithPassword(email, password)).uid; } catch (_) { /* wrong password */ }
    }
    if (!uid) {
      console.warn(`[auth] ${email} exists in Firebase Auth but cannot be linked without FIREBASE_SERVICE_ACCOUNT (or ADMIN_PASSWORD matching that account).`);
      return;
    }
    doc = await users.create({ uid, name: config.bootstrapAdmin.name, email, role: 'superadmin' });
    console.log(`Linked existing Firebase Auth user ${email} as super admin (password unchanged).`);
    await audit({ action: 'system.bootstrap_superadmin', entityType: 'user', entityId: doc.user_id });
    return;
  }
  await audit({ action: 'system.bootstrap_superadmin', entityType: 'user', entityId: doc.user_id });
  await notify(doc.user_id, { type: 'system', title: 'Welcome, super admin', body: 'Open the Super admin page to review platform settings and add staff accounts.', link: '/admin/system' });
  console.log('\n==================== CampusFind first run ====================');
  console.log(' Super admin account created');
  console.log(`   Email:    ${email}`);
  if (!generated) console.log('   Password: taken from ADMIN_PASSWORD');
  else if (config.isProd) console.log('   Password: not shown. Open /forgot, enter this email and use the reset link to choose your own password.');
  else console.log(`   Password: ${password}   (shown once - change it after signing in)`);
  console.log('=============================================================\n');
}

module.exports = { promoteConfiguredOwner, AccountError, createAccount, authenticate, setPassword, removeCredential, bootstrapSuperAdmin };
