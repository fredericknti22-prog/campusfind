'use strict';
/**
 * Minimal .env loader (no dependency). Real environment variables always win, so hosting
 * platforms that inject secrets (Cloud Run, Replit) are never overridden by a stray file.
 */
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', '.env');
// Tests must be hermetic: never let a developer's real .env change their outcome.
const skip = process.env.NODE_ENV === 'test' || process.env.CAMPUSFIND_SKIP_DOTENV === '1';
if (!skip && fs.existsSync(file)) {
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}
