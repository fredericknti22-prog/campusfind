'use strict';
/**
 * Rate limiting that holds across server instances.
 *
 * The plain in-memory limiter in lib/security.js counts per process. On Vercel (or Cloud Run with several instances)
 * every instance has its own memory, so an attacker's guesses are spread over several counters and the real limit
 * is a multiple of the intended one. Sensitive endpoints (sign-in, sign-up, password reset) therefore also count in
 * Firestore: one document per client key and time window, created with a transaction.
 *
 * Design choices:
 *  - The cheap in-memory check runs first, so most abusive traffic is refused without touching the database.
 *  - Only the endpoints listed in the routes use this. Counting every request would burn through the free write quota.
 *  - Keys are stored as SHA-256 hashes, so no IP address or email is written to the database.
 *  - If the shared store is unavailable the request is allowed on the in-memory limit alone, so an outage never locks everyone out.
 *  - Fixed windows: a client can burst up to twice the limit across a window boundary. That is acceptable for these limits.
 */
const { rateLimit, sha256 } = require('../lib/security');
const { db, col, deleteWhere } = require('../store');

const RATE = () => col('rate_limits');

function sharedRateLimit({ name, windowMs, max, key, message = 'Too many requests have been received. Please wait a few minutes and try again.' }) {
  const local = rateLimit({ windowMs, max, key, message });

  const limiter = (req, res, next) => local(req, res, async () => {
    const k = (key ? key(req) : req.ip) || 'anon';
    const now = Date.now();
    const windowIndex = Math.floor(now / windowMs);
    const ref = RATE().doc(sha256(`${name}:${k}:${windowIndex}`));
    let count = 0;
    try {
      count = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const n = (snap.exists ? snap.data().count : 0) + 1;
        tx.set(ref, { name, count: n, window: windowIndex, expires_at: (windowIndex + 1) * windowMs });
        return n;
      });
    } catch (err) {
      console.error('[ratelimit] shared store unavailable, using the per-instance limit only:', err.code || err.message);
    }
    if (count > max) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil(((windowIndex + 1) * windowMs - now) / 1000)));
      return res.status(429).render('error', { status: 429, title: 'Too many requests', message });
    }
    return next();
  });

  limiter.reset = local.reset;
  return limiter;
}

/** Remove counters whose window has ended. Run at start-up and hourly. */
async function cleanupRateLimits() {
  await deleteWhere(RATE().where('expires_at', '<', Date.now()));
}

module.exports = { sharedRateLimit, cleanupRateLimits };
