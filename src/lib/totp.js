'use strict';
/**
 * Time-based one-time codes (RFC 6238, the 6-digit codes in Google / Microsoft Authenticator), with no dependencies.
 * Secrets are stored encrypted (AES-256-GCM). The key comes from TOTP_ENCRYPTION_KEY, or is derived from the Firebase
 * service-account private key, so a copy of the database alone cannot be used to generate codes.
 */
const crypto = require('crypto');
const config = require('../config');

const STEP = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0; let value = 0; const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const generateSecret = () => base32Encode(crypto.randomBytes(20));

function codeAt(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0');
}

const counterNow = (now = Date.now()) => Math.floor(now / 1000 / STEP);

/**
 * Check a code, allowing one step of clock drift either way. Returns the matched counter, or null.
 * Pass the last counter already used so the same code cannot be replayed.
 */
function verify(secret, token, { lastCounter = -1, now = Date.now() } = {}) {
  const t = String(token || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(t)) return null;
  const c = counterNow(now);
  for (const k of [c - 1, c, c + 1]) {
    if (k <= lastCounter) continue;
    const expected = codeAt(secret, k);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(t))) return k;
  }
  return null;
}

const otpauthUrl = (secret, account) =>
  `otpauth://totp/${encodeURIComponent('CampusFind')}:${encodeURIComponent(account)}?secret=${secret}&issuer=CampusFind&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;

/* ---- encryption at rest ---- */
function key() {
  const explicit = (process.env.TOTP_ENCRYPTION_KEY || '').trim();
  const sa = config.firebase.serviceAccount;
  const material = explicit || (sa && sa.private_key) || (config.isProd ? '' : 'campusfind-dev-only-totp-key');
  if (!material) throw new Error('Two-step sign-in needs TOTP_ENCRYPTION_KEY or FIREBASE_SERVICE_ACCOUNT to protect secrets.');
  return Buffer.from(crypto.hkdfSync('sha256', material, 'campusfind', 'totp-secret-v1', 32));
}

function seal(secret) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${enc.toString('base64url')}.${c.getAuthTag().toString('base64url')}`;
}

function open(sealed) {
  const [v, iv, enc, tag] = String(sealed || '').split('.');
  if (v !== 'v1' || !iv || !enc || !tag) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
  } catch (err) {
    return null;
  }
}

/* ---- recovery codes: shown once, stored as SHA-256 hashes ---- */
const hashCode = (c) => crypto.createHash('sha256').update(String(c).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
function recoveryCodes(n = 8) {
  return Array.from({ length: n }, () => {
    const s = crypto.randomBytes(5).toString('hex');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

module.exports = { generateSecret, codeAt, counterNow, verify, otpauthUrl, seal, open, hashCode, recoveryCodes, base32Encode, base32Decode };
