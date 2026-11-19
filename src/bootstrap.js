'use strict';
/** One-time and periodic start-up work for the Firebase backend. */
const categories = require('./repo/categories');
const settings = require('./services/settings');
const { bootstrapSuperAdmin, promoteConfiguredOwner } = require('./services/auth');
const { cleanupSessions, liftExpiredSuspensions } = require('./middleware/session');
const { cleanupRateLimits } = require('./middleware/sharedLimit');

async function init() {
  await categories.seedDefaults();
  await categories.ensureDefaults();
  await settings.refresh(true);
  await bootstrapSuperAdmin();
  await promoteConfiguredOwner();
  await cleanupSessions();
  await cleanupRateLimits();
  await require('./repo/messages').cleanupOld();
  await require('./services/assistant').cleanupChats();
  await liftExpiredSuspensions();
  await require('./services/twofactor').breakGlass();
  await require('./services/whatsNew').seedFirst();
}

module.exports = { init };
