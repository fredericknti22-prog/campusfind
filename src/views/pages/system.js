'use strict';
const { html } = require('../../lib/html');
const { shell } = require('./admin');
const { icon, field, csrf, badge, timeAgo, fmtDate, confirmBtn } = require('../components');

const fmtBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtUptime = (s) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};

function systemPage(req, d) {
  const { settings: s, health, staff, security, counts, errors = {}, values = {} } = d;
  const toggle = (name, label, hint, on) => html`<label class="switch"><input type="checkbox" name="${name}" value="1"${on ? ' checked' : ''}>
    <span class="switch__ui" aria-hidden="true"></span><span><strong>${label}</strong><small>${hint}</small></span></label>`;
  const stat = (k, v) => html`<div class="sysstat"><dt>${k}</dt><dd>${v}</dd></div>`;

  return shell(req, {
    title: 'Super admin', active: 'system', counts,
    body: html`
      <div class="page-head"><div><p class="eyebrow">${icon('lock')} Platform owner</p><h1>Super admin</h1>
        <p class="muted">Platform settings, staff access, backups and health. Every change on this page is written to the audit log.</p></div></div>

      <section class="card pad" aria-labelledby="h-health">
        <h2 id="h-health">System health</h2>
        <dl class="sysgrid">
          ${stat('Uptime', fmtUptime(health.uptime))}
          ${stat('Node.js', health.node)}
          ${stat('Environment', health.env)}
          ${stat('Firebase project', health.project + (health.emulator ? ' (emulator)' : ''))}
          ${stat('Members', health.users)}
          ${stat('Listings', health.listings)}
          ${stat('Photos in Storage', `${health.uploadFiles}${health.uploadCapped ? '+' : ''} files · ${fmtBytes(health.uploadBytes)}`)}
          ${stat('Active sessions', health.sessions)}
        </dl>
      </section>

      ${d.launch ? launchList(d.launch) : ''}

      ${businessForm(req, d)}

      <div class="grid-2 grid-2--top">
        <form class="card pad stack" method="post" action="/admin/system/settings">${csrf(req)}
          <h2>Platform settings</h2>
          ${errors.settings ? html`<div class="banner banner--warn" role="alert">${icon('alert')}<div>${errors.settings}</div></div>` : ''}
          ${toggle('registration_open', 'Open registration', 'Allow new members to create accounts.', s.registration_open === '1')}
          ${toggle('posting_enabled', 'Allow new listings', 'Disable to pause new listings platform-wide.', s.posting_enabled === '1')}
          ${toggle('assistant_enabled', 'AI assistant', 'Lets signed-in members chat with the CampusFind assistant. It also needs an Anthropic API key to be configured.', s.assistant_enabled === '1')}
          ${toggle('maintenance_mode', 'Maintenance mode', 'Non-staff visitors see a maintenance page. Staff can still sign in.', s.maintenance_mode === '1')}
          <div class="grid-2">
            ${field({ name: 'listings_per_day', label: 'Listings per member per day', type: 'number', value: s.listings_per_day, min: 1, step: '1' })}
            ${field({ name: 'reports_per_day', label: 'Reports per member per day', type: 'number', value: s.reports_per_day, min: 1, step: '1' })}
          </div>
          ${field({ name: 'announcement', label: 'Site-wide announcement', value: s.announcement, maxlength: 200, hint: 'Shown as a banner on every page. Leave empty for none.' })}
          <button class="btn btn--primary" type="submit">Save settings</button>
        </form>

        <div class="stack">
          <section class="card pad stack">
            <h2>Backup &amp; maintenance</h2>
            <form method="post" action="/admin/system/backup">${csrf(req)}
              <button class="btn btn--primary btn--block" type="submit">${icon('arrow')} Download data export (JSON)</button>
              <p class="muted small">Every collection except sessions, as one JSON file. It contains personal data, so store it securely. Photos stay in Firebase Storage. For disaster recovery also enable Firestore scheduled backups or point-in-time recovery in the Firebase console.</p></form>
            <hr>
            <form method="post" action="/admin/system/purge-sessions">${csrf(req)}
              <button class="btn btn--ghost btn--block" type="submit">Clear expired sessions</button></form>
            <form method="post" action="/admin/system/signout-all">${csrf(req)}
              ${confirmBtn('Sign everyone else out', 'btn--danger-ghost btn--block', 'Sign out every other member and staff user right now?')}
              <p class="muted small">Use after a suspected security incident. Your own session is kept.</p></form>
          </section>

          <section class="card pad">
            <h2>Security snapshot</h2>
            <dl class="sysgrid sysgrid--tight">
              ${stat('Locked accounts', security.locked)}
              ${stat('Failed sign-ins (24h)', security.failed24)}
              ${stat('Staff verifications (24h)', security.adminLogins24)}
            </dl>
            ${security.recent.length ? html`<ul class="mini">${security.recent.map((e) => html`<li><code>${e.action}</code> <span class="muted small">${e.ip || ''} · ${timeAgo(e.created_at)}</span></li>`)}</ul>` : html`<p class="muted small">No recent security events.</p>`}
          </section>
        </div>
      </div>

      <section class="card pad" aria-labelledby="h-staff">
        <h2 id="h-staff">Staff &amp; access</h2>
        <div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th class="hide-sm">Last sign-in</th><th></th></tr></thead><tbody>
          ${staff.map((m) => html`<tr><td><strong>${m.name}</strong><br><span class="muted small">${m.email}</span></td>
            <td><span class="chip${m.role === 'superadmin' ? ' chip--gold' : ' chip--tone'}">${m.role}</span></td><td>${badge(m.status)}</td>
            <td class="hide-sm">${m.last_login_at ? timeAgo(m.last_login_at) : 'never'}</td>
            <td><a class="btn btn--ghost btn--sm" href="/admin/users/${m.user_id}">Manage</a></td></tr>`)}
        </tbody></table></div>

        <form class="stack staff-form" method="post" action="/admin/system/staff">${csrf(req)}
          <h3>Create a staff account</h3>
          ${errors.staff ? html`<div class="banner banner--warn" role="alert">${icon('alert')}<div>${errors.staff}</div></div>` : ''}
          <div class="grid-2">
            ${field({ name: 'name', label: 'Full name', value: values.name || '', required: true, maxlength: 60 })}
            ${field({ name: 'email', label: 'Email', type: 'email', value: values.email || '', required: true })}
          </div>
          <div class="grid-2">
            ${field({ name: 'role', label: 'Role', as: 'select', value: values.role || 'moderator', options: [['moderator', 'Moderator'], ['admin', 'Administrator'], ['superadmin', 'Super admin']] })}
            ${field({ name: 'password', label: 'Temporary password', type: 'password', required: true, autocomplete: 'new-password', hint: 'At least 10 characters. Share it securely and ask them to change it at first sign-in.' })}
          </div>
          ${confirmBtn('Create staff account', 'btn--primary', 'Create this staff account? Staff can see private member data.')}
        </form>
      </section>`,
  });
}


/* Launch checklist: go-live settings still missing (names and counts only, never values). */
function launchList({ items, mustLeft, shouldLeft }) {
  const row = (i) => html`<li class="launch__item${i.ok ? ' is-ok' : ''}">
    <span class="launch__mark" aria-hidden="true">${icon(i.ok ? 'check' : 'alert')}</span>
    <div><strong>${i.title}</strong> <span class="chip${i.ok ? '' : i.level === 'must' ? ' chip--gold' : ' chip--tone'}">${i.ok ? 'Done' : i.level === 'must' ? 'Before launch' : 'Soon'}</span>
      ${i.ok ? '' : html`<p class="muted small">${i.fix}</p>`}</div></li>`;
  const summary = !mustLeft && !shouldLeft
    ? 'Everything here is set. Do one full run-through on a phone before you announce the site.'
    : `${mustLeft} to fix before launch, ${shouldLeft} to fix soon. Settings are read from Vercel and this page; their values are never shown.`;
  return html`<section class="card pad launch" id="launch" aria-labelledby="h-launch">
    <h2 id="h-launch">Launch checklist</h2>
    <p class="muted">${summary}</p>
    <ul class="launch__list">${items.filter((i) => !i.ok).map(row)}${items.filter((i) => i.ok).map(row)}</ul>
  </section>`;
}

/* Payment and contact details: editable here so the owner never has to open Vercel. Values set here win over the
   environment variables; leaving a field empty falls back to them. */
function businessForm(req, d) {
  const settingsSvc = require('../../services/settings');
  const config = require('../../config');
  const s = d.settings || {};
  const v = d.business || s;
  const errors = d.errors || {};
  const live = settingsSvc.momo();
  const online = Boolean(config.payments.paystackSecret);
  const NETWORKS = ['MTN MoMo', 'Telecel Cash', 'AirtelTigo Money'];
  return html`<section class="card pad stack" id="business" aria-labelledby="h-business">
    <div><h2 id="h-business">${icon('tag')} Payments &amp; contact details</h2>
      <p class="muted small">Shown to members straight away. No redeploy needed.</p></div>
    ${online
      ? html`<div class="banner banner--info">${icon('check')}<div>Paystack is on, so members pay online. The Mobile Money number below is only used if Paystack is switched off.</div></div>`
      : html`<div class="banner ${live.number ? 'banner--info' : 'banner--warn'}">${icon(live.number ? 'check' : 'alert')}<div>${live.number
        ? html`Members who order a promotion are told to send Mobile Money to <strong>${live.number}</strong>${live.name ? html` (${live.name})` : ''}.`
        : html`<strong>No payment number yet.</strong> Members who order a promotion are told to message the team in Help. Add your Mobile Money number below.`}</div></div>`}
    <form class="stack" method="post" action="/admin/system/business">${csrf(req)}
      <div class="grid-2">
        ${field({ name: 'momo_number', label: 'Mobile Money number', value: v.momo_number || '', error: errors.momo_number, maxlength: 16, inputmode: 'tel', placeholder: 'e.g. 0241234567', hint: 'The number members send promotion payments to. Shown only on their own order page.' })}
        ${field({ name: 'momo_name', label: 'Name on the account', value: v.momo_name || '', maxlength: 60, placeholder: 'As it appears when someone sends money', hint: 'Helps members check they are paying the right person.' })}
      </div>
      <div class="grid-2">
        ${field({ name: 'momo_network', label: 'Network', as: 'select', value: v.momo_network || '', options: [['', 'Choose…'], ...NETWORKS.map((n) => [n, n])] })}
        ${field({ name: 'support_email', label: 'Support email (optional)', type: 'email', value: v.support_email || '', error: errors.support_email, maxlength: 120, placeholder: 'e.g. campusfind.help@gmail.com', hint: 'A business mailbox shown on the legal and help pages. Leave empty to use the Help centre chat only.' })}
      </div>
      <p class="muted small">Never enter a PIN, password or code here. CampusFind only needs the number people pay to.</p>
      <div><button class="btn btn--primary" type="submit">Save payment &amp; contact details</button></div>
    </form>
  </section>`;
}

module.exports = { systemPage };
