'use strict';
/** The CampusFind AI assistant (signed-in members only). */
const express = require('express');
const config = require('../config');
const settings = require('../services/settings');
const assistant = require('../services/assistant');
const { clean } = require('../lib/validate');
const { sharedRateLimit } = require('../middleware/sharedLimit');
const { requireLogin, requireActive } = require('../middleware/auth');

const router = express.Router();
const A = config.assistant;
const byUser = (req) => `assistant:${req.user ? req.user.user_id : req.ip}`;
const perHour = sharedRateLimit({ name: 'assistant-hr', windowMs: 3600_000, max: A.perHour, key: byUser, message: 'You have asked a lot of questions in the last hour. Please try again a little later.' });
const perDay = sharedRateLimit({ name: 'assistant-day', windowMs: 24 * 3600_000, max: A.perDay, key: byUser, message: 'You have reached the daily limit for the assistant. Try again tomorrow.' });

const available = () => assistant.configured() && settings.bool('assistant_enabled');

router.get('/assistant', requireLogin, async (req, res) => {
  const chat = available() ? await assistant.history(req.user.user_id) : [];
  res.render('assistant', { chat, available: available(), configured: assistant.configured() });
});

router.post('/assistant', requireLogin, requireActive, perHour, perDay, async (req, res) => {
  if (!available()) {
    req.flash('error', 'The assistant is not available right now.');
    return res.redirect('/assistant');
  }
  const question = clean(req.body.question, { multiline: true });
  if (question.length < 2) {
    req.flash('error', 'Type a question first.');
    return res.redirect('/assistant');
  }
  if (question.length > A.maxUserChars) {
    req.flash('error', `Keep your question under ${A.maxUserChars} characters.`);
    return res.redirect('/assistant');
  }
  await assistant.ask(req.user.user_id, question);
  res.redirect('/assistant#latest');
});

router.post('/assistant/reset', requireLogin, async (req, res) => {
  await assistant.resetHistory(req.user.user_id);
  req.flash('success', 'Started a new conversation.');
  res.redirect('/assistant');
});

/* ----- JSON endpoints for the floating chat widget (same limits and checks as the page) ----- */
const pub = (m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', text: String(m.text || ''), drafts: (m.drafts || []).filter((d) => d && String(d.url || "").startsWith("/listings/new?")).map((d) => ({ title: d.title, url: d.url })) });

router.get('/assistant/state', requireLogin, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  if (!available()) return res.json({ available: false, chat: [] });
  res.json({ available: true, chat: (await assistant.history(req.user.user_id)).map(pub) });
});

router.post('/assistant/ask', requireLogin, requireActive, perHour, perDay, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  if (!available()) return res.status(503).json({ error: 'The AI assistant is not switched on yet.' });
  const question = clean(req.body.question, { multiline: true });
  if (question.length < 2) return res.status(400).json({ error: 'Type a question first.' });
  if (question.length > A.maxUserChars) return res.status(400).json({ error: `Keep your question under ${A.maxUserChars} characters.` });
  const out = await assistant.ask(req.user.user_id, question);
  res.json(pub({ role: 'assistant', text: out.text, drafts: out.drafts }));
});

router.post('/assistant/reset.json', requireLogin, async (req, res) => {
  await assistant.resetHistory(req.user.user_id);
  res.json({ ok: true });
});

module.exports = router;
