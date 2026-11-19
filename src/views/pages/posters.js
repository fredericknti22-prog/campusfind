'use strict';
/** Printable posters with QR codes: one per listing for sellers, and a launch kit of site posters for the team. */
const { html, raw } = require('../../lib/html');
const { page } = require('../layout');
const { icon, priceLabel } = require('../components');
const config = require('../../config');

const toolbar = (back, backLabel, note) => html`
  <div class="poster-bar no-print">
    <a class="btn btn--ghost btn--sm" href="${back}">${icon('arrow', 'icon--flip')} ${backLabel}</a>
    <p class="muted small">${note}</p>
    <button class="btn btn--primary btn--sm" type="button" data-print>${icon('print')} Print or save as PDF</button>
  </div>`;

const qrBlock = (svg, label, url) => html`
  <div class="poster__qr">
    <div class="poster__code" role="img" aria-label="${label}">${raw(svg)}</div>
    <p class="poster__url">${url.replace(/^https?:\/\//, '')}</p>
  </div>`;

function listingPoster(req, { l, image, qr, url }) {
  const price = priceLabel(l);
  return page(req, {
    title: `Poster: ${l.title}`, bare: true,
    body: html`
      ${toolbar(`/listings/${l.listing_id}`, 'Back to listing', 'Prints on one A4 sheet. Pin it on hall, faculty or library notice boards.')}
      <article class="poster">
        <p class="poster__eyebrow">${l.cat_name}</p>
        <h1 class="poster__title">${l.title}</h1>
        ${price ? html`<p class="poster__price">${price}</p>` : ''}
        ${image ? html`<img class="poster__photo" src="${image}" alt="">` : ''}
        ${l.location ? html`<p class="poster__meta">${icon('pin')} ${l.location}</p>` : ''}
        <div class="poster__foot">
          ${qrBlock(qr, `QR code linking to ${l.title} on CampusFind`, url)}
          <div class="poster__cta">
            <p class="poster__scan">Scan to see photos and message me on CampusFind</p>
            <p class="poster__fine">Chat inside the app. Your number stays private. Meet in a busy campus spot.</p>
            <img class="poster__logo" src="/img/logo.png" alt="CampusFind" width="125" height="41">
          </div>
        </div>
      </article>`,
  });
}

const DESIGNS = [
  { key: 'join', eyebrow: `For students at ${config.campusName}`, title: 'Buy, sell and find anything on campus', lines: ['Textbooks and notes', 'Hostels and roommates', 'Laptops, phones and gadgets', 'Tutoring, jobs and events'], scan: 'Scan to browse CampusFind', path: '/' },
  { key: 'sell', eyebrow: 'Got stuff you no longer need?', title: 'Sell it to students in 2 minutes', lines: ['Free to post', 'Snap a photo, set a price', 'Buyers message you in the app', 'Your number stays private'], scan: 'Scan to post your first listing', path: '/listings/new' },
  { key: 'lost', eyebrow: 'Lost & found', title: 'Lost something? Found something?', lines: ['Post a photo and where it was', 'Search what others have found', 'Message the finder safely', 'Mark it returned'], scan: 'Scan to open the lost & found board', path: '/lost-found' },
];

function launchKit(req, { posters }) {
  return page(req, {
    title: 'Launch kit', bare: true,
    body: html`
      ${toolbar('/admin', 'Back to admin', 'Three A4 posters, one per page. Print them, or save as PDF and share in WhatsApp groups.')}
      ${posters.map((p) => html`
      <article class="poster poster--site" id="poster-${p.key}">
        <img class="poster__logo poster__logo--top" src="/img/logo.png" alt="CampusFind" width="190" height="62">
        <p class="poster__eyebrow">${p.eyebrow}</p>
        <h1 class="poster__title">${p.title}</h1>
        <ul class="poster__list">${p.lines.map((x) => html`<li>${icon('check')} ${x}</li>`)}</ul>
        <div class="poster__foot">
          ${qrBlock(p.qr, `QR code: ${p.scan}`, p.url)}
          <div class="poster__cta"><p class="poster__scan">${p.scan}</p><p class="poster__fine">Moderated by the CampusFind team. Report anything that looks wrong.</p></div>
        </div>
      </article>`)}`,
  });
}

module.exports = { listingPoster, launchKit, DESIGNS };
