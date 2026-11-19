'use strict';
/** "Get the app": install CampusFind on the phone's Home Screen and switch on notifications. No app store needed. */
const { html } = require('../../lib/html');
const { page } = require('../layout');
const { icon, csrf, pushCard } = require('../components');

function getApp(req) {
  return page(req, {
    title: 'Get the app',
    description: 'Put CampusFind on your Home Screen and get a buzz for new messages, offers and price drops.',
    body: html`
      <div class="narrow">
        <div class="page-head"><div><h1>Get CampusFind on your phone</h1>
          <p class="muted">No app store and nothing to pay. It opens like an app, works on slow connections and can buzz you when someone replies.</p></div></div>

        <div class="card pad app-install" data-install-card>
          <h2>${icon('plus')} Add it to your Home Screen</h2>
          <button class="btn btn--primary" type="button" data-install hidden>${icon('plus')} Install CampusFind</button>
          <p class="small muted" data-installed hidden>${icon('check')} You are using the installed app.</p>
          <div class="app-steps">
            <section><h3>Android (Chrome)</h3>
              <ol><li>Tap <strong>Install CampusFind</strong> above, or open the <strong>⋮</strong> menu.</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li><li>Open CampusFind from the new icon.</li></ol></section>
            <section><h3>iPhone (Safari)</h3>
              <ol><li>Tap the <strong>Share</strong> button at the bottom of Safari.</li><li>Scroll and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li><li>Open CampusFind from the new icon. Notifications only work from there.</li></ol></section>
          </div>
        </div>

        ${req.user ? pushCard() : html`<div class="card pad"><h2>${icon('bell')} Phone notifications</h2><p class="muted small">Sign in to get a buzz for new messages, offers and price drops.</p><a class="btn btn--primary btn--sm" href="/login?next=/app">Sign in</a></div>`}
      </div>`,
  });
}

module.exports = { getApp };
