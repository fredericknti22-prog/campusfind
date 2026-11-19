'use strict';
/**
 * Lightweight, transparent content screening (section 21). This is NOT AI moderation
 * (explicitly out of scope). Matches only raise a flag into the moderation queue; a human decides.
 */
const PATTERNS = [
  { label: 'payment-scam phrase', re: /\b(western\s*union|money\s*gram|wire\s+(me|the)\s+money|gift\s*cards?\s+(only|payment)|send\s+(the\s+)?(money|deposit)\s+first)\b/i },
  { label: 'investment/crypto bait', re: /\b(guaranteed\s+(returns?|profit)|double\s+your\s+(money|investment)|crypto\s+investment|forex\s+signals?)\b/i },
  { label: 'off-platform pressure', re: /\b(urgent(ly)?\s+(need|sale)|act\s+now|limited\s+time\s+only|whatsapp\s+me\s+(only|first))\b/i },
  { label: 'explicit content term', re: /\b(porn|xxx|nudes?|escort\s+service|onlyfans)\b/i },
  { label: 'exam/cheating service', re: /\b(write\s+your\s+(essay|exam)|do\s+your\s+(exam|assignment)\s+for\s+you|buy\s+(a\s+)?(degree|diploma))\b/i },
];

function screenText(...parts) {
  const text = parts.filter(Boolean).join('\n');
  const hits = PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
  return hits;
}

module.exports = { screenText };
