'use strict';
/**
 * Firebase Cloud Functions entry point.
 *
 * Deploys the whole Express app as one HTTPS function ("app"). Firebase Hosting sits in front of it
 * (see firebase.json): static files come from the CDN and every other request is rewritten to this
 * function. Data, Auth and Storage are all on Firebase.
 *
 * Required secrets (firebase functions:secrets:set NAME):
 *   WEB_API_KEY
 * Optional: FIREBASE_STORAGE_BUCKET, ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL, …
 */
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const webApiKey = defineSecret('WEB_API_KEY');

let app = null;
let booting = null;

function boot() {
  if (!booting) {
    booting = (async () => {
      const { init } = require('./src/bootstrap');
      const { createApp } = require('./src/app');
      await init(); // seeds categories and creates the first super admin on a brand-new project
      app = createApp();
    })().catch((err) => { booting = null; throw err; });
  }
  return booting;
}

exports.app = onRequest(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
    concurrency: 40,
    maxInstances: 5,
    invoker: 'public',
    secrets: [webApiKey],
  },
  async (req, res) => {
    try {
      await boot();
      app(req, res);
    } catch (err) {
      console.error('[boot] CampusFind failed to start:', err);
      res.status(503).type('text/plain').send('CampusFind is starting up. Please try again in a moment.');
    }
  }
);
