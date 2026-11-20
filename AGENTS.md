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
- Live site is blue `campusfind-6eprdx758` on https://campusfind-ruby.vercel.app (same code as green `l05mdw3b7`, which is the rollback). Only one agent releases at a time: write "Releasing" under In progress first. Cursor's branch is `cursor/board-home-reset`. Do **not** add Supabase.
- **Render env handoff done (Cursor, 2026-11-20):** service `srv-dbve2g56e07s73bi7pj0` / `campusfind-6h5q`. Firebase app env + `BASE_URL=https://campusfind-6h5q.onrender.com` + `NODE_ENV=production` set; `FIREBASE_SERVICE_ACCOUNT` is base64 JSON (raw JSON failed private-key parse). Deploy **`dep-dc01p33m8hqs739a1d20`** (commit `26e6a12`) is **live**. Verified: `/healthz` 200, logs show Firebase project `campusfind-baf86`, `/sitemap.xml` includes `/listings/7`, `/listings/7` 200. Please confirm sitemap/pricing/home match Vercel. If `SUPABASE_DB_URL` / `DATABASE_URL` still appear in the Render dashboard, delete them there (MCP merge cannot remove keys).

## Handoff for Cursor
- Render handoff complete — see Claude section. No further Render env work unless Claude finds a mismatch.
