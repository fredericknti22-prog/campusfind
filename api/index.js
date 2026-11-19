'use strict';
/**
 * Vercel entry point: the whole Express app runs as one serverless function (see vercel.json).
 * Static files in /public are served by Vercel's CDN; every other request is rewritten to this handler.
 * The app is created lazily on the first request of each instance.
 */
let app = null;
let booting = null;

function boot() {
  if (!booting) {
    booting = (async () => {
      const { init } = require('../src/bootstrap');
      const { createApp } = require('../src/app');
      await init(); // seeds categories and creates the first super admin on a brand-new project
      app = createApp();
    })().catch((err) => { booting = null; throw err; });
  }
  return booting;
}

/**
 * Vercel decorates req/res with its own helpers (res.redirect answers 307 and keeps the POST method, res.send/json/status,
 * and lazy req.body/query/cookies parsers). They shadow Express's own prototype methods, so remove them and let Express
 * behave exactly as it does under `node src/server.js` (302 after a form post, its own body parsers, ETags, etc.).
 */
function useExpressHelpers(req, res) {
  for (const k of ['status', 'send', 'json', 'redirect', 'sendStatus']) {
    if (Object.prototype.hasOwnProperty.call(res, k)) { try { delete res[k]; } catch (_) { /* keep Vercel's */ } }
  }
  for (const k of ['body', 'query', 'cookies']) {
    if (Object.prototype.hasOwnProperty.call(req, k)) { try { delete req[k]; } catch (_) { /* keep Vercel's */ } }
  }
}

module.exports = async (req, res) => {
  try {
    useExpressHelpers(req, res);
    await boot();
    return app(req, res);
  } catch (err) {
    console.error('[boot] CampusFind failed to start:', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    // DEBUG_BOOT=1 (temporary, for diagnosing a failed first boot) reveals the error message. Never leave it on.
    const detail = process.env.DEBUG_BOOT === '1' ? `\n\n${String(err && err.message).slice(0, 600)}\n${String(err && err.stack).split('\n').slice(1, 4).join('\n')}` : '';
    res.end('CampusFind is starting up. Please try again in a moment.' + detail);
    return undefined;
  }
};
