'use strict';
/**
 * Build render-env-payload.json from local .env (no values printed).
 * Forces BASE_URL to the Render hostname and NODE_ENV=production.
 */
const fs = require('fs');
const path = require('path');

const KEYS = [
  'FIREBASE_SERVICE_ACCOUNT',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_WEB_API_KEY',
  'FIREBASE_STORAGE_BUCKET',
  'ADMIN_EMAIL',
  'ADMIN_NAME',
  'CONTACT_EMAIL',
  'LEGAL_ENTITY',
  'PUBLIC_BROWSING',
  'PHOTOS_ENABLED',
  'PHOTO_STORE',
];

function parseEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const file = path.join(__dirname, '..', '.env');
if (!fs.existsSync(file)) throw new Error('Missing .env');
const env = parseEnvFile(file);
if (!env.FIREBASE_WEB_API_KEY && env.WEB_API_KEY) env.FIREBASE_WEB_API_KEY = env.WEB_API_KEY;
if (!env.PHOTOS_ENABLED) env.PHOTOS_ENABLED = 'true';
if (!env.PHOTO_STORE) env.PHOTO_STORE = 'firestore';

const body = KEYS
  .filter((k) => env[k] != null && String(env[k]).length > 0)
  .map((key) => ({ key, value: String(env[key]) }));

body.push({ key: 'BASE_URL', value: 'https://campusfind-6h5q.onrender.com' });
body.push({ key: 'NODE_ENV', value: 'production' });

const out = path.join(__dirname, '..', 'render-env-payload.json');
fs.writeFileSync(out, JSON.stringify(body));
console.log(JSON.stringify({
  keys: body.map((x) => x.key),
  hasSa: body.some((x) => x.key === 'FIREBASE_SERVICE_ACCOUNT'),
  count: body.length,
}));
