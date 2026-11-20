'use strict';
/**
 * Read .env.render.tmp and merge selected keys onto the Render web service via MCP-equivalent API.
 * Prefers RENDER_API_KEY. Values are never printed.
 *
 *   set RENDER_API_KEY=rnd_...
 *   node scripts/push-env-to-render.js
 *
 * Without an API key, writes render-env-payload.json for the agent to apply via Render MCP (merge).
 */
const fs = require('fs');
const path = require('path');

const SERVICE_ID = process.env.RENDER_SERVICE_ID || 'srv-dbve2g56e07s73bi7pj0';
const KEYS = [
  'FIREBASE_SERVICE_ACCOUNT',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_WEB_API_KEY',
  'FIREBASE_STORAGE_BUCKET',
  'BASE_URL',
  'ADMIN_EMAIL',
  'ADMIN_NAME',
  'CONTACT_EMAIL',
  'LEGAL_ENTITY',
  'PUBLIC_BROWSING',
  'PHOTOS_ENABLED',
  'PHOTO_STORE',
  'NODE_ENV',
];

function parseEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i);
    let val = line.slice(i + 1);
    if (val.startsWith('"') && val.endsWith('"')) {
      try { val = JSON.parse(val); } catch (_) { val = val.slice(1, -1); }
    }
    out[key] = val;
  }
  return out;
}

async function main() {
  const file = path.join(__dirname, '..', '.env.render.tmp');
  if (!fs.existsSync(file)) throw new Error('Missing .env.render.tmp');
  const env = parseEnvFile(file);
  env.NODE_ENV = 'production';

  const body = KEYS.filter((k) => env[k] != null && String(env[k]).length > 0).map((key) => ({
    key,
    value: String(env[key]),
  }));
  if (!body.some((x) => x.key === 'FIREBASE_SERVICE_ACCOUNT')) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT missing from .env.render.tmp');
  }

  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey) {
    const out = path.join(__dirname, '..', 'render-env-payload.json');
    fs.writeFileSync(out, JSON.stringify(body));
    console.log(`Wrote ${out} (${body.length} keys: ${body.map((x) => x.key).join(', ')}). Apply via Render MCP merge; do not commit.`);
    return;
  }

  // Merge: fetch existing, overlay ours, PUT full set (Render PUT replaces).
  const listRes = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/env-vars`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (!listRes.ok) throw new Error(`List env failed: ${listRes.status} ${await listRes.text()}`);
  const existing = await listRes.json();
  const map = new Map();
  for (const row of existing) {
    const ev = row.envVar || row;
    if (ev.key) map.set(ev.key, ev.value);
  }
  for (const { key, value } of body) map.set(key, value);
  const merged = [...map.entries()].map(([key, value]) => ({ key, value }));

  const putRes = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/env-vars`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(merged),
  });
  if (!putRes.ok) throw new Error(`Update env failed: ${putRes.status} ${await putRes.text()}`);
  console.log(`Merged ${body.length} keys onto ${SERVICE_ID} (total ${merged.length}). Keys touched: ${body.map((x) => x.key).join(', ')}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
