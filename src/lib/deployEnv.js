'use strict';
/** Blue/green: is this request being served on a staged (not yet live) build? Only production builds can be candidates. */
const config = require('../config');

let liveHost = '';
try { liveHost = new URL(config.baseUrl).hostname; } catch (e) { /* no base URL */ }

function isCandidate(req) {
  if (!config.isProd || !liveHost) return false;
  const host = String(req.hostname || '').toLowerCase();
  return Boolean(host) && host !== liveHost;
}

module.exports = { isCandidate, liveHost: () => liveHost };
