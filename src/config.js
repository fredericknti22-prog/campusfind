'use strict';
require('./env');
const root = require('path').resolve(__dirname, '..');
const env = process.env;
const isProd = env.NODE_ENV === 'production' || Boolean(env.REPLIT_DEPLOYMENT) || Boolean(env.K_SERVICE);
const port = Number(env.PORT) || 3000;

const list = (v) => (v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** FIREBASE_SERVICE_ACCOUNT may be raw JSON or base64-encoded JSON (easier to store as a secret). */
function parseServiceAccount(v) {
  if (!v) return null;
  try {
    const text = v.trim().startsWith('{') ? v : Buffer.from(v, 'base64').toString('utf8');
    return JSON.parse(text);
  } catch (_) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON (or base64-encoded JSON).');
  }
}

const emulator = Boolean(env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST);
// Inside Cloud Functions the platform provides FIREBASE_CONFIG ({ projectId, storageBucket, ... }).
let platformConfig = {};
try { platformConfig = JSON.parse(env.FIREBASE_CONFIG || '{}'); } catch (_) { /* not running on Firebase */ }
const projectId = env.FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT || platformConfig.projectId || '';

module.exports = {
  root,
  isProd,
  port,
  appName: 'CampusFind',
  campusName: env.CAMPUS_NAME || 'your campus',
  // Photos need Firebase Storage. Set PHOTOS_ENABLED=false to run without it.
  photosEnabled: env.PHOTOS_ENABLED !== 'false',
  // Where photos are kept: "storage" (Firebase Storage, needs the Blaze plan) or "firestore"/"db" (Supabase/Postgres document store, re-encoded to WebP).
  photoStore: (env.PHOTO_STORE === 'firestore' || env.PHOTO_STORE === 'db') ? 'firestore' : 'storage',
  // Supabase Postgres URI (Settings → Database → Connection string → URI). Also accepted as DATABASE_URL.
  databaseUrl: (env.SUPABASE_DB_URL || env.DATABASE_URL || '').trim(),
  baseUrl: (env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  // Blue/green (scripts/bluegreen.js): which colour this build is. A production build reached on any host other than
  // BASE_URL's is a staged candidate and shows a "Test environment" banner.
  deployColor: /^(blue|green)$/.test(env.DEPLOY_COLOR || '') ? env.DEPLOY_COLOR : '',
  // Empty list = any email accepted. Example: "uni.edu,students.uni.edu"
  allowedEmailDomains: list(env.ALLOWED_EMAIL_DOMAINS),
  publicBrowsing: env.PUBLIC_BROWSING !== 'false',
  // Staff must use an authenticator app to open the admin area. On by default in production; STAFF_2FA=off disables it.
  security: { staff2fa: env.STAFF_2FA ? !['off', 'false', '0'].includes(env.STAFF_2FA.toLowerCase()) : isProd },
  trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) : isProd ? 1 : 0,
  firebase: {
    projectId,
    emulator,
    // Web API key: used only for the Identity Toolkit REST calls (password sign-in, reset email).
    // Cloud Functions reserves names starting with FIREBASE_, so a deployed function uses WEB_API_KEY instead.
    webApiKey: env.FIREBASE_WEB_API_KEY || env.WEB_API_KEY || (emulator ? 'emulator-key' : ''),
    storageBucket: env.FIREBASE_STORAGE_BUCKET || platformConfig.storageBucket || (projectId ? `${projectId}.appspot.com` : ''),
    serviceAccount: parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT),
  },
  // Details shown on the legal pages. Set these before launch (see .env.example).
  // Money. Amounts are stored in pesewas (1 cedi = 100 pesewas) so there are no rounding surprises.
  currency: { code: 'GHS', symbol: 'GH₵' },
  // Paid promotions. Prices can be changed with PRICE_FEATURED / PRICE_BUSINESS / PRICE_PREMIUM (in cedis).
  // Online payment uses Paystack (cards and Mobile Money in Ghana). Without PAYSTACK_SECRET_KEY orders are paid
  // manually (for example by Mobile Money) and confirmed by an admin; see MANUAL_PAYMENT_INSTRUCTIONS.
  payments: {
    paystackSecret: (env.PAYSTACK_SECRET_KEY || '').trim(),
    manualInstructions: (env.MANUAL_PAYMENT_INSTRUCTIONS || '').trim(),
    // The Mobile Money account members pay into when Paystack is off. Shown on the order page only.
    momo: { number: (env.MOMO_NUMBER || '').trim(), name: (env.MOMO_NAME || '').trim(), network: (env.MOMO_NETWORK || '').trim() },
    prices: {
      featured: Math.round((Number(env.PRICE_FEATURED) || 10) * 100),
      business: Math.round((Number(env.PRICE_BUSINESS) || 50) * 100),
      premium: Math.round((Number(env.PRICE_PREMIUM) || 100) * 100),
    },
    businessDays: Number(env.BUSINESS_DAYS) || 30,
  },
  // AI assistant (optional). Needs an Anthropic API key; without one the assistant page says it is not available.
  assistant: {
    apiKey: (env.ANTHROPIC_API_KEY || '').trim(),
    model: (env.ASSISTANT_MODEL || 'claude-haiku-5-5').trim(),
    maxTokens: 700,
    maxUserChars: 600,
    perHour: Number(env.ASSISTANT_PER_HOUR) || 20,
    perDay: Number(env.ASSISTANT_PER_DAY) || 60,
  },
  // Minimum age to register. The Terms say 16; raise it where the local age of digital consent is higher.
  // Never set this below 13 (US COPPA) or below the local age of digital consent.
  minAge: Math.max(13, Math.floor(Number(env.MIN_AGE)) || 16),
  // Cloudflare Turnstile bot check (src/services/turnstile.js). Off until all three are set.
  // TURNSTILE_HOSTNAMES: comma-separated frontend hostnames siteverify must report, e.g. campusfind-ruby.vercel.app
  turnstile: {
    siteKey: (env.TURNSTILE_SITE_KEY || '').trim(),
    secret: (env.TURNSTILE_SECRET || '').trim(),
    hostnames: (env.TURNSTILE_HOSTNAMES || '').split(',').map((h) => h.trim()).filter(Boolean),
  },
  legal: {
    entity: env.LEGAL_ENTITY || 'the CampusFind team',
    contactEmail: (env.CONTACT_EMAIL || '').trim(), // internal only, never shown on public pages
    // Public support address (a business mailbox, not a personal one). Without it the pages point to the Help centre chat.
    supportEmail: (env.SUPPORT_EMAIL || '').trim(),
    governingLaw: (env.GOVERNING_LAW || '').trim(), // e.g. "Kenya" or "England and Wales"
    // Physical mailing address of the operator. Shown in the footer and legal pages, and required in any marketing email (CAN-SPAM).
    postalAddress: (env.POSTAL_ADDRESS || '').trim(),
    // US DMCA designated agent (register at https://dmca.copyright.gov/ ; renew every 3 years). Shown on /copyright.
    dmca: {
      agentName: (env.DMCA_AGENT_NAME || '').trim(),
      email: (env.DMCA_AGENT_EMAIL || '').trim(),
      address: (env.DMCA_AGENT_ADDRESS || '').trim(),
      registrationNo: (env.DMCA_REGISTRATION_NO || '').trim(), // e.g. DMCA-1234567
    },
    version: '1.4',
    updated: '8 November 2026',
  },
  session: {
    ttlMs: 7 * 24 * 3600 * 1000,
    adminMs: 30 * 60 * 1000, // step-up admin window
    // Firebase Hosting forwards ONLY a cookie named "__session" to Cloud Run, so production uses that name.
    cookieName: env.SESSION_COOKIE_NAME || (isProd ? '__session' : 'cf_sid'),
  },
  limits: {
    globalPerMin: Number(env.GLOBAL_LIMIT_PER_MIN) || 300,
    registerPerHour: Number(env.REGISTER_LIMIT_PER_HOUR) || 8,
    loginPer15Min: Number(env.LOGIN_LIMIT_PER_15_MIN) || 20,
    imageBytes: 3 * 1024 * 1024,
    imagesPerListing: 4,
    listingsPerDay: 10,
    reportsPerDay: 10,
    messagesPerMin: Number(env.MESSAGES_PER_MIN) || 6,
    messagesPerDay: Number(env.MESSAGES_PER_DAY) || 80,
    falseReportBlock: 3,
    pageSize: 12,
  },
  bootstrapAdmin: {
    email: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
    password: env.ADMIN_PASSWORD || '',
    name: env.ADMIN_NAME || 'Platform Admin',
  },
};
