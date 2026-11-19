'use strict';
/**
 * Server-side sessions (FR-01, doc section 20), stored in Firestore sessions/{sha256(token)}.
 *  - Random 256-bit token in an HttpOnly, SameSite=Lax cookie; only its SHA-256 is stored.
 *  - Session id is rotated on login (fixation defence).
 *  - Per-session CSRF token; flash messages live in the session.
 * Sessions are created in memory and written when the response is sent, so anonymous page views that never
 * render a form do not cost a database write.
 */
const config = require('../config');
const { col, deleteWhere } = require('../store');
const users = require('../repo/users');
const settings = require('../services/settings');
const { unreadCount } = require('../services/notify');
const { randomToken, sha256 } = require('../lib/security');
const { audit } = require('../services/audit');

const COOKIE = config.session.cookieName;
const sessionRef = (hash) => col('sessions').doc(hash);

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { /* ignore bad cookie */ }
  }
  return out;
}

const cookieOptions = () => ({ httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/' });

function toDoc(s) {
  const doc = { ...s };
  delete doc._new;
  doc.expires_ts = new Date(s.expires_at); // enable a Firestore TTL policy on sessions.expires_ts
  return doc;
}

async function usableUser(user) {
  if (!user || user.deleted_at) return null;
  if (user.status === 'banned') return null;
  if (user.status === 'suspended') {
    if (user.status_until && user.status_until <= Date.now()) {
      await users.update(user.user_id, { status: 'active', status_reason: null, status_until: null });
      await audit({ action: 'user.suspension_expired', entityType: 'user', entityId: user.user_id });
      return { ...user, status: 'active', status_reason: null, status_until: null };
    }
    return null;
  }
  return user;
}

async function sessionMiddleware(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  req.session = null;
  req.user = null;
  req.sessionToken = null;
  req.unread = 0;
  const queue = [];
  let flashCleared = false;

  await settings.refresh();
  await require('../services/whatsNew').refresh();

  const token = req.cookies[COOKIE];
  if (token && token.length < 100) {
    const snap = await sessionRef(sha256(token)).get();
    if (snap.exists && snap.data().expires_at > Date.now()) {
      req.sessionToken = token;
      req.session = snap.data();
      req.session.flash = Array.isArray(req.session.flash) ? req.session.flash : [];
      const now = Date.now();
      if (now - req.session.last_seen_at > 5 * 60 * 1000) {
        req.session.last_seen_at = now;
        req.session.expires_at = now + config.session.ttlMs;
        sessionRef(req.session.session_hash)
          .update({ last_seen_at: now, expires_at: req.session.expires_at, expires_ts: new Date(req.session.expires_at) })
          .catch((e) => console.error('[session] touch failed', e.message));
      }
      if (req.session.user_id) {
        const user = await usableUser(await users.getById(req.session.user_id));
        if (user) req.user = user;
        else { await sessionRef(req.session.session_hash).delete().catch(() => {}); req.session = null; req.sessionToken = null; res.clearCookie(COOKIE, cookieOptions()); }
      }
    }
  }
  if (req.user && req.method === 'GET') req.unread = await unreadCount(req.user.user_id);

  function startSession(userId) {
    const tokenValue = randomToken(32);
    const now = Date.now();
    req.sessionToken = tokenValue;
    req.session = {
      session_hash: sha256(tokenValue), user_id: userId, csrf_token: randomToken(24), flash: [], admin_until: null,
      ip: req.ip || null, user_agent: String(req.get('user-agent') || '').slice(0, 200),
      created_at: now, last_seen_at: now, expires_at: now + config.session.ttlMs, _new: true,
    };
    res.cookie(COOKIE, tokenValue, { ...cookieOptions(), maxAge: config.session.ttlMs });
    return req.session;
  }

  req.ensureSession = () => req.session || startSession(null);
  req.csrfToken = () => req.ensureSession().csrf_token;

  req.flash = (type, message) => { req.ensureSession(); queue.push({ type, message }); };
  req.takeFlash = () => {
    const out = [...(req.session ? req.session.flash : []), ...queue];
    if (req.session && req.session.flash.length) { req.session.flash = []; flashCleared = true; }
    queue.length = 0;
    return out;
  };

  /** Write pending session state. Called automatically before redirects and rendered pages are sent. */
  req.persistSession = async () => {
    const s = req.session;
    if (!s) return;
    if (queue.length) { s.flash = [...s.flash, ...queue].slice(-4); queue.length = 0; flashCleared = false; if (!s._new) await sessionRef(s.session_hash).update({ flash: s.flash }); }
    if (s._new) { await sessionRef(s.session_hash).set(toDoc(s)); s._new = false; return; }
    if (flashCleared) { flashCleared = false; await sessionRef(s.session_hash).update({ flash: [] }); }
  };

  req.login = async (user) => {
    if (req.session && !req.session._new) await sessionRef(req.session.session_hash).delete().catch(() => {}); // rotate
    startSession(user.user_id);
    await sessionRef(req.session.session_hash).set(toDoc(req.session));
    req.session._new = false;
    await users.update(user.user_id, { last_login_at: Date.now(), failed_logins: 0, locked_until: null });
    req.user = await users.getById(user.user_id);
    await require('../services/devices').noteLogin(req.user, req);
  };

  req.logout = async () => {
    if (req.session && !req.session._new) await sessionRef(req.session.session_hash).delete().catch(() => {});
    req.session = null; req.user = null; req.sessionToken = null;
    res.clearCookie(COOKIE, cookieOptions());
  };

  req.setAdminUntil = async (until) => {
    const s = req.ensureSession();
    s.admin_until = until;
    if (!s._new) await sessionRef(s.session_hash).update({ admin_until: until });
  };

  /** Remember (for a day) that this browser entered an under-age date of birth, so the age screen cannot simply be retried. */
  req.setAgeBlock = async (until) => {
    const s = req.ensureSession();
    s.age_block_until = until; s.age_block_v = 2;
    if (!s._new) await sessionRef(s.session_hash).update({ age_block_until: until, age_block_v: 2 });
  };
  req.ageBlocked = () => Boolean(req.session && req.session.age_block_v === 2 && req.session.age_block_until > Date.now());

  // Persist session changes before any redirect leaves the server.
  const redirect = res.redirect.bind(res);
  res.redirect = (...args) => {
    req.persistSession().then(() => redirect(...args)).catch((err) => {
      console.error('[session] persist failed', err);
      if (!res.headersSent) res.status(500).type('text').send('Something went wrong. Please try again.');
    });
  };

  next();
}

/** Remove expired sessions. Run at start-up and hourly. */
async function cleanupSessions() {
  await deleteWhere(col('sessions').where('expires_at', '<', Date.now()));
}

/** Lift suspensions whose end date has passed (members who never sign in again would otherwise stay hidden). */
async function liftExpiredSuspensions() {
  const now = Date.now();
  for (const u of await users.suspended()) {
    if (u.status_until && u.status_until <= now) {
      await users.update(u.user_id, { status: 'active', status_reason: null, status_until: null });
      await audit({ action: 'user.suspension_expired', entityType: 'user', entityId: u.user_id });
    }
  }
}

module.exports = { sessionMiddleware, cleanupSessions, liftExpiredSuspensions, COOKIE };
