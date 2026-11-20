'use strict';
/**
 * Search engine visibility: robots.txt, sitemap.xml and schema.org structured data (JSON-LD).
 * Only public pages go in the sitemap. Test deployments (blue/green candidates) ask search engines to stay away.
 */
const config = require('../config');
const { isCandidate } = require('../lib/deployEnv');

const PRIVATE = ['/admin', '/login', '/register', '/forgot', '/reset', '/profile', '/notifications', '/my/', '/report',
  '/offline.html', '/orders', '/messages', '/assistant', '/saved', '/alerts', '/listings/new'];

function robots(req) {
  if (isCandidate(req) || config.sandbox) return 'User-agent: *\nDisallow: /\n';
  return ['User-agent: *', ...PRIVATE.map((p) => `Disallow: ${p}`), 'Allow: /', '', `Sitemap: ${config.baseUrl}/sitemap.xml`, ''].join('\n');
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isoDay = (t) => new Date(Number(t) || Date.now()).toISOString().slice(0, 10);

const STATIC = [
  ['/', 'daily', '1.0'], ['/browse', 'hourly', '0.9'], ['/business', 'daily', '0.8'], ['/lost-found', 'daily', '0.8'],
  ['/pricing', 'monthly', '0.5'], ['/help', 'monthly', '0.5'], ['/rules', 'monthly', '0.4'],
  ['/terms', 'yearly', '0.2'], ['/privacy', 'yearly', '0.2'], ['/refunds', 'yearly', '0.2'], ['/data-protection', 'yearly', '0.2'],
];

/** Public pages, one Browse page per category, and every live listing (listings only when browsing is public). */
function sitemap({ items, cats }) {
  const urls = STATIC.map(([p, freq, pri]) => ({ loc: p, freq, pri }));
  if (config.publicBrowsing) {
    for (const c of cats) urls.push({ loc: `/browse?category=${encodeURIComponent(c.slug)}`, freq: 'daily', pri: '0.7' });
    for (const l of items) urls.push({ loc: `/listings/${l.listing_id}`, mod: l.updated_at || l.published_at, freq: 'weekly', pri: '0.6' });
  }
  const body = urls.map((u) => `  <url><loc>${xmlEsc(config.baseUrl + u.loc)}</loc>${u.mod ? `<lastmod>${isoDay(u.mod)}</lastmod>` : ''}<changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body.join('\n')}\n</urlset>\n`;
}

/** Home page: the site itself, with a search box Google can show under the result. */
function siteLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${config.baseUrl}/#org`, name: 'CampusFind', url: `${config.baseUrl}/`, logo: `${config.baseUrl}/img/logo.png` },
      {
        '@type': 'WebSite', '@id': `${config.baseUrl}/#site`, name: 'CampusFind', url: `${config.baseUrl}/`, publisher: { '@id': `${config.baseUrl}/#org` },
        potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${config.baseUrl}/browse?q={search_term_string}` }, 'query-input': 'required name=search_term_string' },
      },
    ],
  };
}

// Physical goods get Product markup with a price. Housing, jobs, events, services and lost property only get breadcrumbs,
// because Google's product rules do not fit them.
const GOODS = new Set(['textbooks', 'electronics', 'free']);

function listingLd(l, images) {
  const url = `${config.baseUrl}/listings/${l.listing_id}`;
  const graph = [{
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Browse', item: `${config.baseUrl}/browse` },
      { '@type': 'ListItem', position: 2, name: l.cat_name, item: `${config.baseUrl}/browse?category=${encodeURIComponent(l.cat_slug)}` },
      { '@type': 'ListItem', position: 3, name: l.title, item: url },
    ],
  }];
  const priced = l.price_type === 'free' || (['fixed', 'negotiable'].includes(l.price_type) && l.price_cents != null);
  if (GOODS.has(l.cat_slug) && priced && l.status === 'active') {
    graph.push({
      '@type': 'Product', name: l.title, description: String(l.description || '').slice(0, 500), url, category: l.cat_name,
      ...(images.length ? { image: images.slice(0, 3).map((i) => `${config.baseUrl}/uploads/${i.filename}`) } : {}),
      offers: {
        '@type': 'Offer', url, priceCurrency: config.currency.code,
        price: l.price_type === 'free' ? '0' : (l.price_cents / 100).toFixed(2),
        availability: 'https://schema.org/InStock',
      },
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

module.exports = { robots, sitemap, siteLd, listingLd };
