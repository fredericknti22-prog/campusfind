# CampusFind system design

Status: describes the system as deployed at https://campusfind-ruby.vercel.app. Figures marked *assumption* are estimates, not measurements.

## 1. Requirements

**Functional**
- Members post, browse, search and save listings in nine categories (including Business and Lost & Found), with photos.
- Private in-app messaging between members; "mark as returned" for lost and found.
- Moderation: reports, staff review, audit log, suspensions, appeals.
- Paid promotions in Ghana cedis (Featured GH₵10, Business GH₵50, Premium GH₵100) through Paystack, with a manual-payment fallback confirmed by an admin.
- AI assistant that searches listings and drafts posts; the member always reviews and posts themselves.
- Legal: age gate, terms, privacy, cookies, takedown.

**Non-functional**
- Small campus scale (*assumption*: under 20,000 members, under 2,000 live listings, under 50 requests per second at peak).
- Low cost: pay-per-use hosting, no servers to patch.
- Privacy: email and phone never shown to other members.
- Accessible (WCAG 2.2 AA target), works on phones, installable as a PWA.
- Safe by default: strict CSP, CSRF protection, rate limits shared across serverless instances.

**Constraints**: one-person team, Node 22 / Express 5, Firebase Auth + Firestore, Vercel serverless, no inline script or style.

## 2. High-level design

```
 Browser / PWA ──HTTPS──> Vercel edge ──> api/index.js (serverless function)
                                              │  Express 5 app (server-rendered HTML)
                                              │  routes -> services -> repos
        ┌─────────────────────────────────────┼──────────────────────────────┐
        v                  v                  v                v             v
 Firebase Auth      Firestore           Photos store      Paystack      Anthropic API
 (passwords,       (users, listings,    (Firestore docs   (checkout,    (assistant,
  reset email)      sessions, orders,    or Cloud          webhook)      opt-in key)
                    messages, limits)    Storage)
```

- **Rendering**: views are plain functions using a tagged-template `html` helper that escapes by default. No client framework; `public/js/app.js` only enhances (theme, menus, uploads).
- **Sessions**: server-side, stored in Firestore, cookie holds an opaque id. CSRF token per session. Needed because serverless instances share no memory.
- **Layering**: `routes/` (HTTP) -> `services/` (rules: payments, assistant, images, auth) -> `repo/` (Firestore access). Views never touch the database.
- **Config**: all secrets and legal details are environment variables (`src/config.js`); nothing sensitive is in the repo.

## 3. Deep dive

### Data model (Firestore collections)
| Collection | Key fields | Notes |
|---|---|---|
| `users` | user_id, email, role, status, profile | Auth credentials live in Firebase Auth, not here |
| `listings` | listing_id, owner_id, category_id, status, cover, promo_tier, promo_until, is_featured | Denormalised category name/slug/tone added on read |
| `categories` | category_id, slug, tone, sort_order, is_active | Built-ins are migrated in by `ensureDefaults()` on boot |
| `favorites` | user_id + listing_id | Saved listings |
| `messages` / threads | cid = listing + starter | One thread per member per listing |
| `orders` | order_id, provider, status, reference | Idempotent fulfilment in a transaction |
| `reports`, `audit` | target, reason, actor | Moderation trail |
| `sessions`, `ratelimits` | TTL-cleaned at boot | Shared fixed-window limiter |
| `counters` | n | Sequential ids via transaction |

### HTTP surface (all server-rendered)
Public: `/`, `/browse`, `/business`, `/lost-found`, `/listings/:id`, `/pricing`, legal pages. Member: `/listings/new`, `/my/listings`, `/saved`, `/messages`, `/assistant`, `/orders`. Payments: `POST /listings/:id/promote`, `POST /pay/webhook` (HMAC-SHA512 verified). Staff: `/admin/*`.

### Payments
Create order (pending) -> Paystack checkout -> webhook **and** server-side verify both call `fulfil()`; a Firestore transaction makes it idempotent, so duplicate or racing callbacks apply the promotion once. Manual orders wait for an admin to confirm. Payment never bypasses moderation.

### Caching
- Category list cached in memory for 60 s per instance.
- Pages are `private, no-store` (personalised). Static assets are cached by the service worker (versioned `cf-v8`).
- Home, browse and directory pages read one cached `activeSnapshot()` (newest 500 live listings, 10 s TTL) and filter in memory.

### Error handling and retries
- Render errors return a generic 500 page and log server-side.
- Paystack webhook returns 200 only after a successful, idempotent apply so the provider retries on failure.
- Rate limiting: per-IP and per-user fixed windows in Firestore (survive cold starts).

## 4. Scale and reliability

**Load estimate** (*assumption*): 5,000 daily users x 15 page views = 75,000 views/day, about 1 request/s average, 20-50/s at a campus-wide peak. Firestore reads per page view are roughly 1 (snapshot) plus session lookup, so about 150,000 reads/day, well inside the free tier today.

**Scaling**: stateless functions scale horizontally on Vercel. The state tier (Firestore) scales without work at this size.

**Known limits**
1. `activeSnapshot()` loads the newest **500** live listings, cached in memory for 10 s per instance (`SNAPSHOT_LIMIT`, `SNAPSHOT_TTL` in `src/repo/listings.js`). Reads are cheap, but browse, search, the home page and the directories only ever see those 500: once more than 500 listings are live, older ones disappear from them (they stay reachable by direct link and from the owner's page). This is the first real ceiling.
2. Search is in-memory substring matching, not ranked or typo-tolerant.
3. Fixed-window limiter allows a short burst at window edges.
4. Single region, single Firebase project, no staging environment.
5. Photos in Firestore (when used) are size-capped by document limits; Cloud Storage is the scalable option.

**Reliability**: no servers to fail over; availability is bounded by Vercel + Firebase. Backups: Firestore has no automatic export configured yet.

**Monitoring today**: `/healthz`, Vercel function logs. No alerting.

## 5. Trade-off analysis

| Decision | Chosen | Alternative | Why / cost |
|---|---|---|---|
| Rendering | Server-rendered HTML, no framework | React/Next SPA | Fast on cheap phones, strict CSP, tiny surface. Cost: richer interactivity is hand-built |
| Database | Firestore | Postgres | Zero ops, generous free tier, fits serverless. Cost: weak ad-hoc queries, no joins, denormalisation |
| Sessions | Firestore-backed | Signed JWT cookie | Revocable (suspend a user instantly). Cost: a read per request |
| Hosting | Vercel serverless | VPS | No patching, scales to zero. Cost: cold starts, per-instance memory only |
| Payments | Paystack + manual fallback | Manual only | Mobile Money and cards in Ghana. Cost: a third party and webhook to secure |
| Search | In-memory filter | Algolia/Typesense | Free, simple. Cost: does not scale or rank |
| AI assistant | Opt-in, drafts only | Auto-posting | Keeps a human accountable. Cost: one more step for members |

## 6. What I would revisit as it grows

1. **Search and listing reads** (first to hurt, at 500 live listings): move browse and search to paginated Firestore queries with composite indexes (category + published_at, owner + status), keep the snapshot only for the home page, then add a search service if substring matching stops being good enough.
2. **Backups and staging**: schedule Firestore exports; add a second Firebase project for staging before the next big feature.
3. **Alerting**: error-rate and payment-webhook-failure alerts (Vercel + a free uptime check).
4. **Moderation load**: queue ownership and SLAs for staff once reports exceed what one person reviews daily.
5. **Photo pipeline**: move all photos to Cloud Storage with resized variants and a CDN.
6. **Multi-campus**: add a `campus_id` to users and listings before a second campus joins, since retrofitting it is costly.
7. **Rate limiting**: swap the fixed window for a sliding window or token bucket if abuse shows up.

## 7. Open questions
- Expected membership size and launch date (changes the assumptions in section 4).
- Will you serve more than one campus or country (changes data model, currency and legal pages)?
- Who staffs moderation, and what response time do you promise members?
