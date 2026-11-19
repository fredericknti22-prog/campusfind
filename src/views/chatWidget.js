'use strict';
/**
 * Floating help button shown on every member-facing page. It opens a panel with two tabs:
 *   - Ask AI: the CampusFind assistant (/assistant/state, /assistant/ask)
 *   - Talk to the team: the private help chat (/help/updates, POST /help)
 * Messages are loaded only when the panel opens (public/js/assist.js) and are inserted as text, never as HTML.
 * Without JavaScript the button is a plain link to the help centre.
 */
const { html } = require('../lib/html');
const { icon, csrf } = require('./components');

const SUGGESTIONS = ['Find me a cheap calculus textbook', 'Help me write a lost item report', 'How do I sell as a food vendor?', 'Is it safe to pay in advance?'];

function chatWidget(req) {
  const signedIn = Boolean(req.user);
  return html`<div class="aw" data-aw${signedIn ? ' data-aw-member' : ''}>
  <a class="aw-fab" href="/help" role="button" aria-expanded="false" aria-controls="aw-panel" data-aw-toggle>
    <span class="aw-fab__icon aw-fab__icon--open">${icon('chat')}</span>
    <span class="aw-fab__icon aw-fab__icon--close">${icon('x')}</span>
    <span class="sr-only">Help and AI assistant</span>
    <span class="aw-fab__dot" data-aw-dot hidden></span>
  </a>
  <section id="aw-panel" class="aw-panel" role="dialog" aria-modal="false" aria-labelledby="aw-title" hidden>
    <header class="aw-head">
      <span class="aw-head__logo">${icon('sparkle')}</span>
      <div class="aw-head__text"><h2 id="aw-title">CampusFind Help</h2><p>Instant answers from AI, or a person from our team.</p></div>
      <button class="aw-head__close" type="button" data-aw-close aria-label="Close help">${icon('x')}</button>
    </header>
    <div class="aw-tabs" role="tablist" aria-label="Who to ask">
      <button class="aw-tab" type="button" role="tab" id="aw-tab-ai" aria-controls="aw-pane-ai" aria-selected="true" data-aw-tab="ai">${icon('sparkle')}<span>Ask AI</span></button>
      <button class="aw-tab" type="button" role="tab" id="aw-tab-team" aria-controls="aw-pane-team" aria-selected="false" tabindex="-1" data-aw-tab="team">${icon('users')}<span>Talk to the team</span><span class="aw-tab__dot" data-aw-teamdot hidden></span></button>
    </div>
    ${signedIn ? html`
    <div class="aw-pane" id="aw-pane-ai" role="tabpanel" aria-labelledby="aw-tab-ai" data-aw-pane="ai">
      <ol class="aw-log" aria-live="polite" aria-label="Conversation with the AI assistant" data-aw-log="ai">
        <li class="aw-msg aw-msg--bot"><p>Hi ${req.user.name.split(' ')[0]}! I can find listings, draft a post or lost item report, and explain how CampusFind works. What do you need?</p></li>
      </ol>
      <div class="aw-chips" data-aw-chips>${SUGGESTIONS.map((s) => html`<button type="button" class="aw-chip" data-aw-suggest>${s}</button>`)}</div>
      <form class="aw-form" method="post" action="/assistant" data-aw-form="ai">${csrf(req)}
        <label class="sr-only" for="aw-q">Ask the AI assistant</label>
        <textarea id="aw-q" name="question" rows="1" maxlength="600" required placeholder="Ask anything about CampusFind…"></textarea>
        <button class="aw-send" type="submit" aria-label="Send">${icon('arrow')}</button>
      </form>
      <p class="aw-foot">AI can make mistakes. It never posts or messages for you.</p>
    </div>
    <div class="aw-pane" id="aw-pane-team" role="tabpanel" aria-labelledby="aw-tab-team" data-aw-pane="team" hidden>
      <ol class="aw-log" aria-live="polite" aria-label="Conversation with the CampusFind team" data-aw-log="team">
        <li class="aw-msg aw-msg--bot"><p>Send us a message and a member of the CampusFind team will reply here, usually within one working day.</p></li>
      </ol>
      <form class="aw-form" method="post" action="/help" data-aw-form="team">${csrf(req)}
        <label class="sr-only" for="aw-b">Message to the CampusFind team</label>
        <textarea id="aw-b" name="body" rows="1" maxlength="1000" required placeholder="Describe the problem…"></textarea>
        <button class="aw-send" type="submit" aria-label="Send">${icon('arrow')}</button>
      </form>
      <p class="aw-foot">Private between you and our team. We will never ask for your PIN or password.</p>
    </div>` : html`
    <div class="aw-guest">
      <span class="aw-guest__icon">${icon('lock')}</span>
      <h3>Sign in to chat</h3>
      <p>Ask our AI assistant or message the CampusFind team. Your conversation stays private to your account.</p>
      <div class="aw-guest__actions"><a class="btn btn--primary btn--block" href="/login?next=${encodeURIComponent(req.originalUrl || '/')}">Sign in</a><a class="btn btn--ghost btn--block" href="/register">Create an account</a></div>
      <a class="aw-guest__faq" href="/help">Browse common questions ${icon('arrow')}</a>
    </div>`}
  </section>
</div>`;
}

module.exports = { chatWidget };
