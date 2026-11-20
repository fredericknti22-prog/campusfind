# Working on CampusFind (read first: Claude Code and Cursor both edit this repo)

## Decisions that are settled
- **Data store: Firebase** (Firestore + Firebase Auth + Storage). Do **not** switch to Supabase/Postgres or add another database.
- **Hosting:**
  - **Vercel is the main live site** (`https://campusfind-ruby.vercel.app`). Release with `npm run bg:stage` then `npm run bg:promote`; roll back with `npm run bg:rollback`.
  - **Render** (`https://campusfind-6h5q.onrender.com`) runs the same code from GitHub `main` against the **same Firebase project**. It needs `FIREBASE_SERVICE_ACCOUNT` and the other Firebase env vars set in Render.
  - `campusfind-baf86.web.app` (Firebase Hosting) redirects to the main site.

## Rules for both agents
1. **Pull before you edit**, commit small, and push only when `npm test` passes (stop any local preview server first; tests use the Firebase emulators).
2. **Never commit secrets:** `.env`, `.env.render.tmp`, `render-env-payload.json`, service-account JSON, API keys. Check `git status` before every commit.
3. **Before starting a task, add a line under "In progress" below** (who, what, which files). Don't edit files another agent has listed there until they clear it.
4. Keep the strict CSP: no third-party scripts, fonts or styles (self-host everything). No inline `style=` or `<script>`.
5. Add or update tests for behaviour you change, and record each release in `DEPLOYMENT.md`.

## In progress
- (none)

## Handoff for Claude
- Live site is blue `campusfind-6eprdx758` on https://campusfind-ruby.vercel.app (same code as green `l05mdw3b7`, which is the rollback). Only one agent releases at a time: write "Releasing" under In progress first. Cursor's branch is `cursor/board-home-reset`. Do **not** add Supabase. Render (`campusfind-6h5q`) still fails until `FIREBASE_SERVICE_ACCOUNT` is pasted in the Render dashboard.

## Handoff for Cursor (from Claude, 2026-11-20)
- Thanks: pulled `564e7a4`; Claude is testing and releasing it to Vercel now.
- **Render is yours to finish** (you have the Render and Vercel plugins; Claude must not move credentials). With the owner approving in Cursor:
  1. On Render service `srv-dbve2g56e07s73bi7pj0`, set from Vercel production: `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `ADMIN_EMAIL`, `ADMIN_NAME`, `CONTACT_EMAIL`, `LEGAL_ENTITY`, `PHOTOS_ENABLED`, `PHOTO_STORE`, `PUBLIC_BROWSING`.
  2. Set `BASE_URL=https://campusfind-6h5q.onrender.com` and `NODE_ENV=production`. Delete `SUPABASE_DB_URL` / `DATABASE_URL`.
  3. Redeploy latest `main` and write the deploy id + result here.
- Claude will then verify: Render `/sitemap.xml` lists the same listings as Vercel (currently `/listings/7`), pay-first `/pricing`, new home.
