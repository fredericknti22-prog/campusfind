'use strict';
const { html, raw } = require('../../lib/html');
const config = require('../../config');
const { page } = require('../layout');
const { icon, listingCard, avatar, initialOf, pagination, field, csrf, badge, timeAgo, priceLabel, fmtDate, isFeaturedNow, promoTierNow, confirmBtn } = require('../components');
const { isStaff } = require('../../middleware/auth');
const { formatMoney: money } = require('../../lib/validate');
const { TYPES: BUSINESS_TYPES } = require('../../lib/businessTypes');

/* ---------------------------------------------------------------- home */
function home(req, d) {
  const u = req.user;
  const first = u ? u.name.split(' ')[0] : '';
  const campus = config.campusName === 'your campus' ? 'your campus' : config.campusName;
  const grid = (items) => html`<div class="grid">${items.map(listingCard)}</div>`;
  const section = (id, title, items, more) => (items.length ? html`
    <section class="section" aria-labelledby="${id}">
      <div class="section__head"><h2 id="${id}">${title}</h2>${more ? html`<a class="link-arrow" href="${more[0]}">${more[1]} ${icon('arrow')}</a>` : ''}</div>
      ${grid(items)}
    </section>` : '');

  const nBiz = (d.counts && d.counts.business) || 0;
  const nLost = (d.counts && d.counts['lost-found']) || 0;

  return page(req, {
    active: 'home',
    wide: true,
    canonical: '/',
    jsonLd: require('../seo').siteLd(),
    body: html`
      <section class="mast" aria-labelledby="h-hero">
        <div class="mast__copy">
          <p class="mast__brand">CampusFind</p>
          <h1 id="h-hero">${u ? html`Welcome back, ${first}` : html`Looking for something on ${campus}?`}</h1>
          <p class="mast__lead">${u
            ? 'New posts, messages and your own listings — all in one place.'
            : 'Textbooks, rooms, tutors, jobs, events and lost property. Moderated for students.'}</p>
        </div>
        <form class="mast__search" action="/browse" method="get" role="search">
          <label class="sr-only" for="mast-q">Search all listings</label>
          ${icon('search')}
          <input id="mast-q" type="search" name="q" placeholder="Try “chemistry textbook” or “hostel near campus”" maxlength="80" autocomplete="off">
          <button class="btn btn--accent" type="submit">Search</button>
        </form>
        <div class="mast__meta">
          <span>${icon('check')} <strong data-count="${d.total}">${d.total}</strong> live ${d.total === 1 ? 'listing' : 'listings'}</span>
          <a href="/browse">Browse all</a>
          <a href="${u ? '/listings/new' : '/register'}">${u ? 'Post a listing' : 'Create an account'}</a>
        </div>
      </section>

      <div class="home-board">
        <div class="home-board__main">
          <section class="section" aria-labelledby="h-new">
            <div class="section__head"><h2 id="h-new">Latest on campus</h2><a class="link-arrow" href="/browse?sort=newest">See all ${icon('arrow')}</a></div>
            <p class="section__lead muted">Every live listing shows here for everyone — no sign-in needed to browse.</p>
            ${d.latest.length
              ? grid(d.latest)
              : html`<div class="empty">${icon('inbox', 'icon--xl')}<h2>No listings published</h2><p>Listings will appear here once members publish them.</p><a class="btn btn--primary" href="${u ? '/listings/new' : '/register'}">Publish a listing</a></div>`}
          </section>
          ${section('h-feat', 'Featured', d.featured, ['/pricing', 'Promote yours'])}
          ${section('h-biz', 'Local businesses', d.business, ['/business', 'Directory'])}
          ${section('h-lost', 'Lost and found', d.lostFound, ['/lost-found', 'Open board'])}
        </div>

        <aside class="home-board__rail" aria-label="Shortcuts">
          <a class="rail-card" href="/business">
            <span class="rail-card__ico">${icon('store')}</span>
            <span class="rail-card__body"><strong>Business directory</strong><small>Hostels, food, shops${nBiz ? ` · ${nBiz} listed` : ''}</small></span>
          </a>
          <a class="rail-card" href="/lost-found">
            <span class="rail-card__ico">${icon('compass')}</span>
            <span class="rail-card__body"><strong>Lost &amp; found</strong><small>${nLost ? `${nLost} waiting` : 'Report lost or found items'}${d.reunited ? ` · ${d.reunited} returned` : ''}</small></span>
          </a>
          <div class="rail-card rail-card--stack">
            <strong>Quick report</strong>
            <a href="/listings/new?category=lost-found&amp;kind=lost">${icon('search')} Lost something? Report it and add a photo</a>
            <a href="/listings/new?category=lost-found&amp;kind=found">${icon('compass')} Found something? Post a photo and where you left it</a>
          </div>
          <a class="rail-card rail-card--cta" href="${u ? '/listings/new' : '/register'}">
            <span class="rail-card__body"><strong>${u ? 'Post a listing' : 'Join CampusFind'}</strong><small>${u ? 'Reach students on your campus' : 'Free to browse and post'}</small></span>
            <span class="rail-card__go">${icon('arrow')}</span>
          </a>
        </aside>
      </div>`,
  });
}
/* -------------------------------------------------------------- browse */
function browse(req, d) {
  const { q, category, priceMax, sort, verified, items, total, pages, pageNum, categories } = d;
  const params = { q, category, price_max: priceMax, verified, sort };
  Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
  const active = categories.find((c) => c.slug === category);
  const filtered = Boolean(q || category || priceMax || verified);
  const without = (key) => {
    const p = { ...params };
    delete p[key];
    const s = new URLSearchParams(p).toString();
    return `/browse${s ? '?' + s : ''}`;
  };
  const chips = [
    q ? ['Keywords', q, 'q'] : null,
    category && active ? ['Category', active.name, 'category'] : null,
    priceMax ? ['Max price', `${config.currency.symbol}${priceMax}`, 'price_max'] : null,
    verified ? ['Sellers', 'Verified only', 'verified'] : null,
  ].filter(Boolean);
  const hidden = (name, value) => (value ? html`<input type="hidden" name="${name}" value="${value}">` : '');

  return page(req, {
    title: active ? active.name : q ? `Search: ${q}` : 'Browse',
    active: 'browse',
    body: html`
      <div class="page-head">
        <div>
          <h1>${active ? active.name : 'Browse listings'}</h1>
          <p class="muted" aria-live="polite">${total} ${total === 1 ? 'result' : 'results'}${q ? html` for “${q}”` : ''}${active && q ? html` in ${active.name}` : ''}</p>
        </div>
      </div>

      <div class="browse">
        <aside class="filters" aria-label="Filters">
          <details class="filters__box" open>
            <summary>${icon('sliders')} Filters</summary>
            <form method="get" action="/browse" class="stack">
              ${hidden('sort', sort !== 'newest' ? sort : '')}
              ${field({ name: 'q', label: 'Keywords', value: q, maxlength: 80, placeholder: 'e.g. chemistry, bike…' })}
              ${field({ name: 'category', label: 'Category', as: 'select', value: category || '', options: [['', 'All categories'], ...categories.map((c) => [c.slug, c.name])] })}
              ${field({ name: 'price_max', label: `Max price (${config.currency.symbol})`, type: 'number', value: priceMax || '', min: 0, step: '1', inputmode: 'decimal', hint: 'Free items are always included.' })}
              <label class="check"><input type="checkbox" name="verified" value="1"${verified ? raw(' checked') : ''}><span>${icon('shield')} Verified sellers only</span></label>
              <div class="row"><button class="btn btn--primary" type="submit">Apply filters</button>${filtered ? html`<a class="btn btn--ghost" href="/browse">Clear</a>` : ''}</div>
            </form>
          </details>
        </aside>

        <section aria-label="Results"><h2 class="sr-only">Results</h2>
          <div class="results-bar">
            ${chips.length || filtered ? html`<div class="chips" aria-label="Active filters">
              ${chips.map(([k, v, key]) => html`<a class="chip chip--removable" href="${without(key)}" aria-label="Remove filter ${k}: ${v}"><span>${k}: ${v}</span>${icon('x')}</a>`)}
              ${filtered ? html`<a class="link-clear" href="/browse">Clear all</a>` : ''}
              ${filtered && (q || category || priceMax) ? (req.user
                ? html`<form class="alert-form" method="post" action="/alerts">${csrf(req)}${hidden('q', q)}${hidden('category', category)}${hidden('price_max', priceMax)}<button class="btn btn--ghost btn--sm" type="submit">${icon('bell')} Alert me about new matches</button></form>`
                : html`<a class="btn btn--ghost btn--sm" href="/login?next=${encodeURIComponent(req.originalUrl || '/browse')}">${icon('bell')} Sign in to get alerts</a>`) : ''}
            </div>` : ''}
            <form class="sortbox" method="get" action="/browse">
              ${hidden('q', q)}${hidden('category', category)}${hidden('price_max', priceMax)}${hidden('verified', verified)}
              <label for="f-sort">Sort by</label>
              <select id="f-sort" name="sort" data-autosubmit>
                ${[['newest', 'Newest first'], ['oldest', 'Oldest first'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low']].map(([v, l]) => html`<option value="${v}"${(sort || 'newest') === v ? raw(' selected') : ''}>${l}</option>`)}
              </select>
              <noscript><button class="btn btn--ghost btn--sm" type="submit">Apply</button></noscript>
            </form>
          </div>
          ${items.length
            ? html`<div class="grid grid--results">${items.map(listingCard)}</div>${pagination(pageNum, pages, params)}`
            : html`<div class="empty">${icon('search', 'icon--xl')}<h2>No results found</h2>
                <p>Adjust your keywords or filters, or publish a listing.</p>
                <div class="row"><a class="btn btn--ghost" href="/browse">Clear filters</a><a class="btn btn--primary" href="${req.user ? '/listings/new' : '/register'}">Publish a listing</a></div></div>`}
        </section>
      </div>`,
  });
}

/* ------------------------------------------------- business directory */
function businessPage(req, { shops, spotlight, total, type, counts }) {
  const P = config.payments;
  const spotIds = new Set(spotlight.map((l) => l.listing_id));
  const rest = shops.filter((l) => !spotIds.has(l.listing_id));
  const activeType = BUSINESS_TYPES.find((t) => t.key === type);
  const tab = (key, label, n, href) => html`<a class="seg__tab${type === key ? ' is-active' : ''}" href="${href}"${type === key ? raw(' aria-current="page"') : ''}>${label} <span class="seg__n">${n}</span></a>`;
  return page(req, {
    title: activeType ? `${activeType.label} · Business directory` : 'Sell on CampusFind', active: 'business',
    description: 'Hostel managers, food vendors, shop owners and sellers: list your business and reach every student on campus.',
    body: html`
      <section class="band band--business tone-8" aria-labelledby="h-biz-hero">
        <div class="band__text">
          <p class="eyebrow">${icon('store')} Business directory</p>
          <h1 id="h-biz-hero">Sell to every student on campus</h1>
          <p class="band__lead">For hostel managers, food vendors, shop owners and anyone selling to students. Pay once for a Business advertisement and your listing goes live straight away, with Pro seller perks.</p>
          <p class="band__note">Selling here means you agree to the <a href="/business-terms">Seller &amp; business terms</a>. Businesses are listed by their owners and are not inspected or endorsed by CampusFind (<a href="/disclaimer">disclaimer</a>).</p>
          <div class="row row--wrap">
            <a class="btn btn--accent" href="/listings/new?category=business">${icon('plus')} List your business · from ${money(P.prices.business)}</a>
            <a class="btn btn--outline-light" href="/pricing">See prices</a>
          </div>
        </div>
        <ul class="band__facts">
          <li><strong data-count="${total}">${total}</strong><span>${total === 1 ? 'business' : 'businesses'} listed</span></li>
          <li><strong>${money(P.prices.business)}</strong><span>Business advertisement, ${P.businessDays} days</span></li>
          <li><strong>${money(P.prices.premium)}</strong><span>Premium with featured placement</span></li>
        </ul>
      </section>

      <section class="section" aria-labelledby="h-biz-who">
        <h2 id="h-biz-who">Who sells here</h2>
        <ul class="who">
          ${BUSINESS_TYPES.filter((t) => t.key !== 'other').map((t) => html`<li class="who__card tone-${t.tone}">
            <span class="who__icon">${icon(t.icon)}</span>
            <div><strong>${t.who}</strong><p>${t.pitch}</p>
              <a class="link-arrow" href="/listings/new?category=business&amp;type=${t.key}">List as ${t.label.toLowerCase()} ${icon('arrow')}</a></div></li>`)}
        </ul>
      </section>

      ${spotlight.length ? html`<section class="section" aria-labelledby="h-biz-spot">
        <div class="section__head"><h2 id="h-biz-spot">Promoted businesses</h2><a class="link-arrow" href="/pricing">Promote yours ${icon('arrow')}</a></div>
        <div class="grid">${spotlight.map(listingCard)}</div></section>` : ''}

      <section class="section" aria-labelledby="h-biz-all">
        <div class="section__head"><h2 id="h-biz-all">${activeType ? activeType.label : spotlight.length ? 'More businesses' : 'All businesses'}</h2>
          <nav class="seg seg--wrap" aria-label="Filter by type of business">
            ${tab('', 'All', total, '/business')}${BUSINESS_TYPES.map((t) => tab(t.key, t.label, counts[t.key] || 0, `/business?type=${t.key}`))}
          </nav></div>
        ${rest.length ? html`<div class="grid">${rest.map(listingCard)}</div>`
          : spotlight.length ? ''
          : html`<div class="empty">${icon('store', 'icon--xl')}<h2>${activeType ? `No ${activeType.label.toLowerCase()} listed yet` : 'No businesses listed yet'}</h2><p>Be the first. A free listing in the Business category puts your hostel, stall or shop in front of the whole campus.</p><a class="btn btn--primary" href="/listings/new?category=business${activeType ? `&amp;type=${activeType.key}` : ''}">List your business</a></div>`}
      </section>`,
  });
}

/* ------------------------------------------------------- lost and found */
function lostFoundPage(req, { items, kind, counts, reunited }) {
  const tab = (key, label, n, href) => html`<a class="seg__tab${kind === key ? ' is-active' : ''}" href="${href}"${kind === key ? raw(' aria-current="page"') : ''}>${label} <span class="seg__n">${n}</span></a>`;
  return page(req, {
    title: 'Lost & found', active: 'lostfound',
    description: 'Report something you lost or found on campus, and help it get home.',
    body: html`
      <section class="band band--lf tone-6" aria-labelledby="h-lf-hero">
        <div class="band__text">
          <p class="eyebrow">${icon('compass')} Lost &amp; found</p>
          <h1 id="h-lf-hero">Lost something? Found something?</h1>
          <p class="band__lead">Post a photo, say where it was and when. Someone on campus may already have it, or be looking for it right now.</p>
          <div class="row row--wrap">
            <a class="btn btn--light" href="/listings/new?category=lost-found&amp;kind=lost">${icon('search')} I lost something</a>
            <a class="btn btn--accent" href="/listings/new?category=lost-found&amp;kind=found">${icon('check')} I found something</a>
          </div>
        </div>
        <ul class="band__facts">
          <li><strong data-count="${counts.lost}">${counts.lost}</strong><span>lost ${counts.lost === 1 ? 'item' : 'items'} reported</span></li>
          <li><strong data-count="${counts.found}">${counts.found}</strong><span>found ${counts.found === 1 ? 'item' : 'items'} waiting</span></li>
          <li><strong data-count="${reunited}">${reunited}</strong><span>returned to their owners</span></li>
        </ul>
      </section>

      <section class="section" aria-labelledby="h-lf-board">
        <div class="section__head"><h2 id="h-lf-board">Board</h2>
          <nav class="seg" aria-label="Filter the board">
            ${tab('', 'All', counts.all, '/lost-found')}${tab('lost', 'Lost', counts.lost, '/lost-found?kind=lost')}${tab('found', 'Found', counts.found, '/lost-found?kind=found')}
          </nav></div>
        ${items.length ? html`<div class="grid">${items.map(listingCard)}</div>`
          : html`<div class="empty">${icon('compass', 'icon--xl')}<h2>${kind ? `No ${kind} items right now` : 'The board is empty'}</h2><p>That is good news, or nobody has posted yet. Report something to get it started.</p>
              <div class="row"><a class="btn btn--ghost" href="/listings/new?category=lost-found&amp;kind=lost">Report lost</a><a class="btn btn--primary" href="/listings/new?category=lost-found&amp;kind=found">Report found</a></div></div>`}
      </section>

      <section class="section" aria-labelledby="h-lf-how">
        <h2 id="h-lf-how">How it works</h2>
        <ol class="steps">
          <li><span class="steps__n">1</span><div><strong>Post it</strong><p>Add a clear photo, the place and the time. Keep one detail back so the real owner can prove it.</p></div></li>
          <li><span class="steps__n">2</span><div><strong>Match it</strong><p>Owners and finders message each other inside CampusFind. Your email and phone stay private.</p></div></li>
          <li><span class="steps__n">3</span><div><strong>Hand it over</strong><p>Meet in a busy campus space, then mark the item as returned so the board stays up to date.</p></div></li>
        </ol>
      </section>`,
  });
}

/* ------------------------------------------------------ listing detail */
const { replyLabel } = require('../../lib/responsiveness');
/** One-tap opening messages, worded for the kind of listing. */
function quickReplies(l) {
  switch (l.cat_slug) {
    case 'housing': return ['Is the room still available?', 'Can I come and view it?', 'What is included in the rent?'];
    case 'lost-found': return /^found\b/i.test(l.title) ? ['I think this is mine. Can we talk?', 'Where can I collect it?'] : ['I think I found this.', 'Where did you last see it?'];
    case 'opportunities': return ['Is this role still open?', 'How do I apply?', 'Is it paid?'];
    case 'events': return ['Is there an entry fee?', 'Can I bring a friend?', 'Where exactly is it?'];
    case 'services': case 'business': return ['Are you available this week?', 'How much do you charge?', 'Where are you located?'];
    case 'free': return ['Is this still available?', 'When can I pick it up?'];
    default: return ['Is this still available?', 'Is the price negotiable?', 'Where can we meet?'];
  }
}

function listingDetail(req, d) {
  const { l, images, owner, canSeeContact, isOwner, staff } = d;
  const ownerName = owner && owner.name ? owner.name : 'Unknown';
  const ownerFirst = ownerName.split(' ')[0] || 'the poster';
  const price = priceLabel(l);
  const featured = isFeaturedNow(l);
  const gone = ['hidden', 'removed', 'closed', 'draft'].includes(l.status);

  // Sharing: the text WhatsApp pre-fills, and the preview card other apps build from the meta tags.
  const shareUrl = `${config.baseUrl}/listings/${l.listing_id}`;
  const shareText = `${l.title}${price ? ` (${price})` : ''} on CampusFind: ${shareUrl}`;
  const summary = [price, l.cat_name, l.location].filter(Boolean).join(' · ');
  return page(req, {
    title: l.title,
    description: `${summary ? `${summary}. ` : ''}${l.description}`.slice(0, 180),
    image: images.length && !gone ? `/uploads/${images[0].filename}` : null,
    canonical: `/listings/${l.listing_id}`,
    jsonLd: gone ? null : require('../seo').listingLd(l, images),
    active: 'browse',
    body: html`
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/browse">Browse</a> ${icon('arrow')} <a href="/browse?category=${l.cat_slug}">${l.cat_name}</a></nav>

      ${l.reserved_for && l.status === 'active' ? html`<div class="banner banner--info">${icon('clock')}<div><strong>Reserved.</strong> ${isOwner
        ? html`You accepted an offer. If the deal falls through, make it available again. <form class="inline-form" method="post" action="/listings/${l.listing_id}/unreserve">${csrf(req)}<input type="hidden" name="back" value="listing"><button class="btn btn--ghost btn--sm" type="submit">Make available again</button></form>`
        : 'The seller has accepted an offer from someone. You can still message them in case it falls through.'}</div></div>` : ''}
      ${l.outcome === 'sold' && l.status === 'closed' ? html`<div class="banner banner--success">${icon('check')}<div><strong>Sold.</strong> This deal is done${l.sold_cents ? html` (${require('../../lib/validate').formatMoney(l.sold_cents)})` : ''}. Only you and moderators can see this page now.</div></div>` :
      l.outcome === 'returned' && l.status === 'closed' ? html`<div class="banner banner--success">${icon('check')}
        <div><strong>This item was returned to its owner.</strong> Thank you for using CampusFind.</div></div>` : l.outcome === 'expired' && l.status === 'closed' ? html`<div class="banner banner--info">${icon('clock')}
        <div><strong>This listing has expired.</strong> ${isOwner ? html`Listings stay up for 30 days. If it is still available, renew it and it goes straight back on Browse.
          <form class="inline-form" method="post" action="/listings/${l.listing_id}/renew">${csrf(req)}<input type="hidden" name="back" value="listing"><button class="btn btn--primary btn--sm" type="submit">${icon('clock')} Renew for 30 days</button></form>` : 'The poster has not confirmed it is still available.'}</div></div>` : gone ? html`<div class="banner banner--${l.status === 'closed' ? 'info' : 'warn'}">${icon('alert')}
        <div><strong>This listing is ${l.status === 'draft' ? 'a draft' : l.status}.</strong>
        ${isOwner || staff ? ' Only you and moderators can see it.' : ''}
        ${l.status === 'hidden' || l.status === 'removed' ? ' It was actioned by moderators. See the notification for details.' : ''}</div></div>` : ''}

      <div class="detail">
        <div class="detail__main">
          <div class="gallery">
            ${images.length
              ? html`<img class="gallery__hero" id="gallery-main" src="/uploads/${images[0].filename}" alt="Photo 1 of ${images.length}: ${l.title}" width="800" height="600">
                     ${images.length > 1 ? html`<div class="gallery__thumbs" role="group" aria-label="Photo thumbnails">${images.map((im, i) => html`<a class="gallery__thumb${i === 0 ? ' is-active' : ''}" href="/uploads/${im.filename}" data-gallery-thumb data-alt="Photo ${i + 1} of ${images.length}: ${l.title}" aria-label="Show photo ${i + 1} of ${images.length}"${i === 0 ? raw(' aria-current="true"') : ''}><img src="/uploads/${im.filename}" alt="" loading="lazy" width="200" height="150"></a>`)}</div>` : ''}`
              : html`<div class="gallery__ph">${icon('image', 'icon--xl')}<span>No photographs provided</span></div>`}
          </div>

<h1 class="detail__title">${l.title}</h1>
          <div class="detail__tags">
            <span class="chip chip--tone">${icon(l.cat_icon)} ${l.cat_name}</span>
            ${promoTierNow(l) === 'premium' ? html`<span class="chip chip--gold">${icon('star')} Premium</span>` : featured ? html`<span class="chip chip--gold">${icon('star')} Featured</span>` : ''}
            ${promoTierNow(l) ? html`<span class="chip chip--tone">${icon('tag')} Business</span>` : ''}
            ${isOwner || staff ? badge(l.status) : ''}
          </div>

          <div class="prose prewrap">${l.description}</div>

          <section class="safety-tips" aria-labelledby="h-tips">
            <h2 id="h-tips">${icon('shield')} Safety guidance</h2>
            <ul>
              <li>Arrange to meet in busy campus spaces, preferably in daylight.</li>
              <li>Inspect before you pay. Never send money or gift cards in advance.</li>
              <li>Be cautious of pressure to act urgently or to move the conversation off the platform.</li>
              <li>Report suspicious listings using the Report option. Staff review every report.</li>
            </ul>
          </section>
          <p class="disclaimer-note">${icon('alert')}<span><strong>Disclaimer:</strong> this listing was posted by a member. CampusFind does not verify, endorse or guarantee listings, prices, rooms, food or businesses, and is not part of any deal between members. <a href="/disclaimer">Read the full disclaimer</a>.</span></p>
        </div>

        <aside class="detail__side">
          <div class="card buy">
            ${price ? html`<p class="buy__price">${price}</p>` : html`<p class="buy__price buy__price--none">No price</p>`}
            <dl class="facts">
              ${l.location ? html`<div><dt>${icon('pin')} Where</dt><dd>${l.location}</dd></div>` : ''}
              <div><dt>${icon('clock')} Posted</dt><dd>${timeAgo(l.published_at || l.created_at)}</dd></div>
              <div><dt>${icon('eye')} Views</dt><dd>${l.views}</dd></div>
            </dl>

            ${canSeeContact
              ? html`<div class="contact"><h2>How to reach ${isOwner ? 'people' : ownerFirst}</h2><p class="prewrap">${l.contact || 'No contact details given. Reply to the poster through their campus profile.'}</p></div>`
              : html`<div class="contact contact--locked">${icon('lock')}<div><h2>Contact details are for members</h2><p>Sign in to view how to contact the poster.</p><a class="btn btn--primary" href="/login?next=${encodeURIComponent('/listings/' + l.listing_id)}">Sign in</a></div></div>`}

            ${req.user && !isOwner && (l.status === 'active' || d.saved) ? html`<form class="save-form" method="post" action="/listings/${l.listing_id}/save">${csrf(req)}
              <button class="btn btn--ghost btn--block${d.saved ? ' is-saved' : ''}" type="submit" aria-pressed="${d.saved ? 'true' : 'false'}">${icon('bookmark')} ${d.saved ? 'Saved' : 'Save'}</button></form>` : ''}

            ${req.user && !isOwner && l.status === 'active' ? html`<form class="msg-form stack" method="post" action="/listings/${l.listing_id}/message">${csrf(req)}
              <label for="f-msg"><strong>Send a message</strong></label>
              <div class="quick" data-quick hidden><span class="sr-only">Quick messages:</span>${quickReplies(l).map((t) => html`<button class="chip chip--quick" type="button" data-fill="${t}" data-fill-target="f-msg">${t}</button>`)}</div>
              <textarea id="f-msg" name="body" rows="3" maxlength="1000" required placeholder="Hi, is this still available?" aria-describedby="f-msg-hint"></textarea>
              <p class="hint" id="f-msg-hint">Your email and phone stay private. Replies arrive in your Messages inbox.</p>
              <button class="btn btn--primary btn--block" type="submit">${icon('mail')} Message ${ownerFirst}</button></form>` : ''}

            ${isOwner ? html`
              <div class="row row--wrap">
                ${l.status === 'active' && l.cat_slug === 'lost-found' ? html`<form method="post" action="/listings/${l.listing_id}/status">${csrf(req)}
                  <input type="hidden" name="status" value="closed"><input type="hidden" name="outcome" value="returned">
                  <button class="btn btn--primary" type="submit">${icon('check')} Mark as returned</button></form>` : ''}
                ${l.status === 'active' && require('../../lib/deals').soldLabel(l) ? html`<form method="post" action="/listings/${l.listing_id}/sold">${csrf(req)}<input type="hidden" name="back" value="listing">${require('../components').confirmBtn(html`${icon('check')} ${require('../../lib/deals').soldLabel(l)}`, 'btn--primary', 'Mark this as done? The listing closes and leaves Browse.')}</form>` : ''}
                ${l.status === 'active' ? html`<a class="btn btn--ghost" href="/listings/${l.listing_id}/promote">${icon('star')} Promote</a>` : ''}
                <a class="btn btn--primary" href="/listings/${l.listing_id}/edit">${icon('edit')} Edit</a>
                <a class="btn btn--ghost" href="/my/listings">Manage</a>
              </div>` : ''}
          </div>

          ${l.status === 'active' ? html`<div class="card share">
            <h2 class="share__h">${icon('share')} ${isOwner ? 'Share your listing' : 'Share this listing'}</h2>
            ${isOwner ? html`<p class="muted small">Post it in your hall, class or department WhatsApp groups to reach buyers faster.</p>` : ''}
            <div class="share__row">
              <a class="btn btn--wa btn--sm" href="https://wa.me/?text=${encodeURIComponent(shareText)}" target="_blank" rel="noopener noreferrer">${icon('whatsapp')} WhatsApp</a>
              <button class="btn btn--ghost btn--sm" type="button" data-copy="${shareUrl}">${icon('link')} <span>Copy link</span></button>
              <button class="btn btn--ghost btn--sm" type="button" data-share data-share-title="${l.title}" data-share-text="${shareText}" data-share-url="${shareUrl}" hidden>${icon('share')} More</button>
            </div>
            ${isOwner ? html`<a class="btn btn--ghost btn--sm btn--block share__poster" href="/listings/${l.listing_id}/poster">${icon('print')} Print a poster with a QR code</a>` : ''}
          </div>` : ''}

          <div class="card seller">
            <span class="avatar avatar--lg">${initialOf(ownerName)}</span>
            <div>
              <p class="seller__name"><a href="/users/${owner ? owner.user_id : l.owner_id}">${ownerName}</a></p>
              ${owner ? require('../components').proBadge(owner) : ''}
              ${owner ? require('../components').trustBadge(owner, 'pf-badge') : ''}
              ${d.sellerRating && d.sellerRating.count ? html`<p class="seller__rating"><a href="/users/${owner ? owner.user_id : l.owner_id}#reviews">${require('./account').stars(d.sellerRating.avg)} <strong>${d.sellerRating.avg.toFixed(1)}</strong> <span class="muted">(${d.sellerRating.count})</span></a></p>` : ''}
              ${owner && replyLabel(owner) ? html`<p class="seller__reply${replyLabel(owner).fast ? ' is-fast' : ''}">${icon('chat')} ${replyLabel(owner).text}</p>` : ''}
              <p class="muted small">Member since ${owner && owner.created_at ? new Date(owner.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—'}</p>
            </div>
            <a class="btn btn--ghost btn--sm btn--block seller__more" href="/users/${owner ? owner.user_id : l.owner_id}">${icon('user')} View profile and listings</a>
          </div>

          ${!isOwner ? html`<a class="report-link" href="/report?type=listing&id=${l.listing_id}">${icon('flag')} Report this listing</a>` : ''}
          ${staff ? html`<a class="report-link" href="/admin/listings?q=${l.listing_id}">${icon('shield')} Open in admin</a>` : ''}
        </aside>
      </div>

      ${d.similar && d.similar.length ? html`<section class="section similar" aria-labelledby="h-similar">
        <div class="section__head"><h2 id="h-similar">Similar listings</h2><a class="link-arrow" href="/browse?category=${l.cat_slug}">More in ${l.cat_name} ${icon('arrow')}</a></div>
        <div class="grid">${d.similar.map(listingCard)}</div></section>` : ''}`,
  });
}

/* --------------------------------------------------------------- policy pages */
function prose(req, { title, active, intro, sections, draft = true }) {
  return page(req, {
    title, active,
    body: html`
      <article class="doc">
        <header class="doc__head">
          <p class="eyebrow">${draft ? 'Version 1.0 · Draft pending review by your institution' : 'Policy'}</p>
          <h1>${title}</h1>
          <p class="lead">${intro}</p>
        </header>
        <div class="doc__layout">
          <nav class="toc" aria-label="On this page"><h2>On this page</h2><ol>${sections.map((s, i) => html`<li><a href="#s${i + 1}">${s.h}</a></li>`)}</ol></nav>
          <div class="doc__body">${sections.map((s, i) => html`<section id="s${i + 1}"><h2>${i + 1}. ${s.h}</h2>${s.body}</section>`)}</div>
        </div>
      </article>`,
  });
}

function rules(req) {
  return prose(req, {
    title: 'Community rules & regulations',
    active: 'rules',
    intro: 'These rules set out acceptable use of CampusFind and the standards every member is expected to meet.',
    sections: [
      { h: 'Purpose and acceptable use', body: html`<p>CampusFind helps members of ${config.campusName} discover and share campus-related items, services, opportunities, events and information. Use it honestly, respectfully and lawfully.</p>` },
      { h: 'Prohibited content and conduct', body: html`<ul><li>Anything illegal, dangerous or that promotes harm.</li><li>Weapons, drugs, stolen goods or counterfeit items.</li><li>Listings that mislead about what is offered, its condition or the price.</li></ul>` },
      { h: 'Scams, fraud and deceptive listings', body: html`<p>No advance payment schemes, fake deposits, gift-card payments, pyramid or “guaranteed returns” offers, or listings designed to collect personal data or money without delivering what is promised.</p>` },
      { h: 'Sexually explicit content', body: html`<p>Pornographic, sexually explicit or sexualised content, and listings that offer sexual services, are not allowed and are removed on sight.</p>` },
      { h: 'Harassment, threats and abuse', body: html`<p>Do not harass, threaten, bully, discriminate against, or target any person or group. This includes how you contact people about listings.</p>` },
      { h: 'Impersonation', body: html`<p>Do not pretend to be another person, a staff member, a society or a business. Display your real name.</p>` },
      { h: 'Spam and repeated promotion', body: html`<p>Do not post duplicates, flood categories, or repeat unwanted promotion. Posting limits apply and may be tightened for accounts that abuse them.</p>` },
      { h: 'Intellectual property and privacy', body: html`<p>Only post content you have the right to share. Do not publish other people’s personal details or photos without their consent.</p>` },
      { h: 'Reporting and moderation', body: html`<p>Use <strong>Report</strong> on any listing or profile. Reports go to a moderation queue. A moderator inspects the content and history, then dismisses the report or acts. Important decisions are recorded in an audit log, and affected members are notified. Deliberately false reports are themselves a violation.</p>` },
      { h: 'Warnings, removal, suspension and bans', body: html`<p>Depending on severity and history, actions can include a warning, hiding or removing content, restricting posting, a time-limited suspension, or a permanent ban. Serious breaches may skip steps.</p>` },
      { h: 'Your responsibility', body: html`<p>You are responsible for what you post and for your dealings with other members. CampusFind connects people; it does not guarantee items, services or payments.</p>` },
      { h: 'Changes to these rules', body: html`<p>We may update these rules as the platform grows. Significant changes will be announced in the app.</p>` },
    ],
  });
}

/* ------------------------------------------------------------------ errors */
function errorPage(req, { status = 500, title = 'Something went wrong', message = 'Please try again.' }) {
  return page(req, {
    title: `${status} ${title}`,
    body: html`<section class="errorpage"><p class="errorpage__code">${status}</p><h1>${title}</h1><p class="lead">${message}</p>
      <div class="row"><a class="btn btn--primary" href="/">Back to home</a><a class="btn btn--ghost" href="/browse">Browse listings</a></div></section>`,
  });
}

function maintenancePage(req) {
  return page(req, {
    title: 'Back soon', bare: true,
    body: html`<section class="errorpage"><p class="errorpage__code">503</p><h1>Scheduled maintenance</h1>
      <p class="lead">CampusFind is temporarily unavailable while maintenance is carried out. Please try again shortly.</p>
      <a class="btn btn--ghost" href="/admin/login">Staff sign-in</a></section>`,
  });
}

module.exports = { home, browse, businessPage, lostFoundPage, listingDetail, rules, errorPage, maintenancePage };
