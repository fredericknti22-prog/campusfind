'use strict';
/**
 * Error alerts. Server errors (500s) and browser script errors are grouped by kind and counted:
 *   error_logs/{sha1(source|message|first frame)}  { source, message, frame, path, ua, count, first_at, last_at }
 * No personal data: paths lose their query string, no user ids, no form contents, messages are trimmed.
 * The first time a new kind of error appears, super admins get a notification (at most a few per hour).
 */
const crypto = require('crypto');
const { col, FieldValue } = require('../store');

const L = () => col('error_logs');
let alertsThisHour = { at: 0, n: 0 };

const cleanPath = (p) => String(p || '').split('?')[0].split('#')[0].replace(/\/\d{3,}/g, '/:id').slice(0, 120);
const firstFrame = (stack) => {
  const line = String(stack || '').split('\n').find((l) => /\bat\b|@/.test(l) && !/node:internal|node_modules/.test(l)) || '';
  return line.trim().replace(/\?v=[\w]+/g, '').replace(/https?:\/\/[^/]+/g, '').slice(0, 200);
};
// no email addresses, phone numbers or long digit runs in stored messages
const scrub = (s) => String(s || '').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/\+?\d[\d\s-]{6,}\d/g, '[number]').slice(0, 300);

async function record({ source = 'server', message, stack = '', path = '', ua = '' }) {
  try {
    const msg = scrub(message || 'Unknown error');
    const frame = firstFrame(stack);
    const id = crypto.createHash('sha1').update(`${source}|${msg}|${frame}`).digest('hex').slice(0, 24);
    const ref = L().doc(id);
    const now = Date.now();
    const isNew = !(await ref.get()).exists;
    await ref.set({
      id, source, message: msg, frame, path: cleanPath(path), ua: String(ua).slice(0, 160),
      count: FieldValue.increment(1), last_at: now, ...(isNew ? { first_at: now } : {}),
    }, { merge: true });
    if (isNew) await alertOwners(source, msg, cleanPath(path));
    return id;
  } catch (err) {
    console.error('[errorLog] could not record:', err.message);
    return null;
  }
}

async function alertOwners(source, msg, path) {
  const now = Date.now();
  if (now - alertsThisHour.at > 3_600_000) alertsThisHour = { at: now, n: 0 };
  if (alertsThisHour.n >= 5) return;
  alertsThisHour.n += 1;
  const owners = (await col('users').where('role', '==', 'superadmin').get()).docs.map((d) => d.data()).filter((u) => !u.deleted_at);
  const { notify } = require('./notify');
  await Promise.all(owners.map((u) => notify(u.user_id, {
    type: 'system', title: `New ${source === 'client' ? 'browser' : 'server'} error on ${path || 'the site'}`,
    body: msg.slice(0, 140), link: '/admin/errors',
  })));
}

async function list(limit = 100) {
  const snap = await L().orderBy('last_at', 'desc').limit(limit).get();
  return snap.docs.map((d) => d.data());
}

const resolve = (id) => L().doc(String(id)).delete();

const resetAlertBudget = () => { alertsThisHour = { at: 0, n: 0 }; }; // tests

module.exports = { record, list, resolve, scrub, cleanPath, resetAlertBudget };
