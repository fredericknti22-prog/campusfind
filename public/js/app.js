/* CampusFind progressive enhancement. Every feature still works without this file. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* theme toggle */
  // The toggle is a switch for dark mode, so expose its on/off state to screen readers (aria-pressed).
  var toggles = $$('[data-theme-toggle]');
  var syncToggles = function () {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    toggles.forEach(function (t) { t.setAttribute('aria-pressed', dark ? 'true' : 'false'); });
  };
  syncToggles();
  toggles.forEach(function (t) {
    t.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('cf-theme', next); } catch (e) { /* ignore */ }
      syncToggles();
    });
  });

  /* Escape closes an open account menu and puts focus back on its button */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    $$('details.menu[open]').forEach(function (d) {
      d.removeAttribute('open');
      var s = $('summary', d);
      if (s) s.focus();
    });
  });

  /* confirm destructive actions */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-confirm]');
    if (btn && !window.confirm(btn.getAttribute('data-confirm'))) e.preventDefault();
  });

  /* close the account menu when clicking elsewhere */
  document.addEventListener('click', function (e) {
    $$('details.menu[open]').forEach(function (d) { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });

  /* price input only matters for fixed / negotiable */
  var priceType = $('#f-price_type');
  var priceWrap = $('[data-price-field]');
  if (priceType && priceWrap) {
    var sync = function () { priceWrap.hidden = priceType.value !== 'fixed' && priceType.value !== 'negotiable'; };
    priceType.addEventListener('change', sync);
    sync();
  }

  /* show/hide conditional fields: data-show-when="name=value" */
  $$('[data-show-when]').forEach(function (box) {
    var parts = box.getAttribute('data-show-when').split('=');
    var name = parts[0], value = parts[1];
    var form = box.closest('form');
    var update = function () {
      var checked = form.querySelector('[name="' + name + '"]:checked');
      var el = checked || form.querySelector('select[name="' + name + '"]');
      box.hidden = !(el && el.value === value);
    };
    form.addEventListener('change', update);
    update();
  });

  /* character counters */
  $$('textarea[data-count]').forEach(function (ta) {
    var max = Number(ta.getAttribute('data-count'));
    var out = document.createElement('p');
    out.className = 'hint';
    out.setAttribute('aria-live', 'off');
    ta.parentNode.appendChild(out);
    var upd = function () { out.textContent = ta.value.length + ' / ' + max; };
    ta.addEventListener('input', upd);
    upd();
  });

  /* image picker: validate type / count, shrink big photos in the browser, then preview.
     Phones take 5-12 MB pictures; shrinking first keeps uploads fast and under the host's request-size limit. */
  var file = $('#f-images');
  if (file) {
    var box = $('[data-previews]');
    var maxBytes = Number(file.getAttribute('data-max'));
    var slots = Number(file.getAttribute('data-slots'));
    var MAX_SIDE = 1600;
    var SHRINK_ABOVE = 500 * 1024;

    var fail = function (message) {
      file.value = '';
      box.textContent = '';
      var p = document.createElement('p');
      p.className = 'error-text';
      p.setAttribute('role', 'alert');
      p.textContent = message;
      box.appendChild(p);
    };

    /* Resolve with a smaller JPEG File, or the original when shrinking is not possible or not worth it. */
    var shrink = function (f) {
      if (!window.createImageBitmap || !window.HTMLCanvasElement || f.size <= SHRINK_ABOVE) return Promise.resolve(f);
      return createImageBitmap(f).then(function (bmp) {
        var scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bmp.width * scale));
        canvas.height = Math.max(1, Math.round(bmp.height * scale));
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        if (bmp.close) bmp.close();
        return new Promise(function (resolve) {
          canvas.toBlob(function (blob) {
            if (!blob || blob.size >= f.size) return resolve(f);
            resolve(new File([blob], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
          }, 'image/jpeg', 0.82);
        });
      }).catch(function () { return f; });
    };

    file.addEventListener('change', function () {
      box.textContent = '';
      var files = Array.prototype.slice.call(file.files);
      if (!files.length) return;
      if (files.length > slots) return fail('You can add ' + slots + ' more photo' + (slots === 1 ? '' : 's') + '.');
      for (var i = 0; i < files.length; i++) {
        if (!/^image\/(jpeg|png|webp)$/.test(files[i].type)) return fail('Only JPG, PNG or WebP photos are allowed.');
      }
      var note = document.createElement('p');
      note.className = 'hint';
      note.textContent = 'Preparing photos…';
      box.appendChild(note);
      Promise.all(files.map(shrink)).then(function (small) {
        for (var j = 0; j < small.length; j++) {
          if (small[j].size > maxBytes) return fail('Each photo must be under ' + Math.round(maxBytes / 1048576) + ' MB.');
        }
        if (window.DataTransfer) {
          var dt = new DataTransfer();
          small.forEach(function (s) { dt.items.add(s); });
          file.files = dt.files;
        }
        box.textContent = '';
        small.forEach(function (s) {
          var img = document.createElement('img');
          img.alt = '';
          img.src = URL.createObjectURL(s);
          img.onload = function () { URL.revokeObjectURL(img.src); };
          box.appendChild(img);
        });
      });
    });
  }
  /* lost & found: show photo guidance when the Lost & Found category is chosen, and match it to "Lost:" / "Found:" titles */
  var lfForm = $('form[data-lf-category]');
  if (lfForm) {
    var catSel = $('#f-category_id', lfForm);
    var titleIn = $('#f-title', lfForm);
    var tip = $('[data-lf-tip]', lfForm);
    var legend = $('[data-photo-legend]', lfForm);
    var lfId = lfForm.getAttribute('data-lf-category');
    if (catSel && tip) {
      var syncTip = function () {
        var on = catSel.value === lfId;
        tip.hidden = !on;
        if (legend) legend.textContent = on ? 'Add a photo of the item' : 'Photos';
        var found = titleIn && /^found\b/i.test(titleIn.value.trim());
        var lost = $('.lf-tip__lost', tip);
        var fnd = $('.lf-tip__found', tip);
        if (lost) lost.hidden = !!found;
        if (fnd) fnd.hidden = !found;
      };
      catSel.addEventListener('change', syncTip);
      if (titleIn) titleIn.addEventListener('input', syncTip);
      syncTip();
    }
  }
  /* assistant: show progress while the answer is prepared, and jump to the newest message */
  var asking = $('[data-assistant-form]');
  if (asking) {
    asking.addEventListener('submit', function () {
      var b = $('[data-assistant-send]', asking);
      if (b) { b.disabled = true; b.textContent = 'Thinking…'; }
    });
  }
  var latest = $('#latest');
  if (latest && latest.scrollIntoView) latest.scrollIntoView({ block: 'nearest' });
  /* collapse the filter panel on phones so results appear first */
  var filters = $('.filters__box');
  if (filters && window.matchMedia('(max-width: 780px)').matches) filters.removeAttribute('open');

  /* toasts: dismiss button, auto-dismiss for non-errors (errors stay until dismissed) */
  function dismiss(el) {
    el.classList.add('is-leaving');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
  }
  $$('.flash').forEach(function (f) {
    var close = $('[data-dismiss]', f);
    if (close) close.addEventListener('click', function () { dismiss(f); });
    if (f.hasAttribute('data-autodismiss')) {
      var timer = setTimeout(function () { dismiss(f); }, 5000);
      var stop = function () { clearTimeout(timer); };
      f.addEventListener('mouseenter', stop);
      f.addEventListener('focusin', stop);
    }
  });

  /* after a failed submit, move focus to the error summary so keyboard and screen-reader users land on it */
  var summary = $('[data-error-summary]');
  if (summary) summary.focus();

  /* password show / hide */
  $$('[data-pw-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = document.getElementById(btn.getAttribute('aria-controls'));
      if (!input) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });

  /* sort control applies immediately (a no-JS fallback button exists) */
  $$('[data-autosubmit]').forEach(function (el) {
    el.addEventListener('change', function () { el.form.submit(); });
  });

  /* listing gallery: thumbnails swap the main photo; without JS they open the photo */
  var main = $('#gallery-main');
  if (main) {
    $$('[data-gallery-thumb]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        main.src = a.getAttribute('href');
        main.alt = a.getAttribute('data-alt') || '';
        $$('[data-gallery-thumb]').forEach(function (t) { t.classList.remove('is-active'); t.removeAttribute('aria-current'); });
        a.classList.add('is-active');
        a.setAttribute('aria-current', 'true');
      });
    });
  }

  /* submit feedback: show progress and block double submits */
  $$('form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (e.defaultPrevented) return;
      var submitter = e.submitter;
      form.setAttribute('aria-busy', 'true');
      setTimeout(function () {
        $$('button[type="submit"]', form).forEach(function (b) { b.disabled = true; });
        if (submitter && submitter.classList) submitter.classList.add('is-loading');
      }, 0);
    });
  });
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    $$('form[aria-busy]').forEach(function (f) { f.removeAttribute('aria-busy'); });
    $$('button[type="submit"]').forEach(function (b) { b.disabled = false; b.classList.remove('is-loading'); });
  });

  /* installable web app: service worker + install button */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* the site works fine without it */ });
    });
  }
  var deferredInstall = null;
  var installBtns = Array.prototype.slice.call(document.querySelectorAll('[data-install]'));
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstall = e;
    installBtns.forEach(function (b) { b.hidden = false; });
  });
  installBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      deferredInstall.userChoice.then(function () { deferredInstall = null; installBtns.forEach(function (x) { x.hidden = true; }); });
    });
  });
  window.addEventListener('appinstalled', function () { installBtns.forEach(function (x) { x.hidden = true; }); });

  /* side panel: drag by the grip to dock it left or right, collapse it to icons, open it as a drawer on phones.
     Buttons do everything a drag does, so it works by keyboard and touch too. Choices are remembered per browser. */
  (function () {
    var root = document.documentElement;
    var panel = $('#side-panel');
    if (!panel) return;
    var save = function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } };
    var grip = $('[data-panel-grip]', panel);
    var collapseBtn = $('[data-panel-collapse]', panel);
    var openBtn = $('[data-panel-open]');
    var scrim = $('.sp-scrim');
    var side = function () { return root.getAttribute('data-panel-side') === 'right' ? 'right' : 'left'; };
    var sync = function () {
      var other = side() === 'right' ? 'left' : 'right';
      $$('[data-panel-side-toggle], [data-panel-grip]', panel).forEach(function (b) { b.setAttribute('aria-label', 'Move the menu to the ' + other); });
      var collapsed = root.getAttribute('data-panel-collapsed') === '1';
      if (collapseBtn) { collapseBtn.setAttribute('aria-pressed', collapsed ? 'true' : 'false'); collapseBtn.setAttribute('aria-label', collapsed ? 'Expand the menu' : 'Collapse the menu'); }
    };
    var setSide = function (s) {
      if (s === 'right') root.setAttribute('data-panel-side', 'right'); else root.removeAttribute('data-panel-side');
      save('cf-panel-side', s); sync();
    };
    sync();
    $$('[data-panel-side-toggle]', panel).forEach(function (b) { b.addEventListener('click', function () { setSide(side() === 'right' ? 'left' : 'right'); }); });
    if (collapseBtn) collapseBtn.addEventListener('click', function () {
      var c = root.getAttribute('data-panel-collapsed') === '1';
      if (c) root.removeAttribute('data-panel-collapsed'); else root.setAttribute('data-panel-collapsed', '1');
      save(location.pathname.indexOf('/admin') === 0 ? 'cf-panel-collapsed-admin' : 'cf-panel-collapsed', c ? '0' : '1'); sync();
    });

    // drag the grip: the panel follows the pointer, then docks to whichever half of the screen it is dropped on
    if (grip) {
      var startX = 0; var dragging = false; var moved = false;
      grip.addEventListener('pointerdown', function (e) {
        if (window.matchMedia('(max-width: 1000px)').matches || e.button !== 0) return;
        dragging = true; moved = false; startX = e.clientX; grip.setPointerCapture(e.pointerId);
      });
      grip.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        var dx = e.clientX - startX;
        if (!moved && Math.abs(dx) < 8) return; // a click, not a drag
        moved = true; panel.classList.add('is-dragging');
        panel.style.transform = 'translateX(' + dx + 'px)';
        root.setAttribute('data-panel-target', e.clientX > window.innerWidth / 2 ? 'right' : 'left');
      });
      var end = function (e) {
        if (!dragging) return;
        dragging = false;
        panel.classList.remove('is-dragging'); panel.style.transform = ''; root.removeAttribute('data-panel-target');
        if (moved) { setSide(e.clientX > window.innerWidth / 2 ? 'right' : 'left'); grip.dataset.skipClick = '1'; }
      };
      grip.addEventListener('pointerup', end);
      grip.addEventListener('pointercancel', end);
      grip.addEventListener('click', function () {
        if (grip.dataset.skipClick) { delete grip.dataset.skipClick; return; }
        setSide(side() === 'right' ? 'left' : 'right'); // click or Enter: switch sides
      });
    }

    // phones: drawer
    var open = function () {
      root.classList.add('panel-open'); if (scrim) scrim.hidden = false;
      if (openBtn) openBtn.setAttribute('aria-expanded', 'true');
      var first = $('.sp-link', panel); if (first) first.focus();
    };
    var close = function () {
      if (!root.classList.contains('panel-open')) return;
      root.classList.remove('panel-open'); if (scrim) scrim.hidden = true;
      if (openBtn) { openBtn.setAttribute('aria-expanded', 'false'); openBtn.focus(); }
    };
    if (openBtn) openBtn.addEventListener('click', open);
    $$('[data-panel-close]').forEach(function (b) { b.addEventListener('click', close); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  })();

  /* chat: Ctrl/Cmd+Enter sends, the log stays scrolled to the newest message, and new messages arrive live.
     The server returns plain text; it is inserted with textContent, never as HTML. */
  $$('[data-chat-input]').forEach(function (ta) {
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ta.form && ta.value.trim().length > 1) { e.preventDefault(); ta.form.requestSubmit ? ta.form.requestSubmit() : ta.form.submit(); }
    });
  });
  $$('[data-chat-poll]').forEach(function (log) {
    var url = log.getAttribute('data-chat-poll');
    var since = Number(log.getAttribute('data-since')) || 0;
    var stick = function () { log.scrollTop = log.scrollHeight; };
    var nearBottom = function () { return log.scrollHeight - log.scrollTop - log.clientHeight < 80; };
    stick();
    if (location.hash === '#latest' || location.hash === '#chat') { var last = $('#latest'); if (last) last.scrollIntoView({ block: 'nearest' }); }
    var busy = false; var delay = 5000; var timer = null;
    var add = function (m) {
      if (log.querySelector('[data-id="' + m.id + '"]')) return;
      var empty = log.querySelector('.chat-log__empty'); if (empty) empty.remove();
      var li = document.createElement('li');
      li.className = 'bubble' + (m.mine ? ' bubble--me' : '');
      li.setAttribute('data-id', m.id);
      var p = document.createElement('p'); p.className = 'prewrap'; p.textContent = m.body;
      var meta = document.createElement('span'); meta.className = 'bubble__meta';
      meta.textContent = (m.who || (m.mine ? 'You' : log.getAttribute('data-other') || 'Them')) + ' · just now';
      li.appendChild(p); li.appendChild(meta);
      (m.warn || []).forEach(function (w) {
        var n = document.createElement('p'); n.className = 'bubble__warn'; n.setAttribute('role', 'note');
        var t = document.createElement('span'); t.textContent = w; n.appendChild(t); li.appendChild(n);
      });
      log.appendChild(li);
    };
    var poll = function () {
      if (busy || document.hidden) { timer = setTimeout(poll, delay); return; }
      busy = true;
      fetch(url + '?since=' + since, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : { messages: [] }; })
        .then(function (data) {
          var keep = nearBottom();
          (data.messages || []).forEach(function (m) { add(m); since = Math.max(since, m.at); });
          if (keep && data.messages && data.messages.length) stick();
          delay = data.messages && data.messages.length ? 4000 : Math.min(delay + 1000, 15000); // back off when quiet
        })
        .catch(function () { delay = 15000; })
        .then(function () { busy = false; timer = setTimeout(poll, delay); });
    };
    timer = setTimeout(poll, delay);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { clearTimeout(timer); delay = 3000; poll(); } });
  });
})();

/* Share buttons on listings: copy the link, and the phone's own share sheet where the browser has one. */
(function () {
  document.addEventListener('click', function (e) {
    var copy = e.target.closest && e.target.closest('[data-copy]');
    if (!copy) return;
    var url = copy.getAttribute('data-copy');
    var label = copy.querySelector('span') || copy;
    var done = function (ok) {
      var before = label.textContent;
      label.textContent = ok ? 'Link copied' : 'Copy failed';
      setTimeout(function () { label.textContent = before; }, 2000);
    };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = url; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove(); done(ok);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { done(true); }, fallback);
    else fallback();
  });
  if (navigator.share) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-share]'), function (b) {
      b.hidden = false;
      b.addEventListener('click', function () {
        navigator.share({ title: b.getAttribute('data-share-title'), text: b.getAttribute('data-share-text'), url: b.getAttribute('data-share-url') }).catch(function () { /* closed */ });
      });
    });
  }
})();

/* Poster pages: print button (inline handlers are blocked by the content security policy) */
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-print]');
  if (b) window.print();
});

/* Quick messages on a listing: fill the message box in one tap (hidden without JavaScript) */
(function () {
  Array.prototype.forEach.call(document.querySelectorAll('[data-quick]'), function (box) { box.hidden = false; });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-fill]');
    if (!b) return;
    var t = document.getElementById(b.getAttribute('data-fill-target'));
    if (!t) return;
    t.value = b.getAttribute('data-fill');
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  });
})();

/* Admin tables on phones: give every cell its column name, so CSS can show each row as a labelled card. */
(function () {
  Array.prototype.forEach.call(document.querySelectorAll('.table-wrap > .table'), function (table) {
    var heads = Array.prototype.map.call(table.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
    if (!heads.length) return;
    table.classList.add('table--cards');
    Array.prototype.forEach.call(table.querySelectorAll('tbody tr'), function (tr) {
      Array.prototype.forEach.call(tr.children, function (td, i) { if (heads[i] && !td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i]); });
    });
  });
})();

/* Phone notifications switch (Profile). Needs a service worker and Push support; iPhone only from the Home Screen app. */
(function () {
  var card = document.querySelector('[data-push]');
  if (!card) return;
  var on = card.querySelector('[data-push-on]'), off = card.querySelector('[data-push-off]'), status = card.querySelector('[data-push-status]');
  var ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  var csrf = (document.querySelector('input[name="_csrf"]') || {}).value || '';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (ios && !standalone) { card.hidden = false; on.hidden = true; card.querySelector('[data-push-ios]').hidden = false; }
    return;
  }
  card.hidden = false;
  var b64 = function (s) { var p = '='.repeat((4 - s.length % 4) % 4); var raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); var a = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i); return a; };
  var post = function (url, sub) { return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '_csrf=' + encodeURIComponent(csrf) + '&subscription=' + encodeURIComponent(JSON.stringify(sub)) }); };
  var show = function (isOn, msg) { on.hidden = isOn; off.hidden = !isOn; if (msg) status.textContent = msg; };
  navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (s) { if (s) show(true, 'On for this phone. You will get a buzz for new messages, offers and price drops.'); });
  on.addEventListener('click', function () {
    on.disabled = true;
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { on.disabled = false; status.textContent = 'Notifications are blocked for CampusFind. Allow them in your browser or phone settings, then try again.'; return null; }
      return Promise.all([navigator.serviceWorker.ready, fetch('/push/key', { credentials: 'same-origin' }).then(function (r) { return r.json(); })]).then(function (x) {
        return x[0].pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(x[1].key) });
      }).then(function (sub) { return post('/push/subscribe', sub); }).then(function (r) {
        on.disabled = false;
        if (r && r.ok) show(true, 'On for this phone. You will get a buzz for new messages, offers and price drops.');
        else status.textContent = 'Could not turn it on. Please try again.';
      });
    }).catch(function () { on.disabled = false; status.textContent = 'Could not turn it on on this browser.'; });
  });
  off.addEventListener('click', function () {
    navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (s) {
      if (!s) return show(false, 'Off for this phone.');
      return post('/push/unsubscribe', s).then(function () { return s.unsubscribe(); }).then(function () { show(false, 'Off for this phone.'); });
    });
  });
})();

/* Get-the-app nudge (phones, browser not installed app, not dismissed in the last 30 days) and the chat hint */
(function () {
  var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  var phone = window.matchMedia('(max-width: 760px)').matches && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  var installed = document.querySelector('[data-installed]'); if (installed && standalone) installed.hidden = false;
  var nudge = document.querySelector('[data-app-nudge]');
  var KEY = 'cf-app-nudge';
  var dismissed = 0; try { dismissed = Number(localStorage.getItem(KEY)) || 0; } catch (e) { dismissed = 0; }
  if (nudge && phone && !standalone && Date.now() - dismissed > 30 * 864e5) nudge.hidden = false;
  var x = document.querySelector('[data-app-nudge-x]');
  if (x) x.addEventListener('click', function () { nudge.hidden = true; try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* private mode */ } });
  var hint = document.querySelector('[data-push-hint]');
  if (!hint) return;
  var ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (ios && !standalone) { hint.hidden = false; return; }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || Notification.permission === 'denied') return;
  navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (s) { if (!s) hint.hidden = false; }).catch(function () {});
})();
