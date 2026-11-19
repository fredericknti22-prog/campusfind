'use strict';
/** Saved listings: save or unsave from a listing, and see them all on /saved. */
const express = require('express');
const favorites = require('../repo/favorites');
const listings = require('../repo/listings');
const { requireLogin, safeNext } = require('../middleware/auth');

const router = express.Router();

router.post('/listings/:id/save', requireLogin, async (req, res) => {
  const id = /^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : null;
  const back = safeNext(req.body.next, id ? `/listings/${id}` : '/saved');
  const listing = id ? await listings.get(id) : null;
  const saved = id ? await favorites.has(req.user.user_id, id) : false;

  if (saved) {
    // Removing a save always works, even when the listing has since been closed or removed.
    await favorites.remove(req.user.user_id, id);
    req.flash('success', 'Removed from your saved listings.');
    return res.redirect(back);
  }
  if (!listing || listing.deleted_at || listing.status !== 'active') {
    req.flash('error', 'That listing is no longer available.');
    return res.redirect('/saved');
  }
  if (listing.owner_id === req.user.user_id) {
    req.flash('info', 'This is your own listing, so there is nothing to save.');
    return res.redirect(back);
  }
  if (!(await favorites.add(req.user.user_id, id))) {
    req.flash('error', `You can save up to ${favorites.MAX_SAVED} listings. Remove some first.`);
    return res.redirect(back);
  }
  req.flash('success', 'Saved. Find it any time under Saved listings.');
  return res.redirect(back);
});

router.get('/saved', requireLogin, async (req, res) => {
  const ids = await favorites.listingIds(req.user.user_id);
  const live = new Map((await listings.activeSnapshot()).map((l) => [l.listing_id, l]));
  const items = ids.map((id) => live.get(id)).filter(Boolean);
  res.render('saved', { items, unavailable: ids.length - items.length });
});

module.exports = router;
