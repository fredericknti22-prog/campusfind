'use strict';
const { html, raw } = require('../../lib/html');
const config = require('../../config');
const { page } = require('../layout');
const { shell } = require('./admin');
const { icon, csrf, timeAgo } = require('../components');
const { money } = require('../../services/payments');

const STATUS = {
  pending: ['Waiting for payment', 'warn'], awaiting_payment: ['Awaiting your payment', 'warn'], paid: ['Paid', 'ok'],
  cancelled: ['Cancelled', 'muted'], refunded: ['Refunded', 'muted'], failed: ['Not completed', 'muted'],
};
/** Order chip that also says when the member has reported paying and staff are checking. */
const orderChip = (o) => (o.status === 'paid' && o.needs_listing ? html`<span class="chip chip--warn">Paid · choose a listing</span>` : o.status === 'awaiting_payment' && o.claimed_at ? html`<span class="chip chip--tone">Checking payment</span>`
  : o.status === 'cancelled' && o.cancel_reason === 'expired' ? html`<span class="chip chip--tone">Expired, not paid</span>` : statusChip(o.status));
const statusChip = (s) => { const [label, tone] = STATUS[s] || [s, 'muted']; return html`<span class="chip chip--${tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'tone'}">${label}</span>`; };

/* ---------------------------------------------------------------- public price list */
function pricing(req, { products, online }) {
  const rows = [
    { name: 'Basic student listing', price: 'Free', note: 'Every member can post, within the daily limit.', points: ['Listed in browse and search', 'Photos, messages and reports included'], cta: 'Post a free listing', href: '/listings/new' },
    ...products.map((p) => ({ name: p.name, price: money(p.price), note: `${p.days} days · one-off payment`, points: p.includes, key: p.key, cta: `Pay ${money(p.price)}`, href: '/pricing' })),
  ];
  const go = (href) => (req.user ? href : `/login?next=${encodeURIComponent(href)}`);
  return page(req, {
    title: 'Pricing', active: 'pricing',
    description: 'CampusFind is free for students. Optional promotions start at GH₵10.',
    body: html`
      <header class="doc__head"><p class="eyebrow">Pricing</p><h1>Free for students. Promote when you need more eyes.</h1>
        <p class="lead">Posting a listing costs nothing. Promotions are optional, paid once, and never renew by themselves.</p></header>

      <div class="plans">
        ${rows.map((r) => html`<article class="card plan${r.key === 'premium' ? ' plan--top' : ''}">
          <h2>${r.name}</h2>
          <p class="plan__price">${r.price}</p>
          <p class="muted small">${r.note}</p>
          <ul class="plan__list">${r.points.map((x) => html`<li>${icon('check')} ${x}</li>`)}</ul>
          ${r.key && req.user ? html`<form method="post" action="/pricing/${r.key}/buy">${csrf(req)}<button class="btn btn--primary btn--block plan__cta" type="submit">${icon('star')} ${r.cta}</button></form>`
            : html`<a class="btn ${r.key ? 'btn--primary' : 'btn--ghost'} btn--block plan__cta" href="${go(r.href)}">${r.key ? icon('star') : icon('plus')} ${r.key ? `Sign in to pay` : r.cta}</a>`}
          ${r.key ? html`<p class="muted xsmall center">Pay first. Once your payment is confirmed you choose which listing to promote.</p>` : ''}
        </article>`)}
      </div>

      <section class="card pad pro-perks" aria-labelledby="h-pro">
        <h2 id="h-pro">${icon('star')} Every paid plan makes you a Pro seller</h2>
        <p class="muted small">For as long as your promotion runs:</p>
        <ul class="plan__list pro-perks__list">
          <li>${icon('check')} <strong>Gold “Pro seller” badge</strong> on your profile, listings and seller box</li>
          <li>${icon('check')} <strong>10 photos</strong> per listing instead of 4</li>
          <li>${icon('check')} <strong>Listings stay live</strong> for the whole period, with no renewing</li>
          <li>${icon('check')} <strong>Listing stats</strong>: views, saves and chats for every listing</li>
        </ul>
      </section>

      <section class="card form-card stack pricing-notes" aria-labelledby="h-terms">
        <h2 id="h-terms">What you should know before you pay</h2>
        <ul>
          <li><strong>One-off, no automatic renewal.</strong> You pay once for the period shown. We never charge you again unless you choose to buy again.</li>
          <li><strong>Prices are in Ghana cedis (${config.currency.code}).</strong> The price you see next to the button is the price you pay.</li>
          <li><strong>${online ? 'Pay by Mobile Money or card through Paystack.' : 'Pay by Mobile Money.'}</strong> ${online ? 'We never see or store your card or Mobile Money details.' : 'After you choose a promotion you get the payment details and an order number, and an admin switches the promotion on once your payment arrives.'}</li>
          <li><strong>Promotions follow the rules.</strong> Payment never overrides moderation. A promoted listing that breaks the <a href="/rules">Community rules</a> can still be removed.</li>
          <li><strong>Refunds.</strong> If we cannot deliver a promotion we refund you. Otherwise a promotion that is already live is not refundable. See the <a href="/terms">Terms of use</a>.</li>
        </ul>
        <div class="row row--wrap"><a class="btn btn--primary" href="/my/listings">${icon('star')} Promote a listing</a><a class="btn btn--ghost" href="/listings/new">Post a free listing</a></div>
      </section>`,
  });
}

/* ---------------------------------------------------------------- choose a promotion */
function promote(req, { l, products, online, forBusiness = false }) {
  return page(req, {
    title: 'Promote your listing', active: 'mine',
    body: html`
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/my/listings">My listings</a> ${icon('arrow')} <span>Promote</span></nav>
      <div class="page-head"><div><h1>Promote your listing</h1>
        <p class="muted">Listing: <strong>${l.title}</strong></p>
        <p class="muted">Each promotion is a one-off payment and does not renew by itself.</p></div></div>
      ${forBusiness ? html`<div class="banner banner--info">${icon('store')}<div><strong>Pay to publish your business.</strong> Your listing is saved. It goes live as soon as your Business advertisement payment is confirmed, and you become a Pro seller for the same period.</div></div>` : ''}
      <div class="plans">
        ${products.map((p) => html`<article class="card plan${p.key === 'premium' ? ' plan--top' : ''}">
          <h2>${p.name}</h2><p class="muted small">${p.tagline}</p>
          <p class="plan__price">${money(p.price)}</p>
          <ul class="plan__list">${p.includes.map((x) => html`<li>${icon('check')} ${x}</li>`)}</ul>
          <form method="post" action="/listings/${l.listing_id}/promote">${csrf(req)}<input type="hidden" name="product" value="${p.key}">
            <button class="btn btn--primary btn--block" type="submit">${online ? 'Pay' : 'Order for'} ${money(p.price)} · ${p.days} days</button>
            <p class="muted xsmall center">One-off payment. No automatic renewal.</p></form>
        </article>`)}
      </div>
      <p class="muted small">${online ? 'You will be taken to Paystack to pay by Mobile Money or card.' : 'You will get an order number and payment instructions on the next page.'} See <a href="/pricing">pricing</a> and the <a href="/terms">terms</a>.</p>`,
  });
}

/* ---------------------------------------------------------------- one order */
function orderDetail(req, { order, instructions, momo = {}, choices = [] }) {
  const manualDue = order.provider === 'manual' && order.status === 'awaiting_payment';
  return page(req, {
    title: `Order #${order.order_id}`, active: 'mine',
    body: html`
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/orders">My orders</a> ${icon('arrow')} <span>Order #${order.order_id}</span></nav>
      <div class="page-head"><div><h1>Order #${order.order_id}</h1><p class="muted">${order.product_name}${order.listing_title ? html` for “${order.listing_title}”` : ' (you choose the listing after payment)'}</p></div>${orderChip(order)}</div>
      <section class="card form-card stack">
        <dl class="facts">
          <div><dt>Amount</dt><dd><strong>${money(order.amount)}</strong> (${order.currency}), one-off</dd></div>
          <div><dt>Duration</dt><dd>${order.days} days from the moment it is paid</dd></div>
          <div><dt>Payment reference</dt><dd><code>${order.reference}</code></dd></div>
          <div><dt>Created</dt><dd>${timeAgo(order.created_at)}</dd></div>
          ${order.paid_at ? html`<div><dt>Paid</dt><dd>${timeAgo(order.paid_at)}</dd></div>` : ''}
        </dl>
        ${manualDue ? html`<div class="banner banner--info">${icon('alert')}<div>
          <strong>How to pay</strong>
          ${momo.number ? html`<dl class="facts">
            <div><dt>Mobile Money number</dt><dd><strong>${momo.number}</strong></dd></div>
            ${momo.name ? html`<div><dt>Account name</dt><dd>${momo.name}</dd></div>` : ''}
            ${momo.network ? html`<div><dt>Network</dt><dd>${momo.network}</dd></div>` : ''}
          </dl>` : ''}
          ${instructions ? html`<p class="prewrap">${instructions}</p>` : ''}
          ${!momo.number && !instructions ? html`<p>Payment details are not published yet. Message the CampusFind team in the <a href="/help">Help centre</a> to arrange payment.</p>` : ''}
          <p><strong>Only pay the number shown on this page.</strong> Never share your Mobile Money PIN or a code sent to your phone. CampusFind staff will never ask for them.</p>
          <p>Use <strong>${order.reference}</strong> as your payment reference and pay exactly <strong>${money(order.amount)}</strong>. An admin switches your promotion on once the payment arrives.</p>
          ${order.claimed_at ? '' : html`<p class="small muted">Unpaid orders are cancelled automatically after ${require('../../services/payments').STALE_DAYS} days. Nothing is charged.</p>`}</div></div>
          ${order.claimed_at
            ? html`<div class="banner banner--info" id="paid">${icon('clock')}<div><strong>Thanks, we are checking your payment.</strong> You gave transaction ID <code>${order.payer_ref}</code> ${timeAgo(order.claimed_at)}. Your promotion switches on as soon as an admin confirms it.</div></div>`
            : momo.number ? html`<form class="card pad stack paid-form" id="paid" method="post" action="/orders/${order.order_id}/paid">${csrf(req)}
                <h2 class="h3">Already sent the money?</h2>
                <p class="muted small">Enter the transaction ID from the Mobile Money confirmation message so we can match your payment quickly.</p>
                <div class="paid-form__row"><label class="sr-only" for="f-payer-ref">Mobile Money transaction ID</label>
                  <input id="f-payer-ref" type="text" inputmode="text" autocapitalize="characters" spellcheck="false" name="payer_ref" required minlength="4" maxlength="40" autocomplete="off" placeholder="e.g. 1234567890">
                  <button class="btn btn--primary" type="submit">${icon('check')} I have sent the money</button></div>
                <p class="xsmall muted">Only the transaction ID. Never your PIN or a code sent to your phone.</p>
              </form>` : ''}
          <form method="post" action="/orders/${order.order_id}/cancel">${csrf(req)}<button class="btn btn--ghost" type="submit">Cancel this order</button></form>` : ''}
        ${order.status === 'pending' ? html`<div class="banner banner--info">${icon('clock')}<div>We are waiting for confirmation from Paystack. If you have paid, your promotion switches on automatically within a few minutes.</div></div>` : ''}
        ${order.status === 'paid' && order.needs_listing ? html`<section class="card pad stack apply-card" id="apply"><h2>${icon('star')} Payment received. Choose the listing to promote</h2>
          <p class="muted small">The ${order.days} days start when you choose. Your Pro seller perks are already on.</p>
          ${choices.length ? html`<form method="post" action="/orders/${order.order_id}/apply" class="stack">${csrf(req)}
            <div class="choices">${choices.map((l, i) => html`<label class="choice"><input type="radio" name="listing_id" value="${l.listing_id}"${i === 0 ? raw(' checked') : ''} required><span><strong>${l.title}</strong><small>${l.awaiting_payment ? 'Waiting for payment, goes live now' : 'Live'}</small></span></label>`)}</div>
            <button class="btn btn--primary" type="submit">${icon('check')} Promote this listing</button></form>`
          : html`<p>You have no live listings yet. <a href="/listings/new">Post one</a>, then come back to this order to use your payment.</p>`}
        </section>` : ''}
        ${order.status === 'paid' && !order.needs_listing && order.listing_id ? html`<a class="btn btn--primary" href="/listings/${order.listing_id}">${icon('arrow')} View your promoted listing</a>` : ''}
        ${order.status === 'cancelled' && order.cancel_reason === 'expired' ? html`<div class="banner banner--info">${icon('clock')}<div>This order expired because no payment arrived within ${require('../../services/payments').STALE_DAYS} days. Nothing was charged. <a href="/listings/${order.listing_id}/promote">Order again</a> if you still want the promotion.</div></div>` : ''}
      </section>`,
  });
}

function myOrders(req, { items }) {
  return page(req, {
    title: 'My orders', active: 'mine',
    body: html`
      <div class="page-head"><div><h1>My orders</h1><p class="muted">Your promotion payments. Prices are in Ghana cedis.</p></div><a class="btn btn--ghost" href="/pricing">View pricing</a></div>
      ${items.length
        ? html`<ul class="manage">${items.map((o) => html`<li class="card manage__row"><div class="manage__main">
            <p class="manage__title"><a href="/orders/${o.order_id}">Order #${o.order_id}</a> ${orderChip(o)}</p>
            <p class="muted small">${o.product_name} · ${o.listing_title ? html`“${o.listing_title}”` : o.status === 'paid' && o.needs_listing ? html`<strong>choose a listing</strong>` : 'listing chosen after payment'} · ${money(o.amount)} · ${timeAgo(o.created_at)}</p></div></li>`)}</ul>`
        : html`<div class="empty">${icon('tag', 'icon--xl')}<h2>No orders yet</h2><p>Promote a listing to get more views.</p><a class="btn btn--primary" href="/my/listings">Promote a listing</a></div>`}`,
  });
}

/* ---------------------------------------------------------------- admin */
function adminOrders(req, { items, revenue30, paidCount30, waiting, claimed = 0 }) {
  return shell(req, {
    title: 'Orders', active: 'orders',
    body: html`
      <div class="page-head"><div><h1>Orders</h1><p class="muted">Paid promotions. Online payments confirm themselves. Manual payments need your confirmation.</p></div></div>
      <div class="kpis">
        <div class="kpi"><p class="kpi__n">${money(revenue30)}</p><p class="kpi__l">paid in the last 30 days</p></div>
        <div class="kpi"><p class="kpi__n">${paidCount30}</p><p class="kpi__l">paid orders (30 days)</p></div>
        <div class="kpi${waiting ? ' kpi--alert' : ''}"><p class="kpi__n">${waiting}</p><p class="kpi__l">waiting for payment</p></div>
        <div class="kpi${claimed ? ' kpi--alert' : ''}"><p class="kpi__n">${claimed}</p><p class="kpi__l">members say they paid: check your MoMo</p></div>
      </div>
      ${items.length ? html`<div class="table-wrap card"><table class="table"><thead><tr><th>#</th><th>When</th><th>Member</th><th>Promotion</th><th>Amount</th><th>Via</th><th>Status</th><th></th></tr></thead><tbody>
        ${items.map((o) => html`<tr>
          <td>${o.order_id}<br><code class="xsmall">${o.reference}</code></td>
          <td>${timeAgo(o.created_at)}</td>
          <td>${o.who ? html`<a href="/admin/users/${o.who.user_id}">${o.who.name}</a>` : 'Deleted user'}</td>
          <td>${o.product_name}<br>${o.listing_id ? html`<a class="small" href="/listings/${o.listing_id}">${o.listing_title}</a>` : html`<span class="small muted">Pay first · listing chosen after payment</span>`}</td>
          <td>${money(o.amount)}</td><td>${o.provider}</td><td>${orderChip(o)}${o.claimed_at && o.status === 'awaiting_payment' ? html`<br><span class="xsmall muted">Member says paid ${timeAgo(o.claimed_at)}<br>MoMo ID <code>${o.payer_ref}</code></span>` : ''}${o.payer_ref && o.status !== 'awaiting_payment' ? html`<br><span class="xsmall muted">MoMo ID <code>${o.payer_ref}</code></span>` : ''}</td>
          <td class="nowrap">
            ${['awaiting_payment', 'pending'].includes(o.status) ? html`<form method="post" action="/admin/orders/${o.order_id}/confirm" class="inline-form">${csrf(req)}<button class="btn btn--primary btn--sm" type="submit">Confirm payment received</button></form>` : ''}
            ${o.status === 'paid' ? html`<form method="post" action="/admin/orders/${o.order_id}/refund" class="inline-form">${csrf(req)}<button class="btn btn--ghost btn--sm" type="submit">Refund</button></form>` : ''}
          </td></tr>`)}
      </tbody></table></div>`
        : html`<div class="empty">${icon('tag', 'icon--xl')}<h2>No orders yet</h2><p>Orders appear here when members promote a listing.</p></div>`}`,
  });
}

module.exports = { pricing, promote, orderDetail, myOrders, adminOrders };
