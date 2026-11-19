'use strict';
/** Search alerts: save the current browse search, list your alerts, delete one. */
const express = require('express');
const alerts = require('../repo/alerts');
const categories = require('../repo/categories');
const { describe } = require('../services/alerts');
const { requireLogin, requireActive } = require('../middleware/auth');

const router = express.Router();
const clean = (s) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

router.get('/alerts', requireLogin, async (req, res) => {
  const [items, cats] = await Promise.all([alerts.byUser(req.user.user_id), categories.active()]);
  res.render('alerts', { items: items.map((a) => ({ ...a, label: describe(a, cats) })), max: alerts.MAX_ALERTS });
});

router.post('/alerts', requireLogin, requireActive, async (req, res) => {
  const q = clean(req.body.q).toLowerCase().slice(0, 80);
  const cats = await categories.active();
  const category = cats.some((c) => c.slug === req.body.category) ? req.body.category : '';
  const raw = String(req.body.price_max || '').trim();
  const price_max_cents = /^\d{1,7}(\.\d{1,2})?$/.test(raw) ? Math.round(parseFloat(raw) * 100) : null;
  if (!q && !category && price_max_cents == null) {
    req.flash('error', 'Search for something or pick a category first, then save it as an alert.');
    return res.redirect('/browse');
  }
  const r = await alerts.add(req.user.user_id, { q, category, price_max_cents });
  if (r === 'max') req.flash('error', `You can keep up to ${alerts.MAX_ALERTS} alerts. Delete one on the Alerts page first.`);
  else if (r === 'duplicate') req.flash('info', 'You already have an alert for this search.');
  else req.flash('success', 'Alert saved. We will notify you when a new listing matches this search.');
  res.redirect('/alerts');
});

router.post('/alerts/:id/delete', requireLogin, async (req, res) => {
  const ok = await alerts.remove(req.user.user_id, req.params.id);
  req.flash(ok ? 'success' : 'error', ok ? 'Alert deleted.' : 'That alert was not found.');
  res.redirect('/alerts');
});

module.exports = router;
