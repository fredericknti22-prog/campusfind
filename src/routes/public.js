'use strict';
const express = require('express');
const listings = require('../repo/listings');
const categories = require('../repo/categories');
const { isFeaturedNow, promoTierNow } = require('../views/components');

const router = express.Router();

router.get('/', async (req, res) => {
  await require('../services/freshness').sweep();
  const [all, cats] = await Promise.all([listings.activeSnapshot(), categories.active()]);
  const hidden = new Set(require('../services/blocks').list(req.user));
  const items = hidden.size ? all.filter((l) => !hidden.has(Number(l.owner_id))) : all;
  const featured = items.filter(isFeaturedNow).slice(0, 4);
  const business = items.filter((l) => promoTierNow(l) === 'business' && !isFeaturedNow(l)).slice(0, 4);
  const lostFound = items.filter((l) => l.cat_slug === 'lost-found').slice(0, 4);
  const shown = new Set([...featured, ...business].map((l) => l.listing_id));
  const data = {
    categories: cats, featured, business, lostFound,
    latest: items.filter((l) => !shown.has(l.listing_id)).slice(0, 12),
    total: items.length,
    counts: items.reduce((m, l) => { m[l.cat_slug] = (m[l.cat_slug] || 0) + 1; return m; }, {}),
    reunited: await listings.countReturned(),
  };
  if (req.user) {
    const mine = await listings.byOwner(req.user.user_id);
    data.mine = mine.filter((l) => l.status === 'active' && !l.deleted_at).length;
    data.unread = req.unread;
  }
  res.render('home', data);
});
/** Lost items start with "Lost", found items with "Found" (the post form adds the prefix). */
const lfKind = (l) => (/^lost\b/i.test(l.title) ? 'lost' : /^found\b/i.test(l.title) ? 'found' : 'other');

/** Business directory: everything in the Business category plus any listing with a running business promotion. */
router.get('/business', async (req, res) => {
  const items = await listings.activeSnapshot();
  const rank = (l) => (promoTierNow(l) === 'premium' ? 0 : isFeaturedNow(l) ? 1 : promoTierNow(l) === 'business' ? 2 : 3);
  const shops = items
    .filter((l) => l.cat_slug === 'business' || ['business', 'premium'].includes(promoTierNow(l)))
    .sort((a, b) => rank(a) - rank(b) || (b.published_at || b.created_at) - (a.published_at || a.created_at));
  const type = require('../lib/businessTypes').isType(req.query.type) ? req.query.type : '';
  const counts = Object.fromEntries(require('../lib/businessTypes').KEYS.map((k) => [k, shops.filter((l) => l.business_type === k).length]));
  const shown = type ? shops.filter((l) => l.business_type === type) : shops;
  res.render('businessPage', { shops: shown, total: shops.length, type, counts, spotlight: type ? [] : shops.filter((l) => rank(l) < 3).slice(0, 4) });
});

/** Lost & found board with Lost / Found tabs. */
router.get('/lost-found', async (req, res) => {
  const kind = ['lost', 'found'].includes(req.query.kind) ? req.query.kind : '';
  const items = (await listings.activeSnapshot()).filter((l) => l.cat_slug === 'lost-found');
  const counts = { all: items.length, lost: items.filter((l) => lfKind(l) === 'lost').length, found: items.filter((l) => lfKind(l) === 'found').length };
  res.render('lostFoundPage', {
    kind, counts, reunited: await listings.countReturned(),
    items: kind ? items.filter((l) => lfKind(l) === kind) : items,
  });
});
router.get('/robots.txt', (req, res) => res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(require('../views/seo').robots(req)));
router.get('/.well-known/security.txt', (req, res) => {
  const config = require('../config');
  const expires = new Date(Date.now() + 180 * 86_400_000).toISOString();
  res.type('text/plain').set('Cache-Control', 'public, max-age=86400').send(['# Found a security problem in CampusFind? Please tell us privately before sharing it.', `Contact: ${config.baseUrl}/help`, `Expires: ${expires}`, 'Preferred-Languages: en', `Canonical: ${config.baseUrl}/.well-known/security.txt`, `Policy: ${config.baseUrl}/terms`, ''].join('\n'));
});
router.get('/sitemap.xml', async (req, res) => {
  const [items, cats] = await Promise.all([listings.activeSnapshot(), categories.active()]);
  res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(require('../views/seo').sitemap({ items, cats }));
});

const errorBeaconLimit = require('../lib/security').rateLimit({ windowMs: 60_000, max: 10, key: (req) => `err:${req.ip}` });
router.post('/errors/client', errorBeaconLimit, express.text({ type: '*/*', limit: '4kb' }), async (req, res) => {
  let b = {};
  try { b = JSON.parse(typeof req.body === 'string' ? req.body : '{}'); } catch (e) { return res.status(204).end(); }
  if (b && typeof b.message === 'string' && b.message.length) {
    await require('../services/errorLog').record({ source: 'client', message: b.message, stack: String(b.stack || ''), path: String(b.path || ''), ua: req.get('user-agent') });
  }
  res.status(204).end();
});

router.get('/app', (req, res) => res.render('getApp'));

router.get('/whats-new', async (req, res) => res.render('whatsNew', { notes: await require('../services/whatsNew').list() }));

router.post('/whats-new/seen', async (req, res) => {
  if (req.user) await require('../services/whatsNew').markSeen(req.user);
  res.redirect(require('../middleware/auth').safeNext(req.body.back, '/'));
});

router.get('/rules', (req, res) => res.render('rules'));
router.get('/legal', (req, res) => res.render('legalHub'));
router.get('/privacy', (req, res) => res.render('privacy'));
router.get('/terms', (req, res) => res.render('terms'));
router.get('/cookies', (req, res) => res.render('cookies'));
router.get('/moderation', (req, res) => res.render('moderation'));
router.get('/copyright', (req, res) => res.render('copyright'));
router.get('/data-protection', (req, res) => res.render('dataProtection'));
router.get('/business-terms', (req, res) => res.render('businessTerms'));
router.get('/refunds', (req, res) => res.render('refunds'));
router.get('/disclaimer', (req, res) => res.render('disclaimer'));

module.exports = router;
