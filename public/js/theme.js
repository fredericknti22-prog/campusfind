/* Script error reporter: sends at most 3 short, anonymous reports per page to /errors/client. */
(function () {
  var sent = 0;
  var report = function (message, stack) {
    if (sent >= 3 || !message || !navigator.sendBeacon) return;
    if (/ResizeObserver loop|Script error\.?$/.test(message)) return; // harmless browser noise, or cross-origin with no detail
    sent += 1;
    try { navigator.sendBeacon('/errors/client', new Blob([JSON.stringify({ message: String(message).slice(0, 300), stack: String(stack || '').slice(0, 1500), path: location.pathname })], { type: 'text/plain' })); } catch (e) { /* never break the page */ }
  };
  window.addEventListener('error', function (e) { if (e.filename && e.filename.indexOf(location.origin) !== 0) return; report(e.message, e.error && e.error.stack); });
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason || {}; report(r.message || String(r), r.stack); });
})();

/* Runs before first paint (loaded synchronously in <head>) so there is no theme flash. */
(function () {
  var theme = null;
  try { theme = localStorage.getItem('cf-theme'); } catch (e) { /* storage blocked */ }
  if (theme !== 'dark' && theme !== 'light') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
  // side panel position and size, remembered per browser; applied here so the layout does not jump on load
  try {
    if (localStorage.getItem('cf-panel-side') === 'right') document.documentElement.setAttribute('data-panel-side', 'right');
    // admin pages have their own menu, so the site menu starts as an icon rail there unless the member expanded it
    var admin = location.pathname.indexOf('/admin') === 0;
    var folded = localStorage.getItem(admin ? 'cf-panel-collapsed-admin' : 'cf-panel-collapsed');
    if (folded === '1' || (admin && folded === null)) document.documentElement.setAttribute('data-panel-collapsed', '1');
  } catch (e) { /* storage blocked */ }
  // motion.js removes this once it has taken over the entrance animations (with a failsafe), so nothing flashes.
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!calm) document.documentElement.classList.add('motion-pending');
})();
