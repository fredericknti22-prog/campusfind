'use strict';
/**
 * Chat screens. Members: a two-pane layout (conversations on the left, the open chat on the right; one pane at a time
 * on phones), plus the help centre with its private help chat. Staff: the help chat inbox and thread.
 * The open chat polls for new messages (public/js/app.js, [data-chat-poll]); everything also works without JavaScript.
 */
const { html, raw } = require('../../lib/html');
const { page } = require('../layout');
const { icon, field, csrf, timeAgo } = require('../components');
const messages = require('../../repo/messages');

const initial = (name) => String(name || '?').trim().charAt(0).toUpperCase() || '?';
const lastAt = (list) => (list.length ? list[list.length - 1].created_at : 0);

/** One message bubble; the last one carries id="latest" so a redirect can land on it. */
const OFFER_LABEL = { pending: 'Waiting for an answer', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn' };
const bubble = (m, mine, who, isLast, reportUrl = null, actions = null) => html`<li class="bubble${mine ? ' bubble--me' : ''}${m.auto ? ' bubble--auto' : ''}${m.offer ? ' bubble--offer' : ''}" data-id="${m.id}"${isLast ? raw(' id="latest"') : ''}>
  ${m.offer ? html`<p class="offer__amount">${icon('tag')} ${m.body}</p><p class="offer__status offer__status--${m.offer.status}">${OFFER_LABEL[m.offer.status] || m.offer.status}</p>${actions || ''}` : html`<p class="prewrap">${m.body}</p>`}<span class="bubble__meta">${who} · ${timeAgo(m.created_at)}${reportUrl ? html` · <a class="bubble__report" href="${reportUrl}">Report</a>` : ''}</span>${mine ? '' : require('../../services/chatSafety').warnings(m.flags).map((w) => html`<p class="bubble__warn" role="note">${icon('alert')}<span>${w}</span></p>`)}</li>`;

/** The message list plus the reply box, shared by every chat. */
function chatBody(req, { list, mineFn, whoFn, pollUrl, action, label = 'Message', disabled = '', reportFn = null, actionsFn = null, extra = '', hint = 'Plain text. Do not share passwords, bank or card details.' }) {
  return html`
    <ol class="bubbles chat-log" aria-label="Messages" aria-live="polite" data-chat-poll="${pollUrl}" data-since="${lastAt(list)}">
      ${list.length ? list.map((m, i) => bubble(m, mineFn(m), whoFn(m), i === list.length - 1, reportFn && !mineFn(m) ? reportFn(m) : null, actionsFn ? actionsFn(m) : null)) : html`<li class="chat-log__empty muted">No messages yet. Say hello.</li>`}
    </ol>
    ${disabled
      ? html`<div class="banner banner--warn">${icon('alert')}<div>${disabled}</div></div>`
      : html`${extra}<form class="chat-reply" method="post" action="${action}">${csrf(req)}
          <label class="sr-only" for="f-body">${label}</label>
          <textarea id="f-body" name="body" rows="2" maxlength="${messages.MAX_BODY}" required placeholder="Write a message" data-chat-input aria-describedby="f-body-hint"></textarea>
          <button class="btn btn--primary" type="submit">${icon('arrow')}<span>Send</span></button>
          <p class="hint" id="f-body-hint">${hint} Press Ctrl+Enter to send.</p>
        </form>`}`;
}

/** Left pane: the member's conversations, with the help chat pinned at the top. */
function sidebar(req, { threads, help, activeId = '', helpActive = false }) {
  const me = req.user.user_id;
  const label = (t) => (t.kind === 'direct' ? 'Direct message' : `${t.is_owner ? 'Your listing' : 'About'}: ${t.listing_title}`);
  return html`<aside class="chat-side" aria-label="Conversations">
    <div class="chat-side__head"><h2>Chats</h2></div>
    <ul class="chat-list">
      <li><a class="chat-item chat-item--help${helpActive ? ' is-active' : ''}" href="/help?chat=1#chat"${helpActive ? raw(' aria-current="page"') : ''}>
        <span class="avatar avatar--help">${icon('shield')}</span>
        <span class="chat-item__body"><span class="chat-item__top"><strong>CampusFind Help</strong>${help && help.unread ? html`<span class="chat-item__dot" aria-label="Unread"></span>` : ''}</span>
          <span class="chat-item__last small muted">${help ? help.last_body : 'Questions? Chat with our team'}</span></span></a></li>
      ${threads.map((t) => html`<li><a class="chat-item${t.unread ? ' chat-item--unread' : ''}${t.id === activeId ? ' is-active' : ''}" href="/messages/${t.id}"${t.id === activeId ? raw(' aria-current="page"') : ''}>
        <span class="avatar">${initial(t.other ? t.other.name : '')}</span>
        <span class="chat-item__body">
          <span class="chat-item__top"><strong>${t.other && !t.other.deleted_at ? t.other.name : 'Deleted user'}</strong><span class="muted xsmall">${timeAgo(t.updated_at)}</span></span>
          <span class="chat-item__about xsmall muted">${label(t)}</span>
          <span class="chat-item__last small">${t.last_sender_id === me ? 'You: ' : ''}${t.last_body}</span>
        </span>
        ${t.unread ? html`<span class="chat-item__dot" aria-label="Unread"></span>` : ''}</a></li>`)}
    </ul>
    ${threads.length ? '' : html`<p class="chat-side__note muted small">Start a chat from a listing (“Send a message”) or from a member’s profile (“Message”).</p>`}
  </aside>`;
}

function messageInbox(req, { threads, help }) {
  return page(req, {
    title: 'Chats', active: 'messages',
    body: html`
      <div class="page-head"><div><h1>Chats</h1><p class="muted">Talk to buyers, sellers and other members. Your email address and phone number stay private.</p></div></div>
      <div class="chatwrap chatwrap--list">
        ${sidebar(req, { threads, help })}
        <section class="chat-main chat-main--empty" aria-label="No conversation open">
          <div class="empty">${icon('mail', 'icon--xl')}<h2>Pick a conversation</h2><p>Choose a chat on the left, or start one from a listing or a member’s profile.</p>
            <div class="row row--wrap"><a class="btn btn--primary" href="/browse">Browse listings</a><a class="btn btn--ghost" href="/help?chat=1#chat">Chat with CampusFind Help</a></div></div>
        </section>
      </div>`,
  });
}

/** Accept / Decline for the seller, Withdraw for the buyer, on a pending offer. */
function offerActions(req, t, m) {
  if (!m.offer || m.offer.status !== 'pending' || t.kind !== 'listing') return null;
  const me = req.user.user_id;
  const btn = (d, label, cls) => html`<form method="post" action="/messages/${t.id}/offer/${m.id}/${d}">${csrf(req)}<button class="btn ${cls} btn--sm" type="submit">${label}</button></form>`;
  if (me === t.owner_id) return html`<div class="offer__actions">${btn('accept', 'Accept and reserve', 'btn--primary')}${btn('decline', 'Decline', 'btn--ghost')}</div>`;
  if (me === t.starter_id) return html`<div class="offer__actions">${btn('withdraw', 'Withdraw offer', 'btn--ghost')}</div>`;
  return null;
}

/** The buyer's "Make an offer" box, when the listing can take one. */
function offerForm(req, t, listing) {
  if (t.kind !== 'listing' || req.user.user_id !== t.starter_id || t.pending_offer_id) return '';
  if (!require('../../routes/offers').offerable(listing)) return '';
  return html`<details class="offer-box"><summary class="btn btn--ghost btn--sm">${icon('tag')} Make an offer</summary>
    <form class="offer-box__form" method="post" action="/messages/${t.id}/offer">${csrf(req)}
      <label for="f-offer">Your offer (GH₵)</label>
      <div class="row"><input id="f-offer" name="amount" type="number" min="1" step="0.01" inputmode="decimal" required${listing.price_cents ? raw(` placeholder="${Math.round(listing.price_cents / 100)}"`) : ''}>
      <button class="btn btn--primary btn--sm" type="submit">Send offer</button></div>
      <p class="hint">If the seller accepts, the listing is reserved for you. Still meet first and check the item before paying.</p>
    </form></details>`;
}

function messageThread(req, { t, list, threads, help, other, otherPerson, otherName, listing, blockNote = null }) {
  const me = req.user.user_id;
  return page(req, {
    title: `Chat with ${otherName}`, active: 'messages',
    body: html`
      <div class="chatwrap chatwrap--open">
        ${sidebar(req, { threads, help, activeId: t.id })}
        <section class="chat-main" aria-labelledby="chat-title">
          <header class="chat-head">
            <a class="chat-head__back icon-btn" href="/messages" aria-label="Back to all chats">${icon('arrow', 'icon--flip')}</a>
            <span class="avatar">${initial(otherName)}</span>
            <div class="chat-head__who">
              <h1 id="chat-title">${otherPerson ? html`<a href="/users/${otherPerson.user_id}">${otherName}</a>` : otherName}</h1>
              <p class="muted small">${t.kind === 'direct' ? 'Direct message'
                : html`About ${listing ? html`<a href="/listings/${listing.listing_id}">${t.listing_title}</a>` : html`${t.listing_title} (no longer available)`}`}</p>
            </div>
            ${other ? html`<a class="report-link small" href="/report?type=user&id=${other.user_id}">${icon('flag')} Report</a>` : ''}
          </header>
          <div class="chat-safety small">${icon('shield')}<span>Meet in a busy campus spot. Never send money or gift cards in advance.</span></div>
          <p class="push-hint small" data-push-hint hidden>${icon('bell')} <a href="/app#push">Get a buzz on your phone when they reply</a></p>
          ${chatBody(req, {
            list, pollUrl: `/messages/${t.id}/updates`, action: `/messages/${t.id}`, label: `Message to ${otherName}`,
            mineFn: (m) => m.sender_id === me, whoFn: (m) => (m.sender_id === me ? 'You' : otherName),
            disabled: other ? (blockNote || '') : 'This person can no longer receive messages.',
            actionsFn: (m) => offerActions(req, t, m),
            extra: offerForm(req, t, listing),
            reportFn: other ? (m) => `/report?type=user&id=${other.user_id}&msg=${encodeURIComponent(`${t.id}~${m.id}`)}` : null,
          })}
        </section>
      </div>`,
  });
}

/* ---------------------------------------------------------------- help centre */
const FAQ = [
  ['How do I post a listing?', 'Select Post at the top of any page, choose a category, add a clear title, a photo and a price, then publish. Basic listings are free.'],
  ['How do I sell as a business, hostel or food vendor?', 'Post in the Business category and choose your type of business. You can promote your listing from the Pricing page. See the Seller & business terms.'],
  ['I lost or found something. What should I do?', 'Open the Lost & found board and choose “I lost something” or “I found something”. Add a photo and where it was. Keep one detail back so you can check the real owner.'],
  ['Is my phone number shown to other people?', 'No. Members chat inside CampusFind. Contact details you add to a listing are shown only to signed-in members.'],
  ['Someone is asking me to pay in advance. Is that safe?', 'Be careful. Never pay with gift cards or for a room you have not seen. Use Report on the listing or profile and our team will review it.'],
  ['Will CampusFind ever ask for my PIN or password?', 'Never. No one from CampusFind will ask for your Mobile Money PIN, a code sent to your phone, your card details or your password, in a chat, a call or anywhere else. Anyone who asks is a scammer: do not reply, and report them.'],
  ['Can the CampusFind team read my chats?', 'Chats between members are private to the two of you. Staff have no screen for reading them. If you report a chat, the moderators see what was reported so they can act. Conversations with the CampusFind team in Help are seen by the team. To protect you, chats are checked automatically (no person reads them): messages containing a PIN or one-time code are not sent, and common scam messages show you a warning.'],
  ['How do refunds for promotions work?', 'Promotions are one-off payments. If we could not deliver a promotion, you get a refund. See the Payments & refund policy for details.'],
  ['How do I delete my account?', 'Open Edit profile and choose Delete account. Your listings and chats are removed.'],
];

function helpCentre(req, { thread, list }) {
  const signedIn = Boolean(req.user);
  // the chat normally opens in the floating widget; ?chat=1 (or an existing conversation landing via #latest) shows it inline
  const inline = req.query.chat === '1';
  return page(req, {
    title: 'Help', active: 'help',
    description: 'Answers to common questions about CampusFind, and a private chat with the CampusFind team.',
    body: html`
      <div class="page-head"><div><p class="eyebrow">${icon('shield')} Help centre</p><h1>How can we help?</h1>
        <p class="muted">Get an instant answer from our AI assistant, message the team, or browse common questions.</p></div></div>
      <div class="help-start">
        <a class="help-start__card" href="/assistant" data-aw-open="ai"><span class="help-start__icon">${icon('sparkle')}</span><strong>Ask the AI assistant</strong><span>Instant answers, any time. It can find listings and draft a post for you.</span></a>
        <a class="help-start__card help-start__card--team" href="/help?chat=1#chat" data-aw-open="team"><span class="help-start__icon">${icon('users')}</span><strong>Talk to the team</strong><span>A person from CampusFind replies, usually within one working day.</span></a>
      </div>
      <div class="${inline ? 'help-grid' : 'help-grid help-grid--solo'}">
        <section class="${inline ? 'help-faq' : 'help-faq help-faq--full'}" aria-labelledby="h-faq">
          <h2 id="h-faq">Common questions</h2>
          <div class="faq-list">${FAQ.map(([q, a]) => html`<details class="faq"><summary>${q}</summary><p>${a}</p></details>`)}</div>
          <p class="muted small faq-more">More detail: <a href="/rules">Community rules</a> · <a href="/business-terms">Seller &amp; business terms</a> · <a href="/refunds">Payments &amp; refunds</a> · <a href="/privacy">Privacy</a></p>
          ${require('../../services/settings').supportEmail() ? html`<div class="help-email card">${icon('mail')}<div><strong>Prefer email?</strong>
            <p>Write to <a href="mailto:${require('../../services/settings').supportEmail()}">${require('../../services/settings').supportEmail()}</a>. The help chat is usually faster, and keeps your conversation in one place.</p></div></div>` : ''}
        </section>
        ${inline ? html`<section class="card help-chat" id="chat" aria-labelledby="h-chat">
          <header class="chat-head chat-head--help">
            <span class="avatar avatar--help">${icon('shield')}</span>
            <div class="chat-head__who"><h2 id="h-chat">Chat with CampusFind Help</h2><p class="muted small">Private between you and our team. We usually reply within one working day.</p></div>
          </header>
          ${signedIn
            ? chatBody(req, {
              list, pollUrl: '/help/updates', action: '/help', label: 'Message to the CampusFind team',
              mineFn: (m) => !m.from_staff, whoFn: (m) => (m.from_staff ? (m.staff_name || 'CampusFind team') : 'You'),
              hint: 'Describe the problem and include the listing link if there is one. Do not share passwords, bank or card details.',
            })
            : html`<div class="empty empty--compact"><p>Sign in to chat with our team. It keeps your conversation private and lets us reply.</p>
                <div class="row row--wrap"><a class="btn btn--primary" href="/login?next=/help">Sign in</a><a class="btn btn--ghost" href="/register">Create an account</a></div></div>`}
          ${signedIn && !thread ? html`<p class="muted xsmall help-chat__note">Tip: urgent safety problems? Contact campus security first, then report it here.</p>` : ''}
        </section>` : ''}
      </div>`,
  });
}

/* ---------------------------------------------------------------- staff */
function adminHelp(req, { items, counts }) {
  const { shell } = require('./admin');
  return shell(req, {
    title: 'Help chat', active: 'help', counts,
    body: html`
      <div class="page-head"><div><h1>Help chat</h1><p class="muted">Conversations members started with the CampusFind team. Waiting ones are first.</p></div></div>
      ${items.length
        ? html`<ul class="threads">${items.map((t) => html`<li><a class="card thread${t.staff_unread ? ' thread--unread' : ''}" href="/admin/help/${t.user_id}">
            <span class="avatar">${initial(t.who ? t.who.name : '')}</span>
            <span class="thread__body">
              <span class="thread__top"><strong>${t.who && !t.who.deleted_at ? t.who.name : 'Deleted user'}</strong><span class="muted xsmall">${timeAgo(t.updated_at)}</span></span>
              <span class="thread__about muted small">${t.staff_unread ? 'Waiting for a reply' : 'Answered'}</span>
              <span class="thread__last small">${t.last_from_staff ? 'Team: ' : ''}${t.last_body}</span>
            </span>
            ${t.staff_unread ? html`<span class="thread__dot" aria-label="Waiting"></span>` : ''}</a></li>`)}</ul>`
        : html`<div class="empty">${icon('mail', 'icon--xl')}<h2>No help chats yet</h2><p>When members write to the team from the Help page, their conversations appear here.</p></div>`}`,
  });
}

function adminHelpThread(req, { thread, list, member, counts }) {
  const { shell } = require('./admin');
  const name = member && !member.deleted_at ? member.name : 'Deleted user';
  return shell(req, {
    title: `Help chat · ${name}`, active: 'help', counts,
    body: html`
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/admin/help">Help chat</a> ${icon('arrow')} <span>${name}</span></nav>
      <section class="card help-chat help-chat--staff" aria-labelledby="chat-title">
        <header class="chat-head">
          <span class="avatar">${initial(name)}</span>
          <div class="chat-head__who"><h1 id="chat-title">${name}</h1>
            <p class="muted small">${member ? html`${member.email} · <a href="/admin/users/${member.user_id}">Member record</a>` : 'Account deleted'}</p></div>
        </header>
        ${chatBody(req, {
          list, pollUrl: `/admin/help/${thread.user_id}/updates`, action: `/admin/help/${thread.user_id}`, label: `Reply to ${name}`,
          mineFn: (m) => m.from_staff, whoFn: (m) => (m.from_staff ? (m.staff_name || 'CampusFind team') : name),
          hint: 'Replies are signed with your first name and the CampusFind team, and are recorded in the audit log.',
          disabled: member && !member.deleted_at ? '' : 'This member has deleted their account.',
        })}
      </section>`,
  });
}

module.exports = { messageInbox, messageThread, helpCentre, adminHelp, adminHelpThread };
