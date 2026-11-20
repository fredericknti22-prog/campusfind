'use strict';
/**
 * Mint a Firebase Admin service-account key using the logged-in Firebase CLI user,
 * then merge it into render-env-payload.json. Never prints secret material.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT = process.env.FIREBASE_PROJECT_ID || 'campusfind-baf86';
const cfgPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

function loadAccessToken() {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const tokens = cfg.tokens || {};
  if (!tokens.access_token) throw new Error('No Firebase CLI access token. Run: npx firebase login');
  if (tokens.expires_at && Date.now() > Number(tokens.expires_at) - 60_000) {
    throw new Error('Firebase CLI access token expired. Run: npx firebase login --reauth');
  }
  return tokens.access_token;
}

async function main() {
  const token = loadAccessToken();
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  const listRes = await fetch(
    `https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts`,
    { headers }
  );
  const listJson = await listRes.json();
  if (!listRes.ok) throw new Error(`List service accounts failed: ${listRes.status} ${JSON.stringify(listJson).slice(0, 400)}`);
  const accounts = listJson.accounts || [];
  const admin = accounts.find((a) => /firebase-adminsdk/i.test(a.email)) || accounts[0];
  if (!admin) throw new Error('No service accounts found in the Firebase project');

  const keyRes = await fetch(
    `https://iam.googleapis.com/v1/${admin.name}/keys`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE', keyAlgorithm: 'KEY_ALG_RSA_2048' }),
    }
  );
  const keyJson = await keyRes.json();
  if (!keyRes.ok || !keyJson.privateKeyData) {
    throw new Error(`Create key failed: ${keyRes.status} ${JSON.stringify(keyJson).slice(0, 500)}`);
  }
  const saJson = Buffer.from(keyJson.privateKeyData, 'base64').toString('utf8');
  JSON.parse(saJson);

  const payloadPath = path.join(__dirname, '..', 'render-env-payload.json');
  let body = [];
  if (fs.existsSync(payloadPath)) {
    try { body = JSON.parse(fs.readFileSync(payloadPath, 'utf8')); } catch (_) { body = []; }
  }
  const map = new Map(body.map((x) => [x.key, x.value]));
  map.set('FIREBASE_SERVICE_ACCOUNT', saJson);
  map.set('FIREBASE_PROJECT_ID', PROJECT);
  const next = [...map.entries()].map(([key, value]) => ({ key, value }));
  fs.writeFileSync(payloadPath, JSON.stringify(next));
  console.log(JSON.stringify({
    ok: true,
    serviceAccountEmail: admin.email,
    payloadKeys: next.map((x) => x.key),
    saChars: saJson.length,
  }));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
