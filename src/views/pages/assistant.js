'use strict';
const { html } = require('../../lib/html');
const config = require('../../config');
const { page } = require('../layout');
const { icon, csrf, timeAgo } = require('../components');

const SUGGESTIONS = [
  'I lost my black umbrella near the library. Help me write a report.',
  'Find me a second-hand desk lamp under 15.',
  'I found a set of keys. What should I do?',
  'How do I stay safe when buying from another student?',
];

function assistantPage(req, { chat, available, configured }) {
  const A = config.assistant;
  return page(req, {
    title: 'Assistant', active: 'assistant',
    body: html`
      <div class="page-head"><div><h1>Assistant</h1>
        <p class="muted">Ask about listings, lost and found, or how CampusFind works. It can search live listings and draft a post for you to review.</p></div>
        ${chat.length ? html`<form method="post" action="/assistant/reset">${csrf(req)}<button class="btn btn--ghost" type="submit">New conversation</button></form>` : ''}</div>

      <div class="banner banner--info">${icon('shield')}<div>This is an AI assistant, so it can make mistakes. Check details before you act. It cannot post, message or report for you. Do not share passwords or card details. Your questions are processed by Anthropic to produce answers, and the chat is deleted after 30 days. See the <a href="/privacy">privacy policy</a>.</div></div>

      ${!available
        ? html`<div class="empty">${icon('alert', 'icon--xl')}<h2>The assistant is not available</h2>
            <p>${configured ? 'It has been switched off by the administrators.' : 'It has not been set up yet. The site owner needs to add an AI service key.'}</p>
            <a class="btn btn--primary" href="/browse">Browse listings</a></div>`
        : html`
          <ol class="chat" aria-label="Conversation" aria-live="polite">
            ${chat.length ? '' : html`<li class="chat__hint"><p>Try one of these:</p>
              <div class="chat__chips">${SUGGESTIONS.map((s) => html`<form method="post" action="/assistant">${csrf(req)}<input type="hidden" name="question" value="${s}"><button class="chip chip--btn" type="submit">${s}</button></form>`)}</div></li>`}
            ${chat.map((m, i) => html`<li class="chat__msg chat__msg--${m.role === 'user' ? 'me' : 'bot'}"${i === chat.length - 1 ? html` id="latest"` : ''}>
              <span class="chat__who">${m.role === 'user' ? 'You' : 'Assistant'}${m.at ? html` · ${timeAgo(m.at)}` : ''}</span>
              <p class="prewrap">${m.text}</p>
              ${(m.drafts || []).map((d) => html`<div class="card draft">
                <p class="draft__tag">${icon('edit')} Draft ${d.kind === 'lost' ? 'lost item report' : d.kind === 'found' ? 'found item report' : 'listing'}</p>
                <p><strong>${d.title}</strong></p><p class="muted small prewrap">${d.description}</p>
                ${d.location ? html`<p class="muted small">${icon('pin')} ${d.location}</p>` : ''}
                <a class="btn btn--primary btn--sm" href="${d.url}">${icon('arrow')} Open in the form to review</a></div>`)}
            </li>`)}
          </ol>

          <form class="card form-card stack chat__form" method="post" action="/assistant" data-assistant-form>${csrf(req)}
            <label for="f-question"><strong>Ask a question</strong></label>
            <textarea id="f-question" name="question" rows="3" maxlength="${A.maxUserChars}" required placeholder="For example: I found a blue notebook in Block C. Help me write a post."></textarea>
            <button class="btn btn--primary" type="submit" data-assistant-send>${icon('arrow')} Ask</button>
          </form>`}`,
  });
}

module.exports = { assistantPage };
