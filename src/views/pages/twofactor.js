'use strict';
/** Staff two-step sign-in: set up an authenticator app, see recovery codes once, manage them. */
const { html, raw } = require('../../lib/html');
const { page } = require('../layout');
const { icon, csrf, field } = require('../components');

const card = (req, inner) => page(req, {
  title: 'Two-step sign-in',
  body: html`<section class="auth auth--solo"><div class="auth__card card tfa">${inner}</div></section>`,
});

function twoFactorSetup(req, { qr, secret, error = '' }) {
  const grouped = secret.match(/.{1,4}/g).join(' ');
  return card(req, html`
    <p class="eyebrow">${icon('shield')} Staff security</p>
    <h1>Turn on two-step sign-in</h1>
    <p class="muted">Staff accounts can see private reports and change other members’ accounts, so a password alone is not enough. You will need your phone each time you open the admin area.</p>
    <ol class="tfa__steps">
      <li>Install <strong>Google Authenticator</strong> or <strong>Microsoft Authenticator</strong> on your phone.</li>
      <li>In the app, add an account and scan this code.</li>
      <li>Type the 6-digit code the app shows.</li>
    </ol>
    <div class="tfa__qr" role="img" aria-label="QR code for your authenticator app">${raw(qr)}</div>
    <p class="small muted">Cannot scan? Enter this key in the app instead:</p>
    <p class="tfa__key" data-tfa-key>${grouped}</p>
    <form method="post" action="/admin/2fa/setup" class="stack">${csrf(req)}
      ${error ? html`<div class="banner banner--warn" role="alert">${icon('alert')}<div>${error}</div></div>` : ''}
      ${field({ name: 'code', label: '6-digit code', required: true, inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 7, pattern: '[0-9 ]{6,7}' })}
      <button class="btn btn--primary btn--block" type="submit">${icon('lock')} Turn on two-step sign-in</button>
    </form>`);
}

function twoFactorCodes(req, { codes, fresh = true }) {
  return card(req, html`
    <p class="eyebrow">${icon('check')} ${fresh ? 'Two-step sign-in is on' : 'New recovery codes'}</p>
    <h1>Save your recovery codes</h1>
    <div class="banner banner--warn">${icon('alert')}<div><strong>This is the only time these codes are shown.</strong> Each one works once if you lose your phone. Write them down or save them in a password manager, not in a chat or email.</div></div>
    <ul class="tfa__codes">${codes.map((c) => html`<li><code>${c}</code></li>`)}</ul>
    <div class="row row--wrap">
      <button class="btn btn--ghost" type="button" data-print>${icon('print')} Print</button>
      <a class="btn btn--primary" href="/admin">I have saved them, continue</a>
    </div>`);
}

function twoFactorStatus(req, { left, enabledAt, error = '' }) {
  return card(req, html`
    <p class="eyebrow">${icon('shield')} Staff security</p>
    <h1>Two-step sign-in is on</h1>
    <p class="muted">Turned on ${enabledAt ? new Date(enabledAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}. You have <strong>${left}</strong> unused recovery ${left === 1 ? 'code' : 'codes'}.</p>
    ${left <= 2 ? html`<div class="banner banner--warn">${icon('alert')}<div>You are running low on recovery codes. Make new ones below.</div></div>` : ''}
    <form method="post" action="/admin/2fa/recovery" class="stack">${csrf(req)}
      ${error ? html`<div class="banner banner--warn" role="alert">${icon('alert')}<div>${error}</div></div>` : ''}
      ${field({ name: 'code', label: 'Current 6-digit code', required: true, inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 7, hint: 'Making new codes cancels the old ones.' })}
      <button class="btn btn--ghost btn--block" type="submit">Make new recovery codes</button>
    </form>
    <p class="small muted">Lost your phone? Ask a super admin to reset your two-step sign-in from your account page.</p>`);
}

module.exports = { twoFactorSetup, twoFactorCodes, twoFactorStatus };
