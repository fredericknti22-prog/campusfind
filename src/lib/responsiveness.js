'use strict';
/**
 * "Usually replies within an hour" and friends, from users.reply_stats { asked, replied, within_hour, within_day }.
 * Needs at least three answered chats before saying anything, so one slow or fast reply does not label a seller.
 */
const MIN_REPLIES = 3;

function replyLabel(u) {
  const s = (u && u.reply_stats) || {};
  const replied = Number(s.replied) || 0;
  const asked = Math.max(Number(s.asked) || 0, replied);
  if (replied < MIN_REPLIES) return null;
  const rate = replied / asked;
  const hour = (Number(s.within_hour) || 0) / replied;
  const day = (Number(s.within_day) || 0) / replied;
  const speed = hour >= 0.5 ? 'within an hour' : day >= 0.5 ? 'within a day' : 'within a few days';
  return { text: rate >= 0.5 ? `Usually replies ${speed}` : 'Replies to some messages', fast: rate >= 0.5 && hour >= 0.5, rate: Math.round(rate * 100) };
}

module.exports = { replyLabel, MIN_REPLIES };
