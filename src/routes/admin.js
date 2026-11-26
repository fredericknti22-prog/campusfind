'use strict';
const express = require('express');
const config = require('../config');
const settings = require('../services/settings');
const images = require('../services/images');
const users = require('../repo/users');
const listings = require('../repo/listings');
const categories = require('../repo/categories');
const reports = require('../repo/reports');
const { db, col, getMany, countOf, deleteWhere } = require('../store');
const { audit } = require('../services/audit');
const { notify } = require('../services/notify');
const { AccountError, createAccount } = require('../services/auth');
const { ModerationError, moderateListing, moderateUser, resolveReport, startReview } = require('../services/moderation');
const { requireStaff, can } = require('../middleware/auth');
const { cleanupSessions } = require('../middleware/session');
const { clean, checkEmail, checkPassword, intOrNull } = require('../lib/validate');
const { REASON_LABEL, REASONS } = require('../views/pages/account');

const router = express.Router();
const PAGE = 20;
const DAY = 86_400_000;

const counts = async () => ({ openReports: await reports.countOpen(), supportWaiting: await require('../repo/messages').supportWaiting() });
const show = async (res, view, data = {}, status = 200) => res.status(status).render(view, { counts: await counts(), ...data });
const paginate = (req, list) => {
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const pageNum = Math.min(Math.max(1, intOrNull(req.query.page) || 1), pages);
  return { total, pages, pageNum, slice: list.slice((pageNum - 1) * PAGE, pageNum * PAGE) };
};
const notFound = (res) => res.status(404).render('error', { status: 404, title: 'Not found', message: 'That record does not exist.' });
const idParam = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : null);
const has = (text, q) => String(text || '').toLowerCase().includes(q);

/* --------------------------------------------------------------- overview */
router.get('/admin/launch-kit', requireStaff('dashboard'), async (req, res) => {
  const config = require('../config');
  const qr = require('../services/qr');
  const posters = await Promise.all(require('../views/pages/posters').DESIGNS.map(async (p) => {
    const url = `${config.baseUrl}${p.path}`;
    return { ...p, url, qr: await qr.svg(url) };
  }));
  res.render('launchKit', { posters });
});

router.get('/admin/signals', requireStaff('reports'), async (req, res) => {
  show(res, 'adminSignals', { rows: await require('../services/signals').watchlist() });
});

router.get('/admin/errors', requireStaff('system'), async (req, res) => {
  show(res, 'adminErrors', { rows: await require('../services/errorLog').list() });
});

router.post('/admin/errors/:id/resolve', requireStaff('system'), async (req, res) => {
  if (/^[0-9a-f]{24}$/.test(req.params.id)) await require('../services/errorLog').resolve(req.params.id);
  await audit({ actor: req.user, action: 'system.error_resolved', entityType: 'system', meta: { id: req.params.id }, ip: req.ip });
  req.flash('success', 'Marked as fixed. It comes back here if it happens again.');
  res.redirect('/admin/errors');
});

router.get('/admin/updates', requireStaff('system'), async (req, res) => {
  show(res, 'adminUpdates', { notes: await require('../services/whatsNew').list(), values: {} });
});

router.post('/admin/updates', requireStaff('system'), async (req, res) => {
  const wn = require('../services/whatsNew');
  const title = clean(req.body.title);
  const items = String(req.body.items || '').split(/\r?\n/).map((x) => clean(x).replace(/^[-*•]\s*/, '')).filter(Boolean);
  const errors = {};
  if (title.length < 3 || title.length > 90) errors.title = 'Give it a short title (3–90 characters).';
  if (!items.length || items.length > 8) errors.items = 'Write 1 to 8 changes, one per line.';
  else if (items.some((x) => x.length > 160)) errors.items = 'Keep each line under 160 characters.';
  if (Object.keys(errors).length) return show(res, 'adminUpdates', { notes: await wn.list(), values: { title, items: req.body.items }, errors }, 400);
  const { sent } = await wn.publish({ title, items, by: req.user.user_id, notifyAll: req.body.notify === '1' });
  await audit({ actor: req.user, action: 'system.whats_new', entityType: 'system', meta: { title, sent }, ip: req.ip });
  req.flash('success', `Published. Members see it the next time they open CampusFind${sent ? ` and ${sent} got a notification` : ''}.`);
  res.redirect('/admin/updates');
});

router.get('/admin/insights', requireStaff('dashboard'), async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const [data, cats] = await Promise.all([require('../services/insights').summary(days), require('../repo/categories').all()]);
  const catName = new Map(cats.map((c) => [c.slug, c.name]));
  show(res, 'adminInsights', { data, catName });
});

router.get('/admin', requireStaff('dashboard'), async (req, res) => {
  const week = Date.now() - 7 * DAY;
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const since = start.getTime() - 13 * DAY;

  const [openReports, activeListings, members, newUsers7, actions7, signupTimes, cats, active, open, reasonCounts] = await Promise.all([
    reports.countOpen(), listings.countActive(), users.countAll(), users.countSince(week),
    countOf(col('moderation_actions').where('created_at', '>', week)),
    users.createdSince(since), categories.active(), listings.activeSnapshot(), reports.openOnes(),
    Promise.all(REASONS.map(async ([k]) => ({ name: REASON_LABEL[k] || k, value: await reports.countByReason(k) }))),
  ]);

  const byDay = new Map();
  signupTimes.forEach((t) => { const k = new Date(t).toISOString().slice(0, 10); byDay.set(k, (byDay.get(k) || 0) + 1); });
  const signups = Array.from({ length: 14 }, (_, i) => {
    const dt = new Date(start.getTime() - (13 - i) * DAY);
    return { name: dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }), value: byDay.get(dt.toISOString().slice(0, 10)) || 0 };
  });
  const perCategory = new Map();
  active.forEach((l) => perCategory.set(l.category_id, (perCategory.get(l.category_id) || 0) + 1));
  const byCategory = cats.map((c) => ({ name: c.name, value: perCategory.get(c.category_id) || 0 }));

  let recent = [];
  if (can(req.user, 'audit')) {
    const logs = (await col('activity_logs').orderBy('created_at', 'desc').limit(8).get()).docs.map((d) => d.data());
    const actors = await getMany('users', logs.map((l) => l.actor_id));
    recent = logs.map((l) => ({ ...l, actor_name: l.actor_id ? (actors.get(String(l.actor_id)) || {}).name : null }));
  }
  res.render('adminDashboard', {
    counts: { supportWaiting: await require('../repo/messages').supportWaiting(), openReports, activeListings, users: members, newUsers7, actions7 },
    signups, byCategory, byReason: reasonCounts.filter((r) => r.value > 0).sort((a, b) => b.value - a.value),
    queue: open.slice(0, 5), recent,
    health: await require('../services/health').summary(30),
  });
});

/* ---------------------------------------------------------------- reports */
router.get('/admin/reports', requireStaff('reports'), async (req, res) => {
  const status = ['open', 'pending', 'reviewing', 'resolved', 'dismissed', 'all'].includes(req.query.status) ? req.query.status : 'open';
  const { total, pages, pageNum, slice } = paginate(req, await reports.list(status));
  const [reporters, targetUsers, targetListings] = await Promise.all([
    getMany('users', slice.map((r) => r.reporter_id)),
    getMany('users', slice.filter((r) => r.target_type === 'user').map((r) => r.target_id)),
    getMany('listings', slice.filter((r) => r.target_type === 'listing').map((r) => r.target_id)),
  ]);
  const items = slice.map((r) => ({
    ...r,
    reporter_name: r.reporter_id ? (reporters.get(String(r.reporter_id)) || {}).name : null,
    target_label: r.target_type === 'listing' ? (targetListings.get(String(r.target_id)) || {}).title : (targetUsers.get(String(r.target_id)) || {}).name,
  }));
  return show(res, 'adminReports', { items, status, total, pages, pageNum });
});

async function reportContext(id) {
  const r = await reports.get(id);
  if (!r) return null;
  const ctx = { r, reporter: r.reporter_id ? await users.getById(r.reporter_id) : null };
  if (r.target_type === 'listing') {
    const raw = await listings.get(r.target_id);
    ctx.listing = raw ? (await listings.hydrate([raw]))[0] : null;
    ctx.owner = ctx.listing ? await users.getById(ctx.listing.owner_id) : null;
  } else {
    ctx.person = await users.getById(r.target_id);
  }
  ctx.otherReports = (await reports.forTarget(r.target_type, r.target_id)).filter((o) => o.report_id !== id).slice(0, 10);
  const acts = (await col('moderation_actions').where('target_type', '==', r.target_type).where('target_id', '==', r.target_id).get()).docs
    .map((d) => d.data()).sort((a, b) => b.created_at - a.created_at).slice(0, 10);
  const admins = await getMany('users', [...acts.map((a) => a.admin_id), r.reviewer_id]);
  ctx.history = acts.map((a) => ({ ...a, admin_name: (admins.get(String(a.admin_id)) || {}).name || 'staff' }));
  ctx.reviewerName = r.reviewer_id ? (admins.get(String(r.reviewer_id)) || {}).name : null;
  return ctx;
}

router.get('/admin/reports/:id', requireStaff('reports'), async (req, res) => {
  const ctx = await reportContext(idParam(req.params.id));
  if (!ctx) return notFound(res);
  return show(res, 'adminReport', ctx);
});

router.post('/admin/reports/:id/review', requireStaff('reports'), async (req, res) => {
  await startReview({ admin: req.user, reportId: idParam(req.params.id), ip: req.ip });
  res.redirect(`/admin/reports/${req.params.id}`);
});

router.post('/admin/reports/:id/resolve', requireStaff('reports'), async (req, res) => {
  const id = idParam(req.params.id);
  try {
    await resolveReport({
      admin: req.user, reportId: id, outcome: String(req.body.outcome || ''), reason: clean(req.body.reason, { multiline: true }).slice(0, 500),
      days: req.body.days, malicious: req.body.malicious === '1', ip: req.ip,
    });
  } catch (err) {
    if (!(err instanceof ModerationError)) throw err;
    const ctx = await reportContext(id);
    if (!ctx) return notFound(res);
    return show(res, 'adminReport', { ...ctx, error: err.message }, 400);
  }
  req.flash('success', `Report #${id} closed and logged.`);
  res.redirect('/admin/reports');
});

/* --------------------------------------------------------------- listings */
router.get('/admin/listings', requireStaff('listings'), async (req, res) => {
  const q = clean(String(req.query.q || '')).slice(0, 80);
  const status = ['active', 'draft', 'closed', 'hidden', 'removed'].includes(req.query.status) ? req.query.status : '';
  let all = await listings.recent(500);
  const owners = await getMany('users', all.map((l) => l.owner_id));
  all = all.map((l) => ({ ...l, owner_name: (owners.get(String(l.owner_id)) || {}).name || 'Unknown' }));
  const needle = q.toLowerCase();
  if (q) all = all.filter((l) => has(l.title, needle) || has(l.owner_name, needle) || String(l.listing_id) === q);
  if (status) all = all.filter((l) => l.status === status);
  const { total, pages, pageNum, slice } = paginate(req, all);
  return show(res, 'adminListings', { items: await listings.hydrate(slice).then((h) => h.map((l, i) => ({ ...l, owner_name: slice[i].owner_name }))), q, status, total, pages, pageNum });
});

router.post('/admin/listings/:id/moderate', requireStaff('listings'), async (req, res) => {
  try {
    await moderateListing({ admin: req.user, listingId: idParam(req.params.id), action: String(req.body.action), reason: clean(req.body.reason).slice(0, 200), ip: req.ip });
    req.flash('success', 'Listing updated and the owner was notified.');
  } catch (err) {
    if (!(err instanceof ModerationError)) throw err;
    req.flash('error', err.message);
  }
  res.redirect('/admin/listings');
});

router.post('/admin/listings/:id/feature', requireStaff('featured'), async (req, res) => {
  const id = idParam(req.params.id);
  const on = req.body.on === '1';
  const l = id ? await listings.get(id) : null;
  if (!l || l.status !== 'active' || l.deleted_at) { req.flash('error', 'Only live listings can be featured.'); return res.redirect('/admin/listings'); }
  await listings.update(id, { is_featured: on ? 1 : 0, featured_until: on ? Date.now() + 14 * DAY : null });
  await audit({ actor: req.user, action: on ? 'listing.feature' : 'listing.unfeature', entityType: 'listing', entityId: id, ip: req.ip });
  req.flash('success', on ? 'Featured for 14 days. It is labelled “Featured” everywhere.' : 'Feature removed.');
  res.redirect('/admin/listings');
});

/* ------------------------------------------------------------------ users */
router.get('/admin/users', requireStaff('users'), async (req, res) => {
  const q = clean(String(req.query.q || '')).slice(0, 80);
  const status = ['active', 'restricted', 'suspended', 'banned'].includes(req.query.status) ? req.query.status : '';
  const role = ['student', 'moderator', 'admin', 'superadmin'].includes(req.query.role) ? req.query.role : '';
  let all = (await users.recent(500)).filter((u) => !u.deleted_at);
  const needle = q.toLowerCase();
  if (q) all = all.filter((u) => has(u.name, needle) || has(u.email, needle) || String(u.user_id) === q);
  if (status) all = all.filter((u) => u.status === status);
  if (role) all = all.filter((u) => u.role === role);
  const { total, pages, pageNum, slice } = paginate(req, all);
  const items = await Promise.all(slice.map(async (u) => ({ ...u, listing_count: await listings.countOwned(u.user_id) })));
  return show(res, 'adminUsers', { items, q, status, role, total, pages, pageNum });
});

async function userContext(id) {
  const person = id ? await users.getById(id) : null;
  if (!person) return null;
  const mine = (await listings.byOwner(id)).filter((l) => !l.deleted_at).sort((a, b) => b.created_at - a.created_at).slice(0, 20);
  const acts = (await col('moderation_actions').where('owner_id', '==', id).get()).docs.map((d) => d.data()).sort((a, b) => b.created_at - a.created_at).slice(0, 15);
  const admins = await getMany('users', acts.map((a) => a.admin_id));
  return {
    person, listings: mine, signals: require('../services/signals').score(person),
    reports: (await reports.byOwner(id)).slice(0, 15),
    actions: acts.map((a) => ({ ...a, admin_name: (admins.get(String(a.admin_id)) || {}).name || 'staff' })),
  };
}

router.get('/admin/users/:id', requireStaff('users'), async (req, res) => {
  const ctx = await userContext(idParam(req.params.id));
  if (!ctx) return notFound(res);
  return show(res, 'adminUser', ctx);
});

router.post('/admin/users/:id/action', requireStaff('warn'), async (req, res) => {
  const id = idParam(req.params.id);
  try {
    const reason = clean(req.body.reason, { multiline: true }).slice(0, 500);
    if (!reason) throw new ModerationError('A reason is required so the member can understand the decision.');
    await moderateUser({ admin: req.user, userId: id, action: String(req.body.action), reason, days: req.body.days, ip: req.ip });
    req.flash('success', 'Action applied, logged and the member was notified.');
    return res.redirect(`/admin/users/${id}`);
  } catch (err) {
    if (!(err instanceof ModerationError)) throw err;
    const ctx = await userContext(id);
    if (!ctx) return notFound(res);
    return show(res, 'adminUser', { ...ctx, error: err.message }, 400);
  }
});

/** Role changes belong to the super admin only (permission "roles"). */
router.post('/admin/users/:id/reset-2fa', requireStaff('roles'), async (req, res) => {
  const id = idParam(req.params.id);
  const target = id ? await users.getById(id) : null;
  if (!target || target.user_id === req.user.user_id) return notFound(res);
  await require('../services/twofactor').reset(target.user_id);
  await audit({ actor: req.user, action: 'admin.2fa_reset', entityType: 'user', entityId: target.user_id, ip: req.ip });
  await notify(target.user_id, { type: 'system', title: 'Your two-step sign-in was reset', body: 'A super admin reset it. Set it up again the next time you open the admin area. If you did not ask for this, contact the platform owner.', link: '/admin/2fa/setup' });
  req.flash('success', `Two-step sign-in was reset for ${target.name}.`);
  res.redirect(`/admin/users/${target.user_id}`);
});

router.post('/admin/users/:id/role', requireStaff('roles'), async (req, res) => {
  const id = idParam(req.params.id);
  const role = String(req.body.role);
  const fail = (m) => { req.flash('error', m); return res.redirect(`/admin/users/${id}`); };
  if (!['student', 'moderator', 'admin', 'superadmin'].includes(role)) return fail('Choose a valid role.');
  const target = id ? await users.getById(id) : null;
  if (!target || target.deleted_at) return notFound(res);
  if (target.user_id === req.user.user_id) return fail('You cannot change your own role. Ask another super admin.');
  if (target.role === role) return fail('That is already their role.');
  if (target.role === 'superadmin' && (await users.countByRole('superadmin')) <= 1) return fail('There must always be at least one super admin.');

  const batch = db.batch();
  batch.update(col('users').doc(String(id)), { role });
  const theirSessions = await col('sessions').where('user_id', '==', id).get();
  theirSessions.docs.forEach((d) => batch.update(d.ref, { admin_until: null })); // force fresh staff verification
  await audit({ actor: req.user, action: 'user.role_change', entityType: 'user', entityId: id, meta: { from: target.role, to: role }, ip: req.ip, batch });
  await notify(id, { type: 'system', title: 'Your role changed', body: `Your CampusFind role is now: ${role}.`, link: '/profile' }, { batch });
  await batch.commit();
  users.forget(id);
  req.flash('success', `${target.name} is now ${role}.`);
  res.redirect(`/admin/users/${id}`);
});

/* ------------------------------------------------------------- categories */
const ICONS = ['tag', 'book', 'laptop', 'home', 'tool', 'briefcase', 'calendar', 'compass', 'gift', 'star', 'pin'];
const slugify = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

async function categoriesView(req, res, error, status = 200) {
  const list = await categories.all(true);
  const items = await Promise.all(list.map(async (c) => ({ ...c, listing_count: await categories.listingCount(c.category_id) })));
  return show(res, 'adminCategories', { items, error }, status);
}
router.get('/admin/categories', requireStaff('categories'), (req, res) => categoriesView(req, res));

router.post('/admin/categories', requireStaff('categories'), async (req, res) => {
  const name = clean(req.body.name).slice(0, 40);
  const slug = slugify(name);
  if (name.length < 2 || !slug) return categoriesView(req, res, 'Enter a category name.', 400);
  const list = await categories.all(true);
  if (list.some((c) => c.name.toLowerCase() === name.toLowerCase() || c.slug === slug)) return categoriesView(req, res, 'A category with that name already exists.', 400);
  const doc = await categories.create({ name, slug, description: clean(req.body.description).slice(0, 160), icon: ICONS.includes(req.body.icon) ? req.body.icon : 'tag' });
  await audit({ actor: req.user, action: 'category.create', entityType: 'category', entityId: doc.category_id, ip: req.ip });
  req.flash('success', 'Category added.');
  res.redirect('/admin/categories');
});

router.post('/admin/categories/:id', requireStaff('categories'), async (req, res) => {
  const id = idParam(req.params.id);
  const name = clean(req.body.name).slice(0, 40);
  if (!id || name.length < 2) return categoriesView(req, res, 'A category needs a name.', 400);
  const list = await categories.all(true);
  if (!list.some((c) => c.category_id === id)) return notFound(res);
  if (list.some((c) => c.category_id !== id && c.name.toLowerCase() === name.toLowerCase())) return categoriesView(req, res, 'Another category already uses that name.', 400);
  const active = req.body.is_active === '1' ? 1 : 0;
  if (!active && !list.some((c) => c.category_id !== id && c.is_active)) return categoriesView(req, res, 'At least one category must stay active.', 400);
  await categories.update(id, { name, is_active: active, sort_order: Math.min(99, Math.max(0, intOrNull(req.body.sort_order) || 0)) });
  listings.invalidate();
  await audit({ actor: req.user, action: 'category.update', entityType: 'category', entityId: id, meta: { active }, ip: req.ip });
  req.flash('success', 'Category saved.');
  res.redirect('/admin/categories');
});

/* ------------------------------------------------------------------ audit */
router.get('/admin/audit', requireStaff('audit'), async (req, res) => {
  const q = clean(String(req.query.q || '')).slice(0, 40).toLowerCase();
  let logs = (await col('activity_logs').orderBy('created_at', 'desc').limit(500).get()).docs.map((d) => d.data());
  if (q) logs = logs.filter((l) => has(l.action, q));
  const { total, pages, pageNum, slice } = paginate(req, logs);
  const actors = await getMany('users', slice.map((l) => l.actor_id));
  const rows = slice.map((l) => ({ ...l, actor_name: l.actor_id ? (actors.get(String(l.actor_id)) || {}).name : null }));
  return show(res, 'adminAudit', { rows, q, total, pages, pageNum });
});

/* ======================================================== SUPER ADMIN ===== */
async function systemContext(extra = {}) {
  const day = Date.now() - DAY;
  const logs = col('activity_logs');
  const [up, members, live, sessions, staff, locked, failed24, adminLogins24, recent] = await Promise.all([
    images.stats(), users.countAll(), listings.countLive(),
    countOf(col('sessions').where('expires_at', '>', Date.now())),
    users.staff(), users.countLocked(),
    countOf(logs.where('action', '==', 'auth.login_failed').where('created_at', '>', day)),
    countOf(logs.where('action', '==', 'admin.verify').where('created_at', '>', day)),
    logs.where('action', 'in', ['auth.login_failed', 'auth.account_locked', 'admin.denied', 'auth.login_blocked']).orderBy('created_at', 'desc').limit(6).get(),
  ]);
  const rank = { superadmin: 0, admin: 1, moderator: 2 };
  const launchCheck = require('../services/launchCheck');
  const launch = launchCheck.evaluate({ facts: await launchCheck.gather() });
  return {
    launch,
    settings: settings.all(),
    health: {
      uptime: Math.floor(process.uptime()), node: process.version, env: config.isProd ? 'production' : 'development',
      project: config.firebase.projectId, emulator: config.firebase.emulator,
      users: members, listings: live, sessions, uploadFiles: up.files, uploadBytes: up.bytes, uploadCapped: up.capped,
    },
    staff: staff.sort((a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name)),
    security: { locked, failed24, adminLogins24, recent: recent.docs.map((d) => d.data()) },
    ...extra,
  };
}

router.get('/admin/system', requireStaff('system'), async (req, res) => show(res, 'adminSystem', await systemContext()));

router.post('/admin/system/settings', requireStaff('system'), async (req, res) => {
  const b = req.body;
  const next = {
    registration_open: b.registration_open === '1' ? '1' : '0',
    posting_enabled: b.posting_enabled === '1' ? '1' : '0',
    assistant_enabled: b.assistant_enabled === '1' ? '1' : '0',
    maintenance_mode: b.maintenance_mode === '1' ? '1' : '0',
    listings_per_day: String(Math.min(100, Math.max(1, intOrNull(b.listings_per_day) || config.limits.listingsPerDay))),
    reports_per_day: String(Math.min(100, Math.max(1, intOrNull(b.reports_per_day) || config.limits.reportsPerDay))),
    announcement: clean(b.announcement).slice(0, 200),
  };
  await settings.refresh(true);
  const before = settings.all();
  const changed = [];
  for (const [k, v] of Object.entries(next)) {
    if (before[k] !== v) { await settings.set(k, v, req.user.user_id); changed.push(k); }
  }
  if (changed.length) await audit({ actor: req.user, action: 'system.settings', entityType: 'settings', meta: { changed }, ip: req.ip });
  req.flash('success', changed.length ? `Saved: ${changed.map((k) => k.replace(/_/g, ' ')).join(', ')}.` : 'Nothing changed.');
  res.redirect('/admin/system');
});

const NETWORKS = ['MTN MoMo', 'Telecel Cash', 'AirtelTigo Money'];
router.post('/admin/system/business', requireStaff('system'), async (req, res) => {
  const b = req.body;
  const number = clean(b.momo_number).replace(/[\s-]/g, '');
  const email = clean(b.support_email).toLowerCase();
  const errors = {};
  if (number && !/^(\+?233|0)\d{9}$/.test(number)) errors.momo_number = 'Enter a Ghana number, for example 0241234567 or +233241234567.';
  if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) errors.support_email = 'Enter a valid email address, or leave it empty.';
  const network = NETWORKS.includes(b.momo_network) ? b.momo_network : '';
  const next = { momo_number: number, momo_name: clean(b.momo_name).slice(0, 60), momo_network: network, support_email: email };
  if (Object.keys(errors).length) {
    return show(res, 'adminSystem', await systemContext({ errors, business: next }), 400);
  }
  await settings.refresh(true);
  const before = settings.all();
  const changed = [];
  for (const [k, v] of Object.entries(next)) {
    if (before[k] !== v) { await settings.set(k, v, req.user.user_id); changed.push(k); }
  }
  if (changed.length) await audit({ actor: req.user, action: 'system.business', entityType: 'settings', meta: { changed }, ip: req.ip });
  req.flash('success', changed.length ? 'Payment and contact details saved. They show on the site straight away.' : 'Nothing changed.');
  res.redirect('/admin/system#business');
});

router.post('/admin/system/staff', requireStaff('system'), async (req, res) => {
  const values = { name: clean(req.body.name), email: clean(req.body.email).toLowerCase(), role: String(req.body.role) };
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  let err = null;
  if (values.name.length < 2 || values.name.length > 60) err = 'Enter the staff member’s name.';
  else if (!['moderator', 'admin', 'superadmin'].includes(values.role)) err = 'Choose a staff role.';
  else err = checkEmail(values.email) || checkPassword(password, values);
  const fail = async (message) => res.status(400).render('adminSystem', { counts: await counts(), ...(await systemContext({ errors: { staff: message }, values })) });
  if (err) return fail(err);
  let doc;
  try {
    doc = await createAccount({ name: values.name, email: values.email, password, role: values.role });
  } catch (e) {
    if (!(e instanceof AccountError)) throw e;
    return fail(e.code === 'EMAIL_EXISTS' ? 'An account with that email already exists. Use its Manage page to change the role.' : 'We could not create that account. Check the email and password.');
  }
  await audit({ actor: req.user, action: 'system.staff_create', entityType: 'user', entityId: doc.user_id, meta: { role: values.role }, ip: req.ip });
  await notify(doc.user_id, { type: 'system', title: 'You have a CampusFind staff account', body: 'Please change your temporary password from your profile.', link: '/profile' });
  req.flash('success', `${values.name} was added as ${values.role}. Share the temporary password securely.`);
  res.redirect('/admin/system');
});

/** Full JSON export (everything except sessions). Pair with Firestore scheduled backups for disaster recovery. */
router.post('/admin/system/backup', requireStaff('system'), async (req, res) => {
  const names = ['users', 'categories', 'listings', 'reports', 'moderation_actions', 'activity_logs', 'notifications', 'settings', 'counters'];
  const data = { exported_at: new Date().toISOString(), project: config.firebase.projectId, collections: {} };
  const strip = require('../services/twofactor').SECRET_FIELDS;
  for (const n of names) {
    data.collections[n] = (await col(n).get()).docs.map((d) => {
      const row = { id: d.id, ...d.data() };
      if (n === 'users') for (const f of strip) delete row[f];
      return row;
    });
  }
  await audit({ actor: req.user, action: 'system.export', entityType: 'system', ip: req.ip });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  res.set({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="campusfind-export-${stamp}.json"` });
  res.send(JSON.stringify(data, null, 2));
});

router.post('/admin/system/purge-sessions', requireStaff('system'), async (req, res) => {
  await cleanupSessions();
  await audit({ actor: req.user, action: 'system.purge_sessions', entityType: 'system', ip: req.ip });
  req.flash('success', 'Expired sessions were cleared.');
  res.redirect('/admin/system');
});

router.post('/admin/system/signout-all', requireStaff('system'), async (req, res) => {
  const n = await deleteWhere(col('sessions'), { except: req.session.session_hash });
  await audit({ actor: req.user, action: 'system.signout_all', entityType: 'system', meta: { sessions: n }, ip: req.ip });
  req.flash('success', `Signed out ${n} other session${n === 1 ? '' : 's'}.`);
  res.redirect('/admin/system');
});

module.exports = router;
