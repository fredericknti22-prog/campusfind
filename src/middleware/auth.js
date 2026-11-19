'use strict';
/**
 * Authorization (FR-02). Role-based, enforced on the server for every protected route.
 * Least privilege: moderators can work the report queue but cannot manage accounts, roles,
 * categories or the audit log.
 */
const listings = require('../repo/listings');
const { safeEqual } = require('../lib/security');

const ADMIN_PERMS = ['dashboard', 'reports', 'listings', 'warn', 'support', 'users', 'categories', 'audit', 'featured', 'orders'];
const PERMS = {
  // Super admin = platform owner: everything an admin can do, plus staff/roles, settings, backups ('system').
  superadmin: new Set([...ADMIN_PERMS, 'roles', 'system']),
  admin: new Set(ADMIN_PERMS),
  moderator: new Set(['dashboard', 'reports', 'listings', 'warn', 'support']), // 'support' = answer the help chat
  student: new Set(),
};

const can = (user, perm) => Boolean(user && PERMS[user.role] && PERMS[user.role].has(perm));
const isStaff = (user) => Boolean(user && ['superadmin', 'admin', 'moderator'].includes(user.role));

/** Only same-site relative paths are allowed as post-login redirects (open-redirect defence). */
function safeNext(next, fallback = '/') {
  if (typeof next !== 'string') return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\r\n]/.test(next)) return fallback;
  return next;
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  if (req.method === 'GET') return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  req.flash('error', 'Please sign in to continue.');
  return res.redirect('/login');
}

/** Restricted accounts may browse and manage existing content but cannot publish or report. */
function requireActive(req, res, next) {
  if (req.user && req.user.status === 'active') return next();
  const reason = req.user && req.user.status_reason ? ` Reason: ${req.user.status_reason}` : '';
  req.flash('error', `Your account is restricted, so this action is unavailable.${reason}`);
  return res.redirect('/');
}

function requireStaff(perm, { allowWithout2fa = false } = {}) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
    if (!can(req.user, perm)) {
      return res.status(403).render('error', { status: 403, title: 'Access denied', message: 'You do not have permission to open this area.' });
    }
    const until = req.session && req.session.admin_until;
    if (!until || until < Date.now()) return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
    const tf = require('../services/twofactor');
    if (!allowWithout2fa && tf.required(req.user) && !tf.enabled(req.user)) return res.redirect('/admin/2fa/setup');
    return next();
  };
}

/** CSRF check for state-changing requests (all non-GET). Multipart routes call this after parsing. */
function verifyCsrf(req, res, next) {
  const token = req.body && req.body._csrf;
  if (req.session && token && safeEqual(token, req.session.csrf_token)) return next();
  return res.status(403).render('error', {
    status: 403, title: 'Session check failed',
    message: 'Your form expired or could not be verified. Go back, refresh the page and try again.',
  });
}

function csrfGuard(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if ((req.headers['content-type'] || '').startsWith('multipart/form-data')) return next(); // verified after multer
  if (req.method === 'POST' && req.path === '/errors/client') return next(); // error beacons: no side effects beyond a counter
  return verifyCsrf(req, res, next);
}

async function loadListingForOwner(req, res, next) {
  const id = /^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : null;
  const listing = id ? await listings.get(id) : null;
  if (!listing || listing.deleted_at) return res.status(404).render('error', { status: 404, title: 'Not found', message: 'That listing does not exist.' });
  if (listing.owner_id !== req.user.user_id) {
    return res.status(403).render('error', { status: 403, title: 'Access denied', message: 'You can only change your own listings.' });
  }
  req.listing = listing;
  return next();
}

module.exports = { PERMS, can, isStaff, safeNext, requireLogin, requireActive, requireStaff, verifyCsrf, csrfGuard, loadListingForOwner };
