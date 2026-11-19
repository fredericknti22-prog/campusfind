'use strict';
/** Admin: demand insights. What members search for, and what they search for but cannot find. */
const { html, raw } = require('../../lib/html');
const { shell } = require('./admin');
const { icon, timeAgo } = require('../components');

function insightsPage(req, { data, catName, counts }) {
  const { days, totalSearches, emptySearches, top, empty, categories } = data;
  const cat = (slug) => (slug ? catName.get(slug) || slug : '');
  const browseHref = (x) => `/browse?${new URLSearchParams({ ...(x.q ? { q: x.q } : {}), ...(x.category ? { category: x.category } : {}) }).toString()}`;
  const label = (x) => html`<a href="${browseHref(x)}">${x.q ? html`“${x.q}”` : html`<em>${cat(x.category)}</em>`}</a>${x.q && x.category ? html` <span class="muted small">in ${cat(x.category)}</span>` : ''}`;
  const max = (list, k) => Math.max(1, ...list.map((x) => x[k]));
  const bar = (n, m) => html`<progress class="ins-bar" max="${m}" value="${n}" aria-hidden="true"></progress>`;
  const rate = totalSearches ? Math.round((emptySearches / totalSearches) * 100) : 0;

  return shell(req, {
    title: 'Demand insights', active: 'insights', counts,
    body: html`
      <div class="page-head"><div><h1>Demand insights</h1>
        <p class="muted">What students search for on Browse. Searches are counted anonymously: no names, accounts or phone numbers are stored.</p></div>
        <nav class="segmented" aria-label="Period">${[7, 30, 90].map((d) => html`<a class="seg${d === days ? ' is-active' : ''}" href="/admin/insights?days=${d}"${d === days ? raw(' aria-current="page"') : ''}>${d} days</a>`)}</nav>
      </div>

      <div class="kpis">
        <div class="kpi"><p class="kpi__n">${totalSearches}</p><p class="kpi__l">searches in ${days} days</p></div>
        <div class="kpi${rate >= 30 ? ' kpi--alert' : ''}"><p class="kpi__n">${rate}%</p><p class="kpi__l">found nothing</p></div>
        <div class="kpi"><p class="kpi__n">${empty.length}</p><p class="kpi__l">different searches with no results</p></div>
      </div>

      ${totalSearches === 0 ? html`<div class="empty">${icon('search', 'icon--xl')}<h2>No searches yet</h2><p>As students search on Browse, the most popular searches and the ones that find nothing appear here.</p></div>` : html`
      <div class="grid-2 grid-2--top">
        <section class="card pad" aria-labelledby="h-empty">
          <h2 id="h-empty">${icon('alert')} Wanted but not found</h2>
          <p class="muted small">Students looked for these and got no results. Find sellers for them, or post a request in your WhatsApp groups.</p>
          ${empty.length ? html`<ol class="ins-list">${empty.map((x) => html`<li>
              <div class="ins-list__main">${label(x)}<span class="muted xsmall">last ${timeAgo(x.last_at)}</span></div>
              ${bar(x.zero, max(empty, 'zero'))}<strong class="ins-list__n">${x.zero}</strong></li>`)}</ol>`
            : html`<p class="pf-muted">Every search found something. Nice.</p>`}
        </section>

        <section class="card pad" aria-labelledby="h-top">
          <h2 id="h-top">${icon('chart')} Most searched</h2>
          <p class="muted small">The searches students make most often. Popular searches with few results are your best opportunities.</p>
          ${top.length ? html`<ol class="ins-list">${top.map((x) => html`<li>
              <div class="ins-list__main">${label(x)}${x.zero ? html`<span class="chip chip--warn xsmall">${x.zero} found nothing</span>` : ''}</div>
              ${bar(x.count, max(top, 'count'))}<strong class="ins-list__n">${x.count}</strong></li>`)}</ol>`
            : html`<p class="pf-muted">No keyword searches yet.</p>`}
        </section>
      </div>

      ${categories.length ? html`<section class="card pad" aria-labelledby="h-cats">
        <h2 id="h-cats">${icon('list')} Categories browsed without a keyword</h2>
        <ol class="ins-list ins-list--inline">${categories.map((x) => html`<li><div class="ins-list__main">${label(x)}</div>${bar(x.count, max(categories, 'count'))}<strong class="ins-list__n">${x.count}</strong></li>`)}</ol>
      </section>` : ''}`}`,
  });
}

module.exports = { insightsPage };
