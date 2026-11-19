'use strict';
/**
 * Firebase Admin SDK bootstrap for Auth and Storage.
 * Application data lives in Supabase Postgres (see src/store.js / src/db.js).
 * With FIREBASE_AUTH_EMULATOR_HOST / FIREBASE_STORAGE_EMULATOR_HOST set, no credentials are needed for those services.
 */
const { initializeApp, getApps, getApp, cert, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');
const config = require('./config');

const fb = config.firebase;

if (!fb.projectId) {
  throw new Error('FIREBASE_PROJECT_ID is not set. Add it to your environment (see .env.example) or run against the emulators (npm run emulators).');
}
if (!fb.emulator) {
  if (!fb.webApiKey) throw new Error('FIREBASE_WEB_API_KEY (or WEB_API_KEY on Cloud Functions) is not set. Find it in Firebase console > Project settings > General > Web API Key.');
  if (!fb.serviceAccount && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !config.isProd) {
    throw new Error('No Firebase credentials found. Set FIREBASE_SERVICE_ACCOUNT (JSON or base64) or GOOGLE_APPLICATION_CREDENTIALS.');
  }
}

const options = { projectId: fb.projectId };
if (fb.storageBucket) options.storageBucket = fb.storageBucket;
const onGcp = Boolean(process.env.K_SERVICE || process.env.FUNCTION_TARGET);
const hasExplicitCreds = Boolean(fb.serviceAccount || process.env.GOOGLE_APPLICATION_CREDENTIALS);
const adminReady = Boolean(fb.emulator || fb.serviceAccount || hasExplicitCreds || onGcp);
if (fb.emulator || !adminReady) {
  // Skip metadata-server probes on emulators and non-GCP hosts (Render).
  process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
}
if (fb.emulator) {
  // Auth/Storage emulators do not need credentials.
} else if (fb.serviceAccount) {
  options.credential = cert(fb.serviceAccount);
} else if (hasExplicitCreds || onGcp) {
  options.credential = applicationDefault();
} else if (config.isProd) {
  console.warn('[firebase] FIREBASE_SERVICE_ACCOUNT is not set. Using Identity Toolkit REST for sign-up/sign-in; Admin APIs stay off until a service account is configured.');
} else {
  options.credential = applicationDefault();
}

const app = getApps().length ? getApp() : initializeApp(options);

module.exports = {
  app,
  auth: getAuth(app),
  bucket: getStorage(app).bucket(),
  adminReady,
};
