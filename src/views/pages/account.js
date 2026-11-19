'use strict';
const { html, raw } = require('../../lib/html');
const config = require('../../config');
const { page } = require('../layout');
const { turnstileWidget, icon, listingCard, avatar, field, errorSummary, csrf, badge, timeAgo, fmtDate, priceLabel, confirmBtn, brandLogoOnDark } = require('../components');

/* ------------------------------------------------------------------ auth */
function authShell(req, { title, heading, sub, form, aside }) {
  return page(req, {
    title,
    body: html`<section class="auth">
      <div class="auth__aside">
        <div class="auth__brand">${brandLogoOnDark()}</div>
        <h2>${aside.h}</h2>
        <ul class="auth__points">${aside.points.map((p) => html`<li>${icon('check')} ${p}</li>`)}</ul>
      </div>
      <div class="auth__card card">
        <h1>${heading}</h1>
        <p class="muted">${sub}</p>
        ${form}
      </div>
    </section>`,
  });
}

function login(req, { email = '', error = '', next = '' } = {}) {
  return authShell(req, {
    title: 'Sign in',
    heading: 'Sign in',
    sub: 'Sign in to publish, report and manage your listings.',
    aside: { h: 'Sign in to CampusFind', points: ['Browse and search the directory', 'Publish and manage your listings', 'Reports are reviewed by staff'] },
    form: html`<form method="post" action="/login" class="stack" novalidate>
      ${csrf(req)}<input type="hidden" name="next" value="${next}">
      ${error ? html`<div class="banner banner--warn" role="alert">${icon('alert')}<div>${error}</div></div>` : ''}
      ${field({ name: 'email', label: 'Email', type: 'email', value: email, required: true, autocomplete: 'username' })}
      ${field({ name: 'password', label: 'Password', type: 'password', required: true, autocomplete: 'current-password' })}
      ${turnstileWidget('login')}
      <button class="btn btn--primary btn--block" type="submit">Sign in</button>
      <p class="small center"><a href="/forgot">Forgot your password?</a></p>
      <p class="small center muted">New here? <a href="/register">Create an account</a></p>
    </form>`,
  });
}

/** Date of birth as three menus. Years stop at the minimum age, so nobody can pick today's date by accident. */
function dobField(dob, error) {
  const [y, m, d] = /^(\d{4})-(\d{2})-(\d{2})$/.test(dob || '') ? dob.split('-').map(Number) : [0, 0, 0];
  const top = new Date().getUTCFullYear() - config.minAge;
  const years = Array.from({ length: 80 }, (_, i) => top - i);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const opt = (v, label, cur) => html`<option value="${v}"${Number(v) === cur ? raw(' selected') : ''}>${label}</option>`;
  return html`<fieldset class="field dob${error ? ' field--error' : ''}" aria-describedby="f-dob-hint${error ? ' f-dob-err' : ''}">
    <legend>Date of birth <span class="req">*</span></legend>
    <div class="dob__row">
      <label class="sr-only" for="f-dob-d">Day</label><select id="f-dob-d" name="dob_d" required autocomplete="bday-day"><option value="">Day</option>${Array.from({ length: 31 }, (_, i) => opt(i + 1, i + 1, d))}</select>
      <label class="sr-only" for="f-dob-m">Month</label><select id="f-dob-m" name="dob_m" required autocomplete="bday-month"><option value="">Month</option>${months.map((n, i) => opt(i + 1, n, m))}</select>
      <label class="sr-only" for="f-dob-y">Year</label><select id="f-dob-y" name="dob_y" required autocomplete="bday-year"><option value="">Year</option>${years.map((n) => opt(n, n, y))}</select>
    </div>
    <p class="hint" id="f-dob-hint">You must be at least ${config.minAge} to join. Used only to check your age. We do not store it.</p>
    ${error ? html`<p class="error-text" id="f-dob-err">${icon('alert')} ${error}</p>` : ''}
  </fieldset>`;
}

function register(req, { values = {}, errors = {} } = {}) {
  const domains = config.allowedEmailDomains;
  return authShell(req, {
    title: 'Create account',
    heading: 'Create an account',
    sub: 'Registration is free for students.',
    aside: { h: 'Create your account', points: ['Your email address is never shown to others', 'Published rules and active moderation', 'You can delete your account at any time'] },
    form: html`<form method="post" action="/register" class="stack" novalidate>
      ${csrf(req)}
      ${errorSummary(errors)}
      ${errors._form ? html`<div class="banner banner--warn" role="alert">${icon('alert')}<div>${errors._form}</div></div>` : ''}
      ${field({ name: 'name', label: 'Full name', value: values.name || '', error: errors.name, required: true, autocomplete: 'name', maxlength: 60, hint: 'Shown on your listings. Use your real name.' })}
      ${field({ name: 'email', label: 'Email', type: 'email', value: values.email || '', error: errors.email, required: true, autocomplete: 'email', hint: domains.length ? `Use your campus email (${domains.map((d) => '@' + d).join(', ')}).` : 'Never shown publicly.' })}
      ${dobField(values.dob, errors.dob)}
      ${field({ name: 'password', label: 'Password', type: 'password', error: errors.password, required: true, autocomplete: 'new-password', hint: 'At least 10 characters. A passphrase works well.' })}
      <div class="field${errors.agree ? ' field--error' : ''}">
        <label class="check"><input type="checkbox" id="f-agree" name="agree" value="1"${values.agree ? ' checked' : ''} required>
          <span>I agree to the <a href="/terms" target="_blank" rel="noopener">terms</a>, <a href="/privacy" target="_blank" rel="noopener">privacy policy</a>, <a href="/cookies" target="_blank" rel="noopener">cookie policy</a> and <a href="/rules" target="_blank" rel="noopener">community rules</a>.</span></label>
        ${errors.agree ? html`<p class="error-text">${errors.agree}</p>` : ''}
      </div>
      ${turnstileWidget('signup')}
      <button class="btn btn--primary btn--block" type="submit">Create account</button>
      <p class="small center muted">Already a member? <a href="/login">Sign in</a></p>
    </form>`,
  });
}

function forgot(req, { sent = false } = {}) {
  return authShell(req, {
    title: 'Reset password',
    heading: 'Reset your password',
    sub: sent ? 'If that email has an account, a reset link is on its way. It expires in 30 minutes.' : 'Enter your email and we will send a reset link.',
    aside: { h: 'Account recovery', points: ['Reset links expire after 30 minutes', 'Each link can be used once', 'We do not disclose whether an email is registered'] },
    form: sent
      ? html`<a class="btn btn--primary btn--block" href="/login">Back to sign in</a>`
      : html`<form method="post" action="/forgot" class="stack">${csrf(req)}
          ${field({ name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email' })}
          ${turnstileWidget('forgot')}
          <button class="btn btn--primary btn--block" type="submit">Send reset link</button>
          <p class="small center"><a href="/login">Back to sign in</a></p></form>`,
  });
}

function resetPassword(req, { token, error = '', valid = true }) {
  return authShell(req, {
    title: 'Choose a new password',
    heading: 'Choose a new password',
    sub: valid ? 'Pick something at least 10 characters long.' : 'This reset link is invalid or has expired.',
    aside: { h: 'Password security', points: ['All other sessions are signed out after a reset', 'Use a password you do not use elsewhere', 'A passphrase of several words works well'] },
    form: valid
      ? html`<form method="post" action="/reset" class="stack">${csrf(req)}<input type="hidden" name="oobCode" value="${token}">
          ${field({ name: 'password', label: 'New password', type: 'password', required: true, autocomplete: 'new-password', error })}
          <button class="btn btn--primary btn--block" type="submit">Update password</button></form>`
      : html`<a class="btn btn--primary btn--block" href="/forgot">Request a new link</a>`,
  });
}

/* ------------------------------------------------------ listing editor */
function listingForm(req, { l = {}, categories, errors = {}, images = [], isEdit = false, kind = null }) {
  const priceType = l.price_type || 'none';
  const lockedStatus = ['hidden', 'removed'].includes(l.status);
  // Lost & found gets its own photo guidance. The category can also be changed in the form, so app.js swaps the tips live.
  const lfCategory = categories.find((c) => c.slug === 'lost-found');
  const isLostFound = Boolean(lfCategory && Number(l.category_id) === lfCategory.category_id);
  const lfKind = kind || (/^found\b/i.test(l.title || '') ? 'found' : 'lost');
  return page(req, {
    title: isEdit ? 'Edit listing' : 'Post a listing',
    active: 'post',
    body: html`
      <div class="page-head"><div><h1>${isEdit ? 'Edit listing' : 'Post a listing'}</h1>
        <p class="muted">Provide an accurate title, a clear description and genuine photographs.</p></div></div>

      ${lockedStatus ? html`<div class="banner banner--warn">${icon('alert')}<div>Moderators set this listing to <strong>${l.status}</strong>. You can update the details, but only a moderator can make it live again.</div></div>` : ''}

      <div class="post-grid">
      <form class="card form-card stack" method="post" enctype="multipart/form-data" action="${isEdit ? `/listings/${l.listing_id}/edit` : '/listings/new'}"${lfCategory ? raw(` data-lf-category="${lfCategory.category_id}"`) : ''} novalidate>
        ${csrf(req)}
        ${errorSummary(errors)}
        ${errors._form ? html`<div class="banner banner--warn" role="alert">${icon('alert')}<div>${errors._form}</div></div>` : ''}

        ${field({ name: 'title', label: 'Title', value: l.title || '', error: errors.title, required: true, maxlength: 90, placeholder: 'e.g. Intro to Statistics, 5th edition' })}

        <div class="grid-2">
          ${field({ name: 'category_id', label: 'Category', as: 'select', value: l.category_id || '', error: errors.category_id, required: true,
            options: [['', 'Choose…'], ...categories.map((c) => [c.category_id, c.name])] })}
          ${field({ name: 'location', label: 'Where on campus', value: l.location || '', error: errors.location, maxlength: 80, placeholder: 'e.g. Main library, Block C', hint: 'Optional. Avoid home addresses.' })}
        </div>

        ${(() => { const biz = categories.find((c) => c.slug === 'business'); const P = config.payments; const m = require('../../services/payments').money;
          return biz ? html`<div class="banner banner--warn pay-notice" data-show-when="category_id=${biz.category_id}" hidden>${icon('store')}<div>
            <strong>Business listings need payment before they go live.</strong> After you fill this in, you pay for a Business advertisement (${m(P.prices.business)} for ${P.businessDays} days, or Premium ${m(P.prices.premium)}). Your listing goes live as soon as payment is confirmed, and you get the Pro seller perks.</div></div>` : ''; })()}
        ${field({ name: 'business_type', label: 'Type of business', as: 'select', value: l.business_type || '',
          options: [['', 'Not a business'], ...require('../../lib/businessTypes').TYPES.map((t) => [t.key, t.label])],
          hint: raw('Only used when the category is Business. Business listings must follow the <a href="/business-terms">Seller &amp; business terms</a>.') })}

        <div class="grid-2">
          ${field({ name: 'price_type', label: 'Price', as: 'select', value: priceType, options: [['none', 'No price'], ['fixed', 'Fixed price'], ['negotiable', 'Negotiable'], ['free', 'Free']] })}
          <div data-price-field>${field({ name: 'price', label: `Amount (${config.currency.symbol})`, type: 'number', value: l.price_cents != null ? (l.price_cents / 100).toString() : '', error: errors.price, min: 0, step: '0.01', inputmode: 'decimal' })}</div>
        </div>

        ${field({ name: 'description', label: 'Description', as: 'textarea', rows: 7, value: l.description || '', error: errors.description, required: true, maxlength: 2000,
          hint: 'Condition, what is included, availability. Plain text only.' })}

        ${field({ name: 'contact', label: 'Contact details', as: 'textarea', rows: 2, value: l.contact || '', error: errors.contact, maxlength: 200,
          hint: 'Visible to signed-in members only. For example: phone or WhatsApp number, and preferred times.' })}

        ${config.photosEnabled ? html`<fieldset class="field uploader">
          <legend><span data-photo-legend>${isLostFound ? 'Add a photo of the item' : 'Photos'}</span> <span class="muted small">(up to ${require('../../services/pro').photoLimit(req.user)}, JPG/PNG/WebP, ${config.limits.imageBytes / 1024 / 1024} MB each)</span></legend>
          <div class="lf-tip" data-lf-tip${isLostFound ? '' : raw(' hidden')}>
            ${icon('camera')}
            <div>
              <p><strong>A clear photo is the fastest way to reunite an item with its owner.</strong> Take it in good light, on a plain surface, and show any marks, stickers or damage.</p>
              <p class="lf-tip__lost"${lfKind === 'found' ? raw(' hidden') : ''}>Lost something? Add a photo of the item itself, or of a similar one if you do not have your own.</p>
              <p class="lf-tip__found"${lfKind === 'found' ? '' : raw(' hidden')}>Found something? Do not photograph ID cards, bank cards or screens. Keep one detail back, such as a serial number or what is inside, so you can check the owner is genuine.</p>
            </div>
          </div>
          ${images.length ? html`<ul class="thumbs">${images.map((im) => html`<li><img src="/uploads/${im.filename}" alt="" width="96" height="72" loading="lazy">
            <label class="check small"><input type="checkbox" name="remove_image" value="${im.image_id}"> Remove</label></li>`)}</ul>` : ''}
          <input type="file" id="f-images" name="images" aria-label="Choose photos to upload" accept="image/jpeg,image/png,image/webp" multiple data-max="${config.limits.imageBytes}" data-slots="${require('../../services/pro').photoLimit(req.user) - images.length}">
          <div class="previews" data-previews></div>
          ${errors.images ? html`<p class="error-text">${errors.images}</p>` : ''}
        </fieldset>` : ''}

        <div class="form-actions">
          ${isEdit
            ? html`${lockedStatus ? '' : field({ name: 'status', label: 'Visibility', as: 'select', value: l.status || 'active', options: [['active', 'Live'], ['draft', 'Draft (only you)'], ['closed', 'Closed']] })}
                <button class="btn btn--primary" type="submit">Save changes</button><a class="btn btn--ghost" href="/listings/${l.listing_id}">Cancel</a>`
            : html`<button class="btn btn--primary" type="submit" name="intent" value="publish">${icon('check')} Publish</button>
                <button class="btn btn--ghost" type="submit" name="intent" value="draft">Save as draft</button>`}
        </div>
      </form>
      <aside class="post-tips" aria-label="Tips for your listing">
        <section class="card post-tips__card">
          <h2>${icon('star')} Listings that get replies</h2>
          <ul>
            <li><strong>Say exactly what it is.</strong> Brand, model, edition or size in the title.</li>
            <li><strong>Add real photos.</strong> Good light, plain background, show any damage.</li>
            <li><strong>Give a fair price.</strong> Check similar listings in Browse first.</li>
            <li><strong>Say where to meet.</strong> A busy public place on campus is best.</li>
          </ul>
        </section>
        <section class="card post-tips__card post-tips__card--safe">
          <h2>${icon('shield')} Stay safe</h2>
          <ul>
            <li>Never share your Mobile Money PIN or a code sent to your phone.</li>
            <li>Do not post ID cards, bank cards or your home address.</li>
            <li>Every listing can be reported and is checked by our moderators.</li>
          </ul>
          <a class="post-tips__link" href="/rules">Read the Community rules ${icon('arrow')}</a>
        </section>
      </aside>
      </div>`,
  });
}

const fresh = require('../../services/freshness');
const dayLabel = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function myListings(req, { items, stats = null }) {
  return page(req, {
    title: 'My listings', active: 'mine',
    body: html`
      <div class="page-head"><div><h1>My listings</h1><p class="muted">Manage what you have posted.</p>${stats ? '' : html`<p class="small pro-teaser">${icon('star')} Pro sellers see views, saves and chats for every listing. <a href="/pricing">See plans</a></p>`}</div>
        <a class="btn btn--primary" href="/listings/new">${icon('plus')} New listing</a></div>
      ${items.length
        ? html`<ul class="manage">${items.map((l) => html`<li class="card manage__row">
            <a class="manage__thumb tone-${l.cat_tone ?? 0}" href="/listings/${l.listing_id}" tabindex="-1" aria-hidden="true">${l.cover ? html`<img src="/uploads/${l.cover}" alt="" width="72" height="72" loading="lazy">` : icon(l.cat_icon || 'tag')}</a>
            <div class="manage__main">
              <p class="manage__title"><a href="/listings/${l.listing_id}">${l.title}</a> ${fresh.isExpired(l) ? html`<span class="badge badge--expired">Expired</span>` : require('../../lib/deals').isSold(l) ? html`<span class="badge badge--sold">Sold</span>` : badge(l.status)}</p>
              <p class="muted small">${l.cat_name} · ${priceLabel(l) || 'No price'} · updated ${timeAgo(l.updated_at)}</p>
              ${stats ? html`<p class="small manage__stats">${icon('eye')} ${l.views || 0} views · ${icon('bookmark')} ${(stats.get(Number(l.listing_id)) || {}).saves || 0} saves · ${icon('chat')} ${(stats.get(Number(l.listing_id)) || {}).chats || 0} chats</p>` : ''}
              ${l.awaiting_payment ? html`<p class="small manage__fresh is-due">${icon('store')} Waiting for payment. <a href="/listings/${l.listing_id}/promote">Pay to publish</a></p>` : ''}
              ${l.status === 'active' && !fresh.exempt(l) ? html`<p class="small manage__fresh${fresh.canRenew(l) ? ' is-due' : ''}">${icon('clock')} Live until ${dayLabel(fresh.liveUntil(l))}</p>` : ''}
              ${fresh.isExpired(l) ? html`<p class="small manage__fresh is-due">${icon('clock')} Hidden from Browse since ${dayLabel(l.expired_at || l.updated_at)}. Still available? Renew it.</p>` : ''}
            </div>
            <div class="manage__actions">
              ${l.status === 'active' && require('../../lib/deals').soldLabel(l) ? html`<form method="post" action="/listings/${l.listing_id}/sold">${csrf(req)}${confirmBtn(html`${icon('check')} ${require('../../lib/deals').soldLabel(l)}`, 'btn--primary btn--sm', l.reserved_for ? 'Mark this as sold to the buyer you reserved it for? The listing closes and they are asked to review you.' : 'Mark this as sold? The listing closes and leaves Browse.')}</form>` : ''}
              ${l.reserved_for && l.status === 'active' ? html`<form method="post" action="/listings/${l.listing_id}/unreserve">${csrf(req)}<button class="btn btn--ghost btn--sm" type="submit">${icon('clock')} Reserved · make available</button></form>` : ''}
              ${fresh.canRenew(l) ? html`<form method="post" action="/listings/${l.listing_id}/renew">${csrf(req)}<button class="btn btn--primary btn--sm" type="submit">${icon('clock')} Renew for ${fresh.LIVE_DAYS} days</button></form>` : ''}
              ${l.status === 'active' ? html`<a class="btn btn--ghost btn--sm" href="/listings/${l.listing_id}/promote">${icon('star')} Promote</a>` : ''}
              <a class="btn btn--ghost btn--sm" href="/listings/${l.listing_id}/edit">${icon('edit')} Edit</a>
              ${l.status === 'active' && l.cat_slug === 'lost-found'
                ? html`<form method="post" action="/listings/${l.listing_id}/status">${csrf(req)}
                    <input type="hidden" name="status" value="closed"><input type="hidden" name="outcome" value="returned">
                    <button class="btn btn--primary btn--sm" type="submit">${icon('check')} Mark as returned</button></form>` : ''}
              ${['active', 'closed', 'draft'].includes(l.status) && !fresh.isExpired(l)
                ? html`<form method="post" action="/listings/${l.listing_id}/status">${csrf(req)}
                    <input type="hidden" name="status" value="${l.status === 'active' ? 'closed' : 'active'}">
                    <button class="btn btn--ghost btn--sm" type="submit">${l.status === 'active' ? 'Mark closed' : 'Make live'}</button></form>` : ''}
              <form method="post" action="/listings/${l.listing_id}/delete">${csrf(req)}${confirmBtn(html`${icon('trash')} Delete`, 'btn--danger-ghost btn--sm', 'Delete this listing? This cannot be undone.')}</form>
            </div></li>`)}</ul>`
        : html`<div class="empty">${icon('tag', 'icon--xl')}<h2>No listings</h2><p>You have not published any listings yet.</p><a class="btn btn--primary" href="/listings/new">Publish a listing</a></div>`}`,
  });
}

/* ---------------------------------------------------------------- profile */
function verifyCard(req, u) {
  const v = require('../../services/verify');
  const lvl = v.level(u);
  const student = v.isStudentEmail(u.email);
  if (lvl) return html`<section class="card pad verify verify--done" id="verify" aria-labelledby="h-verify"><div class="verify__icon">${icon(lvl === 'student' ? 'shield' : 'check')}</div>
    <div><h2 id="h-verify">${lvl === 'student' ? 'Verified student' : 'Email verified'}</h2>
    <p class="muted small">${lvl === 'student' ? 'Buyers see the Verified student badge on your profile and listings.' : 'Buyers see the Email verified badge on your profile and listings. Members who sign up with a university email (ending in .edu.gh) get the Verified student badge.'}</p></div></section>`;
  return html`<section class="card pad verify" id="verify" aria-labelledby="h-verify"><div class="verify__icon">${icon('shield')}</div>
    <div class="verify__body"><h2 id="h-verify">Get ${student ? 'the Verified student badge' : 'a verified badge'}</h2>
      <p class="muted small">Confirm <strong>${u.email}</strong> and buyers see ${student ? 'Verified student' : 'Email verified'} next to your name. Verified sellers get more replies.</p>
      <div class="row row--wrap">
        <form method="post" action="/profile/verify">${csrf(req)}<button class="btn btn--primary btn--sm" type="submit">${icon('mail')} Send verification link</button></form>
        <a class="btn btn--ghost btn--sm" href="/profile#verify">I have clicked the link</a>
      </div></div></section>`;
}

function profile(req, { p, errors = {}, pwError = '', sessions = null, blocked = null }) {
  const u = req.user;
  return page(req, {
    title: 'Your profile', active: 'profile',
    body: html`
      <div class="page-head"><div><h1>Your profile</h1><p class="muted">${u.email} · <a href="/users/${u.user_id}">View public profile</a></p></div></div>
      ${verifyCard(req, u)}
      <div class="grid-2 grid-2--top">
        <form class="card form-card stack" method="post" action="/profile">${csrf(req)}
          <h2>About you</h2>
          ${errorSummary(errors)}
          ${errors._form ? html`<div class="banner banner--warn">${icon('alert')}<div>${errors._form}</div></div>` : ''}
          ${field({ name: 'name', label: 'Full name', value: p.name, error: errors.name, required: true, maxlength: 60, autocomplete: 'name' })}
          ${field({ name: 'program', label: 'Programme / course', value: p.program, maxlength: 80, error: errors.program })}
          ${field({ name: 'study_year', label: 'Year of study', value: p.study_year, maxlength: 20, placeholder: 'e.g. Year 2' })}
          ${field({ name: 'bio', label: 'Short bio', as: 'textarea', rows: 4, value: p.bio, maxlength: 300, error: errors.bio })}
          <label class="check"><input type="checkbox" name="show_program" value="1"${p.show_program ? ' checked' : ''}><span>Show my programme and year on my public profile</span></label>
          <button class="btn btn--primary" type="submit">Save profile</button>
        </form>

        <div class="stack">
          <form class="card form-card stack" method="post" action="/profile/password">${csrf(req)}
            <h2>Change password</h2>
            ${pwError ? html`<div class="banner banner--warn" role="alert">${icon('alert')}<div>${pwError}</div></div>` : ''}
            ${field({ name: 'current_password', label: 'Current password', type: 'password', required: true, autocomplete: 'current-password' })}
            ${field({ name: 'new_password', label: 'New password', type: 'password', required: true, autocomplete: 'new-password', hint: 'At least 10 characters.' })}
            <button class="btn btn--ghost" type="submit">Update password</button>
          </form>

          ${require('../components').pushCard()}

          ${Array.isArray(sessions) ? html`<section class="card form-card stack" id="devices" aria-labelledby="h-devices">
            <h2 id="h-devices">Where you’re signed in</h2>
            <p class="muted small">Do not recognise one? Sign it out, then change your password.</p>
            <ul class="devices">${sessions.map((s) => html`<li class="devices__row">
              <span class="devices__icon">${icon(/iPhone|Android/.test(s.label) ? 'phone' : 'laptop')}</span>
              <div class="devices__main"><strong>${s.label}</strong>${s.current ? html` <span class="badge badge--active">This device</span>` : ''}
                <p class="muted small">${s.current ? 'Active now' : `Last used ${timeAgo(s.last_seen_at)}`}${s.ip ? ` · network ${s.ip}` : ''} · signed in ${timeAgo(s.created_at)}</p></div>
              ${s.current ? '' : html`<form method="post" action="/profile/sessions/${s.id}/revoke">${csrf(req)}<button class="btn btn--ghost btn--sm" type="submit">Sign out</button></form>`}
            </li>`)}</ul>
            ${sessions.length > 1 ? html`<form method="post" action="/profile/sessions/others">${csrf(req)}${confirmBtn('Sign out everywhere else', 'btn--danger-ghost btn--block', 'Sign out of every other device? You stay signed in here.')}</form>` : ''}
          </section>` : ''}

          ${Array.isArray(blocked) && blocked.length ? html`<section class="card form-card stack" id="blocked" aria-labelledby="h-blocked">
            <h2 id="h-blocked">Blocked members</h2>
            <p class="muted small">They cannot message you and you do not see their listings.</p>
            <ul class="devices">${blocked.map((b) => html`<li class="devices__row"><div class="devices__main"><strong>${b.name}</strong></div>
              <form method="post" action="/users/${b.user_id}/unblock">${csrf(req)}<input type="hidden" name="back" value="profile"><button class="btn btn--ghost btn--sm" type="submit">Unblock</button></form></li>`)}</ul>
          </section>` : ''}

          <form class="card form-card stack danger-zone" method="post" action="/profile/delete">${csrf(req)}
            <h2>${icon('alert')} Delete account</h2>
            <p class="muted small">Removes your listings and erases your personal details. Your name becomes “Deleted user”. This cannot be undone.</p>
            ${field({ name: 'password', label: 'Confirm with your password', type: 'password', required: true, autocomplete: 'current-password' })}
            ${confirmBtn('Delete my account', 'btn--danger', 'Permanently delete your account and all your listings?')}
          </form>
        </div>
      </div>`,
  });
}

function publicProfile(req, { person, p, items, joined, reviews = [], rating = { avg: 0, count: 0 }, myReview = null, eligible = false, iBlocked = false, sold = 0 }) {
  const self = req.user && req.user.user_id === person.user_id;
  const first = person.name.split(' ')[0];
  const staff = ['superadmin', 'admin', 'moderator'].includes(person.role);
  const views = items.reduce((n, l) => n + (Number(l.views) || 0), 0);
  const canMessage = !self && ['active', 'restricted'].includes(person.status);
  const study = p.show_program && (p.program || p.study_year) ? [p.program, p.study_year].filter(Boolean).join(' · ') : '';
  return page(req, {
    title: person.name, active: 'profile',
    body: html`
      <div class="pf-wrap"><div class="pf">
        <aside class="pf-card" aria-labelledby="pf-name">
          <div class="pf-card__cover" aria-hidden="true"></div>
          <div class="pf-card__id">
            <div class="pf-card__avatar">${avatar(person.name, { size: 'xl' })}</div>
            <h1 id="pf-name" class="pf-card__name">${person.name}</h1>
            ${study ? html`<p class="pf-card__study">${icon('book')} ${study}</p>` : ''}
            <div class="pf-card__badges">
              ${require('../components').proBadge(person)}
              ${require('../components').trustBadge(person)}
              ${staff ? html`<span class="pf-badge pf-badge--staff">${icon('shield')} CampusFind team</span>` : ''}
              ${person.status === 'active' ? html`<span class="pf-badge pf-badge--ok">${icon('check')} Good standing</span>` : ''}
            </div>
          </div>
          <dl class="pf-stats">
            <div><dt>Listings</dt><dd>${items.length}</dd></div>
            <div><dt>Sold</dt><dd>${sold}</dd></div>
            <div><dt>Joined</dt><dd>${joined}</dd></div>
          </dl>
          ${require('../../lib/responsiveness').replyLabel(person) ? html`<p class="pf-reply">${icon('chat')} ${require('../../lib/responsiveness').replyLabel(person).text}</p>` : ''}
          ${rating.count ? html`<a class="pf-rating" href="#reviews">${stars(rating.avg)}<strong>${rating.avg.toFixed(1)}</strong><span>${rating.count} ${rating.count === 1 ? 'review' : 'reviews'}</span></a>` : ''}
          <div class="pf-card__actions">
            ${self ? html`<a class="btn btn--primary btn--block" href="/profile">${icon('edit')} Edit profile</a>
                <a class="btn btn--ghost btn--block" href="/listings/new">${icon('plus')} Post a listing</a>` : ''}
            ${canMessage ? (req.user
              ? html`<details class="dm-box pf-dm">
                  <summary class="btn btn--primary btn--block">${icon('mail')} Message ${first}</summary>
                  <form class="dm-box__form" method="post" action="/users/${person.user_id}/message">${csrf(req)}
                    <label for="f-dm">Your message</label>
                    <textarea id="f-dm" name="body" rows="3" maxlength="1000" required placeholder="Hi! I saw your listing…" data-chat-input></textarea>
                    <p class="hint">A private chat opens in Chats. Your email and phone number stay hidden.</p>
                    <button class="btn btn--primary btn--sm" type="submit">${icon('arrow')} Send</button>
                  </form></details>`
              : html`<a class="btn btn--primary btn--block" href="/login?next=/users/${person.user_id}">${icon('mail')} Sign in to message ${first}</a>`) : ''}
            ${!self && req.user ? html`<a class="pf-card__report" href="/report?type=user&id=${person.user_id}">${icon('flag')} Report this member</a>` : ''}
            ${!self && req.user && !staff ? (iBlocked
              ? html`<form method="post" action="/users/${person.user_id}/unblock">${csrf(req)}<button class="pf-card__report link-btn" type="submit">${icon('x')} Unblock ${first}</button></form>`
              : html`<form method="post" action="/users/${person.user_id}/block">${csrf(req)}${confirmBtn(html`${icon('x')} Block ${first}`, 'pf-card__report link-btn', `Block ${first}? They will not be able to message you, and you will not see their listings. They are not told.`)}</form>`) : ''}
          </div>
          <ul class="pf-trust">
            <li>${icon('lock')}<span>Email and phone stay private. Chat happens on CampusFind.</span></li>
            <li>${icon('shield')}<span>Every listing is checked by moderators before it goes live.</span></li>
          </ul>
        </aside>

        <div class="pf-main">
          <section class="pf-panel" aria-labelledby="pf-about">
            <h2 id="pf-about" class="pf-panel__title">About ${self ? 'you' : first}</h2>
            ${p.bio ? html`<p class="prewrap pf-bio">${p.bio}</p>`
              : self ? html`<p class="pf-muted">Add a short bio so buyers know who they are dealing with. <a href="/profile">Write your bio</a></p>`
              : html`<p class="pf-muted">${first} has not written a bio yet.</p>`}
          </section>

          <section class="pf-panel" aria-labelledby="pf-listings">
            <div class="pf-panel__head">
              <h2 id="pf-listings" class="pf-panel__title">Live listings <span class="pf-count">${items.length}</span></h2>
              ${items.length ? html`<a class="pf-link" href="/browse">Browse all ${icon('arrow')}</a>` : ''}
            </div>
            ${items.length ? html`<div class="grid pf-grid">${items.map(listingCard)}</div>`
              : html`<div class="pf-empty">
                  <span class="pf-empty__icon">${icon('tag')}</span>
                  <h3>${self ? 'You have no live listings yet' : `${first} has no live listings right now`}</h3>
                  <p>${self ? 'Post a textbook, room, service or anything else. Moderators review it, usually within a few hours.' : 'Check back later, or see what other students are offering.'}</p>
                  ${self ? html`<a class="btn btn--primary" href="/listings/new">${icon('plus')} Post your first listing</a>` : html`<a class="btn btn--ghost" href="/browse">${icon('search')} Browse listings</a>`}
                </div>`}
          </section>

          ${reviewsPanel(req, { person, first, self, reviews, rating, myReview, eligible })}

          ${!self ? html`<aside class="pf-tip" aria-label="Safety tip">${icon('alert')}<p><strong>Stay safe:</strong> meet in a busy place on campus, check the item before you pay, and never send money in advance. <a href="/rules">Community rules</a></p></aside>` : ''}
        </div>
      </div></div>`,
  });
}

/* ------------------------------------------------------------ seller reviews */
/** Five stars, filled to the nearest half. Decorative: the number next to it carries the meaning for screen readers. */
function stars(avg) {
  const full = Math.floor(avg + 0.25);
  const half = avg - full >= 0.25 && avg - full < 0.75;
  const cells = [1, 2, 3, 4, 5].map((i) => (i <= full ? 'is-on' : i === full + 1 && half ? 'is-half' : ''));
  return html`<span class="stars" aria-hidden="true">${cells.map((c) => html`<span class="star ${c}">★</span>`)}</span>`;
}

function reviewsPanel(req, { person, first, self, reviews, rating, myReview, eligible }) {
  const staffViewer = req.user && ['superadmin', 'admin', 'moderator'].includes(req.user.role);
  const mineVisible = myReview && myReview.status === 'visible';
  const form = (r) => html`<form class="rv-form stack" method="post" action="/users/${person.user_id}/review">${csrf(req)}
      <fieldset class="rv-stars"><legend>${r ? 'Edit your rating' : `Rate ${first}`}</legend>
        ${[5, 4, 3, 2, 1].map((n) => html`<input type="radio" id="rv-${n}" name="rating" value="${n}" required${r && r.rating === n ? ' checked' : ''}><label for="rv-${n}" title="${n} ${n === 1 ? 'star' : 'stars'}"><span class="sr-only">${n} ${n === 1 ? 'star' : 'stars'}</span>★</label>`)}
      </fieldset>
      <label for="rv-body" class="small"><strong>What was it like dealing with ${first}?</strong> <span class="muted">(optional)</span></label>
      <textarea id="rv-body" name="body" rows="3" maxlength="500" placeholder="Was the item as described? Did they turn up on time?">${r ? r.body : ''}</textarea>
      <p class="hint">Be honest and fair. Reviews are public and must follow the <a href="/rules">Community rules</a>. Never include phone numbers.</p>
      <div class="row"><button class="btn btn--primary btn--sm" type="submit">${r ? 'Update review' : 'Post review'}</button></div>
    </form>`;
  return html`<section class="pf-panel" id="reviews" aria-labelledby="pf-reviews">
    <div class="pf-panel__head">
      <h2 id="pf-reviews" class="pf-panel__title">Reviews <span class="pf-count">${rating.count}</span></h2>
      ${rating.count ? html`<p class="rv-summary">${stars(rating.avg)} <strong>${rating.avg.toFixed(1)}</strong> out of 5</p>` : ''}
    </div>
    ${!self && req.user ? (mineVisible
      ? html`<details class="rv-mine"><summary>You rated ${first} ${myReview.rating} ${myReview.rating === 1 ? 'star' : 'stars'}. Edit or delete</summary>${form(myReview)}
          <form method="post" action="/users/${person.user_id}/review/delete">${csrf(req)}<button class="btn btn--danger-ghost btn--sm" type="submit">${icon('trash')} Delete my review</button></form></details>`
      : eligible && !(myReview && myReview.status === 'removed') ? form(null)
      : html`<p class="pf-muted small">${icon('lock')} You can review ${first} after you have chatted about one of their listings and they have replied.</p>`) : ''}
    ${reviews.length
      ? html`<ul class="rv-list">${reviews.map((r) => html`<li class="rv">
          <div class="rv__head">
            <span class="avatar avatar--sm">${(r.author && r.author.name ? r.author.name : '?').slice(0, 1)}</span>
            <div><p class="rv__who">${r.author ? html`<a href="/users/${r.author.user_id}">${r.author.name}</a>` : 'Former member'}</p>
              <p class="rv__meta">${stars(r.rating)} <span class="sr-only">${r.rating} out of 5</span> · ${timeAgo(r.updated_at)}</p></div>
          </div>
          ${r.body ? html`<p class="rv__body prewrap">${r.body}</p>` : ''}
          <div class="rv__actions">
            ${req.user && req.user.user_id !== r.reviewer_id ? html`<a class="rv__report" href="/report?type=user&id=${r.reviewer_id}&review=${r.id}">${icon('flag')} Report</a>` : ''}
            ${staffViewer ? html`<form method="post" action="/reviews/${r.id}/remove">${csrf(req)}${confirmBtn(html`${icon('trash')} Remove`, 'btn--danger-ghost btn--sm', 'Remove this review for everyone?')}</form>` : ''}
          </div>
        </li>`)}</ul>`
      : html`<p class="pf-muted">${self ? 'No reviews yet. Buyers who chat with you about a listing can leave one.' : `${first} has no reviews yet.`}</p>`}
  </section>`;
}

/* ------------------------------------------------------------ saved listings */
function saved(req, { items, unavailable }) {
  return page(req, {
    title: 'Saved listings', active: 'saved',
    body: html`
      <div class="page-head"><div><h1>Saved listings</h1><p class="muted">Only you can see this list.</p></div></div>
      <h2 class="sr-only">Your saved listings</h2>
      ${unavailable ? html`<div class="banner banner--info">${icon('alert')}<div>${unavailable} saved ${unavailable === 1 ? 'listing is' : 'listings are'} no longer available, so ${unavailable === 1 ? 'it is' : 'they are'} not shown here.</div></div>` : ''}
      ${items.length
        ? html`<div class="grid">${items.map((l) => html`<div class="saved-item">${listingCard(l)}
            <form method="post" action="/listings/${l.listing_id}/save" class="saved-item__form">${csrf(req)}<input type="hidden" name="next" value="/saved">
              <button class="btn btn--ghost btn--sm btn--block" type="submit">${icon('bookmark')} Remove from saved</button></form></div>`)}</div>`
        : html`<div class="empty">${icon('bookmark', 'icon--xl')}<h2>Nothing saved yet</h2><p>Use Save on a listing to keep it here for later.</p><a class="btn btn--primary" href="/browse">Browse listings</a></div>`}`,
  });
}

/* ------------------------------------------------------------ search alerts */
function alertsPage(req, { items, max }) {
  return page(req, {
    title: 'Search alerts', active: 'alerts',
    body: html`
      <div class="page-head"><div><h1>Search alerts</h1><p class="muted">Get a notification when a new listing matches a search you saved. Only you can see these.</p></div>
        <a class="btn btn--primary" href="/browse">${icon('search')} New search</a></div>
      ${items.length
        ? html`<ul class="manage">${items.map((x) => html`<li class="card manage__row">
            <span class="manage__thumb alert-ico" aria-hidden="true">${icon('bell')}</span>
            <div class="manage__main">
              <p class="manage__title"><a href="/browse?${new URLSearchParams({ ...(x.q ? { q: x.q } : {}), ...(x.category ? { category: x.category } : {}), ...(x.price_max_cents != null ? { price_max: String(x.price_max_cents / 100) } : {}) }).toString()}">${x.label}</a></p>
              <p class="muted small">Saved ${timeAgo(x.created_at)} · ${x.hits ? `${x.hits} ${x.hits === 1 ? 'match' : 'matches'} so far` : 'no matches yet'}</p>
            </div>
            <div class="manage__actions"><form method="post" action="/alerts/${x.id}/delete">${csrf(req)}<button class="btn btn--danger-ghost btn--sm" type="submit">${icon('trash')} Delete</button></form></div>
          </li>`)}</ul>
          <p class="muted small">${items.length} of ${max} alerts used.</p>`
        : html`<div class="empty">${icon('bell', 'icon--xl')}<h2>No alerts yet</h2><p>Search in Browse, for example “room” under Housing with a maximum price, then choose <strong>Alert me</strong>.</p><a class="btn btn--primary" href="/browse">Go to Browse</a></div>`}`,
  });
}

/* ---------------------------------------------------------------- reports */
const REASONS = [
  ['scam', 'Scam or fraud', 'Asks for money upfront, fake deposits, misleading offer.'],
  ['explicit', 'Sexually explicit content', 'Pornographic or sexualised material.'],
  ['spam', 'Spam', 'Duplicates, unrelated promotion, repeated posting.'],
  ['harassment', 'Harassment or abuse', 'Threats, bullying, discrimination.'],
  ['impersonation', 'Impersonation', 'Pretending to be someone else.'],
  ['prohibited', 'Illegal or prohibited item', 'Weapons, drugs, stolen or counterfeit goods.'],
  ['other', 'Something else', 'Tell us what is wrong.'],
];
const REASON_LABEL = Object.fromEntries(REASONS.map(([k, l]) => [k, l]));
REASON_LABEL['auto-flag'] = 'Automatic screening flag';

function reportForm(req, { type, target, targetTitle, backUrl = '/', errors = {}, values = {}, evidence = null, msgRef = '' }) {
  return page(req, {
    title: 'Report', active: '',
    body: html`
      <div class="narrow">
        <div class="page-head"><div><h1>${icon('flag')} Report ${type === 'listing' ? 'listing' : 'member'}</h1>
          <p class="muted">You are reporting: <strong>${targetTitle}</strong></p></div></div>
        <form class="card form-card stack" method="post" action="/report">${csrf(req)}
          <input type="hidden" name="type" value="${type}"><input type="hidden" name="id" value="${target}">${msgRef ? html`<input type="hidden" name="msg" value="${msgRef}">` : ''}
          ${evidence ? html`<div class="quote-box"><p class="small muted">The message you are reporting (only this message is shared with moderators):</p><blockquote class="prewrap">${evidence.body}</blockquote></div>` : ''}
          ${errors._form ? html`<div class="banner banner--warn" role="alert">${icon('alert')}<div>${errors._form}</div></div>` : ''}
          <fieldset class="field${errors.reason ? ' field--error' : ''}"><legend>What is the problem? <span class="req">*</span></legend>
            <div class="choices">${REASONS.map(([k, l, d]) => html`<label class="choice"><input type="radio" name="reason" value="${k}"${values.reason === k ? ' checked' : ''} required>
              <span><strong>${l}</strong><small>${d}</small></span></label>`)}</div>
            ${errors.reason ? html`<p class="error-text">${errors.reason}</p>` : ''}
          </fieldset>
          ${field({ name: 'details', label: 'Anything else moderators should know?', as: 'textarea', rows: 4, maxlength: 600, value: values.details || '', error: errors.details, hint: 'Optional, but specifics help us act faster.' })}
          <p class="small muted">Reports are reviewed by a moderator. Your identity is not shared with the person you report. Deliberately false reports can lead to limits on your account.</p>
          ${turnstileWidget('report')}
          <div class="form-actions"><button class="btn btn--danger" type="submit">Send report</button><a class="btn btn--ghost" href="${backUrl}">Cancel</a></div>
        </form>
      </div>`,
  });
}

/* ---------------------------------------------------------- notifications */
function notifications(req, { items }) {
  const unread = items.some((n) => !n.is_read);
  return page(req, {
    title: 'Notifications', active: 'alerts',
    body: html`
      <div class="page-head"><div><h1>Notifications</h1><p class="muted">Updates on your listings, reports and account.</p></div>
        ${unread ? html`<form method="post" action="/notifications/read">${csrf(req)}<button class="btn btn--ghost" type="submit">${icon('check')} Mark all read</button></form>` : ''}</div>
      ${items.length
        ? html`<ul class="notifs">${items.map((n) => html`<li class="card notif${n.is_read ? '' : ' notif--unread'}">
            <span class="notif__icon">${icon(n.type === 'moderation' ? 'shield' : n.type === 'report' ? 'flag' : 'bell')}</span>
            <div><p class="notif__title">${n.link ? html`<a href="${n.link}">${n.title}</a>` : n.title}</p>
              ${n.body ? html`<p class="muted small">${n.body}</p>` : ''}<p class="muted xsmall">${timeAgo(n.created_at)}</p></div></li>`)}</ul>`
        : html`<div class="empty">${icon('bell', 'icon--xl')}<h2>No notifications</h2><p>Updates about your listings, reports and account will appear here.</p></div>`}`,
  });
}

module.exports = { login, register, forgot, resetPassword, listingForm, myListings, profile, publicProfile, reportForm, notifications, saved, alertsPage, stars, REASONS, REASON_LABEL };
