'use strict';
/**
 * Firebase Admin SDK bootstrap. Everything server-side goes through here:
 *   Authentication -> credentials, password hashing, reset emails
 *   Firestore      -> all application data
 *   Storage        -> listing photos
 * With FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST set (firebase emulators) no credentials are needed.
 */
const { initializeApp, getApps, getApp, cert, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
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
  // Emulators need no real credential. Skip the SDK's probe of Google's metadata server (slow, noisy).
  process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
} else if (fb.serviceAccount) {
  options.credential = cert(fb.serviceAccount);
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.K_SERVICE || process.env.FUNCTION_TARGET) {
  // Cloud Run / Cloud Functions: the runtime service account is picked up automatically.
  options.credential = applicationDefault();
} else {
  throw new Error(
    'FIREBASE_SERVICE_ACCOUNT is not set. On Render/Vercel/Docker hosts, paste the Firebase service-account JSON (or base64) into that env var. On Cloud Run you can leave it empty and use the runtime service account.'
  );
}

const app = getApps().length ? getApp() : initializeApp(options);
const db = getFirestore(app);
try { db.settings({ ignoreUndefinedProperties: true }); } catch (_) { /* already configured */ }

module.exports = {
  app,
  db,
  auth: getAuth(app),
  bucket: getStorage(app).bucket(),
  FieldValue,
};
