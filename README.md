# CampusFind

Campus discovery platform built from *CampusFind Complete Building & Technical Documentation v2.0*, running on **Firebase**.
Students browse and post listings (books, rooms, services, jobs, events, lost property). Members report problems,
moderators and admins review them, and a **super admin** owns the platform.

| Layer | Technology |
|---|---|
| Identity | **Firebase Authentication** (email + password, hashed by Google, reset emails sent by Firebase) |
| Data | **Cloud Firestore** (all application data) |
| Photos | **Firebase Storage** (private bucket) or, on the free plan, a private **Firestore** collection (`PHOTO_STORE=firestore`). Served through the app either way. |
| Server | Node.js 20+ and Express 5 using the **Firebase Admin SDK** |
| Access control | `firestore.rules` and `storage.rules` deny every client request. The server is the only door. |

Runtime dependencies: `express`, `firebase-admin`, `multer`, `compression`, `sharp` (image re-encoding).

## Run it locally (no Firebase project needed)

Requires Node 20+ and Java 11+ (for the emulators).

```bash
npm install
npm run start:emulated     # starts Auth + Firestore + Storage emulators, loads demo data, serves http://localhost:3000
npm test                   # 31 end-to-end tests against the emulators (app flows and production mode)
npm run check              # syntax check of every source file
```

`start:emulated` prints a local super admin (`owner@campusfind.local`) and demo members. These exist only inside the emulator.
Staff open **/admin/login**, which asks for the password again (step-up) and expires after 30 minutes.

## Connect your real Firebase project

1. **Create the project** at console.firebase.google.com. Enable **Authentication > Email/Password**, **Firestore** (production mode) and **Storage**.
2. **Get credentials**: Project settings > Service accounts > *Generate new private key*, and copy the **Web API key** from the General tab.
3. **Set environment variables** (see `.env.example`): `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_SERVICE_ACCOUNT` (JSON or base64), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `BASE_URL`.
4. **Deploy rules and indexes** once: `npx firebase login`, set your project id in `.firebaserc`, then `npm run deploy:rules`.
5. **Password-reset links**: in Authentication > Templates > Password reset > *Customize action URL*, set it to `https://YOUR-DOMAIN/reset`. Firebase sends the email; CampusFind hosts the new-password page.
6. **Optional hardening**: turn on Firestore scheduled backups or point-in-time recovery. Expired sessions are already deleted hourly by the app; optionally also add a Firestore TTL policy on `sessions.expires_ts` (needs the Blaze plan).
7. `npm start`. On first start the categories are seeded and the super admin is created.

The key in `FIREBASE_SERVICE_ACCOUNT` is a full-access secret. Keep it in a secrets manager, never in the repository.

## Roles

| Role | Can do |
|---|---|
| Visitor | Browse public listings, register, sign in. Contact details are hidden. |
| Student | Post and manage own listings, search, report, manage profile, delete own account. |
| Moderator | Work the report queue, hide/remove/restore listings, warn members. |
| Admin | Everything a moderator can, plus members (restrict, suspend, ban, reinstate), categories, featured listings, audit log. |
| **Super admin** | Everything an admin can, plus the **Super admin page** (`/admin/system`): platform settings, staff accounts and roles, health, data export, sign-out-all. Only role that can change roles. |

Guards: nobody can change their own role, the last super admin cannot be demoted, and staff accounts cannot be sanctioned (demote first).

## The Super admin page

- **System health:** uptime, Node version, Firebase project, member and listing counts, photos in Storage, active sessions.
- **Platform settings:** open/close registration, pause new listings, maintenance mode (staff keep access), daily limits, site-wide announcement. Stored in Firestore `settings/platform`.
- **Staff and access:** list of staff, create moderator/admin/super admin accounts (created in Firebase Auth and Firestore), change roles from a member's page.
- **Data export and maintenance:** download every collection (except sessions) as JSON, clear expired sessions, sign everyone else out after an incident.
- **Security snapshot:** locked accounts, failed sign-ins and staff verifications in the last 24 hours.

Every change is written to the audit log.

## Data model (Firestore)

```
users/{user_id}              account, role, status, embedded profile, uid -> Firebase Auth
categories/{category_id}
listings/{listing_id}        embeds images[] and cover filename
reports/{report_id}          reporter_id null = automatic screening flag; owner_id = affected member
moderation_actions/{auto}
activity_logs/{auto}         audit trail (never contains passwords or tokens)
notifications/{auto}
sessions/{sha256(token)}     server-side sessions with CSRF token, flash messages, admin step-up window
settings/platform
counters/{name}              sequential ids for users, listings, reports, categories
```

Every moderation decision is **one atomic batch**: state change, `moderation_actions` record, audit log and notification.

## Documentation traceability

| Req | Where |
|---|---|
| FR-01 Authentication | `src/services/auth.js`, `src/services/identity.js`, `src/middleware/session.js` (Firebase Auth, lockout after 5 failures, rotating sessions, Firebase reset emails) |
| FR-02 Authorization | `src/middleware/auth.js` (permission map, server-side on every route, CSRF) |
| FR-03 Profile | `src/routes/account.js` |
| FR-04 Listings | `src/routes/listings.js`, `src/repo/listings.js` (owner-only edit/delete, photos verified by magic bytes, stored in Storage) |
| FR-05 Categories | `src/repo/categories.js`, admin CRUD at `/admin/categories` |
| FR-06 Search | `/browse`: keywords, category, max price, sort, pagination |
| FR-07 Reporting | `/report`; one open report per reporter per target (transaction), daily limit, false-report strikes |
| FR-08 Moderation | `src/services/moderation.js` |
| FR-09 Audit | `activity_logs`, viewer at `/admin/audit` |
| FR-10 Notifications | `notifications` collection, bell and `/notifications` |
| FR-11 Dashboard | `/admin` with KPIs and charts |
| FR-12 Safety | validation, escaping template engine, strict CSP, rule-based screening that flags for human review |
| FR-13/14 Availability, recovery | `/healthz` (checks Firestore), JSON export, Firestore backups |

## Security notes

- Firestore and Storage rules deny all client access. A leaked web API key cannot read or write data.
- Strict Content-Security-Policy (no inline script or style), HSTS in production, `nosniff`, frame denial.
- HttpOnly, SameSite=Lax session cookie (`__Host-` prefix in production). Only a SHA-256 of the token is stored.
- Passwords never touch Firestore. Firebase Auth stores and hashes them and rate-limits sign-in attempts. CampusFind adds its own 5-strike lockout.
- Uploads: JPG/PNG/WebP only, identified by file signature, 3 MB each, max 4, random filenames, served with a sandbox CSP. With `PHOTO_STORE=firestore` every photo is decoded and re-encoded, which also removes hidden metadata and rejects files that only pretend to be images.
- Login and reset responses never reveal whether an email is registered.
- Rate limiting has two layers. Every request passes a cheap in-memory limiter. Sign-in, sign-up and password-reset attempts are also counted in Firestore (`rate_limits`, keyed by a hash, no IP stored), so the limit holds when the host runs several instances. If Firestore is unreachable those routes fall back to the in-memory limit. Finished windows are deleted hourly.

## Scale notes

Search reads a 10-second snapshot of the newest 500 active listings and filters in memory. That is fast and flexible for a campus. Beyond a few thousand active listings, move search to Algolia, Typesense or Vertex AI Search. Admin lists look at the newest 500 records, and the audit viewer at the newest 500 events.

## Hosting

The app is a stateless Node server (all data is in Firebase), so it runs anywhere that runs a container or `npm start`.

### Vercel (free plan, no Firebase billing needed)

The Express app runs as one Vercel function (`api/index.js`); `public/` is served by Vercel's CDN (`vercel.json`). Data stays in Firebase (Authentication and Firestore both work on the free Spark plan).

1. **Service-account key:** Firebase console > Project settings > Service accounts > *Generate new private key*. Vercel runs outside Google Cloud, so the server needs this key to reach Firebase. Treat the file as a password and delete the download once it is stored.
2. Store it as the Vercel variable `FIREBASE_SERVICE_ACCOUNT` (base64 of the JSON avoids line-break problems):
   `[Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json")) | vercel env add FIREBASE_SERVICE_ACCOUNT production`
3. Other variables (already set for this project): `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `ADMIN_EMAIL`, `CONTACT_EMAIL`, `LEGAL_ENTITY`, `PUBLIC_BROWSING`, `PHOTOS_ENABLED=true`, `PHOTO_STORE=firestore`, and `BASE_URL` (your public address).
4. Deploy: `vercel deploy --prod`.
5. Open `/forgot` on the live site, enter the admin email and use the Firebase reset link to choose the super admin password.

**Photos:** on the free plan set `PHOTO_STORE=firestore`. Photos are then kept in a private Firestore collection (`photos`), re-encoded to WebP at up to 1600 px and under about 900 KB so each fits one document, and stripped of EXIF data such as GPS location. The browser also shrinks big phone pictures before upload, because Vercel rejects request bodies over 4.5 MB. Firestore's free quota is 1 GiB of storage and 50,000 reads a day, and photos are cached by the CDN for only ten minutes, so a deleted photo stops being served quickly. That suits a campus. If you outgrow it, upgrade to Blaze, create the Storage bucket, set `FIREBASE_STORAGE_BUCKET`, and remove `PHOTO_STORE` to use Firebase Storage instead. Set `PHOTOS_ENABLED=false` to run with no photos at all.

### Option: Firebase Hosting + Cloud Function (Firebase CLI only)

No Docker or `gcloud` needed. The whole app deploys as one function (`app`, in `functions.js`) behind Firebase Hosting, which serves static files from its CDN and gives you free HTTPS and a custom domain. Requires the **Blaze (pay-as-you-go)** plan, which Cloud Functions and Cloud Storage both need. A campus-sized site normally stays inside the free allowances.

1. `npx firebase login`, then create a dedicated Firebase project (or pick an empty one) and upgrade it to **Blaze** in the console.
2. In the console enable **Authentication > Email/Password**, **Firestore** (production mode) and **Storage**.
3. Point the CLI at the project: `npx firebase use --add` (or edit `.firebaserc`).
4. Create a `.env` file in the project folder. Cloud Functions reserves names starting with `FIREBASE_`, so the web API key is called `WEB_API_KEY` here:
   ```
   WEB_API_KEY=your-web-api-key
   BASE_URL=https://YOUR-PROJECT.web.app
   ADMIN_EMAIL=you@example.com
   CONTACT_EMAIL=you@example.com
   LEGAL_ENTITY=Your organisation
   GOVERNING_LAW=Your jurisdiction
   CAMPUS_NAME=Your University
   ```
5. **Super admin password:** nothing to store. On the first request the app creates the super admin for `ADMIN_EMAIL` with a random password that is never shown. Open `/forgot`, enter that email and use the Firebase reset link to choose your own password. (To pick one up front instead, add `ADMIN_PASSWORD=...` to `.env`; a reset email is safer.)
6. Deploy everything (rules, indexes, function, hosting): `npm run deploy`
7. Open `https://YOUR-PROJECT.web.app/forgot`, set your super admin password from the email, then sign in at `/admin/login`.
8. Set the password-reset link (Authentication > Templates > Password reset > customise action URL) to `https://YOUR-DOMAIN/reset`.

**Rehearse it locally first:** `npm run rehearse` runs the real member journey through the emulated Hosting and function, including a photo upload. Three production-only pitfalls it already guards against: Hosting only forwards a cookie named `__session`; Hosting strips cookies from cacheable responses (so every page is `private, no-store`); and Cloud Functions pre-reads request bodies, which would break multipart uploads without `src/middleware/rawbody.js`.

### Alternative: Cloud Run + Firebase Hosting

Use this if you prefer containers. Change the rewrite in `firebase.json` to `{ "source": "**", "run": { "serviceId": "campusfind", "region": "us-central1" } }` and remove the `functions` block.

1. **Firebase project ready** (see "Connect your real Firebase project" above) and `npm run deploy:rules` done.
2. **Deploy the server to Cloud Run** from the project folder. The `Dockerfile` is included; it installs production dependencies only and runs as an unprivileged user.
   ```bash
   gcloud run deploy campusfind --source . --region us-central1 --allow-unauthenticated \
     --set-env-vars NODE_ENV=production,FIREBASE_PROJECT_ID=YOUR_PROJECT,FIREBASE_STORAGE_BUCKET=YOUR_BUCKET,BASE_URL=https://YOUR_DOMAIN,ADMIN_EMAIL=you@example.com,CONTACT_EMAIL=you@example.com,LEGAL_ENTITY="Your organisation",GOVERNING_LAW="Your jurisdiction" \
     --set-secrets FIREBASE_WEB_API_KEY=firebase-web-api-key:latest,ADMIN_PASSWORD=campusfind-admin-password:latest
   ```
   Give the Cloud Run service account the roles **Firebase Admin** (or Cloud Datastore User, Firebase Authentication Admin and Storage Object Admin). With that, no service-account key is needed. Keep secrets in Secret Manager, not in the command line.
3. **Put Firebase Hosting in front** (CDN, free TLS, custom domain): `npm run deploy:hosting`. `firebase.json` already rewrites every request to the Cloud Run service named `campusfind` and serves `public/` assets from the CDN. Hosting only forwards a cookie called `__session`, which is why production uses that name.
4. **Add your domain** in Firebase Hosting, then set `BASE_URL` to it and redeploy.
5. **Set the Firebase reset-email link** to `https://YOUR_DOMAIN/reset` (Authentication > Templates).
6. Start-up is strict on purpose: in production the server refuses to start without `FIREBASE_STORAGE_BUCKET`, and logs a warning if `BASE_URL` is not `https://`.

Scaling note: caches and rate limits live in each instance's memory. That is fine for a campus. If you raise `--max-instances` a lot, move rate limiting to a shared store.

### Alternatives

- **Replit**: import the repo, add the secrets from `.env.example`, run `npm start` (`.replit` is included). No persistent disk is needed because data is in Firebase.
- **Any VM or container host**: `docker build -t campusfind . && docker run -p 8080:8080 --env-file .env campusfind`. Put a TLS-terminating proxy in front and keep `NODE_ENV=production` so cookies are `Secure` and HTTP is redirected to HTTPS.

### What production mode does

HTTPS redirect (via `X-Forwarded-Proto`), HSTS, `Secure` + `HttpOnly` session cookie, gzip compression, long-lived caching for fonts and short caching for CSS/JS, `no-store` on personalised pages, graceful shutdown on `SIGTERM`, and crash logging.

### Pre-launch checklist

- [ ] Firebase Authentication, Firestore and Storage enabled; rules and indexes deployed
- [ ] Web API key restricted in Google Cloud console (HTTP referrers not needed; restrict to the Identity Toolkit API)
- [ ] `ADMIN_PASSWORD` stored as a secret; change it after first sign-in
- [ ] `LEGAL_ENTITY`, `CONTACT_EMAIL` and `GOVERNING_LAW` set, and the legal pages reviewed by a lawyer
- [ ] Firestore scheduled backups or point-in-time recovery enabled
- [ ] (Optional) Firestore TTL policy on `sessions.expires_ts`
- [ ] Password-reset action URL set to `https://YOUR_DOMAIN/reset`
- [ ] Custom domain connected and `BASE_URL` updated
- [ ] `POSTAL_ADDRESS` set (shown in the footer and legal pages; required in any marketing email)
- [ ] DMCA designated agent registered and `DMCA_AGENT_*` / `DMCA_REGISTRATION_NO` set (see "Legal-risk checklist")
- [ ] Smoke test: register, post with a photo, search, report, resolve in admin, check `/healthz`

## Legal pages

Published at `/legal`: **Terms of use**, **Privacy policy**, **Cookie policy**, **Community rules**, **Moderation & appeals**, **Copyright & takedown**. They are linked from every page footer, and sign-up records which version of the terms the member accepted (`terms_version`, `terms_accepted_at`). Set `LEGAL_ENTITY`, `CONTACT_EMAIL` and `GOVERNING_LAW` to personalise them, and bump `legal.version` and `legal.updated` in `src/config.js` whenever you change a document. They are working drafts, not legal advice: have them reviewed for your jurisdiction (data-protection law, consumer law, age of consent, and any rules your institution adds).

## Messaging, returned items and the assistant

- **Messages** (`/messages`): a signed-in member can message the poster from any live listing, and the poster replies from their inbox. Threads live in Firestore (`conversations/{listing}-{member}` with a `messages` subcollection). Email addresses and phone numbers are never shown. Sending is rate limited (6 a minute, 80 a day), messages can be reported through the member report, threads are deleted with the account, and threads idle for 12 months are deleted automatically.
- **Mark as returned**: the poster of a Lost & Found listing can close it as returned. People who messaged about it are notified, the listing shows a "returned to its owner" banner, and the home page counts items returned.
- **AI assistant** (`/assistant`, signed-in members): a tool-using helper that answers questions about CampusFind, searches live public listings, and drafts a listing or lost/found report that opens pre-filled in the normal form. It is read-only: it cannot post, message or report, and it never sees contact details, emails or private messages. Listing text is passed to the model as untrusted data. It needs `ANTHROPIC_API_KEY` (optional `ASSISTANT_MODEL`, default `claude-haiku-5-5`). Without a key the page says it is not available. A super admin can switch it off in Super admin settings, and members are limited to 20 questions an hour and 60 a day. Chats are kept 30 days and deleted with the account. The tests run it against a scripted model, so no key is needed to run `npm test`.
## Pricing and paid promotions

Posting is free. Members can pay once, in Ghana cedis, to promote a listing. Prices (override with `PRICE_FEATURED`, `PRICE_BUSINESS`, `PRICE_PREMIUM` in cedis):

| Service | Price | What it does |
|---|---|---|
| Basic student listing | Free | Normal listing, within the daily limit |
| Featured listing | GH₵10 for 7 days | Gold badge and a place in the Featured section on the home page |
| Business advertisement | GH₵50 for 30 days | "Business" badge and a place in the Local businesses section |
| Premium business promotion | GH₵100 for 30 days | Business advert plus featured placement and a gold "Premium" badge |

The 30-day length of the two business products is an assumption (`BUSINESS_DAYS`). Change it if you want something else.

- **Public price list:** `/pricing`. Members buy from **Promote** on a live listing, and see their purchases at `/orders`. The price sits next to each buy button, and the page says there is no automatic renewal.
- **Online payment (Paystack):** set `PAYSTACK_SECRET_KEY`. The member is sent to Paystack to pay by Mobile Money or card, comes back to `/pay/callback`, and the app asks Paystack to confirm the reference, the amount and the currency before it switches the promotion on. Paystack also calls `/pay/webhook`, which checks its HMAC-SHA512 signature, so a payment is applied even if the member closes the browser. Both paths are idempotent, so a promotion is applied exactly once. In the Paystack dashboard, set the webhook URL to `https://YOUR-DOMAIN/pay/webhook`.
- **Manual payment (no key needed):** without `PAYSTACK_SECRET_KEY` the member gets an order number such as `CF-12` and the text in `MANUAL_PAYMENT_INSTRUCTIONS` (for example your Mobile Money number). An admin opens **Admin, Orders**, checks the payment arrived, and presses **Confirm payment received**.
- **Admin, Orders** (`/admin/orders`, admins and super admins): paid in the last 30 days, orders waiting for payment, confirm and refund. A refund removes the days the order added. You return the money yourself, from the Paystack dashboard or Mobile Money.
- **Safety:** prices come only from the server, a promotion is never applied before payment is confirmed, card and Mobile Money details never reach this app, and promoted content can still be moderated.
- **Not covered:** invoices, VAT or other taxes, and receipts. If you are registered for tax in Ghana, talk to an accountant about what you must charge and record.
## Legal-risk checklist

Six common legal traps for new apps, and where CampusFind stands on each. This is engineering guidance, not legal advice.

| Risk | Status | Where |
| --- | --- | --- |
| **Age gate (COPPA and similar)** | Done. Sign-up asks for a date of birth and refuses anyone under `MIN_AGE` (default 16, never below 13). The date is checked and discarded; only "age confirmed" and the minimum age are stored. An under-age attempt blocks that browser session for 24 hours. | `src/routes/auth.js`, `src/middleware/session.js`, test "age gate" |
| **Third-party fonts (GDPR)** | Done. Inter is self-hosted in `public/fonts`, the Content Security Policy allows fonts and scripts from this site only, and a test fails if any page or the stylesheet references another host. | `public/css/app.css`, `src/app.js`, test "no third-party hosts" |
| **Session replay and keystroke capture (CIPA)** | Not present. No analytics, replay or tracking scripts exist, the CSP would block them, and the cookie policy says so. If you add one, add consent first and mask inputs. | Cookie policy, same test |
| **Marketing email (CAN-SPAM)** | No marketing email is sent; only Firebase password-reset emails. Set `POSTAL_ADDRESS` now. Before sending any promotional email add a working unsubscribe link and that address to every message, and record consent. | Privacy policy "Emails we send" |
| **Renewal terms at checkout** | Not applicable: there are no payments or subscriptions. If you add them, show the price, the renewal period and how to cancel directly next to the pay button, and send a reminder before each renewal. | n/a |
| **DMCA agent (safe harbor for user uploads)** | Page and process are done. You must register the agent yourself. | `/copyright` |

### Register your DMCA designated agent

Needed if you serve a US audience and want safe harbor for user uploads. Photos are off for now, but register before you enable them.

1. Open https://dmca.copyright.gov/ and create an account.
2. Add your service name and the web address of the site. Add the agent's name, a mailing address and an email address. A role mailbox such as `dmca@yourdomain` is better than a personal one.
3. Pay the filing fee (about $6) and note the registration number it gives you (shaped like `DMCA-1234567`).
4. Set these variables, then redeploy: `DMCA_AGENT_NAME`, `DMCA_AGENT_EMAIL`, `DMCA_AGENT_ADDRESS`, `DMCA_REGISTRATION_NO`. The `/copyright` page then shows the agent and number and drops the "in progress" notice.
5. Renew every three years, and update the entry whenever the details change. A lapsed registration loses the protection.
## Branding

- **Logo and colours** come from the official CampusFind logo: navy `#021E4C` and amber `#FBB404`. Light and dark artwork lives in `public/img/` (`logo.png`, `logo-light.png`, `logo-mark*.png`, `favicon.png`). Colour variables are at the top of `public/css/app.css`, with a dark theme.
- The logo was supplied as a screenshot, so it is a modest resolution. Replace the PNGs with the original vector or high-resolution export when you have it. The tagline was cropped in the source and is not included.

## Policies

Rules, Privacy and Terms pages are drafts written from sections 22 and 23. Have your institution review them before launch.

## Project layout

```
src/
  app.js, server.js, bootstrap.js, config.js, firebase.js, store.js
  repo/        users, listings, categories, reports (Firestore queries)
  lib/         html (escaping), security (headers, rate limit), validate
  middleware/  session, auth (permissions, CSRF)
  services/    auth, identity (Firebase Auth REST), moderation, audit, notify, settings, screening, images (Storage)
  routes/      public, auth, listings, account, admin (incl. super admin)
  views/       layout, components, pages/{public,account,admin,system}
public/        css, js, img
scripts/       seed-demo.js, dev-emulated.js
tests/         app.test.js
Dockerfile, .dockerignore
firebase.json, firestore.rules, firestore.indexes.json, storage.rules, .firebaserc
```
