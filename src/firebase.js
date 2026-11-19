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
if (fb.emulator) {
  process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
} else {
  options.credential = fb.serviceAccount ? cert(fb.serviceAccount) : applicationDefault();
}

const app = getApps().length ? getApp() : initializeApp(options);

module.exports = {
  app,
  auth: getAuth(app),
  bucket: getStorage(app).bucket(),
};
