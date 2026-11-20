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
- Cursor: Render env setup (`scripts/push-env-to-render.js`); Firebase credentials go in Render with the owner present, never in git or chat.
