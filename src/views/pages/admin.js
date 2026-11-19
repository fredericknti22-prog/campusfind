'use strict';
const { html, raw, esc } = require('../../lib/html');
const { page } = require('../layout');
const { turnstileWidget, icon, field, csrf, badge, timeAgo, fmtDate, pagination, confirmBtn, priceLabel } = require('../components');
const { can } = require('../../middleware/auth');
const { REPORT_OUTCOMES } = require('../../services/moderation');
const { REASON_LABEL } = require('./account');

function shell(req, { title, active, body, counts }) {
  const u = req.user;
  const link = (href, key, ic, label, perm, n = 0) =>
    can(u, perm)
      ? html`<a class="snav__link${active === key ? ' is-active' : ''}" href="${href}"${active === key ? raw(' aria-current="page"') : ''}>${icon(ic)}<span>${label}</span>${n ? html`<span class="pill" aria-label="${n} open">${n}</span>` : ''}</a>`
      : '';
  const group = (label, items) => {
    if (!items.some((x) => x !== '')) return '';
    return html`<div class="snav__group">${label ? html`<p class="snav__label">${label}</p>` : ''}${items}</div>`;
  };
  const nav = [
    group('', [link('/admin', 'overview', 'chart', 'Overview', 'dashboard'), link('/admin/insights', 'insights', 'search', 'Demand insights', 'dashboard'), link('/admin/launch-kit', 'launch', 'print', 'Launch kit posters', 'dashboard'), link('/admin/2fa/setup', 'tfa', 'lock', 'Two-step sign-in', 'dashboard')]),
    group('Moderation', [
      link('/admin/reports', 'reports', 'flag', 'Reports', 'reports', counts ? counts.openReports : 0),
      link('/admin/listings', 'listings', 'tag', 'Listings', 'listings'),
      link('/admin/signals', 'signals', 'shield', 'Safety signals', 'reports'),
    ]),
    group('People', [
      link('/admin/help', 'help', 'mail', 'Help chat', 'support', counts ? counts.supportWaiting : 0),
      link('/admin/users', 'users', 'users', 'Members', 'users'),
    ]),
    group('Platform', [
      link('/admin/orders', 'orders', 'tag', 'Orders', 'orders'),
      link('/admin/updates', 'updates', 'bell', "What's new", 'system'),
      link('/admin/errors', 'errors', 'alert', 'Errors', 'system'),
      link('/admin/categories', 'categories', 'list', 'Categories', 'categories'),
      link('/admin/audit', 'audit', 'clock', 'Audit log', 'audit'),
      link('/admin/system', 'system', 'lock', 'Super admin', 'system'),
    ]),
  ];
  return page(req, {
    title: `${title} · Admin`, active: 'admin', wide: true,
    body: html`
      <div class="admin">
        <nav class="admin__nav snav" aria-label="Admin sections">${nav}</nav>
        <div class="admin__main">${body}</div>
      </div>`,
  });
}

/* ------------------------------------------------------------- login */
function adminLogin(req, { error = '', next = '' } = {}) {
  return page(req, {
    title: 'Admin sign-in', bare: false,
    body: html`<section class="auth auth--solo">
      <div class="auth__card card">
        <p class="eyebrow">${icon('shield')} Restricted area</p>
        <h1>Staff verification</h1>
        <p class="muted">Enter your password and authenticator code to open the administration tools. Verification expires after 30 minutes and all actions are logged.</p>
        <form method="post" action="/admin/login" class="stack">${csrf(req)}<input type="hidden" name="next" value="${next}">
          ${error ? html`<div class="banner banner--warn" role="alert">${icon('alert')}<div>${error}</div></div>` : ''}
          ${req.user ? html`<p class="small">Signed in as <strong>${req.user.email}</strong></p>` : field({ name: 'email', label: 'Staff email', type: 'email', required: true, autocomplete: 'username' })}
          ${field({ name: 'password', label: 'Password', type: 'password', required: true, autocomplete: 'current-password' })}
          ${field({ name: 'code', label: 'Authenticator code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 11, hint: 'The 6-digit code from your authenticator app, or a recovery code. Leave blank only the first time, before you have set it up.' })}
          ${turnstileWidget('staff-login')}
          <button class="btn btn--primary btn--block" type="submit">${icon('lock')} Verify and continue</button>
        </form>
      </div>
    </section>`,
  });
}

/* ------------------------------------------------------------ charts */
/** Every chart ships with a visually hidden data table so screen-reader users get the exact values. */
const srTable = (rows, label) =>
  `<table class="sr-only"><caption>${esc(label)}</caption><tbody>${rows.map((r) => `<tr><th scope="row">${esc(r.name)}</th><td>${r.value}</td></tr>`).join('')}</tbody></table>`;

function barChart(rows, { label }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const rowH = 32;
  const h = rows.length * rowH + 4;
  const svg = `<svg class="chart" viewBox="0 0 440 ${h}" role="img" aria-label="${esc(label)}">${rows.map((r, i) => {
    const y = i * rowH + 2;
    const w = Math.max(r.value ? 4 : 0, Math.round((r.value / max) * 230));
    return `<text class="chart__label" x="0" y="${y + 20}">${esc(r.name)}</text><rect class="chart__bar" x="150" y="${y + 5}" width="${w}" height="20" rx="4"/><text class="chart__value" x="${150 + w + 8}" y="${y + 20}">${r.value}</text>`;
  }).join('')}</svg>`;
  return raw(`<figure class="chartbox">${svg}${srTable(rows, label)}</figure>`);
}

function columnChart(series, { label }) {
  const max = Math.max(1, ...series.map((s) => s.value));
  const W = 440, H = 140, pad = 24;
  const bw = (W - pad) / series.length;
  const bars = series.map((s, i) => {
    const bh = Math.round((s.value / max) * (H - pad - 14));
    const x = pad + i * bw + 3;
    return `<rect class="chart__bar" x="${x.toFixed(1)}" y="${H - pad - bh}" width="${(bw - 6).toFixed(1)}" height="${Math.max(bh, s.value ? 3 : 1)}" rx="3"><title>${esc(s.name)}: ${s.value}</title></rect>`;
  }).join('');
  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    <text class="chart__value" x="0" y="12">${max}</text>${bars}
    <line class="chart__axis" x1="${pad}" x2="${W}" y1="${H - pad}" y2="${H - pad}"/>
    <text class="chart__label" x="${pad}" y="${H - 4}">${esc(series[0].name)}</text>
    <text class="chart__label" x="${W}" y="${H - 4}" text-anchor="end">${esc(series[series.length - 1].name)}</text></svg>`;
  return raw(`<figure class="chartbox">${svg}${srTable(series, label)}</figure>`);
}

/* --------------------------------------------------------- dashboard */
function dashboard(req, d) {
  const kpi = (n, label, ic, href, tone = '') => html`<a class="kpi ${tone}" href="${href}"><span class="kpi__icon">${icon(ic)}</span><strong>${n}</strong><span>${label}</span></a>`;
  return shell(req, {
    title: 'Overview', active: 'overview', counts: d.counts,
    body: html`
      <div class="page-head"><div><h1>Operations overview</h1><p class="muted">Current figures from the CampusFind database.</p></div></div>
      <div class="kpis">
        ${kpi(d.counts.openReports, 'open reports', 'flag', '/admin/reports', d.counts.openReports ? 'kpi--alert' : '')}
        ${kpi(d.counts.activeListings, 'live listings', 'tag', '/admin/listings')}
        ${kpi(d.counts.users, 'members', 'users', '/admin/users')}
        ${kpi(d.counts.newUsers7, 'joined this week', 'user', '/admin/users')}
        ${kpi(d.counts.actions7, 'moderation actions (7d)', 'shield', '/admin/audit')}
      </div>

      ${d.health ? html`<section class="card pad health" aria-labelledby="h-health">
        <div class="section__head"><h2 id="h-health">Marketplace health, last ${d.health.days} days</h2><a class="link-arrow" href="/admin/insights">What people search for ${icon('arrow')}</a></div>
        <dl class="health__grid">
          <div><dt>Chats started</dt><dd>${d.health.chats}</dd></div>
          <div><dt>Answered by the seller</dt><dd>${d.health.replyRate === null ? '—' : d.health.replyRate + '%'}</dd></div>
          <div><dt>Typical first reply</dt><dd>${d.health.medianReply}</dd></div>
          <div><dt>New listings that got a chat</dt><dd>${d.health.interestRate === null ? '—' : d.health.interestRate + '%'}</dd></div>
          <div><dt>Offers made / accepted</dt><dd>${d.health.offers} / ${d.health.accepted}</dd></div>
          <div><dt>Deals marked done</dt><dd>${d.health.deals}</dd></div>
          <div><dt>Lost items returned</dt><dd>${d.health.returned}</dd></div>
        </dl>
        <p class="muted small">Counted from chat summaries and the audit log, never message text. If few new listings get a chat, promote the site; if sellers do not answer, remind them.</p>
      </section>` : ''}

      <div class="grid-2 grid-2--top">
        <section class="card pad"><h2>New members, last 14 days</h2>${columnChart(d.signups, { label: 'New members per day over the last 14 days' })}</section>
        <section class="card pad"><h2>Live listings by category</h2>${barChart(d.byCategory, { label: 'Live listings per category' })}</section>
      </div>

      <div class="grid-2 grid-2--top">
        <section class="card pad">
          <div class="section__head"><h2>Needs attention</h2><a class="link-arrow" href="/admin/reports">Open queue ${icon('arrow')}</a></div>
          ${d.queue.length
            ? html`<ul class="mini">${d.queue.map((r) => html`<li><a href="/admin/reports/${r.report_id}"><strong>#${r.report_id}</strong> ${REASON_LABEL[r.reason] || r.reason}</a>
                <span class="muted small">${r.target_type} #${r.target_id} · ${timeAgo(r.created_at)}</span>${r.reporter_id ? '' : html`<span class="chip chip--gold">system flag</span>`}</li>`)}</ul>`
            : html`<p class="muted">${icon('check')} No reports are awaiting review.</p>`}
        </section>
        <section class="card pad">
          <h2>Reports by reason</h2>
          ${d.byReason.length ? barChart(d.byReason, { label: 'Reports per reason' }) : html`<p class="muted">No reports yet.</p>`}
        </section>
      </div>

      ${can(req.user, 'audit') ? html`<section class="card pad"><div class="section__head"><h2>Recent activity</h2><a class="link-arrow" href="/admin/audit">Full audit log ${icon('arrow')}</a></div>${logTable(d.recent)}</section>` : ''}`,
  });
}

function logTable(rows) {
  if (!rows.length) return html`<p class="muted">Nothing recorded yet.</p>`;
  return html`<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th class="hide-sm">IP</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr><td>${fmtDate(r.created_at)}</td><td>${r.actor_name || (r.actor_id ? `#${r.actor_id}` : 'system')} <span class="muted small">${r.actor_type}</span></td>
      <td><code>${r.action}</code></td><td>${r.entity_type ? `${r.entity_type} #${r.entity_id}` : '—'}</td><td class="hide-sm muted small">${r.ip || '—'}</td></tr>`)}
  </tbody></table></div>`;
}

/* ----------------------------------------------------------- reports */
function reportsList(req, { items, status, counts, total, pageNum, pages }) {
  const tabs = [['open', 'Open'], ['pending', 'Pending'], ['reviewing', 'In review'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed'], ['all', 'All']];
  return shell(req, {
    title: 'Reports', active: 'reports', counts,
    body: html`
      <div class="page-head"><div><h1>Moderation queue</h1><p class="muted">${total} report${total === 1 ? '' : 's'} in this view. Oldest open reports first.</p></div></div>
      <div class="segmented" role="tablist">${tabs.map(([k, l]) => html`<a class="seg${status === k ? ' is-active' : ''}" href="?status=${k}">${l}</a>`)}</div>
      ${items.length
        ? html`<div class="table-wrap card"><table class="table"><thead><tr><th>#</th><th>Reason</th><th>Target</th><th>Reporter</th><th>Status</th><th>Filed</th><th></th></tr></thead><tbody>
          ${items.map((r) => html`<tr>
            <td>#${r.report_id}</td>
            <td>${REASON_LABEL[r.reason] || r.reason}${r.reporter_id ? '' : html` <span class="chip chip--gold">system flag</span>`}</td>
            <td>${r.target_type === 'listing' ? html`<span>${icon('tag')} ${r.target_label || `Listing #${r.target_id}`}</span>` : html`<span>${icon('user')} ${r.target_label || `User #${r.target_id}`}</span>`}</td>
            <td>${r.reporter_name || html`<span class="muted">System</span>`}</td>
            <td>${badge(r.status)}</td><td>${timeAgo(r.created_at)}</td>
            <td><a class="btn btn--ghost btn--sm" href="/admin/reports/${r.report_id}">Review</a></td></tr>`)}
        </tbody></table></div>${pagination(pageNum, pages, { status })}`
        : html`<div class="empty">${icon('check', 'icon--xl')}<h2>No reports</h2><p>No reports match this view.</p></div>`}`,
  });
}

function reportDetail(req, d) {
  const { r, reporter, listing, owner, person, history, otherReports, error } = d;
  const closed = ['resolved', 'dismissed'].includes(r.status);
  const outcomes = Object.entries(REPORT_OUTCOMES).filter(([k, v]) => can(req.user, v.needs) && !(v.listingOnly && r.target_type !== 'listing'));
  const subject = r.target_type === 'listing' ? owner : person;
  const subjectIsStaff = subject && subject.role !== 'student';

  return shell(req, {
    title: `Report #${r.report_id}`, active: 'reports', counts: d.counts,
    body: html`
      <nav class="crumbs"><a href="/admin/reports">Reports</a> ${icon('arrow')} #${r.report_id}</nav>
      <div class="page-head"><div><h1>Report #${r.report_id} ${badge(r.status)}</h1>
        <p class="muted">${REASON_LABEL[r.reason] || r.reason} · filed ${fmtDate(r.created_at)} by ${reporter ? reporter.name : 'automatic screening'}</p></div></div>

      <div class="admin-split">
        <div class="stack">
          <section class="card pad">
            <h2>${r.target_type === 'listing' ? 'Reported listing' : 'Reported member'}</h2>
            ${r.target_type === 'listing'
              ? (listing ? html`<h3><a href="/listings/${listing.listing_id}">${listing.title}</a> ${badge(listing.status)}</h3>
                  <p class="muted small">${listing.cat_name} · ${priceLabel(listing) || 'no price'} · posted ${timeAgo(listing.created_at)} by ${owner ? html`<a href="/admin/users/${owner.user_id}">${owner.name}</a>` : 'unknown'}</p>
                  <div class="prose prewrap boxed">${listing.description}</div>
                  ${listing.contact ? html`<p class="small"><strong>Contact given:</strong> ${listing.contact}</p>` : ''}`
                : html`<p class="muted">This listing no longer exists. Dismiss the report.</p>`)
              : (person ? html`<h3><a href="/admin/users/${person.user_id}">${person.name}</a> ${badge(person.status)}</h3><p class="muted small">${person.email} · joined ${timeAgo(person.created_at)} · ${person.warnings} warning(s)</p>` : html`<p class="muted">Account not found.</p>`)}
          </section>

          ${r.evidence ? html`<section class="card pad">
            <h2>Reported chat message</h2>
            <p class="muted small">Sent ${timeAgo(r.evidence.sent_at)}. Only this message was shared; the rest of the conversation stays private.${r.evidence.flags && r.evidence.flags.length ? html` Automatic checks flagged it as: <strong>${r.evidence.flags.join(', ')}</strong>.` : ''}</p>
            <blockquote class="boxed prewrap">${r.evidence.body}</blockquote>
          </section>` : ''}
          <section class="card pad">
            <h2>Reporter’s notes</h2>
            <div class="boxed prewrap">${r.details || html`<span class="muted">No extra details provided.</span>`}</div>
          </section>

          <section class="card pad">
            <h2>History on this target</h2>
            ${otherReports.length ? html`<ul class="mini">${otherReports.map((o) => html`<li><a href="/admin/reports/${o.report_id}">#${o.report_id}</a> ${REASON_LABEL[o.reason] || o.reason} ${badge(o.status)} <span class="muted small">${timeAgo(o.created_at)}</span></li>`)}</ul>` : html`<p class="muted">No other reports.</p>`}
            ${history.length ? html`<h3>Past actions</h3><ul class="mini">${history.map((h) => html`<li><code>${h.action}</code> by ${h.admin_name} <span class="muted small">${timeAgo(h.created_at)}${h.reason ? ' · ' + h.reason : ''}</span></li>`)}</ul>` : ''}
          </section>
        </div>

        <aside class="card pad decision">
          <h2>${closed ? 'Decision' : 'Make a decision'}</h2>
          ${closed
            ? html`<p>${badge(r.status)} <strong>${(REPORT_OUTCOMES[r.resolution] || {}).label || r.resolution}</strong></p>
                <p class="muted small">By ${d.reviewerName || 'staff'} · ${fmtDate(r.resolved_at)}</p>${r.resolution_note ? html`<div class="boxed prewrap">${r.resolution_note}</div>` : ''}`
            : html`
              ${r.status === 'pending' ? html`<form method="post" action="/admin/reports/${r.report_id}/review">${csrf(req)}<button class="btn btn--ghost btn--block" type="submit">${icon('eye')} Start review</button></form><hr>` : html`<p class="small muted">Under review${d.reviewerName ? ' by ' + d.reviewerName : ''}.</p>`}
              <form method="post" action="/admin/reports/${r.report_id}/resolve" class="stack">${csrf(req)}
                ${error ? html`<div class="banner banner--warn" role="alert">${icon('alert')}<div>${error}</div></div>` : ''}
                ${subjectIsStaff ? html`<div class="banner banner--info">${icon('alert')}<div>The responsible account is staff. Only dismissal or listing actions are possible.</div></div>` : ''}
                <fieldset class="field"><legend>Outcome</legend><div class="choices">
                  ${outcomes.map(([k, v], i) => html`<label class="choice"><input type="radio" name="outcome" value="${k}" required${i === 0 ? '' : ''}><span><strong>${v.label}</strong></span></label>`)}
                </div></fieldset>
                <div data-show-when="outcome=suspend">${field({ name: 'days', label: 'Suspension length (days)', type: 'number', value: '7', min: 1, step: '1' })}</div>
                ${field({ name: 'reason', label: 'Reason / note', as: 'textarea', rows: 3, maxlength: 500, hint: 'Required for any enforcement. The affected member sees this note.' })}
                ${reporter ? html`<label class="check"><input type="checkbox" name="malicious" value="1"><span>Report was malicious or knowingly false</span></label>` : ''}
                ${confirmBtn('Apply decision', 'btn--primary btn--block', 'Apply this decision? It will be logged and the member notified.')}
              </form>`}
        </aside>
      </div>`,
  });
}

/* ---------------------------------------------------------- listings */
function adminListings(req, { items, q, status, counts, total, pageNum, pages }) {
  const statusOpts = [['', 'Any status'], ['active', 'Live'], ['draft', 'Draft'], ['closed', 'Closed'], ['hidden', 'Hidden'], ['removed', 'Removed']];
  return shell(req, {
    title: 'Listings', active: 'listings', counts,
    body: html`
      <div class="page-head"><div><h1>Listings</h1><p class="muted">${total} match${total === 1 ? '' : 'es'}. Moderation changes are logged and the owner is notified.</p></div></div>
      <form class="toolbar" method="get" action="/admin/listings">
        ${field({ name: 'q', label: 'Search title, owner or ID', value: q, maxlength: 80 })}
        ${field({ name: 'status', label: 'Status', as: 'select', value: status, options: statusOpts })}
        <button class="btn btn--primary" type="submit">Filter</button>
      </form>
      ${items.length ? html`<div class="table-wrap card"><table class="table"><thead><tr><th>Listing</th><th class="hide-sm">Owner</th><th>Status</th><th class="hide-sm">Posted</th><th>Actions</th></tr></thead><tbody>
        ${items.map((l) => html`<tr>
          <td><a href="/listings/${l.listing_id}"><strong>${l.title}</strong></a><br><span class="muted small">#${l.listing_id} · ${l.cat_name}${l.is_featured ? ' · ★ featured' : ''}${l.deleted_at ? ' · deleted by owner' : ''}</span></td>
          <td class="hide-sm"><a href="/admin/users/${l.owner_id}">${l.owner_name}</a></td>
          <td>${badge(l.status)}</td><td class="hide-sm">${timeAgo(l.created_at)}</td>
          <td class="actions">
            ${l.deleted_at ? '' : html`<form method="post" action="/admin/listings/${l.listing_id}/moderate" class="inline-form">${csrf(req)}
              <input type="text" name="reason" placeholder="Reason" maxlength="200" aria-label="Reason for action on listing ${l.listing_id}">
              ${l.status === 'active' ? html`<button class="btn btn--ghost btn--sm" name="action" value="hide">Hide</button>` : ''}
              ${l.status !== 'removed' ? html`<button class="btn btn--danger-ghost btn--sm" name="action" value="remove">Remove</button>` : ''}
              ${['hidden', 'removed'].includes(l.status) ? html`<button class="btn btn--ghost btn--sm" name="action" value="restore">Restore</button>` : ''}
            </form>
            ${can(req.user, 'featured') && l.status === 'active' ? html`<form method="post" action="/admin/listings/${l.listing_id}/feature" class="inline-form">${csrf(req)}
              ${isFeatured(l) ? html`<input type="hidden" name="on" value="0"><button class="btn btn--ghost btn--sm">Unfeature</button>`
                : html`<input type="hidden" name="on" value="1"><button class="btn btn--accent btn--sm">${icon('star')} Feature 14d</button>`}</form>` : ''}`}
          </td></tr>`)}
      </tbody></table></div>${pagination(pageNum, pages, { q, status })}` : html`<div class="empty"><h2>No listings found</h2></div>`}`,
  });
}
const isFeatured = (l) => l.is_featured && (!l.featured_until || l.featured_until > Date.now());

/* ------------------------------------------------------------- users */
function adminUsers(req, { items, q, status, role, counts, total, pageNum, pages }) {
  return shell(req, {
    title: 'Users', active: 'users', counts,
    body: html`
      <div class="page-head"><div><h1>Members</h1><p class="muted">${total} account${total === 1 ? '' : 's'}.</p></div></div>
      <form class="toolbar" method="get" action="/admin/users">
        ${field({ name: 'q', label: 'Search name, email or ID', value: q, maxlength: 80 })}
        ${field({ name: 'status', label: 'Status', as: 'select', value: status, options: [['', 'Any'], ['active', 'Active'], ['restricted', 'Restricted'], ['suspended', 'Suspended'], ['banned', 'Banned']] })}
        ${field({ name: 'role', label: 'Role', as: 'select', value: role, options: [['', 'Any'], ['student', 'Student'], ['moderator', 'Moderator'], ['admin', 'Admin'], ['superadmin', 'Super admin']] })}
        <button class="btn btn--primary" type="submit">Filter</button>
      </form>
      ${items.length ? html`<div class="table-wrap card"><table class="table"><thead><tr><th>Member</th><th>Role</th><th>Status</th><th class="hide-sm">Listings</th><th class="hide-sm">Joined</th><th></th></tr></thead><tbody>
        ${items.map((u) => html`<tr><td><strong>${u.name}</strong><br><span class="muted small">${u.email}</span></td>
          <td>${u.role}</td><td>${badge(u.status)}</td><td class="hide-sm">${u.listing_count}</td><td class="hide-sm">${timeAgo(u.created_at)}</td>
          <td><a class="btn btn--ghost btn--sm" href="/admin/users/${u.user_id}">Open</a></td></tr>`)}
      </tbody></table></div>${pagination(pageNum, pages, { q, status, role })}` : html`<div class="empty"><h2>No members found</h2></div>`}`,
  });
}

function adminErrors(req, { rows, counts }) {
  return shell(req, {
    title: 'Errors', active: 'errors', counts,
    body: html`
      <div class="page-head"><div><h1>Errors</h1><p class="muted">Things that went wrong on the live site, grouped by kind. Server errors are pages that crashed; browser errors are scripts that failed on someone's phone or computer. No personal data is kept. Send a screenshot of this page to whoever maintains the code.</p></div></div>
      ${rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Last seen</th><th scope="col">Where</th><th scope="col">What</th><th scope="col">Times</th><th scope="col"></th></tr></thead><tbody>
        ${rows.map((r) => html`<tr><td>${timeAgo(r.last_at)}<br><span class="muted small">first ${timeAgo(r.first_at)}</span></td>
          <td><span class="chip ${r.source === 'client' ? 'chip--warn' : 'chip--gold'}">${r.source === 'client' ? 'browser' : 'server'}</span> <code>${r.path || '—'}</code></td>
          <td><strong>${r.message}</strong>${r.frame ? html`<br><code class="small">${r.frame}</code>` : ''}${r.ua ? html`<br><span class="muted xsmall">${r.ua}</span>` : ''}</td>
          <td>${r.count}</td>
          <td><form method="post" action="/admin/errors/${r.id}/resolve">${csrf(req)}<button class="btn btn--ghost btn--sm" type="submit">Mark fixed</button></form></td></tr>`)}
      </tbody></table></div>` : html`<div class="empty">${icon('check', 'icon--xl')}<h2>No errors</h2><p>Nothing has gone wrong since the last fix. You get a notification the first time a new kind of error appears.</p></div>`}`,
  });
}

function adminUpdates(req, { notes, values = {}, errors = {}, counts }) {
  return shell(req, {
    title: "What's new", active: 'updates', counts,
    body: html`
      <div class="page-head"><div><h1>What's new</h1><p class="muted">Tell members what changed. Signed-in members see the newest note once, as a small banner, and it stays on the What's new page.</p></div>
        <a class="btn btn--ghost" href="/whats-new">${icon('eye')} View public page</a></div>
      <div class="grid-2 grid-2--top">
        <form class="card form-card stack" method="post" action="/admin/updates">${csrf(req)}
          <h2>Publish a note</h2>
          ${field({ name: 'title', label: 'Title', value: values.title || '', error: errors.title, required: true, maxlength: 90, placeholder: 'e.g. Offers in chat' })}
          ${field({ name: 'items', label: 'What changed (one per line)', as: 'textarea', rows: 6, value: values.items || '', error: errors.items, required: true, hint: 'Plain words, one change per line. Up to 8 lines.' })}
          <label class="check"><input type="checkbox" name="notify" value="1"><span>Also send it to every member's Notifications</span></label>
          ${confirmBtn('Publish', 'btn--primary', 'Publish this note to members?')}
        </form>
        <section class="card pad"><h2>Published</h2>
          ${notes.length ? html`<ul class="mini">${notes.map((n) => html`<li><strong>${n.title}</strong> <span class="muted small">${fmtDate(n.created_at)} · ${n.items.length} ${n.items.length === 1 ? 'change' : 'changes'}</span></li>`)}</ul>` : html`<p class="muted">Nothing yet.</p>`}
        </section>
      </div>`,
  });
}

function adminSignals(req, { rows, counts }) {
  return shell(req, {
    title: 'Safety signals', active: 'signals', counts,
    body: html`
      <div class="page-head"><div><h1>Safety signals</h1>
        <p class="muted">Members that several people have blocked, or whose chat messages keep tripping the automatic scam checks. These are counts only: chats stay private. Look at their listings and reports, and act through the member page.</p></div></div>
      ${rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Member</th><th scope="col">Blocked by</th><th scope="col">Pay first</th><th scope="col">Asked for code</th><th scope="col">“By mistake”</th><th scope="col">Status</th></tr></thead><tbody>
        ${rows.map((r) => html`<tr><td><a href="/admin/users/${r.user.user_id}">${r.user.name}</a></td><td>${r.blocked}</td><td>${r.byFlag['pay-first']}</td><td>${r.byFlag['asks-code']}</td><td>${r.byFlag['fake-payment']}</td><td>${badge(r.user.status)}</td></tr>`)}
      </tbody></table></div>` : html`<div class="empty">${icon('shield', 'icon--xl')}<h2>Nothing to look at</h2><p>Nobody has been blocked by several members or sent repeated scam-like messages.</p></div>`}`,
  });
}

function adminUserDetail(req, d) {
  const { person, listings, reports, actions, counts, error, signals } = d;
  const isSelf = person.user_id === req.user.user_id;
  const sanctionable = person.role === 'student' && !isSelf;
  return shell(req, {
    title: person.name, active: 'users', counts,
    body: html`
      <nav class="crumbs"><a href="/admin/users">Members</a> ${icon('arrow')} ${person.name}</nav>
      <div class="page-head"><div><h1>${person.name} ${badge(person.status)}</h1>
        <p class="muted">${person.email} · ${person.role} · joined ${fmtDate(person.created_at)} · last sign-in ${person.last_login_at ? timeAgo(person.last_login_at) : 'never'}</p></div></div>
      ${error ? html`<div class="banner banner--warn" role="alert">${icon('alert')}<div>${error}</div></div>` : ''}
      ${person.status_reason ? html`<div class="banner banner--info">${icon('alert')}<div><strong>Current restriction:</strong> ${person.status_reason}${person.status_until ? ` (until ${fmtDate(person.status_until)})` : ''}</div></div>` : ''}

      <div class="admin-split">
        <div class="stack">
          <section class="card pad"><h2>Listings (${listings.length})</h2>
            ${listings.length ? html`<ul class="mini">${listings.map((l) => html`<li><a href="/listings/${l.listing_id}">${l.title}</a> ${badge(l.status)} <span class="muted small">${timeAgo(l.created_at)}</span></li>`)}</ul>` : html`<p class="muted">None.</p>`}</section>
          ${signals && (signals.blocked || signals.flags) ? html`<section class="card pad"><h2>${icon('shield')} Safety signals</h2>
            <p class="muted small">Counts only. Chats stay private; read the reports for detail.</p>
            <ul class="mini"><li>Blocked by <strong>${signals.blocked}</strong> ${signals.blocked === 1 ? 'member' : 'members'}</li>
            <li>Asked to be paid first: <strong>${signals.byFlag['pay-first']}</strong></li><li>Asked for a code or PIN: <strong>${signals.byFlag['asks-code']}</strong></li><li>“Sent money by mistake” messages: <strong>${signals.byFlag['fake-payment']}</strong></li></ul></section>` : ''}
          <section class="card pad"><h2>Reports against this member / their listings</h2>
            ${reports.length ? html`<ul class="mini">${reports.map((r) => html`<li><a href="/admin/reports/${r.report_id}">#${r.report_id}</a> ${REASON_LABEL[r.reason] || r.reason} ${badge(r.status)} <span class="muted small">${r.target_type}</span></li>`)}</ul>` : html`<p class="muted">None.</p>`}</section>
          <section class="card pad"><h2>Moderation history</h2>
            ${actions.length ? html`<ul class="mini">${actions.map((a) => html`<li><code>${a.action}</code> by ${a.admin_name} <span class="muted small">${timeAgo(a.created_at)}${a.reason ? ' · ' + a.reason : ''}</span></li>`)}</ul>` : html`<p class="muted">No actions recorded. Warnings: ${person.warnings}. False reports filed: ${person.false_reports}.</p>`}</section>
        </div>

        <aside class="stack">
          ${sanctionable && (can(req.user, 'users') || can(req.user, 'warn')) ? html`
          <form class="card pad stack" method="post" action="/admin/users/${person.user_id}/action">${csrf(req)}
            <h2>Account action</h2>
            <fieldset class="field"><legend>Action</legend><div class="choices">
              ${can(req.user, 'warn') ? html`<label class="choice"><input type="radio" name="action" value="warn" required><span><strong>Warn</strong></span></label>` : ''}
              ${can(req.user, 'users') ? html`
                <label class="choice"><input type="radio" name="action" value="restrict"><span><strong>Restrict</strong><small>No new posts or reports</small></span></label>
                <label class="choice"><input type="radio" name="action" value="suspend"><span><strong>Suspend</strong><small>Signed out for a set time</small></span></label>
                <label class="choice"><input type="radio" name="action" value="ban"><span><strong>Ban</strong><small>Permanent</small></span></label>
                <label class="choice"><input type="radio" name="action" value="reinstate"><span><strong>Reinstate</strong><small>Lift all restrictions</small></span></label>` : ''}
            </div></fieldset>
            <div data-show-when="action=suspend">${field({ name: 'days', label: 'Suspension length (days)', type: 'number', value: '7', min: 1, step: '1' })}</div>
            ${field({ name: 'reason', label: 'Reason', as: 'textarea', rows: 3, maxlength: 500, required: true, hint: 'The member sees this note.' })}
            ${confirmBtn('Apply action', 'btn--primary btn--block', 'Apply this action to the account? It will be logged.')}
          </form>` : html`<div class="card pad"><p class="muted">${isSelf ? 'You cannot take action on your own account.' : 'Staff accounts cannot be sanctioned. Change their role first.'}</p></div>`}

          ${can(req.user, 'roles') && !isSelf && person.totp_secret ? html`
          <form class="card pad stack" method="post" action="/admin/users/${person.user_id}/reset-2fa">${csrf(req)}
            <h2>Two-step sign-in</h2><p class="muted small">On since ${new Date(person.totp_enabled_at || Date.now()).toLocaleDateString('en-GB')}. Reset it only after confirming the person’s identity (for example, in person) because they lost their phone.</p>
            ${confirmBtn('Reset two-step sign-in', 'btn--danger-ghost btn--block', 'Reset this person’s two-step sign-in? They will have to set it up again before opening the admin area.')}
          </form>` : ''}
          ${can(req.user, 'roles') && !isSelf ? html`
          <form class="card pad stack" method="post" action="/admin/users/${person.user_id}/role">${csrf(req)}
            <h2>Role</h2>
            ${field({ name: 'role', label: 'Role', as: 'select', value: person.role, options: [['student', 'Student'], ['moderator', 'Moderator (reports and listings only)'], ['admin', 'Administrator (moderation + accounts)'], ['superadmin', 'Super admin (platform owner)']] })}
            ${confirmBtn('Change role', 'btn--ghost btn--block', 'Change this person’s role? Elevated roles can see private data and moderate content.')}
          </form>` : ''}
        </aside>
      </div>`,
  });
}

/* -------------------------------------------------------- categories */
function adminCategories(req, { items, counts, error }) {
  return shell(req, {
    title: 'Categories', active: 'categories', counts,
    body: html`
      <div class="page-head"><div><h1>Categories</h1><p class="muted">Every listing belongs to a defined category. Deactivate rather than delete to keep history intact.</p></div></div>
      ${error ? html`<div class="banner banner--warn" role="alert">${icon('alert')}<div>${error}</div></div>` : ''}
      <div class="table-wrap card"><table class="table"><thead><tr><th>Name</th><th>Slug</th><th>Listings</th><th>Active</th><th>Order</th><th></th></tr></thead><tbody>
        ${items.map((c) => html`<tr>
          <form id="cat-${c.category_id}" method="post" action="/admin/categories/${c.category_id}">${csrf(req)}</form>
          <td><input type="text" form="cat-${c.category_id}" name="name" value="${c.name}" maxlength="40" aria-label="Name for ${c.name}" required></td>
          <td class="muted small">${c.slug}</td><td>${c.listing_count}</td>
          <td><label class="check"><input form="cat-${c.category_id}" type="checkbox" name="is_active" value="1"${c.is_active ? ' checked' : ''}> <span class="sr-only">Active</span></label></td>
          <td><input form="cat-${c.category_id}" type="number" name="sort_order" value="${c.sort_order}" min="0" max="99" class="narrow-input" aria-label="Sort order for ${c.name}"></td>
          <td><button form="cat-${c.category_id}" class="btn btn--ghost btn--sm" type="submit">Save</button></td></tr>`)}
      </tbody></table></div>
      <form class="card pad stack" method="post" action="/admin/categories">${csrf(req)}
        <h2>Add a category</h2>
        <div class="grid-2">${field({ name: 'name', label: 'Name', required: true, maxlength: 40 })}
          ${field({ name: 'icon', label: 'Icon', as: 'select', value: 'tag', options: ['tag', 'book', 'laptop', 'home', 'tool', 'briefcase', 'calendar', 'compass', 'gift', 'star', 'pin'].map((i) => [i, i]) })}</div>
        ${field({ name: 'description', label: 'Description', maxlength: 160 })}
        <button class="btn btn--primary" type="submit">Add category</button>
      </form>`,
  });
}

/* ------------------------------------------------------------- audit */
function adminAudit(req, { rows, q, counts, total, pageNum, pages }) {
  return shell(req, {
    title: 'Audit log', active: 'audit', counts,
    body: html`
      <div class="page-head"><div><h1>Audit log</h1><p class="muted">${total} recorded event${total === 1 ? '' : 's'}. Passwords and tokens are never written here.</p></div></div>
      <form class="toolbar" method="get" action="/admin/audit">${field({ name: 'q', label: 'Filter by action (e.g. login, moderation)', value: q, maxlength: 40 })}<button class="btn btn--primary" type="submit">Filter</button></form>
      <div class="card pad">${logTable(rows)}</div>${pagination(pageNum, pages, { q })}`,
  });
}

module.exports = { shell, adminLogin, dashboard, reportsList, reportDetail, adminListings, adminUsers, adminUserDetail, adminSignals, adminUpdates, adminErrors, adminCategories, adminAudit };
