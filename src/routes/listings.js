'use strict';
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const settings = require('../services/settings');
const images = require('../services/images');
const messages = require('../repo/messages');
const { notify } = require('../services/notify');
const users = require('../repo/users');
const listings = require('../repo/listings');
const categories = require('../repo/categories');
const reports = require('../repo/reports');
const { audit } = require('../services/audit');
const { screenText } = require('../services/screening');
const { clean, parsePriceToCents, intOrNull } = require('../lib/validate');
const { requireLogin, requireActive, verifyCsrf, loadListingForOwner, isStaff } = require('../middleware/auth');
const { rateLimit } = require('../lib/security');
const { isFeaturedNow } = require('../views/components');

const router = express.Router();

function gate(req, res, next) {
  if (!config.publicBrowsing && !req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.limits.imageBytes, files: config.limits.imagesPerListing, fields: 20, fieldSize: 20_000, parts: 40 },
}).array('images', config.limits.imagesPerListing);

/** Parse multipart safely, convert multer errors to a friendly message, then check CSRF. */
const uploadParse = [
  (req, res, next) => upload(req, res, (err) => {
    if (err) {
      req.uploadError = err.code === 'LIMIT_FILE_SIZE'
        ? `Each photo must be under ${config.limits.imageBytes / 1024 / 1024} MB.`
        : ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(err.code)
          ? `You can upload up to ${config.limits.imagesPerListing} photos.`
          : 'We could not read that upload. Try again with JPG, PNG or WebP photos.';
    }
    next();
  }),
  verifyCsrf,
];

/** Validate every upload by its real file type, then let the image service convert it for the chosen store. */
async function stageImages(files) {
  if (!config.photosEnabled) return { images: [] };
  const out = [];
  for (const f of files || []) {
    const ext = images.sniff(f.buffer);
    if (!ext) return { error: 'Only real JPG, PNG or WebP photos are allowed.' };
    try {
      out.push(await images.prepare({ ext, buffer: f.buffer }));
    } catch (err) {
      if (err.code === 'BAD_IMAGE') return { error: 'One of the photos could not be read. Try a different JPG, PNG or WebP file.' };
      throw err;
    }
  }
  return { images: out };
}

const newImageId = () => crypto.randomBytes(6).toString('hex');

async function storeImages(staged, startPos) {
  const out = [];
  for (let i = 0; i < staged.length; i++) {
    const filename = await images.save(staged[i].buffer, staged[i].ext);
    out.push({ image_id: newImageId(), filename, position: startPos + i });
  }
  return out;
}

function readListingForm(body, cats) {
  const v = {
    title: clean(body.title),
    description: clean(body.description, { multiline: true }),
    category_id: intOrNull(body.category_id),
    location: clean(body.location),
    contact: clean(body.contact, { multiline: true }),
    price_type: ['fixed', 'negotiable', 'free', 'none'].includes(body.price_type) ? body.price_type : 'none',
    price_cents: null,
    business_type: null,
  };
  // The business type only means something in the Business category; anywhere else it is dropped.
  const inBusiness = cats.some((c) => c.category_id === v.category_id && c.slug === 'business');
  if (inBusiness && require('../lib/businessTypes').isType(body.business_type)) v.business_type = body.business_type;
  const errors = {};
  if (v.title.length < 4 || v.title.length > 90) errors.title = 'Give it a clear title (4–90 characters).';
  if (v.description.length < 10 || v.description.length > 2000) errors.description = 'Describe it in 10–2000 characters.';
  if (!cats.some((c) => c.category_id === v.category_id)) errors.category_id = 'Choose a category.';
  if (v.location.length > 80) errors.location = 'Keep the location under 80 characters.';
  if (v.contact.length > 200) errors.contact = 'Keep contact details under 200 characters.';
  if (v.price_type === 'fixed' || v.price_type === 'negotiable') {
    const raw = String(body.price || '').trim();
    if (raw) {
      v.price_cents = parsePriceToCents(raw);
      if (v.price_cents === null) errors.price = 'Enter a valid amount, e.g. 25 or 25.50.';
    } else if (v.price_type === 'fixed') {
      errors.price = 'Enter the price, or choose another price option.';
    }
  }
  return { v, errors };
}

/** Automatic screening only raises a flag for a human moderator; it never removes anything itself. */
async function flagIfSuspicious(listing, v) {
  const hits = screenText(v.title, v.description, v.contact);
  if (!hits.length) return;
  const result = await reports.create({
    reporter_id: null, target_type: 'listing', target_id: listing.listing_id, owner_id: listing.owner_id,
    reason: hits.some((h) => h.startsWith('explicit')) ? 'explicit' : 'scam',
    details: `Automatic screening matched: ${hits.join(', ')}. A human must confirm.`,
  });
  if (!result.duplicate) await audit({ action: 'screening.flag', entityType: 'listing', entityId: listing.listing_id, meta: { hits } });
}

const byPublished = (a, b) => (b.published_at || 0) - (a.published_at || 0);
const priceSort = (dir) => (a, b) => {
  if (a.price_cents == null && b.price_cents == null) return byPublished(a, b);
  if (a.price_cents == null) return 1;
  if (b.price_cents == null) return -1;
  return dir * (a.price_cents - b.price_cents) || byPublished(a, b);
};

/* ------------------------------------------------------------ browse */
router.get('/browse', gate, async (req, res) => {
  await require('../services/freshness').sweep();
  const q = clean(String(req.query.q || '')).slice(0, 80);
  const category = clean(String(req.query.category || '')).slice(0, 40);
  const priceMaxRaw = String(req.query.price_max || '').trim();
  const priceMax = /^\d{1,7}(\.\d{1,2})?$/.test(priceMaxRaw) ? priceMaxRaw : '';
  const sort = ['newest', 'oldest', 'price_asc', 'price_desc'].includes(req.query.sort) ? req.query.sort : 'newest';
  const pageNum = Math.max(1, Math.min(500, intOrNull(req.query.page) || 1));
  const verified = req.query.verified === '1' ? '1' : '';

  let items = await listings.activeSnapshot();
  const hidden = new Set(require('../services/blocks').list(req.user));
  if (hidden.size) items = items.filter((l) => !hidden.has(Number(l.owner_id)));
  const terms = q.toLowerCase().split(' ').filter(Boolean).slice(0, 5);
  if (terms.length) {
    items = items.filter((l) => {
      const hay = `${l.title} ${l.description} ${l.location}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  if (category) items = items.filter((l) => l.cat_slug === category);
  if (verified) items = items.filter((l) => l.owner_trust);
  if (priceMax) {
    const cents = Math.round(parseFloat(priceMax) * 100);
    items = items.filter((l) => l.price_type === 'free' || l.price_cents == null || l.price_cents <= cents);
  }
  const sorters = {
    newest: (a, b) => (isFeaturedNow(b) - isFeaturedNow(a)) || byPublished(a, b),
    oldest: (a, b) => (a.published_at || 0) - (b.published_at || 0),
    price_asc: priceSort(1),
    price_desc: priceSort(-1),
  };
  items = [...items].sort(sorters[sort]);

  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / config.limits.pageSize));
  const current = Math.min(pageNum, pages);
  const slice = items.slice((current - 1) * config.limits.pageSize, current * config.limits.pageSize);
  if (current === 1 && (q || category)) {
    await require('../services/insights').record({ q, category, total, who: req.user ? `u${req.user.user_id}` : req.ip });
  }
  res.render('browse', { q, category, priceMax, sort, verified, items: slice, total, pages, pageNum: current, categories: await categories.active() });
});

/* ------------------------------------------------------------ create */
const createLimiter = rateLimit({ windowMs: 60_000, max: 8, key: (req) => `post:${req.user ? req.user.user_id : req.ip}` });

router.get('/listings/new', requireLogin, requireActive, async (req, res) => {
  const cats = await categories.active();
  const wanted = String(req.query.category || '');
  const cat = cats.find((c) => String(c.category_id) === wanted || c.slug === wanted);
  const kind = ['lost', 'found'].includes(req.query.kind) ? req.query.kind : null;
  const l = { category_id: cat ? cat.category_id : null };
  if (cat && cat.slug === 'business' && require('../lib/businessTypes').isType(req.query.type)) l.business_type = req.query.type;
  if (kind) { l.title = kind === 'lost' ? 'Lost: ' : 'Found: '; l.price_type = 'none'; }
  // The assistant can hand over a draft. Nothing is saved: the member reviews the filled-in form and publishes it themselves.
  const pre = (v, n) => clean(typeof v === 'string' ? v : '', { multiline: true }).slice(0, n);
  if (req.query.title) l.title = pre(req.query.title, 90);
  if (req.query.description) l.description = pre(req.query.description, 2000);
  if (req.query.location) l.location = pre(req.query.location, 80);
  if (req.query.title || req.query.description) l.price_type = l.price_type || 'none';
  res.render('listingForm', { categories: cats, l, kind });
});

router.post('/listings/new', requireLogin, requireActive, createLimiter, uploadParse, async (req, res) => {
  const cats = await categories.active();
  const { v, errors } = readListingForm(req.body, cats);
  const renderBack = (extra = {}) => res.status(400).render('listingForm', { categories: cats, l: v, errors: { ...errors, ...extra } });

  if (!settings.bool('posting_enabled')) return renderBack({ _form: 'Posting is paused for a moment. Please try again later.' });
  const mine = await listings.byOwner(req.user.user_id);
  const today = mine.filter((l) => l.created_at > Date.now() - 86_400_000).length;
  if (today >= settings.int('listings_per_day')) {
    return renderBack({ _form: `You have reached the daily limit of ${settings.int('listings_per_day')} new listings. Try again tomorrow.` });
  }
  if (req.uploadError) errors.images = req.uploadError;
  const staged = await stageImages(req.files);
  if (staged.error) errors.images = staged.error;
  if (Object.keys(errors).length) return renderBack();

  const publish = req.body.intent !== 'draft';
  const now = Date.now();
  const imgs = await storeImages(staged.images, 0);
  const listing = await listings.create({
    owner_id: req.user.user_id, category_id: v.category_id, title: v.title, description: v.description,
    price_type: v.price_type, price_cents: v.price_cents, location: v.location, contact: v.contact, business_type: v.business_type,
    status: publish ? 'active' : 'draft', created_at: now, updated_at: now, published_at: publish ? now : null,
    images: imgs, cover: imgs[0] ? imgs[0].filename : null,
  });
  await audit({ actor: req.user, action: 'listing.create', entityType: 'listing', entityId: listing.listing_id, ip: req.ip });
  if (publish) await flagIfSuspicious(listing, v);
  if (publish) await require('../services/alerts').onListingLive(listing.listing_id);
  req.flash('success', publish ? 'Your listing has been published.' : 'Draft saved.');
  res.redirect(`/listings/${listing.listing_id}`);
});

/* ------------------------------------------------------------ mine */
router.get('/my/listings', requireLogin, async (req, res) => {
  const mine = (await listings.byOwner(req.user.user_id)).filter((l) => !l.deleted_at).sort((a, b) => b.updated_at - a.updated_at);
  res.render('myListings', { items: await listings.hydrate(mine) });
});

/* ------------------------------------------------------------ detail */
const seen = new Set();
router.get('/listings/:id', gate, async (req, res) => {
  const id = /^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : null;
  const raw = id ? await listings.get(id) : null;
  const notFound = () => res.status(404).render('error', { status: 404, title: 'Listing not found', message: 'It may have been closed, removed or never existed.' });
  if (!raw) return notFound();

  const [l] = await listings.hydrate([raw]);
  const owner = await users.getById(l.owner_id);
  const sellerRating = await require('../repo/reviews').summary(l.owner_id);
  const isOwner = Boolean(req.user && req.user.user_id === l.owner_id);
  const staff = isStaff(req.user);
  const publiclyVisible = l.status === 'active' && !l.deleted_at && owner && !owner.deleted_at && ['active', 'restricted'].includes(owner.status);
  if (!publiclyVisible && !(staff || (isOwner && !l.deleted_at))) return notFound();

  if (!isOwner && publiclyVisible && req.session) {
    const key = `${req.session.session_hash}:${id}`;
    if (!seen.has(key)) {
      if (seen.size > 20000) seen.clear();
      seen.add(key);
      listings.bumpViews(id).catch(() => {});
      l.views += 1;
    }
  }
  const imgs = [...(l.images || [])].sort((a, b) => a.position - b.position);
  const saved = req.user && !isOwner ? await require('../repo/favorites').has(req.user.user_id, id) : false;
  res.render('listingDetail', { sellerRating, l, images: imgs, owner, isOwner, staff, saved, canSeeContact: Boolean(req.user) });
});

/* ------------------------------------------------------------ poster */
router.get('/listings/:id/poster', requireLogin, loadListingForOwner, async (req, res) => {
  const [l] = await listings.hydrate([req.listing]);
  if (l.status !== 'active') {
    req.flash('error', 'Only live listings can have a poster. Publish it first.');
    return res.redirect(`/listings/${l.listing_id}`);
  }
  const imgs = [...(l.images || [])].sort((a, b) => a.position - b.position);
  const url = `${config.baseUrl}/listings/${l.listing_id}`;
  res.render('listingPoster', { l, url, qr: await require('../services/qr').svg(url), image: imgs.length ? `/uploads/${imgs[0].filename}` : null });
});

/* ------------------------------------------------------------ edit */
router.get('/listings/:id/edit', requireLogin, loadListingForOwner, async (req, res) => {
  res.render('listingForm', { l: req.listing, categories: await categories.active(), images: req.listing.images || [], isEdit: true });
});

router.post('/listings/:id/edit', requireLogin, loadListingForOwner, uploadParse, async (req, res) => {
  const listing = req.listing;
  const cats = (await categories.all()).filter((c) => c.is_active || c.category_id === listing.category_id);
  const { v, errors } = readListingForm(req.body, cats);
  const existing = [...(listing.images || [])].sort((a, b) => a.position - b.position);
  const removeIds = new Set([].concat(req.body.remove_image || []).map(String));
  const keep = existing.filter((im) => !removeIds.has(im.image_id));
  const dropped = existing.filter((im) => removeIds.has(im.image_id));

  if (req.uploadError) errors.images = req.uploadError;
  const staged = await stageImages(req.files);
  if (staged.error) errors.images = staged.error;
  else if (keep.length + staged.images.length > config.limits.imagesPerListing) {
    errors.images = `A listing can have at most ${config.limits.imagesPerListing} photos.`;
  }
  const locked = ['hidden', 'removed'].includes(listing.status);
  let status = listing.status;
  if (!locked && ['active', 'draft', 'closed'].includes(req.body.status)) status = req.body.status;

  if (Object.keys(errors).length) {
    return res.status(400).render('listingForm', { l: { ...v, listing_id: listing.listing_id, status: listing.status }, categories: cats, errors, images: existing, isEdit: true });
  }

  const added = await storeImages(staged.images, keep.length);
  const allImages = [...keep, ...added].map((im, i) => ({ ...im, position: i }));
  const now = Date.now();
  await listings.update(listing.listing_id, {
    category_id: v.category_id, title: v.title, description: v.description, price_type: v.price_type, price_cents: v.price_cents,
    location: v.location, contact: v.contact, business_type: v.business_type, status, updated_at: now,
    published_at: status === 'active' && !listing.published_at ? now : listing.published_at || null,
    images: allImages, cover: allImages[0] ? allImages[0].filename : null,
  });
  await Promise.all(dropped.map((im) => images.remove(im.filename)));
  {
    const watch = require('../services/savedWatch');
    const drop = status === 'active' && listing.status === 'active' ? watch.priceDrop(listing, v) : null;
    if (drop) await watch.notifyChange({ ...listing, title: v.title }, 'price-drop', drop);
    if (listing.status === 'active' && status === 'closed') await watch.notifyChange({ ...listing, title: v.title }, 'closed');
  }
  await audit({ actor: req.user, action: 'listing.update', entityType: 'listing', entityId: listing.listing_id, ip: req.ip });
  if (status === 'active') await flagIfSuspicious(listing, v);
  if (status === 'active' && !listing.published_at) await require('../services/alerts').onListingLive(listing.listing_id);
  req.flash('success', 'Listing updated.');
  res.redirect(`/listings/${listing.listing_id}`);
});

router.post('/listings/:id/renew', requireLogin, loadListingForOwner, async (req, res) => {
  const fresh = require('../services/freshness');
  const [l] = await listings.hydrate([req.listing]);
  if (!fresh.canRenew(l)) {
    req.flash('error', `You can renew a listing during its last ${fresh.RENEW_WINDOW_DAYS} days, or after it expires.`);
    return res.redirect('/my/listings');
  }
  const now = Date.now();
  await listings.update(l.listing_id, { status: 'active', outcome: null, renewed_at: now, reminded_at: null, expired_at: null, updated_at: now });
  if (l.status !== 'active') await require('../services/savedWatch').notifyChange(l, 'available');
  await audit({ actor: req.user, action: 'listing.renew', entityType: 'listing', entityId: l.listing_id, ip: req.ip });
  req.flash('success', `Renewed. “${String(l.title).slice(0, 60)}” stays up for another ${fresh.LIVE_DAYS} days.`);
  res.redirect(req.body.back === 'listing' ? `/listings/${l.listing_id}` : '/my/listings');
});

router.post('/listings/:id/status', requireLogin, loadListingForOwner, async (req, res) => {
  const next = req.body.status;
  if (!['active', 'closed', 'draft'].includes(next) || ['hidden', 'removed'].includes(req.listing.status)) {
    req.flash('error', 'That change is not allowed.');
    return res.redirect('/my/listings');
  }
  const now = Date.now();
  // "Mark as returned" is only for Lost & Found items: the owner has got the item back (or the finder handed it over).
  const cat = (await categories.all()).find((c) => c.category_id === req.listing.category_id);
  const returned = next === 'closed' && req.body.outcome === 'returned' && Boolean(cat && cat.slug === 'lost-found');
  await listings.update(req.listing.listing_id, {
    status: next, updated_at: now, outcome: returned ? 'returned' : null,
    ...(next === 'active' && req.listing.published_at ? { renewed_at: now, reminded_at: null } : {}),
    published_at: next === 'active' && !req.listing.published_at ? now : req.listing.published_at || null,
  });
  if (next === 'active' && !req.listing.published_at) await require('../services/alerts').onListingLive(req.listing.listing_id);
  if (req.listing.status === 'active' && next === 'closed' && !returned) await require('../services/savedWatch').notifyChange(req.listing, 'closed');
  if (req.listing.status === 'closed' && next === 'active') await require('../services/savedWatch').notifyChange(req.listing, 'available');
  await audit({ actor: req.user, action: returned ? 'listing.returned' : 'listing.status', entityType: 'listing', entityId: req.listing.listing_id, meta: { to: next }, ip: req.ip });
  if (returned) {
    // Tell everyone who asked about it, so nobody keeps looking.
    const threads = await messages.byListing(req.listing.listing_id);
    await Promise.all(threads.filter((t) => t.starter_id !== req.user.user_id).map((t) => notify(t.starter_id, {
      type: 'message', title: `Update: “${String(req.listing.title).slice(0, 60)}” was returned`,
      body: 'The poster marked this item as returned to its owner, so no further action is needed.', link: `/messages/${t.id}`,
    })));
  }
  req.flash('success', returned ? 'Marked as returned. Thank you for helping an item get home.' : next === 'active' ? 'Listing is live again.' : 'Listing closed.');
  res.redirect('/my/listings');
});

router.post('/listings/:id/delete', requireLogin, loadListingForOwner, async (req, res) => {
  const files = (req.listing.images || []).map((im) => im.filename);
  const now = Date.now();
  await listings.update(req.listing.listing_id, { deleted_at: now, status: 'closed', updated_at: now, images: [], cover: null });
  await Promise.all(files.map((f) => images.remove(f)));
  await audit({ actor: req.user, action: 'listing.delete', entityType: 'listing', entityId: req.listing.listing_id, ip: req.ip });
  req.flash('success', 'Listing deleted.');
  res.redirect('/my/listings');
});

module.exports = router;
