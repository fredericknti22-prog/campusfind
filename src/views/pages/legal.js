'use strict';
/**
 * Legal documents: Terms of Use, Privacy Policy, Cookie Policy, Moderation & Appeals, Copyright & Takedown,
 * plus the hub page. The Community Rules live in public.js.
 * These are working drafts written from the project documentation. They must be reviewed by a lawyer
 * qualified in the operator's jurisdiction before launch.
 */
const { html, raw } = require('../../lib/html');
const config = require('../../config');
const { page } = require('../layout');
const { icon } = require('../components');

const L = config.legal;
const { supportEmail } = require('../../services/settings');
const campus = config.campusName === 'your campus' ? 'your campus' : config.campusName;

/** How to reach the team: the private Help centre chat, plus a business support mailbox once SUPPORT_EMAIL is set. */
const contact = () => (supportEmail()
  ? html`the CampusFind team (message us in the <a href="/help">Help centre</a> or email <a href="mailto:${supportEmail()}">${supportEmail()}</a>)`
  : html`the CampusFind team (message us in the <a href="/help">Help centre</a>)`);

/** Postal address line, shown only once the operator has configured one. */
const postal = () => (L.postalAddress ? html`<p>Postal address: ${L.postalAddress}</p>` : '');

const { formatMoney: money } = require('../../lib/validate');

const lawText = () => (L.governingLaw
  ? html`the laws of ${L.governingLaw}`
  : html`the laws of the jurisdiction in which the operator is established`);

const DOCS = [
  ['/terms', 'Terms of use', 'The agreement between you and the operator when you use CampusFind.', 'list'],
  ['/privacy', 'Privacy policy', 'What personal data we collect, why, who sees it and your rights.', 'lock'],
  ['/cookies', 'Cookie policy', 'The few cookies and browser storage items the site uses.', 'tag'],
  ['/rules', 'Community rules', 'What is and is not allowed on the platform.', 'shield'],
  ['/moderation', 'Moderation & appeals', 'How reports are reviewed, the actions we take and how to appeal.', 'flag'],
  ['/copyright', 'Copyright & takedown', 'How to report content that infringes your rights.', 'alert'],
  ['/data-protection', 'Data protection policy', 'How we meet the Data Protection Act, 2012 (Act 843): principles, security and your rights.', 'shield'],
  ['/business-terms', 'Seller & business terms', 'Extra rules for hostel managers, food vendors and anyone selling on CampusFind.', 'store'],
  ['/refunds', 'Payments & refund policy', 'How paid promotions are charged, when they are refunded and how to ask.', 'tag'],
  ['/disclaimer', 'Disclaimer', 'What CampusFind is and is not responsible for, and how to stay safe.', 'alert'],
];

function legalPage(req, { path, title, intro, sections }) {
  return page(req, {
    title, active: 'legal',
    body: html`
      <article class="doc">
        <header class="doc__head">
          <p class="eyebrow">Version ${L.version} · Last updated ${L.updated}</p>
          <h1>${title}</h1>
          <p class="lead">${intro}</p>
          <div class="banner banner--info" role="note">${icon('alert')}<div><strong>Draft for legal review.</strong> This document was prepared from the project documentation and is not legal advice. The operator should have it reviewed for its jurisdiction and institution before launch.</div></div>
        </header>
        <div class="doc__layout">
          <nav class="toc" aria-label="On this page"><h2>On this page</h2><ol>${sections.map((s, i) => html`<li><a href="#s${i + 1}">${s.h}</a></li>`)}</ol></nav>
          <div class="doc__body">
            ${sections.map((s, i) => html`<section id="s${i + 1}"><h2>${i + 1}. ${s.h}</h2>${s.body}</section>`)}
            <section class="doc__more"><h2>Other legal documents</h2>
              <ul class="plain">${DOCS.filter(([href]) => href !== path).map(([href, label]) => html`<li><a href="${href}">${label}</a></li>`)}</ul>
            </section>
          </div>
        </div>
      </article>`,
  });
}

/* ------------------------------------------------------------------ hub */
function legalHub(req) {
  return page(req, {
    title: 'Legal', active: 'legal',
    body: html`
      <header class="doc__head">
        <p class="eyebrow">Version ${L.version} · Last updated ${L.updated}</p>
        <h1>Legal information</h1>
        <p class="lead">The documents that govern your use of CampusFind, written in plain language. Questions? Contact ${contact()}.</p>
      </header>
      <div class="legal-grid">
        ${DOCS.map(([href, label, desc, ic]) => html`<a class="card legal-card" href="${href}">
          <span class="legal-card__icon">${icon(ic)}</span>
          <span><strong>${label}</strong><small>${desc}</small></span></a>`)}
      </div>`,
  });
}

/* ---------------------------------------------------------------- terms */
function terms(req) {
  return legalPage(req, {
    path: '/terms',
    title: 'Terms of use',
    intro: 'These terms govern your access to and use of CampusFind. Please read them together with the Privacy policy, Cookie policy and Community rules.',
    sections: [
      { h: 'About these terms', body: html`<p>CampusFind is a moderated directory where members of ${campus} publish and find textbooks, accommodation, services, employment, events and lost property. It is operated by ${L.entity} (“we”, “us”, “the operator”). By creating an account or using the service you agree to these terms. If you do not agree, do not use CampusFind.</p>` },
      { h: 'Changes to the terms', body: html`<p>We may update these terms as the platform develops or the law changes. We will show the new version number and date at the top of this page and, for material changes, notify members in the app. Using CampusFind after a change takes effect means you accept the updated terms. If you disagree, you can delete your account at any time.</p>` },
      { h: 'Who can use CampusFind', body: html`<ul><li>You must be at least <strong>${config.minAge} years old</strong>, and you confirm your date of birth when you register, or the minimum age of digital consent where you live if that is higher.</li><li>You must be able to form a binding agreement and must not be barred from using the service by law or by a previous ban.</li><li>The operator may limit registration to people with a campus email address.</li></ul>` },
      { h: 'Your account', body: html`<ul><li>Give accurate information and keep it up to date. Use your real name.</li><li>Keep your password confidential and do not share your account. You are responsible for activity under it.</li><li>Tell us promptly if you suspect unauthorised access.</li><li>One person, one account. Do not create accounts to evade a restriction, suspension or ban.</li></ul>` },
      { h: 'Listings and your content', body: html`<p>“Your content” means everything you publish: listings, descriptions, photographs, contact details, profile information and reports.</p><ul><li>You are responsible for your content and for making sure it is accurate, lawful and follows the <a href="/rules">Community rules</a>.</li><li>You confirm that you own your content or have the rights and permissions needed to publish it, including consent from anyone identifiable in your photographs.</li><li>You keep ownership of your content. You give the operator a non-exclusive, worldwide, royalty-free licence to host, store, display, reproduce and distribute it on and through CampusFind for the purpose of running, moderating, securing and improving the service. The licence ends when you delete the content or your account, except for copies in routine backups for a limited period and records we must keep for safety or legal reasons.</li><li>Do not post other people’s personal data, such as home addresses or phone numbers, without their consent.</li></ul>` },
      { h: 'Deals between members', body: html`<p>CampusFind connects members. We are <strong>not a party</strong> to any sale, rental, service, job or other arrangement made between members, and we do not hold funds, inspect items, verify identities or guarantee that a listing is genuine, safe, legal or as described.</p><ul><li>You deal with other members at your own risk. Read the safety guidance on each listing.</li><li>Meet in public places, inspect before you pay, and never send money or gift cards in advance.</li><li>You are responsible for complying with the law that applies to your transaction, including any taxes, licences, tenancy or employment rules.</li><li>Disputes between members are for those members to resolve. We may help by reviewing reports under our moderation process, but we do not decide who is owed money.</li></ul>` },
      { h: 'Messages and the AI assistant', body: html`<ul><li>Chats are for talking about listings and dealing with other members, including direct messages started from a profile. Do not send spam, threats, harassment, or requests for money in advance. Messages are covered by the Community rules and can be reported.</li><li>The AI assistant gives general help and drafts text for you to review. It can be wrong, it is not professional advice, and you remain responsible for what you publish and for any deal you make.</li><li>We may limit or switch off messaging or the assistant for a member, or for everyone, to prevent abuse or control cost.</li></ul>` },
      { h: 'Moderation and enforcement', body: html`<p>We review reports and may take action to keep the platform safe. Depending on severity and history, actions include a warning, hiding or removing content, restricting posting or reporting, a time-limited suspension, or a permanent ban. We may act without notice where needed to prevent harm or comply with the law. Where we act on your content or account we will normally tell you and give a reason. You can appeal as described in <a href="/moderation">Moderation &amp; appeals</a>.</p>` },
      { h: 'Featured and promoted listings', body: html`<p>Posting a basic listing is free. Optional promotions are paid for once, in Ghana cedis (${config.currency.code}), and are always labelled on the site:</p>
          <ul>
            <li><strong>Featured listing</strong>, ${money(config.payments.prices.featured)} for 7 days.</li>
            <li><strong>Business advertisement</strong>, ${money(config.payments.prices.business)} for ${config.payments.businessDays} days.</li>
            <li><strong>Premium business promotion</strong>, ${money(config.payments.prices.premium)} for ${config.payments.businessDays} days, including featured placement.</li>
          </ul>
          <ul>
            <li><strong>No automatic renewal.</strong> You pay once for the period shown. We never charge you again unless you choose to buy again, and buying again adds time to a promotion that is still running.</li>
            <li><strong>The price you see is the price you pay.</strong> It is shown next to the button before you confirm.</li>
            <li><strong>When it starts.</strong> A promotion starts when your payment is confirmed. If you pay by Mobile Money directly, it starts when an administrator confirms your payment.</li>
            <li><strong>Moderation still applies.</strong> Payment or promotion never overrides moderation. Promoted content must follow the Community rules and can be removed like any other content. If we remove it for breaking the rules, the promotion ends and no refund is due.</li>
            <li><strong>Business advertisements</strong> must describe a real, lawful business or service and must not mislead.</li>
            <li><strong>Refunds.</strong> If we cannot deliver a promotion you paid for, for example because of an error on our side, we will refund you or extend it. A promotion that has gone live and has not been removed for a breach is otherwise not refundable. This does not affect any rights you have under the law.</li>
            <li><strong>Payments</strong> are processed by Paystack. We never see or store your card or Mobile Money details.</li>
          </ul>` },
      { h: 'Acceptable use of the service', body: html`<p>In addition to the Community rules, you must not:</p><ul><li>scrape, harvest or copy data from the service by automated means, or use it to build contact lists;</li><li>probe, scan or test the security of the service, or attempt to access accounts, data or admin areas you are not authorised to use;</li><li>interfere with or overload the service, bypass rate limits, or introduce malware;</li><li>use the service to harass, defraud, impersonate or spam others, or to send unsolicited commercial messages;</li><li>misuse the report tool, including filing knowingly false or repeated unfounded reports.</li></ul><p>If you find a security vulnerability, please report it to ${contact()} and give us reasonable time to fix it before disclosing it.</p>` },
      { h: 'Intellectual property', body: html`<p>The CampusFind name, logo, design, software and documentation belong to the operator or its licensors and are protected by law. These terms give you no right to use them except to use the service as intended. If you believe content on CampusFind infringes your copyright or other rights, follow the process in <a href="/copyright">Copyright &amp; takedown</a>.</p>` },
      { h: 'Third-party services', body: html`<p>CampusFind runs on third-party infrastructure, including Google Firebase (authentication, database and file storage). Links to external sites are provided for convenience; we do not control and are not responsible for them. Your use of any third-party service is subject to that provider’s own terms.</p>` },
      { h: 'Availability and changes to the service', body: html`<p>We aim to keep CampusFind available but do not promise uninterrupted or error-free access. We may change, suspend or discontinue features, perform maintenance, or limit usage (for example posting limits) at any time. We will try to give notice of significant changes where practicable.</p>` },
      { h: 'Disclaimers', body: html`<p>To the fullest extent permitted by law, CampusFind is provided “as is” and “as available”, without warranties of any kind, whether express or implied, including fitness for a particular purpose, accuracy of listings, and non-infringement. Content is created by members; we do not endorse it and do not guarantee that it is lawful, safe or accurate.</p>` },
      { h: 'Limitation of liability', body: html`<p>Nothing in these terms excludes or limits liability that cannot be excluded or limited by law, including liability for death or personal injury caused by negligence, for fraud, or for any rights you have as a consumer that cannot be waived.</p><p>Subject to that, and to the extent permitted by law, the operator is not liable for: (a) losses arising from dealings between members; (b) content published by members; (c) indirect or consequential loss, loss of profit, loss of data or loss of opportunity; or (d) events beyond our reasonable control. Where liability cannot be excluded, it is limited to the greater of the amount you paid us (if any) in the twelve months before the claim and a nominal sum permitted by law.</p>` },
      { h: 'Indemnity', body: html`<p>To the extent permitted by law, you agree to compensate the operator for losses, claims and reasonable costs arising from your content or from your breach of these terms or of the law, except where the loss was caused by our own breach or negligence.</p>` },
      { h: 'Ending your use of CampusFind', body: html`<ul><li><strong>By you:</strong> you may stop using the service at any time and delete your account from your profile. Your listings are removed and your personal details are erased as described in the Privacy policy.</li><li><strong>By us:</strong> we may suspend or end your access if you breach these terms or the Community rules, if required by law, or if we discontinue the service.</li><li>Sections that by their nature should survive (such as intellectual property, disclaimers, liability and governing law) continue after your access ends.</li></ul>` },
      { h: 'Privacy and cookies', body: html`<p>How we handle personal data is explained in the <a href="/privacy">Privacy policy</a> and <a href="/cookies">Cookie policy</a>, which form part of this agreement.</p>` },
      { h: 'Governing law and disputes', body: html`<p>These terms and any dispute arising from them are governed by ${lawText()}. Before starting formal proceedings, please contact us so we can try to resolve the matter informally. Nothing in this section removes any right you have to bring a claim in the courts or before a regulator that you cannot lawfully give up.</p>` },
      { h: 'General', body: html`<ul><li><strong>Entire agreement:</strong> these terms, with the documents they refer to, are the whole agreement about your use of CampusFind.</li><li><strong>Severability:</strong> if a provision is found unenforceable, the rest remains in effect.</li><li><strong>No waiver:</strong> not enforcing a right is not a waiver of it.</li><li><strong>Assignment:</strong> you may not transfer your rights under these terms; the operator may transfer its rights to a successor operator of the service.</li><li><strong>Notices:</strong> we may give notice by posting in the app, in your notifications, or by email.</li></ul>` },
      { h: 'Contact', body: html`<p>Questions about these terms: ${contact()}.</p>` },
    ],
  });
}

/* -------------------------------------------------------------- privacy */
function privacy(req) {
  return legalPage(req, {
    path: '/privacy',
    title: 'Privacy policy',
    intro: 'This policy explains what personal data CampusFind collects, why we collect it, who can see it, how long we keep it, and the choices and rights you have.',
    sections: [
      { h: 'Who is responsible for your data', body: html`<p>${L.entity} operates CampusFind and decides how and why personal data is processed (the “controller”). Contact: ${contact()}.</p>` },
      { h: 'The data we collect', body: html`<ul>
          <li><strong>Account data:</strong> your name and email address, a unique account identifier, your role (member or staff) and account status. Your password is held by Firebase Authentication in hashed form. CampusFind never stores or sees it.</li>
          <li><strong>Profile data you choose to add:</strong> programme or course, year of study and a short bio.</li>
          <li><strong>Content you publish:</strong> listings (title, description, category, price, location, contact details) and photographs.</li>
          <li><strong>Reports and moderation records:</strong> reports you file, reports about you or your content, moderator decisions and the notes behind them.</li>
          <li><strong>Notifications:</strong> messages the platform sends you about your listings, reports and account.</li>
          <li><strong>Chats between members:</strong> the text of conversations you start or receive, about a listing or directly from a member’s profile, with who wrote each message and when. Your email address and phone number are not shared through chats.</li>
          <li><strong>Help chat:</strong> what you write to the CampusFind team through the Help page and our replies. Staff who answer can see your name and email address so they can help you, and each reply is recorded in the audit log.</li>
          <li><strong>Saved listings:</strong> which listings you chose to save. Only you can see them, and they are deleted with your account.</li>
          <li><strong>Assistant chats:</strong> if you use the AI assistant, the questions you type and the answers it gives.</li>
          <li><strong>Orders and payments:</strong> if you buy a promotion, the order (what you bought, for which listing, the amount, the date, the payment reference and whether it was paid). We never receive or store your card number or Mobile Money PIN.</li>
          <li><strong>Technical and security data:</strong> IP address, browser type, session identifiers, sign-in and failed sign-in events, and an audit trail of administrative actions with timestamps.</li>
          <li><strong>Consent and age records:</strong> the version of the terms you accepted and when, and a record that you met the minimum age when you registered. You enter your date of birth to register, but we use it only for that check and do not store it.</li>
        </ul><p>We do not collect payment card details, government identifiers, precise location, contacts or biometric data.</p>` },
      { h: 'How we get it', body: html`<p>Directly from you when you register, edit your profile, post listings or file reports; automatically from your device when you use the site; and from other members when they report you or your content.</p>` },
      { h: 'Why we use it, and the legal basis', body: html`<ul>
          <li><strong>To provide the service</strong> (create your account, publish listings, show contact details to signed-in members, send notifications). <em>Basis: performing our agreement with you.</em></li>
          <li><strong>To keep the platform safe</strong> (moderation, spam and fraud prevention, rate limiting, audit logs, investigating reports). <em>Basis: our legitimate interests in running a safe service, and legal obligations where they apply.</em></li>
          <li><strong>To secure accounts and the service</strong> (session management, sign-in lockout, abuse detection). <em>Basis: legitimate interests.</em></li>
          <li><strong>To comply with the law</strong> and respond to lawful requests. <em>Basis: legal obligation.</em></li>
          <li><strong>To communicate with you</strong> about your account, important changes and your requests. <em>Basis: contract and legitimate interests.</em></li>
          <li><strong>Optional profile details</strong> you add and choose to show publicly. <em>Basis: your consent, which you can withdraw by editing or removing them.</em></li>
        </ul>` },
      { h: 'Who can see what', body: html`<ul>
          <li><strong>Everyone, including visitors:</strong> active listings (title, description, price, location, photographs), the poster’s name and member-since date, and your optional programme and year if you allow it.</li>
          <li><strong>Signed-in members only:</strong> the contact details you put on a listing.</li>
          <li><strong>Never shown to other members:</strong> your email address, your reports, your notifications and your account status.</li>
          <li><strong>Moderators and administrators:</strong> the data needed to review reports and manage accounts, including your email address. Their actions are recorded in an audit log. Super admins also manage settings and can export platform data.</li>
        </ul>` },
      { h: 'Service providers and recipients', body: html`<p>We use <strong>Google Firebase</strong> (Google LLC and its affiliates) as our processor for sign-in (Authentication), the database (Cloud Firestore), photo storage (Cloud Storage) and, if configured, hosting and delivery of password-reset emails. Our hosting provider (for example Vercel) also processes requests to run the site. They process data only to provide those services to us under their data-processing terms. If the AI assistant is switched on, the questions you type into it are sent to <strong>Anthropic</strong>, which generates the answers and acts as our processor for that purpose. If you buy a promotion, <strong>Paystack</strong> processes the payment and receives your email address, the amount and the order reference from us, together with the payment details you enter on its page. The assistant sees only public listing information and your questions, never contact details, email addresses or private messages, and it cannot act on your behalf. Do not put passwords, card numbers or other sensitive information into it. We do not sell personal data and we do not share it for advertising. We may disclose data where required by law, to protect people’s safety, or to establish or defend legal claims.</p>` },
      { h: 'International transfers', body: html`<p>Data is stored in the Google Cloud region selected by the operator for the project, and Google may process data in other countries where it operates. Where data moves across borders we rely on the safeguards offered by the provider and the law that applies, such as standard contractual clauses. Ask us for details of the current storage region.</p>` },
      { h: 'How long we keep data', body: html`<ul>
          <li><strong>Active accounts:</strong> for as long as you have an account.</li>
          <li><strong>Chats between members and help chats:</strong> until you delete your account, or 12 months after the last message in a conversation, whichever comes first. The other person keeps their copy only until the same point.</li>
          <li><strong>Assistant chats:</strong> deleted 30 days after your last question, when you choose New conversation, and when you delete your account.</li>
          <li><strong>Orders and payments:</strong> kept for as long as accounting and tax law require, even after you delete your account, with your name and email removed from the record.</li>
          <li><strong>Sessions:</strong> up to 7 days, then removed automatically. Password-reset links expire in 30 minutes.</li>
          <li><strong>Deleted accounts:</strong> when you delete your account your listings and photographs are removed, your notifications are deleted, your sign-in credential is deleted from Firebase Authentication, and your name and email are replaced with “Deleted user” and a placeholder.</li>
          <li><strong>Safety, moderation and audit records:</strong> kept only as long as needed to protect members, enforce our rules, meet legal obligations and handle disputes, then deleted or fully anonymised. After account deletion they no longer identify you.</li>
          <li><strong>Backups:</strong> deleted data may remain in routine backups for a limited period before being overwritten.</li>
        </ul>` },
      { h: 'How we protect your data', body: html`<ul><li>Passwords are handled and hashed by Firebase Authentication; sign-in attempts are rate-limited and accounts lock after repeated failures.</li><li>All traffic uses HTTPS. Session cookies are HttpOnly and Secure, and forms are protected against cross-site request forgery.</li><li>The database and file storage deny all direct client access; only the application server, using restricted credentials, can read or write them.</li><li>Staff access is role-based, requires an additional password check for admin areas, and is logged.</li><li>User-supplied text is escaped and a strict content security policy limits what the browser will run.</li></ul><p>No system is perfectly secure. If a breach affecting your data occurs we will notify you and the relevant authority where the law requires.</p>` },
      { h: 'Your rights', body: html`<p>Depending on where you live, you may have the right to:</p><ul><li><strong>access</strong> the personal data we hold about you and receive a copy;</li><li><strong>correct</strong> inaccurate or incomplete data (you can edit your profile at any time);</li><li><strong>erase</strong> your data (use “Delete account” on your profile);</li><li><strong>restrict</strong> or <strong>object to</strong> certain processing, including processing based on legitimate interests;</li><li><strong>data portability</strong>, to receive your data in a structured, commonly used format;</li><li><strong>withdraw consent</strong> where processing relies on it, without affecting earlier processing;</li><li><strong>complain</strong> to your local data-protection authority.</li></ul><p>To use a right that is not available through your account, contact ${contact()}. We may need to verify your identity first and will respond within the time the law requires (normally one month). Some records may be kept where the law allows or requires, for example to protect other members.</p>` },
      { h: 'Automated decisions', body: html`<p>CampusFind does not make decisions that have legal or similarly significant effects on you by automated means. A simple rule-based screen can flag listings that contain suspicious phrases, but a person always reviews a flag before any action is taken.</p>` },
      { h: 'Children', body: html`<p>CampusFind is not intended for anyone under ${config.minAge}. Registration asks for your date of birth and refuses anyone below that age; the date is not saved. If someone is turned away, this browser is also blocked from retrying for 24 hours using the same session identifier. We do not knowingly collect data from children. If you believe a child has registered, contact us and we will delete the account.</p>` },
      { h: 'Emails we send', body: html`<p>CampusFind sends only service emails, such as password-reset links, and these are delivered by Firebase Authentication. We do not send marketing or promotional email. If that ever changes, every such email will carry a working unsubscribe link and our postal address, and we will ask for your consent first where the law requires it.</p>` },
      { h: 'Cookies and similar technologies', body: html`<p>We use one essential session cookie and one preference item in your browser. We do not use advertising or tracking cookies. See the <a href="/cookies">Cookie policy</a>.</p>` },
      { h: 'Changes to this policy', body: html`<p>We will post any update here with a new version and date and notify members of material changes in the app.</p>` },
      { h: 'Contact', body: html`<p>Privacy questions and requests: ${contact()}.</p>${postal()}` },
    ],
  });
}

/* -------------------------------------------------------------- cookies */
function cookies(req) {
  return legalPage(req, {
    path: '/cookies',
    title: 'Cookie policy',
    intro: 'CampusFind keeps cookies to the minimum needed to work. There is no advertising, analytics or cross-site tracking.',
    sections: [
      { h: 'What are cookies?', body: html`<p>Cookies are small text files a website stores in your browser. Similar technologies, such as your browser’s local storage, work in a comparable way. We refer to all of them as “cookies”.</p>` },
      { h: 'What we use', body: html`<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Type</th><th>Purpose</th><th>Lifetime</th></tr></thead><tbody>
          <tr><td><code>__session</code> (<code>cf_sid</code> in development)</td><td>Strictly necessary cookie</td><td>Keeps you signed in, protects forms against cross-site request forgery and carries short confirmation messages. It is HttpOnly (scripts cannot read it), Secure (HTTPS only) and SameSite=Lax. It holds a random identifier, not personal data.</td><td>Up to 7 days, renewed while you use the site; removed when you sign out</td></tr>
          <tr><td><code>cf-theme</code></td><td>Preference (local storage)</td><td>Remembers whether you chose the light or dark colour theme.</td><td>Until you clear your browser data</td></tr>
        </tbody></table></div>` },
      { h: 'What we do not use', body: html`<ul><li>No advertising or marketing cookies.</li><li>No analytics or behaviour-tracking cookies.</li><li>No social-media tracking pixels.</li><li>No session-replay, screen-recording or keystroke-capture tools. We never record what you type or how you move around the site.</li><li>No third-party cookies set by CampusFind. Fonts and scripts are served from our own domain, so your browser does not contact Google or any other font or script host when you visit.</li></ul>` },
      { h: 'Consent', body: html`<p>Strictly necessary cookies do not need your consent because the service cannot work without them. The theme preference is stored only because you ask for it by switching theme. If we ever add optional cookies, we will ask first and give you a way to refuse.</p>` },
      { h: 'Managing cookies', body: html`<p>You can delete or block cookies in your browser settings. If you block the session cookie you will not be able to sign in or submit forms. Clearing local storage resets your theme to your device’s default.</p>` },
      { h: 'More information', body: html`<p>See the <a href="/privacy">Privacy policy</a> for how we handle personal data, or contact ${contact()}.</p>` },
    ],
  });
}

/* ----------------------------------------------------------- moderation */
function moderation(req) {
  return legalPage(req, {
    path: '/moderation',
    title: 'Moderation & appeals',
    intro: 'How we review reports, what actions we can take, what you will be told, and how to challenge a decision.',
    sections: [
      { h: 'Our approach', body: html`<p>CampusFind is moderated by people. Reports are reviewed by trained staff who check the content, its history and the Community rules before deciding. Decisions are recorded in an audit log so they are traceable. Payment, promotion or popularity never changes a moderation outcome.</p>` },
      { h: 'How reports work', body: html`<ol><li><strong>Report.</strong> Any signed-in member can report a listing or a member and choose a reason. Duplicate open reports are merged and daily limits prevent abuse.</li><li><strong>Queue.</strong> The report enters the moderation queue. Rule-based screening may also flag a listing for review; a flag never removes anything by itself.</li><li><strong>Review.</strong> A moderator inspects the content, the account history and earlier reports.</li><li><strong>Decision.</strong> The moderator dismisses the report or applies an action, with a recorded reason.</li><li><strong>Notice.</strong> The affected member is notified. The reporter is told their report was reviewed, without private details about the other person.</li></ol>` },
      { h: 'Actions we can take', body: html`<ul><li><strong>Warning</strong> for a first or minor breach.</li><li><strong>Hide</strong> a listing while it is checked, or <strong>remove</strong> it for a clear breach.</li><li><strong>Restrict</strong> an account so it can browse and manage existing content but cannot publish or report.</li><li><strong>Suspend</strong> an account for a set time; the member is signed out until it ends.</li><li><strong>Ban</strong> an account permanently for serious or repeated breaches.</li></ul><p>We choose the least severe action that protects members, but serious harm (for example fraud, threats or sexual exploitation) may lead directly to a ban and referral to the authorities.</p>` },
      { h: 'What you will be told', body: html`<p>When we act on your listing or account you will receive a notification explaining what happened and, where it is safe to do so, the reason. We may withhold details if telling you would put someone at risk, compromise an investigation or breach the law.</p>` },
      { h: 'False and abusive reports', body: html`<p>Reporting is for genuine concerns. If a moderator finds a report was knowingly false or malicious, the reporter’s account is marked. After repeated unfounded reports, the ability to report may be limited.</p>` },
      { h: 'How to appeal', body: html`<p>If you believe a decision about your content or account was wrong, you can appeal.</p><ol><li>Contact ${contact()} within <strong>30 days</strong> of the decision.</li><li>Give your account email, the listing or report number if you have it, and explain why you think the decision should change. Add any evidence that helps.</li><li>A different staff member from the original decision-maker will review it where possible.</li><li>We will reply with the outcome and reasons. The decision may be upheld, reduced or reversed, and if reversed we will restore your content or access.</li></ol><p>Appeals do not pause an action that is needed to protect members, but we will handle them promptly and in good faith. Our decision on appeal does not remove any right you have under the law.</p>` },
      { h: 'Emergencies and illegal content', body: html`<p>CampusFind is not an emergency service. If someone is in immediate danger, contact campus security or your local emergency number first. Report suspected illegal content using the Report option and, where appropriate, to the police. We may preserve relevant records and cooperate with lawful requests from the authorities.</p>` },
      { h: 'Transparency', body: html`<p>Moderator and administrator actions are logged with who acted, when and why. Access to moderation tools is limited by role, and staff must re-enter their password to open the admin area.</p>` },
    ],
  });
}

/* ------------------------------------------------------------ copyright */
const D = L.dmca;
/** Where infringement notices go: the designated agent's email when set, otherwise the general contact. */
const agentContact = () => (D.email ? html`<a href="mailto:${D.email}">${D.email}</a>` : contact());

/** The agent block shows exactly what the operator has registered, and never claims a registration that does not exist. */
function dmcaAgent() {
  const rows = [
    D.agentName && html`<li><strong>Agent:</strong> ${D.agentName}</li>`,
    html`<li><strong>Email:</strong> ${agentContact()}</li>`,
    (D.address || L.postalAddress) && html`<li><strong>Address:</strong> ${D.address || L.postalAddress}</li>`,
    D.registrationNo && html`<li><strong>US Copyright Office DMCA directory number:</strong> ${D.registrationNo}</li>`,
  ].filter(Boolean);
  return html`<p>Notices of claimed copyright infringement go to our designated agent:</p><ul>${rows}</ul>${D.registrationNo ? '' : html`<p class="muted">Our agent registration with the US Copyright Office is in progress. Until it is complete, send notices to the email above and we will treat them in the same way.</p>`}`;
}

function copyright(req) {
  return legalPage(req, {
    path: '/copyright',
    title: 'Copyright & takedown',
    intro: 'We respect intellectual-property rights and expect members to do the same. This page explains how to tell us about content that infringes your rights.',
    sections: [
      { h: 'Our policy', body: html`<p>Members may publish only content they own or have permission to use. We remove or disable access to content that infringes copyright or other intellectual-property rights when we receive a valid notice, and we may end the access of members who repeatedly infringe.</p>` },
      { h: 'Designated agent for notices', body: dmcaAgent() },
      { h: 'Sending a notice', body: html`<p>To report infringing content, send ${agentContact()} a notice that includes:</p><ol><li>your name, address, email address and phone number;</li><li>a description of the work you say has been infringed (and, where relevant, proof of ownership);</li><li>the web address (URL) of the listing or content on CampusFind that you say infringes;</li><li>a statement that you have a good-faith belief that the use is not authorised by the rights holder, its agent or the law;</li><li>a statement, made under penalty of perjury where the law requires, that the information in the notice is accurate and that you are the rights holder or authorised to act for them;</li><li>your physical or electronic signature.</li></ol><p>Incomplete notices may delay action. Please do not use this process for other complaints; use the Report option instead.</p>` },
      { h: 'What happens next', body: html`<p>We review the notice, may hide the content while we do, and notify the member who posted it. If the notice is valid we remove the content and keep a record of the action.</p>` },
      { h: 'Counter-notice', body: html`<p>If your content was removed and you believe that was a mistake or that you have the right to use it, send ${contact()} a counter-notice with your name and contact details, a description and the former location of the content, a statement that you believe in good faith it was removed by mistake or misidentification, and your signature. We will pass it to the original complainant. Unless they tell us within a reasonable period (about 10 working days) that they have started legal action, we may restore the content.</p>` },
      { h: 'Repeat infringers', body: html`<p>Members who repeatedly post infringing content may have their accounts restricted, suspended or banned.</p>` },
      { h: 'Misuse of this process', body: html`<p>Knowingly sending a false notice or counter-notice can have legal consequences and may lead to action against your account.</p>` },
      { h: 'Other rights', body: html`<p>For complaints about trade marks, privacy, defamation or other legal rights, contact ${contact()} with the listing address and details of the problem. We will assess it under our rules and the law that applies.</p>` },
    ],
  });
}

/* ----------------------------------------------------- data protection */
function dataProtection(req) {
  return legalPage(req, {
    path: '/data-protection',
    title: 'Data protection policy',
    intro: html`How CampusFind protects personal data and meets the Data Protection Act, 2012 (Act 843) of Ghana. It sits alongside the <a href="/privacy">Privacy policy</a>, which lists exactly what we collect and why.`,
    sections: [
      { h: 'Scope and responsibility', body: html`<p>This policy covers all personal data processed through CampusFind: member accounts, listings, messages, reports, payments for promotions and the records we keep to run the service safely. ${L.entity} is the <strong>data controller</strong> and is accountable for compliance. Contact for data protection matters: ${contact()}.</p>${postal()}` },
      { h: 'Registration with the Data Protection Commission', body: html`<p>Act 843 requires data controllers to register with the Data Protection Commission of Ghana. The operator registers CampusFind as a data controller and renews that registration as the law requires. Members can ask us for the registration details at any time.</p>` },
      { h: 'The principles we follow', body: html`<p>We process personal data in line with the data protection principles in Act 843:</p><ol>
        <li><strong>Accountability.</strong> The operator is responsible for every processing activity, including processing done for us by our service providers.</li>
        <li><strong>Lawfulness of processing.</strong> We process data only with a lawful basis: to provide the service you signed up for, to meet legal duties, to protect members, or with your consent.</li>
        <li><strong>Specification of purpose.</strong> We collect data for clear, stated purposes, set out in the Privacy policy, and only as much as each purpose needs.</li>
        <li><strong>Compatibility of further processing.</strong> We do not reuse data for an unrelated purpose without a lawful basis or your consent.</li>
        <li><strong>Quality of information.</strong> You can correct your profile at any time, and we act on correction requests promptly.</li>
        <li><strong>Openness.</strong> Our documents explain in plain language what we do with data, and we tell you about material changes.</li>
        <li><strong>Data security safeguards.</strong> We protect data with the technical and organisational measures described below.</li>
        <li><strong>Data subject participation.</strong> You can see, correct, object to and delete your data as described in section 6.</li></ol>` },
      { h: 'How we keep data secure', body: html`<ul>
        <li>All traffic to CampusFind is encrypted in transit (HTTPS, with Strict Transport Security in production).</li>
        <li>Passwords are handled by Google Firebase Authentication and are never stored or seen by the operator.</li>
        <li>Data is stored in Google Cloud Firestore, which encrypts data at rest.</li>
        <li>Staff access is limited by role (moderator, admin, super admin), staff re-enter their password to open the admin area, and every staff action is written to an audit log.</li>
        <li>Forms are protected against cross-site request forgery, logins are rate-limited and accounts lock after repeated failed attempts.</li>
        <li>A strict Content Security Policy blocks third-party scripts, and uploaded photos are re-encoded to strip hidden data before they are stored.</li>
        <li>The service is tested regularly, including automated security tests and vulnerability scans.</li></ul>` },
      { h: 'Who processes data for us', body: html`<p>We use a small number of service providers (processors), each bound by its own terms and data protection commitments:</p><ul>
        <li><strong>Google Firebase / Google Cloud:</strong> sign-in, database and file storage.</li>
        <li><strong>Vercel:</strong> hosting of the website.</li>
        <li><strong>Paystack:</strong> processing of payments for paid promotions. Card and Mobile Money details go directly to Paystack; CampusFind never sees or stores them.</li>
        <li><strong>Anthropic:</strong> only if you choose to use the AI assistant, to process the questions you type. Assistant chats are deleted after 30 days.</li></ul>
        <p>We do not sell personal data and do not share it for advertising.</p>` },
      { h: 'Your rights', body: html`<p>Under Act 843 you have the right to:</p><ul>
        <li><strong>Access</strong> the personal data we hold about you, and be told how it is used and who it is shared with.</li>
        <li><strong>Correction</strong> of data that is inaccurate, out of date, incomplete or misleading. Most of it you can edit yourself on your profile.</li>
        <li><strong>Deletion</strong> of data we no longer have a lawful reason to keep. You can delete your account from your profile.</li>
        <li><strong>Object</strong> to processing that causes you unwarranted damage or distress.</li>
        <li><strong>Refuse direct marketing.</strong> We do not send marketing; if that ever changes, we will ask first and every message will let you opt out.</li></ul>
        <p>Send requests to ${contact()}. We may ask you to confirm your identity, and we reply within the time the law allows. Using these rights is free.</p>` },
      { h: 'Data breaches', body: html`<p>If personal data is accessed, disclosed or lost without authorisation, we will contain it, assess the risk, notify the Data Protection Commission and the affected members as Act 843 requires, as soon as reasonably practicable, and record what happened and what we changed.</p>` },
      { h: 'Retention', body: html`<p>We keep data only as long as we need it for the purposes in the Privacy policy or as the law requires. Deleted accounts are removed from public view straight away. Moderation, audit and payment records are kept for a limited period to protect members and meet legal and tax duties, then deleted.</p>` },
      { h: 'International transfers', body: html`<p>Our providers may store or process data outside Ghana. We use providers that offer recognised safeguards for international transfers and transfer only what is needed to run the service.</p>` },
      { h: 'Complaints', body: html`<p>Please contact us first at ${contact()} so we can put things right. You also have the right to complain to the <strong>Data Protection Commission of Ghana</strong>.</p>` },
      { h: 'Review of this policy', body: html`<p>We review this policy at least once a year and whenever the service or the law changes. The version and date at the top show the latest update.</p>` },
    ],
  });
}

/* ------------------------------------------------------ seller terms */
function businessTerms(req) {
  const P = config.payments;
  return legalPage(req, {
    path: '/business-terms',
    title: 'Seller & business terms',
    intro: html`Extra terms for anyone who sells on CampusFind, including hostel managers, food vendors, shops and service providers. They add to the <a href="/terms">Terms of use</a> and the <a href="/rules">Community rules</a>, which still apply in full.`,
    sections: [
      { h: 'Who these terms apply to', body: html`<p>These terms apply when you post in the Business category, choose a business type (Hostel &amp; rooms, Food &amp; drinks, Shop &amp; retail, Services or Other), buy a Business or Premium promotion, or otherwise offer goods or services for money on CampusFind.</p>` },
      { h: 'Who you are', body: html`<ul><li>Use your real name or your real, registered business name. Do not pretend to be another business, the university or a student society.</li><li>You must be allowed to sell what you list. If you list on behalf of a business, you confirm you have its permission.</li><li>We may ask for proof of identity, ownership or authority and may hide a listing until we receive it.</li></ul>` },
      { h: 'Honest listings', body: html`<ul><li>Describe what you sell accurately, with genuine, current photos. Do not use stock or borrowed photos to describe a specific room or product.</li><li>Show prices in Ghana cedis (${config.currency.code}). Say what the price includes and list any extra charges, such as utilities, service charges or delivery fees.</li><li>Keep listings up to date. Close a listing when the room is let or the item is sold out.</li><li>Do not post the same listing many times or use misleading titles to appear in more searches.</li></ul>` },
      { h: 'Hostels and accommodation', body: html`<ul><li>List only accommodation you own or are authorised to let, and follow the law and local rules that apply to it, including tenancy, safety and building requirements.</li><li>State the rent, the period it covers (for example per semester or per year), any deposit, what is included and the real location.</li><li>Let students view the room, or give an honest virtual tour, before asking for any payment, and give a written receipt for every payment you receive.</li><li>Do not demand payment for a room you cannot provide or take several deposits for the same room.</li></ul>` },
      { h: 'Food vendors', body: html`<ul><li>Hold and keep up to date the permits, health certificates and registrations your local authority and food regulators require, and follow food hygiene and safety rules.</li><li>Describe food accurately and say clearly if a dish contains common allergens, such as nuts, eggs, milk, fish or gluten.</li><li>Prices shown must be the prices you charge.</li></ul>` },
      { h: 'Shops and service providers', body: html`<ul><li>Sell only lawful goods and services. Counterfeit goods, prohibited items and anything listed in the Community rules as banned are not allowed.</li><li>Honour the warranties, returns and consumer rights the law gives your customers.</li><li>If you take bookings, keep appointments or tell the customer in good time if you cannot.</li></ul>` },
      { h: 'Payments between you and your customers', body: html`<p>CampusFind is a directory. We do not take part in, collect or guarantee payments between sellers and buyers. You are responsible for your sales, your receipts, refunds you owe your customers and any taxes, licences or levies on your business, including those administered by the Ghana Revenue Authority.</p><p>Do not ask buyers to pay with gift cards, or to pay in full before they have seen what they are buying, unless that is normal and clearly explained for the type of business.</p>` },
      { h: 'Paid promotions', body: html`<p>Basic listings are free. A Business advertisement costs ${money(P.prices.business)} and a Premium business promotion costs ${money(P.prices.premium)}, each for ${P.businessDays} days. Promotions are one-off payments, never renew by themselves, are always labelled on the site and do not change moderation decisions. Refunds follow the <a href="/refunds">Payments &amp; refund policy</a>.</p>` },
      { h: 'Reviews of your business', body: html`<p>Do not post fake reviews, pay for reviews, or pressure customers to change what they say. Members may report businesses that break these terms.</p>` },
      { h: 'Enforcement', body: html`<p>We may hide or remove a listing, end a promotion without refund where these terms were broken, restrict or ban an account, and keep records or report matters to the authorities where the law requires. Decisions can be appealed as described in <a href="/moderation">Moderation &amp; appeals</a>.</p>` },
      { h: 'Contact', body: html`<p>Questions about selling on CampusFind: ${contact()}.</p>` },
    ],
  });
}

/* ---------------------------------------------------------- refunds */
function refunds(req) {
  const P = config.payments;
  return legalPage(req, {
    path: '/refunds',
    title: 'Payments & refund policy',
    intro: html`How paid promotions on CampusFind are charged and refunded. Posting a basic listing is always free.`,
    sections: [
      { h: 'What you can pay for', body: html`<ul>
        <li><strong>Featured listing:</strong> ${money(P.prices.featured)} for ${P.featuredDays || 7} days.</li>
        <li><strong>Business advertisement:</strong> ${money(P.prices.business)} for ${P.businessDays} days.</li>
        <li><strong>Premium business promotion:</strong> ${money(P.prices.premium)} for ${P.businessDays} days, including featured placement.</li></ul>
        <p>Prices are in Ghana cedis (${config.currency.code}). The price shown next to the button is the price you pay.</p>` },
      { h: 'How payment works', body: html`<p>Online payments are processed by Paystack by Mobile Money or card; CampusFind never sees or stores your card or Mobile Money details. Where online payment is not available, you receive payment instructions and an order number, and an administrator switches the promotion on once your payment arrives. Every promotion is a one-off payment and <strong>never renews automatically</strong>.</p>` },
      { h: 'When you get a full refund', body: html`<ul>
        <li>We could not switch your promotion on after you paid.</li>
        <li>You were charged twice or charged the wrong amount.</li>
        <li>Your listing was removed by a moderator before the promotion started, and it did not break our rules.</li>
        <li>You cancel a manual-payment order before it is confirmed (nothing is charged).</li></ul>` },
      { h: 'When a refund is not given', body: html`<ul>
        <li>The promotion has already gone live and run, in whole or in part, as described.</li>
        <li>The listing or promotion was removed because it broke the <a href="/terms">Terms of use</a>, the <a href="/rules">Community rules</a> or the <a href="/business-terms">Seller &amp; business terms</a>.</li>
        <li>You changed your mind after the promotion started, or the promotion did not bring the results you hoped for. Promotions increase visibility; they do not guarantee sales.</li></ul>
        <p>Nothing in this policy takes away any right to a refund that the law gives you.</p>` },
      { h: 'How to ask for a refund', body: html`<p>Contact ${contact()} within 14 days of the payment with your order number (shown on the <a href="/orders">My orders</a> page) and the reason. We reply within 5 working days. Approved refunds go back to the original payment method; the time it takes to reach you depends on Paystack and your bank or Mobile Money provider.</p>` },
      { h: 'Payments between members', body: html`<p>CampusFind does not handle payments between buyers and sellers, so it cannot refund them. Raise problems with the seller first, and report listings that look fraudulent so moderators can act.</p>` },
    ],
  });
}

/* -------------------------------------------------------- disclaimer */
function disclaimer(req) {
  return legalPage(req, {
    path: '/disclaimer',
    title: 'Disclaimer',
    intro: html`What CampusFind is, what it is not, and the limits of our responsibility. Please read it together with the <a href="/terms">Terms of use</a>.`,
    sections: [
      { h: 'CampusFind is a directory', body: html`<p>CampusFind lets members publish and find listings. It is not a party to any sale, rental, booking or exchange between members, and it is not an agent, landlord, employer, broker or seller. Any agreement is made directly between the people involved.</p>` },
      { h: 'Listings are posted by members', body: html`<p>Members, including businesses, write their own listings. We moderate reports and screen for obvious scams, but we cannot check every listing and do not guarantee that any listing, price, photo, room, product, service, job or event is accurate, lawful, safe or available. Hostels, food and other businesses are not inspected or endorsed by CampusFind, and a promotion badge only means the seller paid for visibility.</p>` },
      { h: 'Stay safe', body: html`<ul><li>Meet in busy, public places on campus and tell a friend where you are going.</li><li>View rooms and items before paying. Never pay deposits for a room you have not seen, and never pay with gift cards.</li><li>Keep conversations on CampusFind until you trust the other person, and never share passwords or one-time codes.</li><li>Report anything suspicious using the Report link. If someone is in danger, contact campus security or the police first.</li></ul>` },
      { h: 'Lost and found', body: html`<p>The Lost &amp; Found board helps members reunite items with their owners. CampusFind does not hold, collect or deliver lost property and is not responsible for items. Check that a claimant is the real owner, for example by asking for a detail only the owner would know, and consider handing valuables to campus security.</p>` },
      { h: 'The AI assistant', body: html`<p>The optional assistant is an AI tool. It can make mistakes and its answers are not professional, legal or financial advice. Check important details yourself. It cannot post, message or report for you.</p>` },
      { h: 'Links and third parties', body: html`<p>Listings and pages may link to other websites or services. We do not control them and are not responsible for their content, products or privacy practices.</p>` },
      { h: 'No warranty and limits of liability', body: html`<p>To the fullest extent the law allows, CampusFind is provided “as is” and “as available”, without warranties of any kind, and the operator is not liable for losses arising from dealings between members, from listings, or from interruptions to the service. Our full liability terms are in the <a href="/terms">Terms of use</a>. Nothing here limits liability that cannot be limited by law.</p>` },
      { h: 'Not affiliated', body: html`<p>Unless a page says otherwise, CampusFind is operated independently and is not run or endorsed by any university, college or student union.</p>` },
      { h: 'Contact', body: html`<p>Questions about this disclaimer: ${contact()}.</p>` },
    ],
  });
}

module.exports = { legalHub, terms, privacy, cookies, moderation, copyright, dataProtection, businessTerms, refunds, disclaimer, DOCS };
