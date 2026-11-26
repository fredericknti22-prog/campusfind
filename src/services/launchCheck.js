'use strict';
/**
 * Launch checklist on the Super admin page: which go-live settings are still missing.
 * Reads configuration names and counts only. It never shows a secret or a setting's value.
 *
 * evaluate() is pure (tested directly); gather() collects the few database facts it needs.
 */
const config = require('../config');
const settings = require('./settings');
const { col } = require('../store');

const TEST_EMAIL = /(@|\.)(campus\.test|example\.(com|org|net))$|\.test$/i;
const isTestEmail = (email) => TEST_EMAIL.test(String(email || '').trim());

/** Database facts: test accounts left from development, and staff two-step status. */
async function gather() {
  const snap = await col('users').select('email', 'deleted_at').limit(5000).get();
  const testAccounts = snap.docs.map((d) => d.data()).filter((u) => !u.deleted_at && isTestEmail(u.email)).length;
  const staff = await require('../repo/users').staff();
  return {
    testAccounts,
    staffWithout2fa: staff.filter((s) => !s.totp_secret).length,
    superadminNeverSignedIn: staff.some((s) => s.role === 'superadmin' && !s.last_login_at),
  };
}

/**
 * @returns {{ items: Array<{key, level:'must'|'should', ok:boolean, title, fix}>, mustLeft:number, shouldLeft:number }}
 */
function evaluate({ cfg = config, momo = settings.momo(), supportEmail = settings.supportEmail(), facts = {} } = {}) {
  const t = cfg.turnstile || {};
  const legal = cfg.legal || {};
  const items = [
    {
      key: 'payments', level: 'must', ok: Boolean(cfg.payments.paystackSecret || momo.number),
      title: 'Members can pay for promotions',
      fix: 'Add your Mobile Money number under "Payments & contact details" below, or add PAYSTACK_SECRET_KEY in Vercel for automatic payments (then set the Paystack webhook to /pay/webhook).',
    },
    {
      key: 'turnstile', level: 'must', ok: Boolean(t.siteKey && t.secret && (t.hostnames || []).length),
      title: 'Bot check on sign-up and sign-in',
      fix: 'Create a Cloudflare Turnstile widget, then add TURNSTILE_SITE_KEY, TURNSTILE_SECRET and TURNSTILE_HOSTNAMES in Vercel.',
    },
    {
      key: 'staff2fa', level: 'must', ok: !facts.staffWithout2fa && !facts.superadminNeverSignedIn,
      title: 'Staff accounts are locked down',
      fix: facts.superadminNeverSignedIn
        ? 'The super admin has never signed in. Set its password with "Forgot password", sign in, and turn on two-step sign-in.'
        : `${facts.staffWithout2fa || 0} staff account(s) have no two-step sign-in. Ask each to turn it on in their profile and keep the recovery codes offline.`,
    },
    {
      key: 'testAccounts', level: 'must', ok: !facts.testAccounts,
      title: 'No test accounts left in the live database',
      fix: `${facts.testAccounts || 0} account(s) use a test address (for example @campus.test). Delete them under Members.`,
    },
    {
      key: 'legal', level: 'must',
      ok: Boolean(legal.governingLaw && legal.postalAddress && legal.entity && legal.entity !== 'the CampusFind team'),
      title: 'Legal pages name who runs CampusFind',
      fix: 'Add LEGAL_ENTITY (your registered business or your own name), GOVERNING_LAW (for example "Ghana") and POSTAL_ADDRESS in Vercel. Have a lawyer read the Terms and Privacy pages.',
    },
    {
      key: 'domains', level: 'should', ok: (cfg.allowedEmailDomains || []).length > 0,
      title: 'Only students can join',
      fix: 'If CampusFind is for students only, add ALLOWED_EMAIL_DOMAINS in Vercel, for example "ug.edu.gh,knust.edu.gh".',
    },
    {
      key: 'support', level: 'should', ok: Boolean(supportEmail),
      title: 'Support email is published',
      fix: 'Add a support address under "Payments & contact details" below. Until then, help goes through the in-app chat.',
    },
    {
      key: 'copyright', level: 'should', ok: Boolean(legal.dmca && legal.dmca.agentName && legal.dmca.email),
      title: 'Copyright contact is named',
      fix: 'Add DMCA_AGENT_NAME, DMCA_AGENT_EMAIL and DMCA_AGENT_ADDRESS in Vercel so owners know where to send copyright notices.',
    },
    {
      key: 'assistant', level: 'should', ok: Boolean(cfg.assistant && cfg.assistant.apiKey),
      title: 'AI assistant is set up',
      fix: 'Add ANTHROPIC_API_KEY in Vercel, or leave the assistant off. Members then see that it is not available.',
    },
    {
      key: 'baseUrl', level: 'must', ok: /^https:\/\//.test(cfg.baseUrl || ''),
      title: 'Site address uses https',
      fix: 'Set BASE_URL in Vercel to the public https:// address. In Firebase console, set the password-reset action URL to that address followed by /reset.',
    },
  ];
  return {
    items,
    mustLeft: items.filter((i) => i.level === 'must' && !i.ok).length,
    shouldLeft: items.filter((i) => i.level === 'should' && !i.ok).length,
  };
}

module.exports = { evaluate, gather, isTestEmail };
