'use strict';
/**
 * Safety signals for moderators, built from counts only (no message text, since chats stay private):
 *   users.blocked_by_count       how many different members currently block this person
 *   users.chat_flags.{code}      how many of their chat messages tripped an automatic scam check
 * A member is "worth a look" when several people block them or their messages repeatedly look like scams.
 */
const { col, FieldValue } = require('../store');

const SCAM_FLAGS = ['pay-first', 'asks-code', 'fake-payment']; // links alone are too common to count

/** Count a sender's risky messages (never throws; called after a message is stored). */
async function noteFlags(senderId, flags) {
  const hits = (flags || []).filter((f) => SCAM_FLAGS.includes(f));
  if (!hits.length) return;
  try {
    const patch = {};
    for (const f of hits) patch[f] = FieldValue.increment(1);
    await col('users').doc(String(senderId)).set({ chat_flags: patch, chat_flag_total: FieldValue.increment(hits.length) }, { merge: true });
  } catch (err) {
    console.error('[signals] could not count flags:', err.message);
  }
}

const noteBlock = (targetId, delta) => col('users').doc(String(targetId)).set({ blocked_by_count: FieldValue.increment(delta) }, { merge: true });

function score(u) {
  const blocked = Math.max(0, Number(u.blocked_by_count) || 0);
  const f = u.chat_flags || {};
  const flags = SCAM_FLAGS.reduce((n, k) => n + (Number(f[k]) || 0), 0);
  return { blocked, flags, byFlag: Object.fromEntries(SCAM_FLAGS.map((k) => [k, Number(f[k]) || 0])), score: blocked * 3 + flags };
}

/** Members worth a look, highest first: blocked by 2+ people, or 3+ scam-like messages. */
async function watchlist(limit = 50) {
  const [a, b] = await Promise.all([
    col('users').where('blocked_by_count', '>=', 2).limit(200).get(),
    col('users').where('chat_flag_total', '>=', 3).limit(200).get(),
  ]);
  const seen = new Map();
  for (const d of [...a.docs, ...b.docs]) {
    const u = d.data();
    if (!u || u.deleted_at || seen.has(u.user_id)) continue;
    const s = score(u);
    if (s.blocked >= 2 || s.flags >= 3) seen.set(u.user_id, { user: u, ...s });
  }
  return [...seen.values()].sort((x, y) => y.score - x.score).slice(0, limit);
}

module.exports = { SCAM_FLAGS, noteFlags, noteBlock, score, watchlist };
