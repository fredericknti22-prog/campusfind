'use strict';
/**
 * One-command local development: runs inside `firebase emulators:exec` (npm run start:emulated).
 * Seeds demo data into the emulators, then starts the app. Data lives only as long as the emulators.
 * The local super admin below exists only in the emulator and never touches a real project.
 */
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-campusfind';
process.env.FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT;
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.GCLOUD_PROJECT}.appspot.com`;
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'owner@campusfind.local';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Owner-Passw0rd-2026';

const { seed, DEMO_PASSWORD } = require('./seed-demo');

seed()
  .then(() => {
    console.log(`\nLocal super admin (emulator only): ${process.env.ADMIN_EMAIL} / ${process.env.ADMIN_PASSWORD}`);
    console.log(`Demo members: amara@demo.campus ... / ${DEMO_PASSWORD}`);
    require('../src/server');
  })
  .catch((err) => { console.error(err); process.exit(1); });
