# Deploying CampusFind: blue/green

Two environments, **blue** and **green**. One is live on https://campusfind-ruby.vercel.app; the other is where the next
version is built and checked. Switching is instant and the old colour stays ready, so a bad release is undone with one
command.

## Everyday flow

```bash
npm test                 # everything must pass first
npm run bg:stage         # build the current code as the idle colour and smoke-test it (live site untouched)
# open the URL it prints and click through it yourself; it shows a "Test environment" banner
npm run bg:promote       # point the live domain at it (instant, no downtime)
npm run bg:rollback      # if anything is wrong: back to the previous colour, instantly
npm run bg:status        # which colour is live, what is staged, what rollback goes to
```

## What `bg:stage` checks before it lets you promote

Health check, the home page and side panel, browse, business, lost & found, help, pricing, terms, privacy, disclaimer,
sign-in and sign-up pages, members-only pages redirecting to sign-in, security headers, the versioned stylesheet, and
that the build knows it is not live yet. `bg:promote` refuses a build that failed (override only with `--force`).

## How it works

- Every Vercel deployment is an immutable build with its own URL. "Live" is whichever build the production domain points
  at. `bg:stage` runs `vercel deploy --prod --skip-domain`, so the new build gets production settings but not the domain.
- The build's colour comes from `DEPLOY_COLOR`. It is reported by `/healthz` (`{"color":"green","live":true}`) and the
  `X-Deploy-Color` response header.
- A production build opened on any address other than the live domain shows a striped "Test environment" banner and
  tells search engines not to index it.
- Staged builds are private (Vercel Deployment Protection). The smoke tests reach them through `vercel curl` using your
  Vercel login. In CI, set `VERCEL_AUTOMATION_BYPASS_SECRET` instead.
- State is kept in `.deploy/bluegreen.json` (ignored by git and by deploys).

## Important: both colours share the live database

Blue and green use the same Firebase project and the same data, which is normal for blue/green: switching never loses
or splits data. It also means a staged build writes real data if you post or sign up on it. To try changes against
separate test data, create a second Firebase project for staging and give the staged build its credentials. Ask and it
can be wired in as a third, fully separate staging environment.

## Release history

| When | Colour | Build | Notes |
|---|---|---|---|
| 2026-11-09 | blue | campusfind-nvw57ea01 | last build before blue/green |
| 2026-11-09 | green | campusfind-8xi86ym5t | dark mode fix, glass side panel, disclaimers, cache-busting, Turnstile, blue/green |
| 2026-11-09 | blue | campusfind-3u3lduvv1 | contact/admin email switched to ernetinaeshn12@gmail.com; owner handover promoted her to super admin |
| 2026-11-09 | green | campusfind-7xt2x33oy | help page email; handover setting removed |
| 2026-11-09 | blue | campusfind-ipoxxzy5r | handover check for ntikofi780@gmail.com: already a super admin, nothing changed; handover now logs its outcome |
| 2026-11-09 | green | campusfind-i7wofhed8 | handover setting removed |
| 2026-11-09 | blue | campusfind-13ubtzbfd | profile page redesign (two-column card, stats, trust notes, empty state); help centre FAQ and chat polish |
| 2026-11-10 | green | campusfind-7lc740sgc | floating help button on every page with Ask AI and Talk to the team tabs; help centre start cards; AI waits for ANTHROPIC_API_KEY |
| 2026-11-10 | blue | campusfind-dw545jljc | pricing cards get action buttons; public pages no longer show the personal contact email (Help centre, plus SUPPORT_EMAIL when set); MOMO_NUMBER/NAME/NETWORK shown on manual order pages; PIN and chat-privacy FAQs |
| 2026-11-10 | green | campusfind-72xz57xp2 | fix: page animation wrote numbers into the post form description box; post form tips and safety panel; photos on My listings; seller card links to profile; short pages keep footer lower |
| 2026-11-10 | blue | campusfind-mrexjl5np | admin: site menu starts folded to icons on admin pages; admin tables scroll sideways instead of breaking words into letters |
| 2026-11-10 | green | campusfind-jcsmbb01x | Super admin > Payments & contact details: MoMo number, account name, network and support email set from the admin page (no Vercel or redeploy needed) |
| 2026-11-10 | blue | campusfind-qh7p4j9xc | Mobile Money orders: member reports the MoMo transaction ID ("I have sent the money"); admin Orders shows it and a "members say they paid" count |
| 2026-11-10 | green | campusfind-cp5irfgid | staff who can confirm orders get a notification when a member reports a Mobile Money payment |
| 2026-11-10 | blue | campusfind-6wl4yid2b | sharing: WhatsApp / Copy link / phone share sheet on live listings; link previews use the listing photo, price and place (og:image, og:url, canonical) |
| 2026-11-10 | green | campusfind-5y2j0dhsh | search alerts: save a Browse search (keywords, category, max price), notified once when a matching listing first goes live; /alerts page; removed with account deletion |
| 2026-11-11 | blue | campusfind-k4xlhy7mx | order clean-up: unpaid Mobile Money orders cancel after 7 days (not ones the member reported paying), member notified; "Expired, not paid" label; runs when an orders page is opened |
| 2026-11-11 | green | campusfind-8wzhnxdsf | seller reviews: 1-5 stars + comment, only after a listing chat the seller replied to; one per buyer, editable; rating on profile and listing seller card; report pre-fills review text; staff Remove; deleted with account |
| 2026-11-11 | blue | campusfind-hbi10kjed | demand insights: anonymous per-day search counts from Browse (no user/IP stored, phone numbers and emails skipped); Admin > Demand insights shows most searched and "wanted but not found" over 7/30/90 days |
| 2026-11-11 | green | campusfind-21cbcrws1 | Google visibility: /sitemap.xml (public pages, category pages, live listings), robots.txt points to it (test builds blocked), schema.org data on home (site search) and listings (breadcrumbs; price for textbooks, electronics, free items) |
| 2026-11-11 | blue | campusfind-4yy7zzm90 | posters: sellers print an A4 poster with a QR code for any live listing (no contact details printed); Admin > Launch kit posters gives three printable site posters (join, sell, lost & found) |
| 2026-11-11 | green | campusfind-8h59dmy2u | listing freshness: listings stay live 30 days, one reminder 3 days before, then expire (hidden from Browse) with a one-tap Renew in My listings and on the listing; business listings and paid promotions never expire |
| 2026-11-11 | blue | campusfind-7u6vjdfz8 | verified members: Profile > Send verification link (Firebase sends the email via a custom-token sign-in); /reset applies verifyEmail links; badges on profile and seller card: Verified student for *.edu.gh (+ STUDENT_DOMAINS), Email verified otherwise |
| 2026-11-11 | green | campusfind-m7mgdg57r | verified mark on listing cards (purple student / blue email) and Browse filter "Verified sellers only" (verified=1, kept through sort, paging and filter chips) |
| 2026-11-11 | blue | campusfind-fjb5b0133 | security: staff two-step sign-in (authenticator app, encrypted secrets, hashed one-time recovery codes, replay protection, 5 wrong codes lock 15 min, super-admin reset, STAFF_2FA_RESET_EMAIL break-glass); exports strip secrets; HSTS 2 years + preload; /.well-known/security.txt; quick messages + seller reply time |
| 2026-11-11 | green | campusfind-pmia5j5c2 | devices: Profile > Where you're signed in (browser/system, masked network, last used; sign out one or all others; session ids never shown); alert on sign-in from a new browser/system |
| 2026-11-11 | blue | campusfind-g528zeedh | chat safety: messages that share a PIN/one-time code are refused; pay-first, code requests, fake 'sent by mistake' payments and links show the reader a warning (automatic, nobody reads chats); Help FAQ updated |
| 2026-11-11 | green | campusfind-b5fjw40k7 | report a chat message: Report link on each message from the other person; server attaches only that message (checked: reporter in the chat, sender is the reported member, not support chats); moderators see it with its automatic flags |
| 2026-11-11 | blue | campusfind-r6y2k4muh | block members: Block/Unblock on profiles (not staff); no messages either way (listing, direct, existing chats); blocker stops seeing their listings on Home and Browse; Profile > Blocked members; reporting still works |
| 2026-11-11 | green | campusfind-88cagc21r | safety signals: users.blocked_by_count (deduplicated) and per-sender scam-check counts; Admin > Safety signals ranks members blocked by 2+ or with 3+ scam-like messages; counts on the member admin page; no message text shown |
| 2026-11-11 | blue | campusfind-ohv7f809o | offers: buyer makes an offer in a listing chat (one open at a time, GH₵1-1,000,000); seller accepts (listing Reserved for that buyer) or declines; buyer withdraws; Reserved tag on cards/detail; seller can make it available again |
| 2026-11-11 | green | campusfind-may4t1v0q | mark as sold: owner closes textbooks/electronics/free/housing listings as sold (given away / taken); reserved buyer notified with a review link; other askers told; Sold count on public profiles replaces Views |
| 2026-11-11 | blue | campusfind-mjjsdopvk | marketplace health on Admin overview (30 days): chats started, seller answer rate, typical first reply, share of new listings that got a chat, offers made/accepted, deals done, lost items returned |
| 2026-11-11 | green | campusfind-jzjix6zmk | design refresh: computers get a slim sticky top bar (Browse, Categories dropdown, Business, Lost & found, Pricing, Help) and no side panel; account items under the avatar (+ Search alerts); calmer type scale, compact search, smaller chat button; phones unchanged |
| 2026-11-11 | blue | campusfind-cyano8uxa | change notifications: What's new notes (Admin > What's new; banner once per existing member until Got it; /whats-new page; optional send to all Notifications; first note seeded once); saved-listing alerts for price drops, reserved, available again, sold and closed |
| 2026-11-18 | green | campusfind-1huu5dl58 | fix: order page transaction-ID field had no input type (unstyled black box in dark mode on iPhone); dark-mode main buttons now solid blue with white text; payment form and How to pay facts stack on phones; same input fix on admin Categories |
| 2026-11-18 | blue | campusfind-goiyj8pie | phone dark-mode sweep (20 pages): all fields 16px on touch screens (no iPhone zoom-on-tap); dark-mode red buttons readable; test that every input declares a type |
| 2026-11-18 | green | campusfind-mu1aw84xs | admin on phones: every admin table becomes labelled cards under 640px (Confirm payment / Review always on screen); status filters are one swipeable row of pills (class clash fixed) |
| 2026-11-18 | blue | campusfind-e5fsy3tdl | phone notifications (Web Push via web-push 3.6.7): Profile > Phone notifications; every in-app notification is also pushed (title, short body, link); VAPID keys generated once into Firestore secrets/vapid (server-only, not exported); dead devices pruned; iPhone needs Add to Home Screen |
| 2026-11-18 | green | campusfind-26x0scr57 | get the app: /app (Android install button + iPhone Add to Home Screen steps + notifications switch), dismissible phone nudge for signed-in members not using the installed app, chat hint to turn on notifications; all Install buttons work |
| 2026-11-18 | blue | campusfind-fwzuv99m3 | browser smoke test (jsdom 27.4.0, dev only): runs theme.js + app.js on 31 public, member and admin pages as phone and computer, clicks common controls, fails on any script error (verified it catches the install-button crash) |
| 2026-11-19 | green | campusfind-8ipb6dcpv | error alerts: server 500s and browser script errors grouped in error_logs (scrubbed: no query strings, emails, numbers), Admin > Errors with Mark fixed, owner notified once per new kind; reporter in theme.js (3 beacons/page, 10/min/IP); test server keep-alive fix |
| 2026-11-19 | blue | campusfind-5ir4wdo73 | registration fix: date of birth as Day/Month/Year menus (iPhone date picker pre-filled today and triggered the 24-hour under-age block); a date under 5 years old is a typo, never a block; blocks saved before this release are ignored |
| 2026-11-19 | blue | campusfind-kq7cwbysj | Firebase kept (a Cursor session's Supabase/Render migration undone from the last release's files; web.app redirect now points here). Pay first: Pricing plans go straight to payment, listing chosen after; Business listings are drafts until a paid Business ad; Pro seller perks (gold badge, 10 photos, no expiry while Pro, listing stats). Rosie-style restyle kept with self-hosted/system fonts and Home lost & found shortcuts restored |
| 2026-11-20 | green (live) | campusfind-iwpqs45ol | released committed main e7646d6 (from a clean copy, not the working folder): Cursor's campus-board layout (search masthead, sticky category pills), Render boot checks, password-reset continue/resend links, AGENTS.md shared rules |
| 2026-11-20 | — (local) | pending stage | Home “Latest on campus” is first and lists up to 24 live posts for signed-out visitors (featured posts stay in the feed). Publish flash says listings are public. Keep PUBLIC_BROWSING true. |
