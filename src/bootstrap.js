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
  } catch (err) {
    console.warn(`[bootstrap] Super-admin bootstrap deferred: ${err.message}`);
  }
  const { adminReady } = require('./firebase');
  if (adminReady) {
    try {
      await require('./services/twofactor').breakGlass();
    } catch (err) {
      console.warn(`[bootstrap] 2FA break-glass deferred: ${err.message}`);
    }
  }
  await cleanupSessions();
  await cleanupRateLimits();
  await require('./repo/messages').cleanupOld();
  await require('./services/assistant').cleanupChats();
  await liftExpiredSuspensions();
  await require('./services/whatsNew').seedFirst();
}

module.exports = { init };
