'use strict';
const express = require('express');
const config = require('../config');
const settings = require('../services/settings');
const turnstile = require('../services/turnstile');
const identity = require('../services/identity');
const users = require('../repo/users');
const { auth } = require('../firebase');
const { col, deleteWhere } = require('../store');
const { audit } = require('../services/audit');
const { notify } = require('../services/notify');
const { AccountError, authenticate, createAccount } = require('../services/auth');
const { clean, checkEmail, checkPassword } = require('../lib/validate');
const { sharedRateLimit } = require('../middleware/sharedLimit');
const { safeNext } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = sharedRateLimit({ name: 'login', windowMs: 15 * 60_000, max: config.limits.loginPer15Min });
const registerLimiter = sharedRateLimit({ name: 'register', windowMs: 60 * 60_000, max: config.limits.registerPerHour, message: 'Too many sign-ups from this network. Try again later.' });
const forgotLimiter = sharedRateLimit({ name: 'forgot', windowMs: 60 * 60_000, max: 6 });

/* ----- sign in ----- */
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { next: safeNext(req.query.next, '') });
});

router.post('/login', loginLimiter, async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const next = safeNext(req.body.next, '/');
  if (!(await turnstile.verify(req, 'login')).ok) return res.status(403).render('login', { email, error: turnstile.MESSAGE, next: req.body.next ? next : '' });
  const result = await authenticate(email, req.body.password, req.ip);
  if (result.error) return res.status(401).render('login', { email, error: result.error, next: req.body.next ? next : '' });
  await req.login(result.user);
  await audit({ actor: result.user, action: 'auth.login', entityType: 'user', entityId: result.user.user_id, ip: req.ip });
  res.redirect(next);
});

router.post('/logout', async (req, res) => {
  if (req.user) await audit({ actor: req.user, action: 'auth.logout', entityType: 'user', entityId: req.user.user_id, ip: req.ip });
  await req.logout();
  res.redirect('/');
});

/* ----- register ----- */
/** Whole years between a YYYY-MM-DD date of birth and today (UTC). Returns null when the date is not a real, plausible date. */
function ageFromDob(dob, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob || '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const born = new Date(Date.UTC(y, mo - 1, d));
  if (born.getUTCFullYear() !== y || born.getUTCMonth() !== mo - 1 || born.getUTCDate() !== d) return null; // e.g. 2010-02-31
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

const underAge = (res) => res.status(403).render('error', {
  status: 403,
  title: 'We cannot create an account for you',
  message: `You must be at least ${config.minAge} years old to join CampusFind. We have not saved the date you entered.`,
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  if (!settings.bool('registration_open')) {
    return res.status(403).render('error', { status: 403, title: 'Sign-ups paused', message: 'New registrations are temporarily closed. Please check back soon.' });
  }
  if (req.ageBlocked()) return underAge(res);
  res.render('register');
});

router.post('/register', registerLimiter, async (req, res) => {
  if (!settings.bool('registration_open')) return res.redirect('/register');
  if (!(await turnstile.verify(req, 'signup')).ok) {
    return res.status(403).render('register', { values: { name: clean(req.body.name), email: clean(req.body.email).toLowerCase() }, errors: { _form: turnstile.MESSAGE } });
  }
  if (req.ageBlocked()) return underAge(res);
  const pad = (n) => String(Number(n) || '').padStart(2, '0');
  const dob = req.body.dob_y || req.body.dob_m || req.body.dob_d ? `${String(Number(req.body.dob_y) || '')}-${pad(req.body.dob_m)}-${pad(req.body.dob_d)}` : clean(req.body.dob);
  const values = { name: clean(req.body.name), email: clean(req.body.email).toLowerCase(), agree: req.body.agree === '1', dob };
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const age = ageFromDob(values.dob);
  // Born in the last few years is a slip (a phone date picker that defaulted to today), not a child: ask again, never block.
  if (age !== null && age < 5) return res.status(400).render('register', { values: { ...values, dob: '' }, errors: { dob: 'That date is too recent. Choose the day, month and year you were born.' } });
  if (age !== null && age < config.minAge) {
    await req.setAgeBlock(Date.now() + 24 * 3600 * 1000); // neutral age screen: remember it for a day, store nothing about the person
    return underAge(res);
  }
  const errors = {};
  if (age === null) errors.dob = 'Enter your date of birth.';
  if (values.name.length < 2 || values.name.length > 60) errors.name = 'Enter your name (2–60 characters).';
  const emailErr = checkEmail(values.email);
  if (emailErr) errors.email = emailErr;
  const pwErr = checkPassword(password, values);
  if (pwErr) errors.password = pwErr;
  if (!values.agree) errors.agree = 'You need to accept the terms and rules to join.';
  if (Object.keys(errors).length) return res.status(400).render('register', { values, errors });

  let user;
  try {
    user = await createAccount({ name: values.name, email: values.email, password, consent: { version: config.legal.version, minAge: config.minAge } });
  } catch (err) {
    if (!(err instanceof AccountError)) throw err;
    const msg = {
      EMAIL_EXISTS: 'An account with this email already exists. Try signing in.',
      WEAK_PASSWORD: 'Choose a stronger password.',
      INVALID_EMAIL: 'Enter a valid email address.',
    }[err.code] || 'We could not create that account.';
    const field = err.code === 'WEAK_PASSWORD' ? 'password' : 'email';
    return res.status(400).render('register', { values, errors: { [field]: msg } });
  }
  await req.login(user);
  await audit({ actor: user, action: 'auth.register', entityType: 'user', entityId: user.user_id, ip: req.ip });
  await notify(user.user_id, { type: 'system', title: 'Welcome to CampusFind', body: 'Please read the community rules before publishing your first listing.', link: '/rules' });
  req.flash('success', 'Your account has been created.');
  res.redirect('/');
});

/* ----- password recovery (Firebase sends the email) ----- */
router.get('/forgot', (req, res) => res.render('forgot', {}));

router.post('/forgot', forgotLimiter, async (req, res) => {
  if (!(await turnstile.verify(req, 'forgot')).ok) { req.flash('error', turnstile.MESSAGE); return res.redirect('/forgot'); }
  const email = clean(req.body.email).toLowerCase();
  const user = await users.getByEmail(email);
  if (user && !user.deleted_at && user.status !== 'banned') {
    try {
      await identity.sendPasswordReset(email);
      await audit({ action: 'auth.reset_requested', entityType: 'user', entityId: user.user_id, ip: req.ip });
    } catch (err) {
      console.error('[auth] could not send reset email:', err.code || err.message);
    }
  }
  // Same response either way: never reveal whether an email is registered.
  res.render('forgot', { sent: true });
});

async function checkResetCode(code) {
  try { return await identity.verifyResetCode(String(code || '').slice(0, 500)); } catch (_) { return null; }
}

router.get('/reset', async (req, res) => {
  const code = String(req.query.oobCode || '');
  if (req.query.mode === 'verifyEmail') {
    const u = code ? await require('../services/verify').apply(code) : null;
    req.flash(u ? 'success' : 'error', u ? 'Your email address is verified. Your profile and listings now show the badge.' : 'That verification link has expired or was already used. Send a new one from your profile.');
    return res.redirect(req.user ? '/profile#verify' : '/login');
  }
  res.render('resetPassword', { token: code, valid: Boolean(code && (await checkResetCode(code))) });
});

router.post('/reset', forgotLimiter, async (req, res) => {
  const code = String(req.body.oobCode || '');
  const info = await checkResetCode(code);
  if (!info) return res.status(400).render('resetPassword', { token: code, valid: false });
  const user = await users.getByEmail(info.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const err = checkPassword(password, { email: info.email, name: user ? user.name : '' });
  if (err) return res.status(400).render('resetPassword', { token: code, valid: true, error: err });
  try {
    await identity.confirmPasswordReset(code, password);
  } catch (_) {
    return res.status(400).render('resetPassword', { token: code, valid: false });
  }
  if (user) {
    await users.update(user.user_id, { failed_logins: 0, locked_until: null });
    await deleteWhere(col('sessions').where('user_id', '==', user.user_id)); // sign out everywhere
    if (user.uid) await auth.revokeRefreshTokens(user.uid).catch(() => {});
    await audit({ action: 'auth.password_reset', entityType: 'user', entityId: user.user_id, ip: req.ip });
  }
  req.flash('success', 'Password updated. Sign in with your new password.');
  res.redirect('/login');
});

/* ----- staff step-up verification ----- */
router.get('/admin/login', (req, res) => {
  res.render('adminLogin', { next: safeNext(req.query.next, '') });
});

router.post('/admin/login', loginLimiter, async (req, res) => {
  const email = req.user ? req.user.email : clean(req.body.email).toLowerCase();
  const next = safeNext(req.body.next, '/admin');
  if (!(await turnstile.verify(req, 'staff-login')).ok) return res.status(403).render('adminLogin', { error: turnstile.MESSAGE, next: req.body.next ? next : '' });
  const result = await authenticate(email, req.body.password, req.ip, { staffOnly: true });
  if (result.error) return res.status(401).render('adminLogin', { error: result.error, next: req.body.next ? next : '' });
  const tf = require('../services/twofactor');
  let usedRecovery = false;
  if (tf.enabled(result.user)) {
    const how = await tf.check(result.user, req.body.code);
    if (!how) {
      await audit({ actor: result.user, action: 'admin.2fa_failed', entityType: 'user', entityId: result.user.user_id, ip: req.ip });
      return res.status(401).render('adminLogin', { error: 'Enter the 6-digit code from your authenticator app, or one of your recovery codes.', next: req.body.next ? next : '' });
    }
    usedRecovery = how === 'recovery';
  }
  if (!req.user || req.user.user_id !== result.user.user_id) await req.login(result.user);
  await req.setAdminUntil(Date.now() + config.session.adminMs);
  await audit({ actor: result.user, action: usedRecovery ? 'admin.verify_recovery' : 'admin.verify', entityType: 'user', entityId: result.user.user_id, ip: req.ip });
  if (usedRecovery) {
    const left = tf.recoveryLeft(await require('../repo/users').getById(result.user.user_id));
    req.flash('error', `You used a recovery code. ${left} left. If you lost your phone, set up two-step sign-in again from Admin › Two-step sign-in.`);
  }
  res.redirect(next);
});

/* ----- staff two-step sign-in setup ----- */
const stepUp = require('../middleware/auth').requireStaff('dashboard', { allowWithout2fa: true });
const tfLimiter = sharedRateLimit({ name: 'tfa', windowMs: 15 * 60_000, max: 10, key: (req) => `tfa:${req.user ? req.user.user_id : req.ip}` });
const noStore = (res) => res.set('Cache-Control', 'no-store');

router.get('/admin/2fa/setup', stepUp, async (req, res) => {
  const tf = require('../services/twofactor');
  noStore(res);
  if (tf.enabled(req.user)) return res.render('twoFactorStatus', { left: tf.recoveryLeft(req.user), enabledAt: req.user.totp_enabled_at });
  const secret = await tf.pendingSecret(req.user);
  const qr = await require('../services/qr').svg(require('../lib/totp').otpauthUrl(secret, req.user.email));
  res.render('twoFactorSetup', { qr, secret });
});

router.post('/admin/2fa/setup', stepUp, tfLimiter, async (req, res) => {
  const tf = require('../services/twofactor');
  noStore(res);
  if (tf.enabled(req.user)) return res.redirect('/admin/2fa/setup');
  const fresh = await require('../repo/users').getById(req.user.user_id);
  const codes = await tf.confirm(fresh, req.body.code);
  if (!codes) {
    const secret = await tf.pendingSecret(fresh);
    const qr = await require('../services/qr').svg(require('../lib/totp').otpauthUrl(secret, req.user.email));
    return res.status(400).render('twoFactorSetup', { qr, secret, error: 'That code did not match. Check the time on your phone is set automatically, then type the newest code.' });
  }
  await audit({ actor: req.user, action: 'admin.2fa_enabled', entityType: 'user', entityId: req.user.user_id, ip: req.ip });
  await require('../services/notify').notify(req.user.user_id, { type: 'system', title: 'Two-step sign-in is on', body: 'Your staff account now needs a code from your authenticator app. If this was not you, contact the platform owner immediately.', link: '/admin/2fa/setup' });
  res.render('twoFactorCodes', { codes, fresh: true });
});

router.post('/admin/2fa/recovery', stepUp, tfLimiter, async (req, res) => {
  const tf = require('../services/twofactor');
  noStore(res);
  const fresh = await require('../repo/users').getById(req.user.user_id);
  if (!tf.enabled(fresh)) return res.redirect('/admin/2fa/setup');
  if ((await tf.check(fresh, req.body.code)) !== 'totp') {
    return res.status(400).render('twoFactorStatus', { left: tf.recoveryLeft(fresh), enabledAt: fresh.totp_enabled_at, error: 'That code did not match. Use the current code from your authenticator app.' });
  }
  const codes = await tf.newRecoveryCodes(fresh);
  await audit({ actor: req.user, action: 'admin.2fa_recovery_codes', entityType: 'user', entityId: req.user.user_id, ip: req.ip });
  res.render('twoFactorCodes', { codes, fresh: false });
});

module.exports = router;
