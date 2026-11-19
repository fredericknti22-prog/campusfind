'use strict';
/**
 * Member-to-member chat: questions about a listing, and one-to-one direct messages started from a profile.
 * Live updates: the open conversation polls /messages/:cid/updates (JSON) every few seconds; without JavaScript
 * the page still works by reloading after each send.
 */
const express = require('express');
const config = require('../config');
const messages = require('../repo/messages');
const listings = require('../repo/listings');
const users = require('../repo/users');
const { notify, markReadByLink } = require('../services/notify');
const { audit } = require('../services/audit');
const { clean } = require('../lib/validate');
const { getMany } = require('../store');
const { sharedRateLimit } = require('../middleware/sharedLimit');
const { requireLogin, requireActive } = require('../middleware/auth');

const router = express.Router();
const byUser = (req) => `msg:${req.user ? req.user.user_id : req.ip}`;
const perMinute = sharedRateLimit({ name: 'message-min', windowMs: 60_000, max: config.limits.messagesPerMin, key: byUser, message: 'You are sending messages very quickly. Wait a minute and try again.' });
const perDay = sharedRateLimit({ name: 'message-day', windowMs: 24 * 3600_000, max: config.limits.messagesPerDay, key: byUser, message: 'You have reached the daily message limit. Try again tomorrow.' });

const reachable = (u) => Boolean(u && !u.deleted_at && ['active', 'restricted'].includes(u.status));
const firstName = (u) => String(u.name || '').split(' ')[0];
const blocks = require('../services/blocks');

function readBody(raw) {
  const body = clean(raw, { multiline: true });
  if (body.length < 2) return { error: 'Write a message first.' };
  if (body.length > messages.MAX_BODY) return { error: `Keep messages under ${messages.MAX_BODY} characters.` };
  const blocked = require('../services/chatSafety').block(body);
  if (blocked) return { error: blocked };
  return { body };
}

async function deliver(req, { cid, listing, to, body, kind = 'listing' }) {
  const flags = require('../services/chatSafety').assess(body);
  const id = await messages.send({ listing, from: req.user.user_id, to, body, cid, kind, flags });
  await require('../services/signals').noteFlags(req.user.user_id, flags);
  await notify(to, {
    type: 'message',
    title: kind === 'direct' ? `New message from ${firstName(req.user)}` : `New message about “${String(listing.title).slice(0, 60)}”`,
    body: `${firstName(req.user)}: ${body.slice(0, 120)}`, link: `/messages/${id}`,
  });
  return id;
}

/** Threads for the conversation list, with the other person attached. */
async function threadList(me) {
  const threads = await messages.listFor(me);
  const people = await getMany('users', threads.map((t) => t.other_id).filter(Boolean));
  return threads.map((t) => ({ ...t, other: people.get(String(t.other_id)) || null }));
}

/* ----- start a conversation from a listing ----- */
router.post('/listings/:id/message', requireLogin, requireActive, perMinute, perDay, async (req, res) => {
  const id = /^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : null;
  const listing = id ? await listings.get(id) : null;
  const back = id ? `/listings/${id}` : '/browse';
  if (!listing || listing.deleted_at || listing.status !== 'active') {
    req.flash('error', 'That listing is no longer available.');
    return res.redirect('/browse');
  }
  if (listing.owner_id === req.user.user_id) {
    req.flash('info', 'This is your own listing. People who message you will appear in your inbox.');
    return res.redirect('/messages');
  }
  const owner = await users.getById(listing.owner_id);
  if (!reachable(owner)) {
    req.flash('error', 'The poster cannot receive messages right now.');
    return res.redirect(back);
  }
  if (blocks.messageBlock(req.user, owner)) { req.flash('error', blocks.messageBlock(req.user, owner)); return res.redirect(back); }
  const { body, error } = readBody(req.body.body);
  if (error) { req.flash('error', error); return res.redirect(back); }
  const cid = await deliver(req, { cid: null, listing, to: listing.owner_id, body });
  await audit({ actor: req.user, action: 'message.send', entityType: 'listing', entityId: listing.listing_id, ip: req.ip });
  req.flash('success', 'Message sent. You will be notified when they reply.');
  res.redirect(`/messages/${cid}`);
});

/* ----- start (or continue) a direct chat from a member's profile ----- */
router.post('/users/:id/message', requireLogin, requireActive, perMinute, perDay, async (req, res) => {
  const id = /^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : null;
  const person = id ? await users.getById(id) : null;
  if (!person || person.deleted_at) { req.flash('error', 'That member could not be found.'); return res.redirect('/messages'); }
  if (person.user_id === req.user.user_id) { req.flash('info', 'You cannot message yourself.'); return res.redirect(`/users/${id}`); }
  if (!reachable(person)) { req.flash('error', 'This member cannot receive messages right now.'); return res.redirect(`/users/${id}`); }
  if (blocks.messageBlock(req.user, person)) { req.flash('error', blocks.messageBlock(req.user, person)); return res.redirect(`/users/${id}`); }
  const { body, error } = readBody(req.body.body);
  if (error) { req.flash('error', error); return res.redirect(`/users/${id}`); }
  const cid = await deliver(req, { cid: messages.directId(req.user.user_id, id), listing: null, to: id, body, kind: 'direct' });
  await audit({ actor: req.user, action: 'message.direct', entityType: 'user', entityId: id, ip: req.ip });
  res.redirect(`/messages/${cid}`);
});

/* ----- inbox ----- */
router.get('/messages', requireLogin, async (req, res) => {
  const [threads, help] = await Promise.all([threadList(req.user.user_id), messages.supportThread(req.user.user_id)]);
  res.render('messageInbox', { threads, help });
});

/* ----- one conversation ----- */
async function loadThread(req, res) {
  const t = /^[\w-]{1,40}$/.test(req.params.cid) ? await messages.get(req.params.cid, req.user.user_id) : null;
  if (!t || t.kind === 'support') {
    if (t && t.kind === 'support') { res.redirect('/help'); return null; }
    res.status(404).render('error', { status: 404, title: 'Conversation not found', message: 'It may have been deleted, or it belongs to someone else.' });
    return null;
  }
  return t;
}

router.get('/messages/:cid', requireLogin, async (req, res) => {
  const t = await loadThread(req, res);
  if (!t) return;
  const [list, other, listing, threads, help] = await Promise.all([
    messages.messagesOf(t.id), users.getById(t.other_id), t.listing_id ? listings.get(t.listing_id) : null,
    threadList(req.user.user_id), messages.supportThread(req.user.user_id),
  ]);
  if (t.unread) await messages.markRead(t.id, req.user.user_id);
  await markReadByLink(req.user.user_id, `/messages/${t.id}`);
  res.render('messageThread', {
    t, list, threads: threads.map((x) => (x.id === t.id ? { ...x, unread: 0 } : x)), help,
    other: reachable(other) ? other : null,
    otherPerson: other && !other.deleted_at ? other : null,
    otherName: other && !other.deleted_at ? other.name : 'Deleted user',
    listing: listing && !listing.deleted_at ? listing : null,
    blockNote: other ? blocks.messageBlock(req.user, other) : null,
  });
});

router.post('/messages/:cid', requireLogin, requireActive, perMinute, perDay, async (req, res) => {
  const t = await loadThread(req, res);
  if (!t) return;
  const [other, listing] = await Promise.all([users.getById(t.other_id), t.listing_id ? listings.get(t.listing_id) : null]);
  if (!reachable(other)) {
    req.flash('error', 'This person can no longer receive messages.');
    return res.redirect(`/messages/${t.id}`);
  }
  if (blocks.messageBlock(req.user, other)) { req.flash('error', blocks.messageBlock(req.user, other)); return res.redirect(`/messages/${t.id}`); }
  const { body, error } = readBody(req.body.body);
  if (error) { req.flash('error', error); return res.redirect(`/messages/${t.id}`); }
  await deliver(req, {
    cid: t.id, kind: t.kind, to: t.other_id, body,
    listing: listing || { listing_id: t.listing_id, title: t.listing_title, owner_id: t.owner_id },
  });
  res.redirect(`/messages/${t.id}#latest`);
});

/* ----- live updates for the open conversation (JSON; participants only) ----- */
router.get('/messages/:cid/updates', requireLogin, async (req, res) => {
  const t = /^[\w-]{1,40}$/.test(req.params.cid) ? await messages.get(req.params.cid, req.user.user_id) : null;
  if (!t || t.kind === 'support') return res.status(404).json({ error: 'not found' });
  const since = Number(req.query.since) || 0;
  const fresh = await messages.messagesSince(t.id, since);
  if (fresh.some((m) => m.sender_id !== req.user.user_id)) await messages.markRead(t.id, req.user.user_id);
  res.set('Cache-Control', 'private, no-store').json({
    messages: fresh.map((m) => {
      const mine = m.sender_id === req.user.user_id;
      return { id: m.id, mine, body: m.body, at: m.created_at, warn: mine ? [] : require('../services/chatSafety').warnings(m.flags) };
    }),
  });
});

module.exports = router;
