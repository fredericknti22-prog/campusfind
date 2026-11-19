'use strict';
/**
 * Help centre and help chat. Members read answers to common questions and can chat privately with the
 * CampusFind team; staff with the 'support' permission answer from /admin/help. Every staff reply is audited.
 */
const express = require('express');
const config = require('../config');
const messages = require('../repo/messages');
const users = require('../repo/users');
const reports = require('../repo/reports');
const { notify, markReadByLink } = require('../services/notify');
const { audit } = require('../services/audit');
const { clean } = require('../lib/validate');
const { getMany } = require('../store');
const { sharedRateLimit } = require('../middleware/sharedLimit');
const { requireLogin, requireActive, requireStaff, can } = require('../middleware/auth');

const router = express.Router();
const helpLimit = sharedRateLimit({ name: 'help-min', windowMs: 60_000, max: Math.max(3, Math.floor(config.limits.messagesPerMin / 2)), key: (req) => `help:${req.user ? req.user.user_id : req.ip}`, message: 'You are sending messages very quickly. Wait a minute and try again.' });

const AUTO_REPLY = 'Thanks for getting in touch. A member of the CampusFind team will reply here, usually within one working day. You will get a notification when they do. The answers on this page cover the most common questions in the meantime.';

const wantsJson = (req) => (req.get('accept') || '').includes('application/json');

function readBody(raw) {
  const body = clean(raw, { multiline: true });
  if (body.length < 2) return { error: 'Write a message first.' };
  if (body.length > messages.MAX_BODY) return { error: `Keep messages under ${messages.MAX_BODY} characters.` };
  return { body };
}

/* ----- help centre (public); the chat part needs an account ----- */
router.get('/help', async (req, res) => {
  let thread = null; let list = [];
  if (req.user) {
    thread = await messages.supportThread(req.user.user_id);
    if (thread) {
      list = await messages.messagesOf(thread.id);
      if (thread.unread) await messages.markRead(thread.id, req.user.user_id);
      await markReadByLink(req.user.user_id, '/help');
    }
  }
  res.render('helpCentre', { thread, list });
});

router.post('/help', requireLogin, requireActive, helpLimit, async (req, res) => {
  const { body, error } = readBody(req.body.body);
  if (error) { if (wantsJson(req)) return res.status(400).json({ error }); req.flash('error', error); return res.redirect('/help?chat=1#chat'); }
  const before = await messages.supportThread(req.user.user_id);
  await messages.sendSupport({ userId: req.user.user_id, from: req.user.user_id, body });
  if (!before) {
    await messages.sendSupport({ userId: req.user.user_id, from: 0, body: AUTO_REPLY, fromStaff: true, staffName: 'CampusFind Help', auto: true });
  }
  // tell the team when a conversation starts waiting (not on every message, so nobody is flooded)
  if (!before || !(before.staff_unread > 0)) {
    const team = (await users.staff()).filter((u) => can(u, 'support'));
    await Promise.all(team.map((u) => notify(u.user_id, {
      type: 'support', title: `Help chat from ${req.user.name.split(' ')[0]}`, body: body.slice(0, 140), link: `/admin/help/${req.user.user_id}`,
    })));
  }
  await audit({ actor: req.user, action: 'support.message', entityType: 'user', entityId: req.user.user_id, ip: req.ip });
  if (wantsJson(req)) return res.json({ ok: true });
  res.redirect('/help?chat=1#latest');
});

router.get('/help/updates', requireLogin, async (req, res) => {
  const thread = await messages.supportThread(req.user.user_id);
  if (!thread) return res.json({ messages: [] });
  const fresh = await messages.messagesSince(thread.id, Number(req.query.since) || 0);
  if (fresh.some((m) => m.from_staff)) await messages.markRead(thread.id, req.user.user_id);
  res.set('Cache-Control', 'private, no-store').json({
    messages: fresh.map((m) => ({ id: m.id, mine: !m.from_staff, body: m.body, at: m.created_at, who: m.from_staff ? (m.staff_name || 'CampusFind team') : 'You' })),
  });
});

/* ----- staff inbox ----- */
const counts = async () => ({ openReports: await reports.countOpen(), supportWaiting: await messages.supportWaiting() });

router.get('/admin/help', requireStaff('support'), async (req, res) => {
  const queue = await messages.supportQueue();
  const people = await getMany('users', queue.map((t) => t.user_id));
  res.render('adminHelp', { counts: await counts(), items: queue.map((t) => ({ ...t, who: people.get(String(t.user_id)) || null })) });
});

async function loadMember(req, res) {
  const id = /^\d{1,9}$/.test(req.params.uid) ? Number(req.params.uid) : null;
  const thread = id ? await messages.supportThread(id) : null;
  if (!thread) { res.status(404).render('error', { status: 404, title: 'Conversation not found', message: 'This member has not written to the help chat.' }); return null; }
  return { id, thread, member: await users.getById(id) };
}

router.get('/admin/help/:uid', requireStaff('support'), async (req, res) => {
  const ctx = await loadMember(req, res);
  if (!ctx) return;
  const list = await messages.messagesOf(ctx.thread.id);
  if (ctx.thread.staff_unread) await messages.markSupportRead(ctx.id);
  await markReadByLink(req.user.user_id, `/admin/help/${ctx.id}`);
  res.render('adminHelpThread', { counts: await counts(), thread: ctx.thread, list, member: ctx.member });
});

router.post('/admin/help/:uid', requireStaff('support'), async (req, res) => {
  const ctx = await loadMember(req, res);
  if (!ctx) return;
  const { body, error } = readBody(req.body.body);
  if (error) { req.flash('error', error); return res.redirect(`/admin/help/${ctx.id}`); }
  const staffName = `${req.user.name.split(' ')[0]} · CampusFind team`;
  await messages.sendSupport({ userId: ctx.id, from: req.user.user_id, body, fromStaff: true, staffName });
  await notify(ctx.id, { type: 'support', title: 'The CampusFind team replied', body: body.slice(0, 140), link: '/help' });
  await audit({ actor: req.user, action: 'support.reply', entityType: 'user', entityId: ctx.id, ip: req.ip });
  res.redirect(`/admin/help/${ctx.id}#latest`);
});

router.get('/admin/help/:uid/updates', requireStaff('support'), async (req, res) => {
  const id = /^\d{1,9}$/.test(req.params.uid) ? Number(req.params.uid) : null;
  const thread = id ? await messages.supportThread(id) : null;
  if (!thread) return res.status(404).json({ error: 'not found' });
  const fresh = await messages.messagesSince(thread.id, Number(req.query.since) || 0);
  if (fresh.some((m) => !m.from_staff)) await messages.markSupportRead(id);
  res.set('Cache-Control', 'private, no-store').json({
    messages: fresh.map((m) => ({ id: m.id, mine: m.from_staff, body: m.body, at: m.created_at, who: m.from_staff ? (m.staff_name || 'CampusFind team') : 'Member' })),
  });
});

module.exports = router;
