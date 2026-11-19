'use strict';
/** One-time and periodic start-up work (Supabase Postgres + Firebase Auth/Storage). */
const { initDb } = require('./db');
const categories = require('./repo/categories');
const settings = require('./services/settings');
const { bootstrapSuperAdmin, promoteConfiguredOwner } = require('./services/auth');
const { cleanupSessions, liftExpiredSuspensions } = require('./middleware/session');
const { cleanupRateLimits } = require('./middleware/sharedLimit');

async function init() {
  await initDb();
  await categories.seedDefaults();
  await categories.ensureDefaults();
  await settings.refresh(true);
  try {
    await bootstrapSuperAdmin();
    await promoteConfiguredOwner();
    await require('./services/twofactor').breakGlass();
  } catch (err) {
    // Render (and other non-GCP hosts) need FIREBASE_SERVICE_ACCOUNT; still bring the HTTP server up.
    console.warn(`[bootstrap] Firebase Auth setup deferred: ${err.message}`);
  }
  await cleanupSessions();
  await cleanupRateLimits();
  await require('./repo/messages').cleanupOld();
  await require('./services/assistant').cleanupChats();
  await liftExpiredSuspensions();
  await require('./services/whatsNew').seedFirst();
}

module.exports = { init };
