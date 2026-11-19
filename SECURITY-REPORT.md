# CampusFind security report

Date: 2026-11-08. Scope: the CampusFind web app (Node 22 / Express 5, Firebase Auth + Firestore, Vercel).
All active testing was run against a **local** copy with empty emulated data, never against the live site.

## What was run

| Check | Tool | Result |
|---|---|---|
| Dynamic scan (spider + active attack scan) | OWASP ZAP 2.17.0, quick scan | 1 high, 1 medium, 4 informational, all triaged below |
| Dependency audit | `npm audit --omit=dev` | 2 high fixed (body-parser, multer); 6 moderate accepted (see below) |
| Secret scan of the source | pattern search (private keys, `sk_live_`, `sk-ant-`, Google API keys) | Only the local `.env`, which is excluded from git and from deploys |
| Deploy contents | `.gitignore` / `.vercelignore` review | `.env*`, service-account files, tests and scripts are not uploaded |
| Security headers | code review + automated test | strict CSP, no inline script/style, clickjacking and MIME protection, HSTS in production |
| Regression tests | `tests/security.test.js` (5 tests) | pass; the suite is now 76/76 |

## ZAP findings and what was done

| Finding | Risk | Verdict | Action |
|---|---|---|---|
| SQL Injection - SQLite (time based) on `POST /login`, `email` | High | **Not SQL injection** (there is no SQL database), but a real weakness: any string was passed to Firebase Auth, so response time depended on attacker input and the identity service could be made to do work | Malformed emails and passwords over 1,024 characters are now rejected before any database or Firebase call, with the same generic message. The email rule also refuses `< > ( ) [ ] \ , ; : "`. Covered by a test that proves Firebase Auth is never called. |
| HTTP Only Site | Medium | Local scan only | Production is HTTPS on Vercel with `Strict-Transport-Security`. No change. |
| User Controllable HTML Element Attribute (23) | Info | Values are reflected but always HTML-escaped by the `html` template helper | Test added that injects `"><script>` into every reflected parameter and checks nothing breaks out. |
| GET for POST on `/forgot` | Info | False positive: `GET /forgot` only shows the form and ignores the query string | None. |
| Modern Web Application, User Agent Fuzzer | Info | Informational | None. |

## Dependencies

- Fixed: `body-parser` (DoS via trailing bytes in compressed bodies) and `multer` (DoS via pending fileFilter) by upgrading.
- Accepted: 6 moderate advisories in one chain, `firebase-admin` → `google-gax` → `rimraf` → `glob` → `minimatch`. It is only used to delete the library's own temporary files with fixed paths and never sees user input. Forcing a major `glob` upgrade under the Firebase SDK risks breaking it. Recheck when `firebase-admin` releases an update.

## Controls already in place

- Server-side sessions with per-session CSRF tokens on every state-changing form.
- Passwords handled by Firebase Auth; account lockout after repeated failures; generic login errors (no account enumeration).
- Rate limits shared across serverless instances (verified during the scan: ZAP's traffic was throttled with HTTP 429 until limits were raised for the test).
- Strict Content-Security-Policy (`script-src 'self'; style-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, no `X-Powered-By`.
- Uploaded images are re-encoded with sharp and served with `default-src 'none'; sandbox`.
- Paystack webhooks verified with HMAC-SHA512 and confirmed server-side; payment fulfilment is idempotent.
- The new motion library is bundled and self-hosted; no third-party scripts are loaded.

## Still to do (needs the owner)

- Rotate the Firebase service-account key and delete the downloaded copy (see SETUP-CHECKLIST.md).
- Schedule Firestore backups and add error and payment-webhook alerts.
- Repeat the ZAP scan after major changes, and consider an authenticated scan that signs in as a test member.
