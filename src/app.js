'use strict';
const path = require('path');
const express = require('express');
const compression = require('compression');
const config = require('./config');
const settings = require('./services/settings');
const images = require('./services/images');
const { db } = require('./store');
const { securityHeaders, rateLimit } = require('./lib/security');
const { sessionMiddleware } = require('./middleware/session');
const { restoreMultipartBody } = require('./middleware/rawbody');
const { csrfGuard, isStaff } = require('./middleware/auth');
const { renderMiddleware } = require('./views');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(securityHeaders);
  // Vercel is the only CampusFind site. Any old Render copy forwards visitors there (path and query kept).
  app.use((req, res, next) => {
    if (config.sandbox) { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); return next(); } // the Render sandbox stays put
    if (/\.onrender\.com$/i.test(req.hostname || '')) return res.redirect(301, 'https://campusfind-ruby.vercel.app' + req.originalUrl);
    next();
  });
  app.use(compression());
  app.use(restoreMultipartBody); // photo uploads under Cloud Functions (no effect elsewhere)

  // Behind a TLS-terminating proxy (Cloud Run, Firebase Hosting, Replit) send plain-HTTP visitors to HTTPS.
  if (config.isProd) {
    app.use((req, res, next) => {
      if (req.headers['x-forwarded-proto'] === 'http' && req.path !== '/healthz') {
        return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
      }
      return next();
    });
  }

  // Liveness probe for Cloud Run / Replit / uptime monitors (no session, no personal data).
  app.use((req, res, next) => { if (config.deployColor) res.setHeader('X-Deploy-Color', config.deployColor); next(); });
  app.get('/healthz', async (req, res) => {
    try {
      await db.collection('settings').doc('platform').get();
      res.set('Cache-Control', 'no-store').json({ status: 'ok', color: config.deployColor || null, live: !require('./lib/deployEnv').isCandidate(req) });
    } catch (err) {
      res.status(503).set('Cache-Control', 'no-store').json({ status: 'unavailable' });
    }
  });

  app.get('/favicon.ico', (req, res) => res.redirect(301, '/img/favicon.png'));
  app.use(express.static(path.join(config.root, 'public'), {
    index: false,
    maxAge: config.isProd ? '1h' : 0,
    setHeaders: (res, file) => {
      if (/[\\/]fonts[\\/]/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      if (/[\\/]sw\.js$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); // updates must reach users quickly
      // pages link CSS/JS as "?v=<content hash>" (layout.js), so those URLs never change and may be kept for a year;
      // anything requested without a version must be revalidated
      if (/[\\/](css|js)[\\/]/.test(file)) res.setHeader('Cache-Control', res.req && res.req.query && res.req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
      if (/\.webmanifest$/.test(file)) res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    },
  }));
  // Listing photos come from Firebase Storage through the app (bucket stays private). No session needed.
  app.get('/uploads/:file', images.serve);

  // Every dynamic response is personal. "private" also makes Firebase Hosting / CDNs keep Set-Cookie intact
  // (they strip cookies from anything cacheable), and "no-store" keeps it out of shared caches and the back cache.
  app.use((req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });

  // Paystack calls this with a signed JSON body. It needs the raw bytes, no session and no CSRF token.
  const payments = require('./routes/payments');
  app.post('/pay/webhook', express.raw({ type: '*/*', limit: '100kb' }), payments.webhook);

  app.use(express.urlencoded({ extended: false, limit: '30kb' }));
  app.use(sessionMiddleware);
  app.use(renderMiddleware);
  app.use(rateLimit({ windowMs: 60_000, max: config.limits.globalPerMin }));

  // Maintenance mode (super admin switch). Staff and sign-in pages stay reachable.
  app.use((req, res, next) => {
    if (!settings.bool('maintenance_mode') || isStaff(req.user)) return next();
    if (['/login', '/logout', '/admin/login'].includes(req.path)) return next();
    return res.status(503).set('Retry-After', '600').render('maintenance');
  });

  app.use(csrfGuard);

  app.use(require('./routes/public'));
  app.use(require('./routes/auth'));
  app.use(require('./routes/listings'));
  app.use(require('./routes/account'));
  app.use(require('./routes/messages'));
  app.use(require('./routes/help'));
  app.use(require('./routes/assistant'));
  app.use(payments);
  app.use(require('./routes/favorites'));
  app.use(require('./routes/alerts'));
  app.use(require('./routes/reviews'));
  app.use(require('./routes/offers'));
  app.use(require('./routes/admin'));

  app.use((req, res) => {
    res.status(404).render('error', { status: 404, title: 'Page not found', message: 'We could not find that page.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use(async (err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      return res.status(413).render('error', { status: 413, title: 'Too large', message: 'That request was too large.' });
    }
    if (err && err.status >= 400 && err.status < 500 && !res.headersSent) {
      return res.status(err.status).render('error', { status: err.status, title: 'Bad request', message: 'That request could not be understood.' });
    }
    console.error('[error]', req.method, req.originalUrl, err);
    await require('./services/errorLog').record({ source: 'server', message: err && err.message, stack: err && err.stack, path: req.originalUrl, ua: req.get('user-agent') });
    if (res.headersSent) return next(err);
    return res.status(500).render('error', {
      status: 500, title: 'Something went wrong', message: 'An unexpected error occurred. It has been logged. Please try again.',
    });
  });

  return app;
}

module.exports = { createApp };
