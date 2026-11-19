'use strict';
const { html, raw } = require('../lib/html');
const config = require('../config');
const { icon, flashes, csrf, brandLogo, brandLogoOnDark, avatar } = require('./components');
const { isStaff } = require('../middleware/auth');
const settings = require('../services/settings');
const { isCandidate, liveHost } = require('../lib/deployEnv');

/**
 * Versioned asset URLs ("/css/app.css?v=<content hash>"). A changed file gets a new address, so browsers, the CDN and
 * the offline service worker can never pair new pages with an old stylesheet or script.
 */
const assetVersions = new Map();
const BOOTED = Date.now().toString(36);
function asset(p) {
  if (!assetVersions.has(p)) {
    // fallback is unique per deployment (never a constant), because versioned URLs are cached for a year
    let v = String(process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || BOOTED).replace(/[^\w]/g, '').slice(-12);
    try { v = require('crypto').createHash('sha256').update(require('fs').readFileSync(require('path').join(config.root, 'public', p))).digest('hex').slice(0, 12); } catch (e) { /* file not bundled: deployment-unique fallback */ }
    assetVersions.set(p, v);
  }
  return `${p}?v=${assetVersions.get(p)}`;
}

const dot = (n) => html`<span class="dot-count">${n > 9 ? '9+' : n}</span>`;

/**
 * Side panel: every navigation option lives here (pages, categories, account, help, admin).
 * Desktop: docked left or right, can be dragged by its grip to the other side or collapsed to an icon rail; the choice
 * is remembered in this browser (public/js/theme.js applies it before first paint, app.js handles the controls).
 * Phones: a drawer opened from the menu button. Every drag action also has a button, so it works by keyboard.
 */
function sidePanel(req, active) {
  const u = req.user;
  const unread = u ? req.unread || 0 : 0;
  const PINNED = ['business', 'lost-found']; // dedicated pages, always first after "All"
  const navCats = req.navCats || [];
  const cats = [...PINNED.map((s) => navCats.find((c) => c.slug === s)).filter(Boolean), ...navCats.filter((c) => !PINNED.includes(c.slug))];
  const pageFor = { business: '/business', 'lost-found': '/lost-found' };
  const onBrowse = req.path === '/browse';
  const curCat = onBrowse ? String((req.query && req.query.category) || '') : '';
  const item = (href, here, ic, label, extra = '', cls = '') => html`<a href="${href}" class="sp-link${cls}${here ? ' is-active' : ''}"${here ? raw(' aria-current="page"') : ''} title="${label}">
      <span class="sp-ico">${icon(ic)}</span><span class="sp-label">${label}</span>${extra}</a>`;
  const nav = (key, href, ic, label, extra) => item(href, active === key, ic, label, extra);

  return html`
  <aside id="side-panel" class="side-panel" aria-label="Site menu">
    <div class="sp-head">
      <button class="sp-btn sp-grip" type="button" data-panel-grip aria-label="Move the menu to the other side" title="Drag to move the menu, or click to switch sides">${icon('grip')}</button>
      <span class="sp-title">Menu</span>
      <button class="sp-btn sp-collapse" type="button" data-panel-collapse aria-pressed="false" aria-label="Collapse the menu" title="Collapse or expand">${icon('chevrons')}</button>
      <button class="sp-btn sp-close" type="button" data-panel-close aria-label="Close the menu">${icon('x')}</button>
    </div>
    <nav class="sp-group" aria-label="Main">
      ${nav('home', '/', 'home', 'Home')}
      ${nav('browse', '/browse', 'search', 'Browse')}
      ${nav('business', '/business', 'store', 'Business')}
      ${nav('lostfound', '/lost-found', 'compass', 'Lost & found')}
      ${nav('pricing', '/pricing', 'tag', 'Pricing')}
      ${nav('help', '/help', 'shield', 'Help & support')}
    </nav>
    ${u ? html`<nav class="sp-group" aria-label="Your account">
      <p class="sp-heading">You</p>
      ${nav('messages', '/messages', 'mail', 'Chats')}
      ${nav('notifications', '/notifications', 'bell', 'Notifications', unread ? html`<span class="sp-badge" aria-label="${unread} unread">${unread > 9 ? '9+' : unread}</span>` : '')}
      ${item('/saved', req.path === '/saved', 'bookmark', 'Saved')}
      ${item('/alerts', req.path === '/alerts', 'bell', 'Search alerts')}
      ${nav('mine', '/my/listings', 'list', 'My listings')}
      ${item('/orders', req.path === '/orders', 'tag', 'My orders')}
      ${nav('assistant', '/assistant', 'star', 'Assistant')}
      ${isStaff(u) ? nav('admin', '/admin', 'lock', 'Admin area') : ''}
    </nav>` : ''}
    <nav class="sp-group sp-cats" aria-label="Categories">
      <p class="sp-heading">Categories</p>
      ${item('/browse', onBrowse && !curCat, 'list', 'All listings')}
      ${cats.map((c) => {
        const href = pageFor[c.slug] || `/browse?category=${c.slug}`;
        const here = pageFor[c.slug] ? req.path === href : onBrowse && curCat === c.slug;
        return item(href, here, c.icon || 'tag', c.name, '', ` tone-${c.tone ?? 0}`);
      })}
    </nav>
    <div class="sp-foot">
      <button class="sp-btn sp-move" type="button" data-panel-side-toggle aria-label="Move the menu to the other side">${icon('swap')}<span class="sp-label">Move to other side</span></button>
    </div>
  </aside>
  <div class="sp-scrim" data-panel-close hidden></div>`;
}

/** Header: logo, search and the main actions only. Navigation lives in the side panel. */
function topNav(req, active) {
  const link = (key, href, label) => html`<a class="tn-link${active === key ? ' is-active' : ''}" href="${href}"${active === key ? raw(' aria-current="page"') : ''}>${label}</a>`;
  const cats = (req.navCats || []).filter((c) => !['business', 'lost-found'].includes(c.slug));
  return html`<nav class="cf-topnav" aria-label="Main">
    ${link('browse', '/browse', 'Browse')}
    ${cats.length ? html`<details class="menu tn-menu"><summary class="tn-link">Categories ${icon('caret', 'tn-caret')}</summary>
      <div class="menu__panel tn-panel">${cats.map((c) => html`<a href="/browse?category=${c.slug}"><span class="tn-cat tone-${c.tone ?? 0}">${icon(c.icon || 'tag')}</span>${c.name}</a>`)}
        <a class="tn-all" href="/browse">${icon('list')} All listings</a></div></details>` : ''}
    ${link('business', '/business', 'Business')}
    ${link('lostfound', '/lost-found', 'Lost & found')}
    ${link('pricing', '/pricing', 'Pricing')}
    ${link('help', '/help', 'Help')}
  </nav>`;
}

function header(req, active = '') {
  const u = req.user;
  const unread = u ? req.unread || 0 : 0;

  return html`
  <header class="site-header cf-header">
    <div class="cf-header__bar wrap">
      <button class="icon-btn cf-menu-btn" type="button" data-panel-open aria-controls="side-panel" aria-expanded="false" aria-label="Open the menu">${icon('menu')}</button>
      <a class="brand" href="/" aria-label="CampusFind home">${brandLogo()}</a>
      ${topNav(req, active)}

      <form class="cf-search" action="/browse" method="get" role="search">
        <label class="sr-only" for="hdr-q">Search listings</label>
        ${icon('search')}
        <input id="hdr-q" type="search" name="q" placeholder="Search textbooks, rooms, tutors…" maxlength="80" autocomplete="off">
        <button class="cf-search__go" type="submit" aria-label="Search">${icon('search')}</button>
      </form>

      <div class="cf-actions">
        <button class="icon-btn icon-btn--soft" type="button" data-theme-toggle aria-label="Switch colour theme">${icon('moon', 'theme-moon')}${icon('sun', 'theme-sun')}</button>
        ${u
          ? html`
            <a class="icon-btn icon-btn--soft cf-hide-sm" href="/saved" aria-label="Saved listings">${icon('bookmark')}</a>
            <a class="icon-btn icon-btn--soft cf-hide-sm" href="/messages" aria-label="Chats">${icon('mail')}</a>
            <a class="icon-btn icon-btn--soft" href="/notifications" aria-label="Notifications${unread ? `, ${unread} unread` : ''}">${icon('bell')}${unread ? dot(unread) : ''}</a>
            <a class="btn btn--accent btn--sm cf-post" href="/listings/new">${icon('plus')}<span>Post</span></a>
            <details class="menu">
              <summary class="account-pill icon-btn--soft" aria-label="Account menu">${avatar(u.name, { size: 'sm' })}<span class="sr-only">My account</span></summary>
              <div class="menu__panel">
                <p class="menu__who"><strong>${u.name}</strong><span>${u.email}</span></p>
                <a href="/users/${u.user_id}">${icon('user')} My profile</a>
                <a href="/my/listings">${icon('list')} My listings</a>
                <a href="/saved">${icon('bookmark')} Saved listings</a>
                <a href="/alerts">${icon('bell')} Search alerts</a>
                <a href="/messages">${icon('mail')} Chats</a>
                <a href="/help">${icon('shield')} Help &amp; support</a>
                <a href="/assistant">${icon('star')} Assistant</a>
                <a href="/orders">${icon('tag')} My orders</a>
                <a href="/notifications">${icon('bell')} Notifications</a>
                <a href="/app">${icon('plus')} Get the app</a>
                <a href="/profile">${icon('edit')} Edit profile</a>
                ${isStaff(u) ? html`<a href="/admin">${icon('shield')} Admin area</a>` : ''}
                <form method="post" action="/logout">${csrf(req)}<button type="submit">${icon('logout')} Sign out</button></form>
              </div>
            </details>`
          : html`
            <a class="icon-btn icon-btn--soft" href="/saved" aria-label="Saved listings">${icon('bookmark')}</a>
            <a class="btn btn--ghost btn--sm" href="/login">Log in</a>
            <a class="btn btn--accent btn--sm cf-post" href="/listings/new">${icon('plus')}<span>Post</span></a>`}
      </div>
    </div>
  </header>`;
}

/** Phones: five fixed tabs, with Post raised in the middle. */
function bottomNav(req, active) {
  const u = req.user;
  const item = (href, key, ic, label, badgeN = 0) =>
    html`<a href="${href}" class="tab${active === key ? ' is-active' : ''}"${active === key ? raw(' aria-current="page"') : ''}>
      <span class="tab__icon">${icon(ic)}${badgeN ? dot(badgeN) : ''}</span>
      <span class="tab__label">${label}</span></a>`;
  return html`<nav class="tabbar" aria-label="Quick navigation">
    ${item('/', 'home', 'home', 'Home')}
    ${item('/browse', 'browse', 'search', 'Browse')}
    <a href="${u ? '/listings/new' : '/register'}" class="tab tab--post" aria-label="Post a listing"><span class="tab__icon">${icon('plus')}</span><span class="tab__label">Post</span></a>
    ${u ? item('/messages', 'messages', 'mail', 'Chats') : item('/pricing', 'pricing', 'tag', 'Pricing')}
    ${item(u ? '/profile' : '/login', 'profile', 'user', u ? 'Me' : 'Sign in')}
  </nav>`;
}

function footer() {
  return html`
  <footer class="site-footer cf-footer">
    <div class="wrap cf-footer__grid">
      <div>
        <a class="brand" href="/" aria-label="CampusFind home">${brandLogoOnDark()}</a>
        <p class="muted">A moderated listings platform for ${config.campusName}: textbooks, accommodation, services, jobs, events and lost property.</p>
      </div>
      <div>
        <h2 class="footer-h">Explore</h2>
        <ul class="plain"><li><a href="/browse">Browse listings</a></li><li><a href="/business">Business directory</a></li><li><a href="/lost-found">Lost &amp; found</a></li><li><a href="/listings/new">Publish a listing</a></li><li><a href="/rules">Community rules</a></li><li><a href="/pricing">Pricing</a></li><li><a href="/whats-new">What's new</a></li><li><a href="/app">Get the app</a></li><li><a href="/help">Help &amp; support</a></li></ul>
      </div>
      <div>
        <h2 class="footer-h">Legal</h2>
        <ul class="plain"><li><a href="/terms">Terms of use</a></li><li><a href="/privacy">Privacy policy</a></li><li><a href="/cookies">Cookie policy</a></li><li><a href="/data-protection">Data protection</a></li><li><a href="/business-terms">Seller &amp; business terms</a></li><li><a href="/refunds">Payments &amp; refunds</a></li><li><a href="/disclaimer">Disclaimer</a></li><li><a href="/moderation">Moderation &amp; appeals</a></li><li><a href="/copyright">Copyright &amp; takedown</a></li></ul>
      </div>
    </div>
    <p class="wrap cf-footer__disclaimer"><strong>Disclaimer:</strong> CampusFind is a directory. Listings, prices, hostels, food and businesses are posted by members and are not verified or endorsed by CampusFind, which is not a party to any deal between members. Not affiliated with any university unless stated. <a href="/disclaimer">Full disclaimer</a>.</p>
    <div class="wrap cf-footer__base"><span>© ${new Date().getFullYear()} CampusFind · <a href="/legal">Legal information</a>${config.legal.postalAddress ? html` · ${config.legal.postalAddress}` : ''}</span><button class="link-btn" type="button" data-install hidden>Install the app</button><span>To raise a concern, use Report on any listing or profile.</span></div>
  </footer>`;
}

/** The newest change note, once per member, until dismissed. */
function whatsNewBanner(req) {
  if (!req.user || req.path === '/whats-new' || String(req.path || '').startsWith('/admin')) return '';
  const n = require('../services/whatsNew').unseenFor(req.user);
  if (!n) return '';
  return html`<aside class="wn-banner wrap" aria-label="What's new">
    <span class="wn-banner__icon">${icon('sparkle')}</span>
    <div class="wn-banner__body"><strong>What's new: ${n.title}</strong>
      <ul>${n.items.slice(0, 3).map((x) => html`<li>${x}</li>`)}</ul>
      ${n.items.length > 3 ? html`<a href="/whats-new">See all ${n.items.length} changes</a>` : html`<a href="/whats-new">More about this</a>`}</div>
    <form method="post" action="/whats-new/seen">${csrf(req)}<input type="hidden" name="back" value="${req.originalUrl || '/'}"><button class="btn btn--ghost btn--sm" type="submit">Got it</button></form>
  </aside>`;
}

/** Wrap page content in the shell. */
function page(req, { title, body, active = '', description = '', bare = false, wide = false, image = null, canonical = null, jsonLd = null }) {
  const fullTitle = title ? `${title} · CampusFind` : 'CampusFind · Campus listings directory';
  // Link previews (WhatsApp, X, Facebook): a page can pass its own photo and address; relative paths are made absolute.
  const abs = (p) => (p && p.startsWith('/') ? `${config.baseUrl}${p}` : p);
  const ogImage = abs(image) || `${config.baseUrl}/img/logo.png`;
  return String(html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${fullTitle}</title>
  <meta name="description" content="${description || 'CampusFind is a moderated directory where students publish and find textbooks, accommodation, services, employment, events and lost property.'}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="CampusFind">
  <meta property="og:title" content="${fullTitle}">
  <meta property="og:description" content="${description || 'A moderated directory where students publish and find textbooks, accommodation, services, employment, events and lost property.'}">
  <meta property="og:image" content="${ogImage}">
  ${canonical ? html`<meta property="og:url" content="${abs(canonical)}"><link rel="canonical" href="${abs(canonical)}">` : ''}
  <meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
  ${jsonLd ? raw(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`) : ''}
  <meta name="theme-color" content="#1565c0">
  <link rel="icon" href="/img/favicon.png" type="image/png">
  <link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="CampusFind">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  ${isCandidate(req) ? raw('<meta name="robots" content="noindex, nofollow">') : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=Hanken+Grotesk:wght@400;500;600;700&display=swap">
  <link rel="stylesheet" href="${asset('/css/app.css')}">
  <script src="${asset('/js/theme.js')}"></script>
</head>
<body class="cf${wide ? ' cf--wide' : ''}${bare ? ' cf--bare' : ' has-panel'}">
  <a class="skip" href="#main">Skip to content</a>
  ${isCandidate(req) ? html`<div class="env-banner" data-env="candidate" role="note">${icon('alert')}<span><strong>Test environment${config.deployColor ? ` (${config.deployColor})` : ''}</strong> · this build is not the live site yet. <a href="https://${liveHost()}">Go to the live site</a></span></div>` : ''}
  ${bare ? '' : sidePanel(req, active)}
  ${bare ? '' : header(req, active)}
  ${bare || !settings.get('announcement') ? '' : html`<div class="announce" role="note">${icon('bell')} <span>${settings.get('announcement')}</span></div>`}
  ${bare ? '' : whatsNewBanner(req)}
  ${bare || !req.user || req.path === '/app' || String(req.path || '').startsWith('/admin') ? '' : html`<aside class="app-nudge wrap" data-app-nudge hidden aria-label="Get the app">${icon('bell')}<span>Get a buzz when someone replies or makes an offer.</span><a class="btn btn--primary btn--sm" href="/app">Get the app</a><button class="icon-btn app-nudge__x" type="button" data-app-nudge-x aria-label="Not now">${icon('x')}</button></aside>`}
  ${flashes(req.takeFlash())}
  <main id="main" class="${wide ? 'wrap wrap--wide' : 'wrap'} cf-main${bare ? ' main--bare' : ''}" tabindex="-1">${body}</main>
  ${bare ? '' : footer()}
  ${bare ? '' : bottomNav(req, active)}
  ${bare || String(req.path || '').startsWith('/admin') || req.path === '/assistant' ? '' : require('./chatWidget').chatWidget(req)}
  <script src="${asset('/js/app.js')}" defer></script>
  ${bare || String(req.path || '').startsWith('/admin') || req.path === '/assistant' ? '' : html`<script src="${asset('/js/assist.js')}" defer></script>`}
  <script src="${asset('/js/motion.js')}" defer></script>
</body>
</html>`);
}

module.exports = { page };
