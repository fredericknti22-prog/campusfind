'use strict';
/**
 * Blocking. users.blocked is the list of member ids a member has blocked (at most MAX).
 * A block works both ways for messaging: neither side can send to the other. The blocker also stops seeing the
 * blocked member's listings. Reporting still works after a block, so people can block first and report after.
 */
const { FieldValue } = require('../store');
const users = require('../repo/users');

const MAX = 200;
const list = (u) => (Array.isArray(u && u.blocked) ? u.blocked.map(Number) : []);
const hasBlocked = (a, b) => Boolean(a && b && list(a).includes(Number(b.user_id)));

/** null if the two can talk; otherwise the message to show `me`. */
function messageBlock(me, other) {
  if (hasBlocked(me, other)) return 'You blocked this member. Unblock them from their profile to message them again.';
  if (hasBlocked(other, me)) return 'This member cannot receive messages from you.';
  return null;
}

async function block(me, targetId) {
  if (list(me).length >= MAX) return 'max';
  if (list(me).includes(Number(targetId))) return 'ok';
  await users.update(me.user_id, { blocked: FieldValue.arrayUnion(Number(targetId)) });
  await require('./signals').noteBlock(targetId, 1);
  users.forget(me.user_id);
  return 'ok';
}

async function unblock(me, targetId) {
  if (!list(me).includes(Number(targetId))) return;
  await require('./signals').noteBlock(targetId, -1);
  await users.update(me.user_id, { blocked: FieldValue.arrayRemove(Number(targetId)) });
  users.forget(me.user_id);
}

module.exports = { MAX, list, hasBlocked, messageBlock, block, unblock };
