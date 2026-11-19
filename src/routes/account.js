'use strict';
const express = require('express');
const config = require('../config');
const settings = require('../services/settings');
const identity = require('../services/identity');
const images = require('../services/images');
const messages = require('../repo/messages');
const users = require('../repo/users');
const listings = require('../repo/listings');
const reports = require('../repo/reports');
const { col, db, deleteWhere } = require('../store');
const { audit } = require('../services/audit');
const notifications = require('../services/notify');
const { setPassword, removeCredential } = require('../services/auth');
const { clean, checkPassword, intOrNull } = require('../lib/validate');
const { requireLogin, requireActive } = require('../middleware/auth');
const { REASONS } = require('../views/pages/account');

const router = express.Router();

const profileView = (u) => ({ name: u.name, bio: '', program: '', study_year: '', show_program: 1, ...(u.profile || {}) });

/** Verify the member's current password against Firebase Auth. */
async function passwordMatches(user, password) {
  try {
    const r = await identity.signInWithPassword(user.email, String(password || ''));
    return r.uid === user.uid;
  } catch (_) {
    return false;
  }
}

/* ----------------------------------------------------------- profile */
router.get('/profile', requireLogin, async (req, res) => {
  req.user = await require('../services/verify').refresh(req.user);
  const blockedIds = require('../services/blocks').list(req.user);
  const blockedMap = blockedIds.length ? await require('../store').getMany('users', blockedIds) : new Map();
  res.render('profile', {
    p: profileView(req.user), sessions: await require('../services/devices').list(req.user.user_id, req.session.session_hash),
    blocked: blockedIds.map((id) => ({ user_id: id, name: (blockedMap.get(String(id)) || {}).name || 'Deleted user' })),
  });
});

router.post('/profile/sessions/others', requireLogin, async (req, res) => {
  await deleteWhere(col('sessions').where('user_id', '==', req.user.user_id), { except: req.session.session_hash });
  await audit({ actor: req.user, action: 'auth.sessions_revoked', entityType: 'user', entityId: req.user.user_id, ip: req.ip });
  req.flash('success', 'Signed out of every other device. Only this one is still signed in.');
  res.redirect('/profile#devices');
});

router.post('/profile/sessions/:id/revoke', requireLogin, async (req, res) => {
  const devices = require('../services/devices');
  const id = /^[0-9a-f]{16}$/.test(req.params.id) ? req.params.id : '';
  if (id && id === devices.publicId(req.session.session_hash)) {
    req.flash('error', 'That is the device you are using. Use Sign out in the menu instead.');
    return res.redirect('/profile#devices');
  }
  const ok = id ? await devices.revoke(req.user.user_id, id) : false;
  if (ok) await audit({ actor: req.user, action: 'auth.session_revoked', entityType: 'user', entityId: req.user.user_id, ip: req.ip });
  req.flash(ok ? 'success' : 'error', ok ? 'That device was signed out.' : 'That session had already ended.');
  res.redirect('/profile#devices');
});

router.get('/push/key', requireLogin, async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ key: await require('../services/push').publicKey() });
});

router.post('/push/subscribe', requireLogin, async (req, res) => {
  const ok = await require('../services/push').subscribe(req.user.user_id, req.body.subscription, req.get('user-agent'));
  if (ok) await audit({ actor: req.user, action: 'push.subscribe', entityType: 'user', entityId: req.user.user_id, ip: req.ip });
  res.status(ok ? 200 : 400).json({ ok });
});

router.post('/push/unsubscribe', requireLogin, async (req, res) => {
  await require('../services/push').unsubscribe(req.user.user_id, req.body.subscription);
  res.json({ ok: true });
});

router.post('/profile/verify', requireLogin, async (req, res) => {
  const verify = require('../services/verify');
  try {
    const r = await verify.send(req.user);
    if (r === 'already') req.flash('success', 'Your email address is already verified.');
    else if (r === 'wait') req.flash('error', 'We sent a link a moment ago. Check your inbox and spam folder, or try again in two minutes.');
    else req.flash('success', `We sent a verification link to ${req.user.email}. Open it, then come back here.`);
  } catch (err) {
    console.error('[verify] could not send:', err.code || err.message);
    req.flash('error', 'We could not send the email just now. Please try again later.');
  }
  res.redirect('/profile#verify');
});

router.post('/profile', requireLogin, async (req, res) => {
  const v = {
    name: clean(req.body.name), program: clean(req.body.program), study_year: clean(req.body.study_year),
    bio: clean(req.body.bio, { multiline: true }), show_program: req.body.show_program === '1' ? 1 : 0,
  };
  const errors = {};
  if (v.name.length < 2 || v.name.length > 60) errors.name = 'Enter your name (2–60 characters).';
  if (v.program.length > 80) errors.program = 'Keep it under 80 characters.';
  if (v.study_year.length > 20) errors._form = 'Year of study is too long.';
  if (v.bio.length > 300) errors.bio = 'Keep your bio under 300 characters.';
  if (Object.keys(errors).length) return res.status(400).render('profile', { p: { ...v }, errors });
  await users.update(req.user.user_id, {
    name: v.name,
    'profile.program': v.program, 'profile.study_year': v.study_year, 'profile.bio': v.bio,
    'profile.show_program': v.show_program, 'profile.updated_at': Date.now(),
  });
  await audit({ actor: req.user, action: 'profile.update', entityType: 'user', entityId: req.user.user_id, ip: req.ip });
  req.flash('success', 'Profile saved.');
  res.redirect('/profile');
});

router.post('/profile/password', requireLogin, async (req, res) => {
  const renderErr = (pwError) => res.status(400).render('profile', { p: profileView(req.user), pwError });
  if (!(await passwordMatches(req.user, req.body.current_password))) return renderErr('Your current password is not correct.');
  const err = checkPassword(String(req.body.new_password || ''), { email: req.user.email, name: req.user.name });
  if (err) return renderErr(err);
  await setPassword(req.user, req.body.new_password);
  await deleteWhere(col('sessions').where('user_id', '==', req.user.user_id), { except: req.session.session_hash });
  await audit({ actor: req.user, action: 'auth.password_change', entityType: 'user', entityId: req.user.user_id, ip: req.ip });
  req.flash('success', 'Password changed. Other devices were signed out.');
  res.redirect('/profile');
});

router.post('/profile/delete', requireLogin, async (req, res) => {
  const me = req.user;
  if (me.role !== 'student') {
    req.flash('error', 'Staff accounts must be demoted by a super admin before they can be deleted.');
    return res.redirect('/profile');
  }
  if (!(await passwordMatches(me, req.body.password))) {
    req.flash('error', 'Password did not match, so nothing was deleted.');
    return res.redirect('/profile');
  }
  const now = Date.now();
  const mine = (await listings.byOwner(me.user_id)).filter((l) => !l.deleted_at);
  const files = mine.flatMap((l) => (l.images || []).map((im) => im.filename));
  for (const l of mine) {
    await listings.update(l.listing_id, { deleted_at: now, status: 'removed', contact: '', updated_at: now, images: [], cover: null });
  }
  await Promise.all(files.map((f) => images.remove(f)));
  await deleteWhere(col('notifications').where('user_id', '==', me.user_id));
  await deleteWhere(col('sessions').where('user_id', '==', me.user_id));
  await messages.deleteForUser(me.user_id);
  await require('../repo/reviews').deleteForUser(me.user_id);
  await require('../repo/alerts').deleteForUser(me.user_id);
  await require('../repo/favorites').deleteForUser(me.user_id);
  await require('../services/push').deleteForUser(me.user_id);
  await require('../services/assistant').resetHistory(me.user_id);
  await removeCredential(me);
  await users.update(me.user_id, {
    name: 'Deleted user', email: `deleted-${me.user_id}@deleted.invalid`, uid: null, deleted_at: now,
    profile: { bio: '', program: '', study_year: '', show_program: 0, updated_at: now },
  });
  await audit({ action: 'account.delete', entityType: 'user', entityId: me.user_id, ip: req.ip });
  await req.logout();
  res.redirect('/');
});

/* ------------------------------------------------------ public profile */
router.get('/users/:id', async (req, res) => {
  if (!config.publicBrowsing && !req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  const id = /^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : null;
  const person = id ? await users.getById(id) : null;
  if (!person || person.deleted_at || person.status === 'banned') {
    return res.status(404).render('error', { status: 404, title: 'Member not found', message: 'This profile is not available.' });
  }
  const items = (await listings.activeSnapshot()).filter((l) => l.owner_id === id).slice(0, 24);
  const reviewsRepo = require('../repo/reviews');
  const list = await reviewsRepo.forSeller(id);
  const authors = await require('../store').getMany('users', list.map((r) => r.reviewer_id));
  const myReview = req.user && req.user.user_id !== id ? await reviewsRepo.mine(req.user.user_id, id) : null;
  const eligible = req.user && req.user.user_id !== id ? await require('./reviews').canReview(req.user.user_id, id) : false;
  res.render('publicProfile', {
    reviews: list.map((r) => ({ ...r, author: authors.get(String(r.reviewer_id)) || null })),
    rating: list.length ? { avg: Math.round((list.reduce((n, r) => n + r.rating, 0) / list.length) * 10) / 10, count: list.length } : { avg: 0, count: 0 },
    sold: (await listings.byOwner(id)).filter((l) => l.outcome === 'sold' && !l.deleted_at).length,
    myReview, eligible, iBlocked: require('../services/blocks').hasBlocked(req.user, person),
    person, p: profileView(person), items,
    joined: new Date(person.created_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
  });
});

/* ------------------------------------------------------- notifications */
router.get('/notifications', requireLogin, async (req, res) => {
  res.render('notifications', { items: await notifications.list(req.user.user_id) });
});
router.post('/notifications/read', requireLogin, async (req, res) => {
  await notifications.markAllRead(req.user.user_id);
  res.redirect('/notifications');
});

/* ------------------------------------------------------------- reports */
/**
 * A reported chat message, checked on the server: the reporter must be in the conversation and the message must
 * come from the member being reported. Only this one message is attached to the report; the rest of the chat stays private.
 */
async function reportedMessage(ref, reporterId, reportedId) {
  const m = /^([\w-]{1,40})~([\w-]{1,40})$/.exec(String(ref || ''));
  if (!m) return null;
  const thread = await require('../repo/messages').get(m[1], reporterId);
  if (!thread || thread.kind === 'support') return null;
  const snap = await col('conversations').doc(m[1]).collection('messages').doc(m[2]).get();
  const msg = snap.exists ? snap.data() : null;
  if (!msg || msg.sender_id !== reportedId) return null;
  return { cid: m[1], message_id: m[2], body: String(msg.body).slice(0, 1000), sent_at: msg.created_at, flags: msg.flags || [] };
}

async function reportTarget(type, id) {
  if (type === 'listing') {
    const l = await listings.get(id);
    return l && !l.deleted_at ? { owner: l.owner_id, title: l.title, back: `/listings/${l.listing_id}` } : null;
  }
  if (type === 'user') {
    const u = await users.getById(id);
    return u && !u.deleted_at ? { owner: u.user_id, title: u.name, back: `/users/${u.user_id}` } : null;
  }
  return null;
}

router.post('/users/:id/block', requireLogin, async (req, res) => {
  const id = intOrNull(req.params.id);
  const person = id ? await users.getById(id) : null;
  if (!person || person.deleted_at || id === req.user.user_id) return res.redirect('/');
  if (['superadmin', 'admin', 'moderator'].includes(person.role)) {
    req.flash('error', 'Staff accounts cannot be blocked. If a staff member is behaving badly, report it.');
    return res.redirect(`/users/${id}`);
  }
  const r = await require('../services/blocks').block(req.user, id);
  if (r === 'max') { req.flash('error', 'You have blocked the maximum number of members. Unblock someone first.'); return res.redirect('/profile#blocked'); }
  await audit({ actor: req.user, action: 'user.block', entityType: 'user', entityId: id, ip: req.ip });
  require('../repo/listings').invalidate();
  req.flash('success', `${person.name} is blocked. They cannot message you and you will not see their listings. They are not told. You can still report them.`);
  res.redirect(req.body.back === 'chat' && /^[\w-]{1,40}$/.test(String(req.body.cid || '')) ? `/messages/${req.body.cid}` : `/users/${id}`);
});

router.post('/users/:id/unblock', requireLogin, async (req, res) => {
  const id = intOrNull(req.params.id);
  if (!id) return res.redirect('/profile');
  await require('../services/blocks').unblock(req.user, id);
  await audit({ actor: req.user, action: 'user.unblock', entityType: 'user', entityId: id, ip: req.ip });
  req.flash('success', 'Unblocked.');
  res.redirect(req.body.back === 'profile' ? '/profile#blocked' : `/users/${id}`);
});

router.get('/report', requireLogin, async (req, res) => {
  const type = req.query.type === 'user' ? 'user' : 'listing';
  const id = intOrNull(req.query.id);
  const t = id && (await reportTarget(type, id));
  if (!t) return res.status(404).render('error', { status: 404, title: 'Nothing to report', message: 'That item no longer exists.' });
  if (t.owner === req.user.user_id) {
    req.flash('info', 'You cannot report your own content.');
    return res.redirect(t.back);
  }
  let values = {};
  if (type === 'user' && req.query.review) {
    const rv = await require('../repo/reviews').get(String(req.query.review));
    if (rv && rv.reviewer_id === id && rv.status === 'visible') {
      values = { details: `About their ${rv.rating}-star review on member #${rv.seller_id}'s profile: "${String(rv.body || '(no comment)').slice(0, 400)}"` };
    }
  }
  const evidence = type === 'user' && req.query.msg ? await reportedMessage(req.query.msg, req.user.user_id, id) : null;
  res.render('reportForm', { type, target: id, targetTitle: t.title, backUrl: evidence ? `/messages/${evidence.cid}` : t.back, values, evidence, msgRef: evidence ? req.query.msg : '' });
});

router.post('/report', requireLogin, requireActive, async (req, res) => {
  const type = req.body.type === 'user' ? 'user' : 'listing';
  const id = intOrNull(req.body.id);
  const t = id && (await reportTarget(type, id));
  if (!t) return res.status(404).render('error', { status: 404, title: 'Nothing to report', message: 'That item no longer exists.' });
  if (t.owner === req.user.user_id) return res.redirect(t.back);

  const reason = REASONS.some(([k]) => k === req.body.reason) ? req.body.reason : null;
  const details = clean(req.body.details, { multiline: true });
  const evidence = type === 'user' && req.body.msg ? await reportedMessage(req.body.msg, req.user.user_id, id) : null;
  const back = (errors) => res.status(400).render('reportForm', { type, target: id, targetTitle: t.title, backUrl: t.back, errors, values: { reason, details }, evidence, msgRef: evidence ? req.body.msg : '' });
  if (!(await require('../services/turnstile').verify(req, 'report')).ok) return back({ _form: require('../services/turnstile').MESSAGE });
  if (!reason) return back({ reason: 'Choose the closest reason.' });
  if (details.length > 600) return back({ details: 'Keep details under 600 characters.' });

  if ((req.user.false_reports || 0) >= config.limits.falseReportBlock) {
    return back({ _form: 'Reporting is limited on your account after several reports were found to be unfounded. Contact a moderator if you think this is a mistake.' });
  }
  const todays = (await reports.byReporter(req.user.user_id)).filter((r) => r.created_at > Date.now() - 86_400_000).length;
  if (todays >= settings.int('reports_per_day')) return back({ _form: 'You have reached the daily report limit. Moderators are working through the queue.' });

  const result = await reports.create({ reporter_id: req.user.user_id, target_type: type, target_id: id, owner_id: t.owner, reason, details, evidence });
  if (result.duplicate) {
    req.flash('info', 'You already have an open report on this. A moderator will look at it soon.');
    return res.redirect(t.back);
  }
  await audit({ actor: req.user, action: 'report.create', entityType: 'report', entityId: result.report.report_id, meta: { type, id, reason }, ip: req.ip });
  req.flash('success', 'Report sent. Thank you for helping keep CampusFind safe.');
  res.redirect(evidence ? `/messages/${evidence.cid}` : t.back);
});

module.exports = router;
