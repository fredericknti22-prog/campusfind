'use strict';
const { html, raw, esc } = require('../lib/html');
const { formatMoney } = require('../lib/validate');
const { labelOf } = require('../lib/businessTypes');

/* ---------- icons (24px stroke set, inline so CSP stays strict) ---------- */
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  tag: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 20h20"/>',
  tool: '<path d="M14 7a4 4 0 0 0 5.5 4.8L10 21.5a2 2 0 0 1-3-3L16.6 9A4 4 0 0 0 14 7z"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  gift: '<rect x="3" y="9" width="18" height="12" rx="1"/><path d="M12 9v12M3 13h18M12 9c-3 0-4-4-1.5-4S12 9 12 9zm0 0c3 0 4-4 1.5-4S12 9 12 9z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  grip: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
  swap: '<path d="M7 7h13l-3-3M17 17H4l3 3"/>',
  chevrons: '<path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  whatsapp: '<path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.4z"/><path d="M9 8.5c0 3.3 2.9 6.5 6.4 6.5l1.1-1.6-2-1-1 .9c-1-.4-2.1-1.5-2.5-2.5l.9-1-1-2z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  logout: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>',
  chart: '<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.500l6.1-.9z"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-8 9"/>',
  caret: '<path d="m6 9 6 6 6-6"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><path d="M7 14h10v7H7z"/>',
  camera: '<path d="M4 8h3l1.6-2.5h6.8L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.6"/>',
  bookmark: '<path d="M6 3.5h12V21l-6-4.2L6 21z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  store: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9"/><path d="M5 12v8h14v-8M10 20v-5h4v5"/>',
  sliders:'<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
};

const icon = (name, cls = '') =>
  raw(
    `<svg class="icon ${esc(cls)}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.tag}</svg>`
  );

/* ---------- time ---------- */
function timeAgo(ms) {
  if (!ms) return '';
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
const fmtDate = (ms) =>
  ms ? new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/* ---------- small pieces ---------- */
const csrf = (req) => raw(`<input type="hidden" name="_csrf" value="${esc(req.csrfToken())}">`);

const flashes = (list) =>
  list.length
    ? html`<div class="flashes" role="region" aria-label="Notifications">${list.map((f) => {
        const kind = f.type === 'error' ? 'error' : f.type === 'success' ? 'success' : 'info';
        return html`<div class="flash flash--${kind}" role="${kind === 'error' ? 'alert' : 'status'}"${kind === 'error' ? '' : raw(' data-autodismiss')}>
          ${icon(kind === 'error' ? 'alert' : 'check')}<span class="flash__text">${f.message}</span>
          <button class="flash__close" type="button" data-dismiss aria-label="Dismiss message">${icon('x')}</button>
        </div>`;
      })}</div>`
    : '';

function priceLabel(l) {
  if (l.price_type === 'free') return 'Free';
  if (l.price_type === 'negotiable') return l.price_cents != null ? `${formatMoney(l.price_cents)} · negotiable` : 'Negotiable';
  if (l.price_type === 'fixed' && l.price_cents != null) return formatMoney(l.price_cents);
  return '';
}

/** What to show in the price slot when a listing has no price. */
function noPriceLabel(l) {
  if (l.cat_slug === 'lost-found') return /^found\b/i.test(l.title) ? 'Found item' : 'Lost item';
  if (l.cat_slug === 'business') return 'Ask for prices';
  return 'Contact poster';
}

const STATUS_LABEL = {
  draft: 'Draft', active: 'Live', closed: 'Closed', hidden: 'Hidden', removed: 'Removed',
  pending: 'Pending', reviewing: 'In review', resolved: 'Resolved', dismissed: 'Dismissed',
  restricted: 'Restricted', suspended: 'Suspended', banned: 'Banned',
};
const badge = (status) => html`<span class="badge badge--${status}">${STATUS_LABEL[status] || status}</span>`;

/** "Verified student" (university email confirmed) or "Email verified". Empty for unverified members. */
function trustBadge(u, cls = 'pf-badge') {
  const lvl = require('../lib/trust').level(u);
  if (lvl === 'student') return html`<span class="${cls} ${cls}--student" title="Confirmed a university email address">${icon('shield')} Verified student</span>`;
  if (lvl === 'email') return html`<span class="${cls} ${cls}--verified" title="Confirmed their email address">${icon('check')} Email verified</span>`;
  return '';
}

/** Gold "Pro seller" badge while the member has a paid promotion running. */
const proBadge = (u, cls = 'pf-badge') => (require('../services/pro').isPro(u) ? html`<span class="${cls} ${cls}--pro" title="Has a paid promotion running">${icon('star')} Pro seller</span>` : '');

/** Phone notifications switch. Hidden until app.js knows this browser can do push (or needs the iPhone Home Screen step). */
const pushCard = () => html`<section class="card form-card stack push-card" id="push" data-push hidden aria-labelledby="h-push">
  <h2 id="h-push">${icon('bell')} Phone notifications</h2>
  <p class="muted small" data-push-status>Get a buzz on this phone for new messages, offers and price drops, even when CampusFind is closed.</p>
  <p class="small push-card__ios" data-push-ios hidden>On iPhone: tap Share, then <strong>Add to Home Screen</strong>, and open CampusFind from there to turn this on.</p>
  <div class="row row--wrap"><button class="btn btn--primary btn--sm" type="button" data-push-on>${icon('bell')} Turn on for this phone</button>
    <button class="btn btn--ghost btn--sm" type="button" data-push-off hidden>Turn off on this phone</button></div>
</section>`;

const isFeaturedNow = (l) => Boolean(l.is_featured && (!l.featured_until || l.featured_until > Date.now()));
/** 'premium' | 'business' | null: a paid business promotion that is still running. */
const promoTierNow = (l) => (l.promo_tier && l.promo_until && l.promo_until > Date.now() ? l.promo_tier : null);

/** Marketplace card: photo first, then price, title, where and when, and who. Promotion tags sit beside the price, never over the photo. */
function listingCard(l) {
  const featured = isFeaturedNow(l);
  const tier = promoTierNow(l);
  const price = priceLabel(l);
  const tag = l.reserved_for ? ['Reserved', 'clock', 'amber'] : tier === 'premium' ? ['Premium', 'star', 'gold'] : featured ? ['Featured', 'star', 'gold'] : tier === 'business' ? ['Business', 'tag', 'blue'] : null;
  return html`
    <article class="listing tone-${l.cat_tone ?? 0}${tag && !l.reserved_for ? ' listing--promo' : ''}">
      <a class="listing__media" href="/listings/${l.listing_id}" tabindex="-1" aria-hidden="true">
        ${l.cover
          ? html`<img src="/uploads/${l.cover}" alt="" loading="lazy" width="480" height="360">`
          : html`<span class="listing__ph">${icon(l.cat_icon || 'tag')}<span>${l.cat_name}</span></span>`}
      </a>
      <div class="listing__body">
        <div class="listing__top">
          ${price ? html`<p class="listing__price">${price}</p>` : html`<p class="listing__price listing__price--none">${noPriceLabel(l)}</p>`}
          ${tag ? html`<span class="tag tag--${tag[2]}">${icon(tag[1])} ${tag[0]}</span>` : ''}
        </div>
        <p class="cat-tag">${icon(l.cat_icon || 'tag')}<span>${l.cat_slug === 'business' && l.business_type ? `${l.cat_name} · ${labelOf(l.business_type)}` : l.cat_name}</span></p>
        <h3 class="listing__title"><a href="/listings/${l.listing_id}">${l.title}</a></h3>
        <p class="listing__meta">
          ${l.location ? html`<span>${icon('pin')} ${l.location}</span>` : ''}
          <span>${icon('clock')} ${timeAgo(l.published_at || l.created_at)}</span>
        </p>
        ${l.owner_name ? html`<p class="listing__who">${avatar(l.owner_name, { size: 'xs' })}<span>${l.owner_name}</span>${l.owner_pro ? html`<span class="promark" title="Pro seller">${icon('star')}<span class="sr-only">Pro seller</span></span>` : ''}${l.owner_trust ? html`<span class="vmark vmark--${l.owner_trust}" title="${l.owner_trust === 'student' ? 'Verified student' : 'Email verified'}">${icon(l.owner_trust === 'student' ? 'shield' : 'check')}<span class="sr-only">${l.owner_trust === 'student' ? 'Verified student' : 'Email verified'}</span></span>` : ''}</p>` : ''}
      </div>
    </article>`;
}
const initialOf = (name) => String(name || '?').trim().charAt(0).toUpperCase() || '?';

/** Round avatar with the member's initial. */
const avatar = (name, { size = '' } = {}) =>
  html`<span class="x-avatar${size ? ` x-avatar--${size}` : ''}" aria-hidden="true"><span>${initialOf(name)}</span></span>`;


function pagination(page, pages, params = {}) {
  if (pages <= 1) return '';
  const link = (p, label, cls = '', aria = '') => {
    const q = new URLSearchParams({ ...params, page: String(p) });
    return html`<a class="page ${cls}" href="?${q.toString()}" ${aria ? raw(`aria-label="${esc(aria)}"`) : ''}>${label}</a>`;
  };
  const nums = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return html`<nav class="pagination" aria-label="Pagination">
    ${page > 1 ? link(page - 1, 'Previous', 'page--edge') : ''}
    ${nums.map((n) => (n === '…' ? html`<span class="page page--gap">…</span>` : n === page
      ? html`<span class="page page--current" aria-current="page">${n}</span>` : link(n, n)))}
    ${page < pages ? link(page + 1, 'Next', 'page--edge') : ''}
  </nav>`;
}

/* ---------- form fields ---------- */
function field({ name, label, type = 'text', value = '', error = '', hint = '', required = false, as = 'input', options = [], rows = 5, maxlength, autocomplete, placeholder = '', min, max, step, inputmode }) {
  const id = `f-${name}`;
  const describedby = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ');
  const common = `id="${id}" name="${esc(name)}"${required ? ' required' : ''}${maxlength ? ` maxlength="${maxlength}"` : ''}${
    autocomplete ? ` autocomplete="${esc(autocomplete)}"` : ''}${describedby ? ` aria-describedby="${describedby}"` : ''}${
    error ? ' aria-invalid="true"' : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}`;
  let control;
  if (as === 'textarea') {
    control = raw(`<textarea ${common} rows="${rows}"${maxlength ? ` data-count="${maxlength}"` : ''}>${esc(value)}</textarea>`);
  } else if (as === 'select') {
    control = raw(`<select ${common}>${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
  } else {
    control = raw(`<input type="${esc(type)}" ${common} value="${esc(value)}"${min !== undefined ? ` min="${min}"` : ''}${max !== undefined ? ` max="${max}"` : ''}${step ? ` step="${step}"` : ''}${inputmode ? ` inputmode="${inputmode}"` : ''}>`);
  }
  if (type === 'password' && as === 'input') {
    // Show/hide toggle (progressive enhancement: the field works without JavaScript).
    control = html`<div class="input-wrap">${control}<button class="input-wrap__btn" type="button" data-pw-toggle aria-controls="${id}" aria-pressed="false" aria-label="Show password">Show</button></div>`;
  }
  return html`<div class="field${error ? ' field--error' : ''}">
    <label for="${id}">${label}${required ? html`<span class="req" aria-hidden="true"> *</span>` : ''}</label>
    ${control}
    ${hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}
    ${error ? html`<p class="error-text" id="${id}-err">${icon('alert')}<span>${error}</span></p>` : ''}
  </div>`;
}

/** Focusable summary shown after a failed submit. Each item links to its field; inline errors stay in place. */
function errorSummary(errors = {}) {
  const keys = Object.keys(errors).filter((k) => k !== '_form' && errors[k]);
  if (!keys.length) return '';
  return html`<div class="error-summary" role="alert" tabindex="-1" data-error-summary aria-labelledby="es-title">
    <h2 id="es-title">${keys.length === 1 ? 'There is a problem' : `There are ${keys.length} problems`}</h2>
    <ul>${keys.map((k) => html`<li><a href="#f-${k}">${errors[k]}</a></li>`)}</ul>
  </div>`;
}

/** Cloudflare Turnstile widget for a protected form; renders nothing until Turnstile is configured. */
function turnstileWidget(action) {
  const ts = require('../services/turnstile');
  if (!ts.enabled()) return '';
  return html`<div class="cf-turnstile ts-box" data-sitekey="${ts.siteKey()}" data-action="${action}" data-theme="auto" data-size="flexible"></div>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`;
}

const confirmBtn = (label, cls, message) =>
  html`<button type="submit" class="btn ${cls}" data-confirm="${message}">${label}</button>`;

/** Official CampusFind logo (public/img/logo*.png). Light/dark artwork swaps with the theme; the compact mark shows on phones. */
const brandLogo = () => html`<img class="brand__logo brand__logo--full brand__logo--on-light" src="/img/logo.png" alt="CampusFind" width="125" height="41">
  <img class="brand__logo brand__logo--full brand__logo--on-dark" src="/img/logo-light.png" alt="CampusFind" width="125" height="41">
  <img class="brand__logo brand__logo--mark brand__logo--on-light" src="/img/logo-mark.png" alt="CampusFind" width="33" height="41">
  <img class="brand__logo brand__logo--mark brand__logo--on-dark" src="/img/logo-mark-light.png" alt="CampusFind" width="33" height="41">`;
/** Light artwork for always-dark surfaces (footer, sign-in panel). */
const brandLogoOnDark = () => html`<img class="brand__logo brand__logo--fixed" src="/img/logo-light.png" alt="CampusFind" width="140" height="46">`;

module.exports = { turnstileWidget, avatar, initialOf, icon, timeAgo, fmtDate, csrf, flashes, priceLabel, badge, listingCard, pagination, field, errorSummary, confirmBtn, brandLogo, brandLogoOnDark, isFeaturedNow, promoTierNow, STATUS_LABEL, trustBadge, pushCard, proBadge };
