'use strict';
/**
 * "Where you're signed in": each member sees their own sessions (browser, system, rough network, last used),
 * can sign out any of them, and is told when a sign-in comes from a browser/system they have not used before.
 * Session ids are never shown: each row gets a separate one-way id, so the page leaks nothing that could
 * be turned back into a session cookie.
 */
const crypto = require('crypto');
const { col } = require('../store');
const users = require('../repo/users');
const { notify } = require('./notify');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function label(ua) {
  const s = String(ua || '');
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet'
    : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /CrOS/.test(s) ? 'ChromeOS'
    : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : '';
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'Unknown browser';
}

/** 41.66.12.x / 2001:db8:1:: (enough to recognise your own network, not to locate you). */
function maskIp(ip) {
  const s = String(ip || '').replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return s.replace(/\.\d+$/, '.x');
  if (s.includes(':')) return `${s.split(':').slice(0, 3).join(':')}::`;
  return '';
}

const publicId = (hash) => sha(`device:${hash}`).slice(0, 16);

async function list(userId, currentHash) {
  const snap = await col('sessions').where('user_id', '==', Number(userId)).limit(50).get();
  const now = Date.now();
  return snap.docs.map((d) => d.data()).filter((s) => s.expires_at > now)
    .map((s) => ({ id: publicId(s.session_hash), label: label(s.user_agent), ip: maskIp(s.ip), last_seen_at: s.last_seen_at, created_at: s.created_at, current: s.session_hash === currentHash }))
    .sort((a, b) => (b.current - a.current) || (b.last_seen_at - a.last_seen_at));
}

/** Sign out one of the member's own sessions. Resolves true when something was removed. */
async function revoke(userId, id) {
  const snap = await col('sessions').where('user_id', '==', Number(userId)).limit(50).get();
  const hit = snap.docs.find((d) => publicId(d.data().session_hash) === String(id));
  if (!hit) return false;
  await hit.ref.delete();
  return true;
}

/** After a successful sign-in: remember the browser/system and warn the member about a new one. Never throws. */
async function noteLogin(user, req) {
  try {
    const name = label(req.get('user-agent'));
    const sig = sha(name).slice(0, 12);
    const known = Array.isArray(user.known_devices) ? user.known_devices : [];
    if (known.includes(sig)) return;
    await users.update(user.user_id, { known_devices: [...known, sig].slice(-10) });
    if (!known.length) return; // first sign-in ever: nothing to compare with
    const where = maskIp(req.ip);
    await notify(user.user_id, {
      type: 'system', title: `New sign-in: ${name}`,
      body: `Your account was signed in from ${name}${where ? ` (network ${where})` : ''}. If this was not you, change your password now. That signs out every other device.`,
      link: '/profile#devices',
    });
  } catch (err) {
    console.error('[devices] could not record sign-in:', err.message);
  }
}

module.exports = { label, maskIp, publicId, list, revoke, noteLogin };
