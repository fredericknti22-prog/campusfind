'use strict';
const config = require('../config');

/** Trim, drop control chars (keeps \n), collapse runaway blank lines. */
function clean(v, { multiline = false } = {}) {
  let s = typeof v === 'string' ? v : '';
  s = s.replace(/\u0000/g, '').replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  s = s.replace(/\r\n?/g, '\n');
  if (!multiline) s = s.replace(/\s+/g, ' ');
  else s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// Practical address check: also refuses characters real mailboxes do not use (< > ( ) [ ] \ , ; : "), so markup
// and injection probes are rejected before they reach Firebase Auth.
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

function checkEmail(email) {
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return 'Enter a valid email address.';
  if (config.allowedEmailDomains.length) {
    const domain = email.split('@')[1].toLowerCase();
    const ok = config.allowedEmailDomains.some((d) => domain === d || domain.endsWith('.' + d));
    if (!ok) return `Please use your campus email (${config.allowedEmailDomains.map((d) => '@' + d).join(', ')}).`;
  }
  return null;
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '1234567890', '123456789', 'qwertyuiop', 'iloveyou12',
  'letmein123', 'welcome123', 'admin12345', 'changeme123', 'campusfind', 'campusfind1',
]);

function checkPassword(pw, { email = '', name = '' } = {}) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 128) return 'Password is too long (max 128 characters).';
  const lower = pw.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'That password is too common. Pick something less guessable.';
  if (/^(.)\1+$/.test(pw) || /^\d+$/.test(pw)) return 'Password is too simple. Mix letters, numbers or symbols.';
  const local = (email.split('@')[0] || '').toLowerCase();
  if (local.length >= 4 && lower.includes(local)) return 'Password should not contain your email name.';
  if (name && name.length >= 4 && lower.includes(name.toLowerCase().replace(/\s+/g, ''))) {
    return 'Password should not contain your name.';
  }
  return null;
}

function parsePriceToCents(raw) {
  const s = String(raw || '').trim().replace(/[, ]/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return cents >= 0 && cents <= 99_999_999 ? cents : null;
}

const intOrNull = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const SYMBOL = require('../config').currency.symbol;
const formatMoney = (cents) =>
  `${SYMBOL}${(cents / 100).toLocaleString('en-GB', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Escape LIKE wildcards so user text is matched literally. */
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

module.exports = { clean, checkEmail, checkPassword, parsePriceToCents, intOrNull, formatMoney, likeEscape };
