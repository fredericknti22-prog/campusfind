'use strict';
/**
 * Scam protection inside member chats. Automatic and private: nothing is shown to staff (chats stay between the
 * two members). Two things happen:
 *   - block(): a message that hands over a one-time code or PIN is not sent at all (the classic MoMo/WhatsApp takeover);
 *   - assess(): risky messages are stored with flags, and the person reading them sees a plain warning underneath.
 */
const RISKS = [
  {
    code: 'asks-code',
    re: [/\b(send|give|tell|share|forward|read)\b[^.?!\n]{0,30}\b(code|otp|pin|verification|password)\b/i, /\b(otp|one[-\s]?time\s+(pass)?code|verification\s+code|momo\s+pin|your\s+pin)\b/i],
    warn: 'Never share a PIN, password or the code from a text message. Real buyers and sellers, and CampusFind, never need them.',
  },
  {
    code: 'pay-first',
    re: [/\b(pay|send|momo|transfer)\b[^.?!\n]{0,30}\b(first|before|upfront|up front|in advance|deposit|booking fee|transport fee|delivery fee|commitment fee)\b/i, /\b(advance payment|deposit first|commitment fee)\b/i],
    warn: 'Asked to pay before you have seen the item? That is the most common scam. Meet in a busy place, check the item, then pay.',
  },
  {
    code: 'fake-payment',
    re: [/\b(sent|send|transferred|paid)\b[^.?!\n]{0,30}\b(by mistake|wrongly|in error|mistakenly)\b/i, /\b(reverse|refund|return)\b[^.?!\n]{0,20}\b(the\s+)?(money|excess|balance|extra)\b/i],
    warn: 'Says they paid you by mistake? Check your balance in your MoMo app, not a text message. Never send back money you have not seen arrive.',
  },
  {
    code: 'link',
    re: [/https?:\/\/|\bwww\.|\bbit\.ly\b|\btinyurl\b|\bwa\.me\b/i],
    warn: 'This message contains a link. Never enter your password, PIN or card details on a page you opened from a chat.',
  },
];

/** Flags for a message body, e.g. ['pay-first']. */
const assess = (body) => RISKS.filter((r) => r.re.some((re) => re.test(String(body || '')))).map((r) => r.code);

/** Warning lines for stored flags (unknown codes are ignored). */
const warnings = (flags) => (Array.isArray(flags) ? RISKS.filter((r) => flags.includes(r.code)).map((r) => r.warn) : []);

/** A reason to refuse the message, or null. Catches "my code is 482913", "PIN: 1234", "the OTP 55 21 90". */
function block(body) {
  const s = String(body || '');
  const digits = '(\\d[\\s-]?){3,7}\\d';
  const near = new RegExp(`\\b(code|otp|pin|token|passcode)\\b[^\\d\\n]{0,20}${digits}\\b|\\b${digits}\\b[^\\d\\n]{0,12}\\b(is\\s+(my|the)\\s+)?(code|otp|pin)\\b`, 'i');
  return near.test(s)
    ? 'For your safety this was not sent. It looks like a PIN or a one-time code. Never share these with anyone, even someone who says they are from CampusFind or MTN.'
    : null;
}

module.exports = { assess, warnings, block, RISKS };
