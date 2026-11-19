/* Floating help and AI chat widget (markup: src/views/chatWidget.js). All text is inserted with textContent. */
(function () {
  'use strict';
  var root = document.querySelector('[data-aw]');
  if (!root) return;
  var fab = root.querySelector('[data-aw-toggle]');
  var panel = root.querySelector('#aw-panel');
  var member = root.hasAttribute('data-aw-member');
  var loaded = false; var teamSince = 0; var pollTimer = null; var tab = 'ai'; var aiOn = true;

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return null; }
  function $(sel) { return root.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

  function isOpen() { return !panel.hidden; }
  function open(which) {
    if (which) select(which);
    panel.hidden = false; root.classList.add('is-open'); fab.setAttribute('aria-expanded', 'true');
    if (member && !loaded) { loaded = true; load(); }
    startPoll();
    var ta = $('[data-aw-pane="' + tab + '"] textarea'); if (ta) setTimeout(function () { ta.focus(); }, 60);
  }
  function close() {
    panel.hidden = true; root.classList.remove('is-open'); fab.setAttribute('aria-expanded', 'false');
    stopPoll(); fab.focus();
  }
  function select(which) {
    tab = which === 'team' ? 'team' : 'ai'; store('cf-aw-tab', tab);
    $$('[data-aw-tab]').forEach(function (b) {
      var on = b.getAttribute('data-aw-tab') === tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
    });
    $$('[data-aw-pane]').forEach(function (p) { p.hidden = p.getAttribute('data-aw-pane') !== tab; });
    if (tab === 'team') { var d = $('[data-aw-teamdot]'); if (d) d.hidden = true; }
    scrollLog(tab);
  }

  fab.addEventListener('click', function (e) { e.preventDefault(); if (isOpen()) close(); else open(); });
  $('[data-aw-close]').addEventListener('click', close);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) close(); });
  $$('[data-aw-tab]').forEach(function (b) {
    b.addEventListener('click', function () { select(b.getAttribute('data-aw-tab')); });
    b.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { var next = tab === 'ai' ? 'team' : 'ai'; select(next); $('[data-aw-tab="' + next + '"]').focus(); }
    });
  });
  // any element on the page can open the widget, e.g. the help centre buttons
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-aw-open]');
    if (!t) return; e.preventDefault(); open(t.getAttribute('data-aw-open'));
  });
  var saved = store('cf-aw-tab'); if (saved) select(saved);

  /* ---------- rendering ---------- */
  function scrollLog(which) { var log = $('[data-aw-log="' + which + '"]'); if (log) log.scrollTop = log.scrollHeight; }
  function add(which, role, text, extra) {
    var log = $('[data-aw-log="' + which + '"]');
    var li = document.createElement('li');
    li.className = 'aw-msg ' + (role === 'me' ? 'aw-msg--me' : 'aw-msg--bot');
    if (extra && extra.who) { var w = document.createElement('span'); w.className = 'aw-msg__who'; w.textContent = extra.who; li.appendChild(w); }
    var p = document.createElement('p'); p.textContent = text; li.appendChild(p);
    (extra && extra.drafts || []).forEach(function (d) {
      if (typeof d.url !== 'string' || d.url.indexOf('/listings/new?') !== 0) return;
      var a = document.createElement('a'); a.className = 'aw-draft'; a.href = d.url;
      a.textContent = 'Review draft: ' + (d.title || 'your listing'); li.appendChild(a);
    });
    log.appendChild(li); scrollLog(which); return li;
  }
  function typing(which) {
    var log = $('[data-aw-log="' + which + '"]');
    var li = document.createElement('li'); li.className = 'aw-msg aw-msg--bot aw-msg--typing';
    li.setAttribute('aria-label', 'Assistant is typing');
    for (var i = 0; i < 3; i++) li.appendChild(document.createElement('span'));
    log.appendChild(li); scrollLog(which); return li;
  }
  function getJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { if (!r.ok) throw r; return r.json(); });
  }
  function postForm(form, data) {
    var body = new URLSearchParams();
    body.set('_csrf', form.querySelector('input[name="_csrf"]').value);
    Object.keys(data).forEach(function (k) { body.set(k, data[k]); });
    return fetch(form.getAttribute('action').replace(/^\/assistant$/, '/assistant/ask'), {
      method: 'POST', credentials: 'same-origin', body: body,
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    }).then(function (r) {
      if (r.status === 429) throw new Error('You are sending messages quickly. Wait a minute and try again.');
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.'); return j; });
    });
  }

  /* ---------- loading ---------- */
  function load() {
    getJSON('/assistant/state').then(function (s) {
      if (!s.available) { aiOn = false; disableAI(); return; }
      if (s.chat.length) { var c = $('[data-aw-chips]'); if (c) c.hidden = true; }
      s.chat.forEach(function (m) { add('ai', m.role === 'user' ? 'me' : 'bot', m.text, { drafts: m.drafts }); });
    }).catch(function () { aiOn = false; disableAI(); });
    pollTeam(true);
  }
  function disableAI() {
    var pane = $('[data-aw-pane="ai"]');
    add('ai', 'bot', 'The AI assistant is not switched on yet. The CampusFind team can help you in the other tab.');
    pane.querySelector('textarea').disabled = true; pane.querySelector('.aw-send').disabled = true;
    var c = $('[data-aw-chips]'); if (c) c.hidden = true;
    if (!store('cf-aw-tab')) select('team');
  }
  function pollTeam(first) {
    if (!member) return;
    getJSON('/help/updates?since=' + teamSince).then(function (j) {
      (j.messages || []).forEach(function (m) {
        if (document.querySelector('[data-aw-log="team"] [data-id="' + m.id + '"]')) return;
        var li = add('team', m.mine ? 'me' : 'bot', m.body, { who: m.mine ? '' : m.who });
        li.setAttribute('data-id', m.id);
        if (!m.mine && !first && tab !== 'team') { var d = $('[data-aw-teamdot]'); if (d) d.hidden = false; }
        teamSince = Math.max(teamSince, m.at || 0);
      });
    }).catch(function () { /* offline: try again on the next tick */ });
  }
  function startPoll() { stopPoll(); if (member) pollTimer = setInterval(function () { if (!document.hidden) pollTeam(false); }, 10000); }
  function stopPoll() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  /* ---------- sending ---------- */
  function grow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; }
  $$('[data-aw-form]').forEach(function (form) {
    var which = form.getAttribute('data-aw-form');
    var ta = form.querySelector('textarea'); var btn = form.querySelector('.aw-send'); var busy = false;
    ta.addEventListener('input', function () { grow(ta); });
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); } });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = ta.value.trim(); if (text.length < 2 || busy) return;
      if (which === 'ai' && !aiOn) return;
      busy = true; btn.disabled = true; ta.value = ''; grow(ta);
      var c = $('[data-aw-chips]'); if (c && which === 'ai') c.hidden = true;
      var mine = add(which, 'me', text);
      var dots = which === 'ai' ? typing('ai') : null;
      postForm(form, which === 'ai' ? { question: text } : { body: text }).then(function (j) {
        if (dots) dots.remove();
        if (which === 'ai') add('ai', 'bot', j.text, { drafts: j.drafts });
        else { mine.remove(); pollTeam(false); }
      }).catch(function (err) {
        if (dots) dots.remove();
        mine.classList.add('aw-msg--failed');
        add(which, 'bot', err.message || 'Could not send. Check your connection and try again.');
        ta.value = text; grow(ta);
      }).then(function () { busy = false; btn.disabled = false; ta.focus(); });
    });
  });
  $$('[data-aw-suggest]').forEach(function (b) {
    b.addEventListener('click', function () {
      var form = $('[data-aw-form="ai"]'); var ta = form.querySelector('textarea');
      ta.value = b.textContent; form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
    });
  });
})();
