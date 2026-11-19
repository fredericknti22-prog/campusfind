'use strict';
/** Public "What's new" page: every change note, newest first. */
const { html } = require('../../lib/html');
const { page } = require('../layout');
const { icon } = require('../components');

const day = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function whatsNewPage(req, { notes }) {
  return page(req, {
    title: "What's new",
    description: 'Recent changes and new features on CampusFind.',
    body: html`
      <div class="narrow">
        <div class="page-head"><div><h1>What's new</h1><p class="muted">Changes and new features on CampusFind, newest first.</p></div></div>
        ${notes.length ? html`<ol class="wn-list">${notes.map((n) => html`<li class="card pad wn-note">
            <p class="eyebrow">${day(n.created_at)}</p><h2>${n.title}</h2>
            <ul class="wn-items">${n.items.map((x) => html`<li>${icon('check')}<span>${x}</span></li>`)}</ul></li>`)}</ol>`
          : html`<div class="empty">${icon('bell', 'icon--xl')}<h2>Nothing yet</h2><p>New features will be listed here.</p></div>`}
      </div>`,
  });
}

module.exports = { whatsNewPage };
