'use strict';
const config = require('./config');

/** Fail fast on a mis-configured production deployment, and warn about soft problems. */
function checkProductionConfig() {
  if (!config.isProd || config.firebase.emulator) return;
  const problems = [];
  const needsBucket = config.photosEnabled && config.photoStore === 'storage';
  if (needsBucket && !process.env.FIREBASE_STORAGE_BUCKET) problems.push('FIREBASE_STORAGE_BUCKET is not set (find it in Firebase console > Storage).');
  if (problems.length) throw new Error(problems.join(' '));
  if (!/^https:\/\//.test(config.baseUrl)) console.warn(`[config] BASE_URL is "${config.baseUrl}". Set it to your public https:// address.`);
  if (config.firebase.serviceAccount) console.warn('[config] Using FIREBASE_SERVICE_ACCOUNT. On Cloud Run prefer the runtime service account and leave it unset.');
}

process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', (err) => { console.error('[uncaughtException]', err); process.exit(1); });

async function main() {
  checkProductionConfig();
  require('./firebase');
  const { init } = require('./bootstrap');
  const { cleanupSessions, liftExpiredSuspensions } = require('./middleware/session');
  const { cleanupRateLimits } = require('./middleware/sharedLimit');
  const { createApp } = require('./app');

  await init();
  setInterval(() => {
    cleanupSessions().catch((e) => console.error('[cleanup]', e.message));
    cleanupRateLimits().catch((e) => console.error('[cleanup]', e.message));
    require('./repo/messages').cleanupOld().catch((e) => console.error('[cleanup]', e.message));
    require('./services/assistant').cleanupChats().catch((e) => console.error('[cleanup]', e.message));
    liftExpiredSuspensions().catch((e) => console.error('[cleanup]', e.message));
  }, 60 * 60 * 1000).unref();

  const server = createApp().listen(config.port, '0.0.0.0', () => {
    const mode = config.firebase.emulator ? 'Firebase emulators' : `Firebase project ${config.firebase.projectId}`;
    console.log(`CampusFind running on ${config.baseUrl} (${config.isProd ? 'production' : 'development'}, ${mode})`);
  });
  // Cloud Run allows a short grace period after SIGTERM: stop accepting work, then exit.
  server.keepAliveTimeout = 65_000; // longer than Google's load balancer idle timeout (60s)
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('CampusFind failed to start:', err.message);
  process.exit(1);
});
