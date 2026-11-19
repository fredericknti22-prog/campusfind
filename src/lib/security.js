'use strict';
const crypto = require('crypto');
const config = require('../config');

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Security headers (doc section 20). CSP forbids inline script/style, so XSS has little to work with. */
function securityHeaders(req, res, next) {
  const cf = Boolean(config.turnstile && config.turnstile.siteKey && config.turnstile.secret && config.turnstile.hostnames.length);
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      cf ? "script-src 'self' https://challenges.cloudflare.com" : "script-src 'self'", // Cloudflare Turnstile, only when enabled
      ...(cf ? ['frame-src https://challenges.cloudflare.com'] : []),
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.removeHeader('X-Powered-By');
  next();
}

/** Minimal in-memory sliding-window limiter. Fine for a single instance; swap for Redis when scaling out. */
function rateLimit({ windowMs, max, key, message = 'Too many requests have been received. Please wait a few minutes and try again.' }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, arr] of hits) {
      const fresh = arr.filter((t) => t > cutoff);
      if (fresh.length) hits.set(k, fresh); else hits.delete(k);
    }
  }, Math.min(windowMs, 60_000));
  timer.unref();

  const limiter = (req, res, next) => {
    const k = (key ? key(req) : req.ip) || 'anon';
    const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => t > now - windowMs);
    if (arr.length >= max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).render('error', { status: 429, title: 'Too many requests', message });
    }
    arr.push(now);
    hits.set(k, arr);
    next();
  };
  limiter.reset = () => hits.clear();
  return limiter;
}

module.exports = { randomToken, sha256, safeEqual, securityHeaders, rateLimit };
