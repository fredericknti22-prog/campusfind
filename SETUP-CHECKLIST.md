# CampusFind launch checklist

Live site: https://campusfind-ruby.vercel.app
Items marked **You** need your own keys, logins or legal details, so I can't do them for you.

Add variables in Vercel: Project `campusfind` > Settings > Environment Variables (Production), then redeploy
(`vercel deploy --prod --yes`) so they take effect. Mark every secret as Sensitive.

## 1. Already done
- [x] Hosted on Vercel, Firebase Auth + Firestore connected
- [x] Legal pages, age gate, self-hosted fonts, no session replay
- [x] Photos, messaging, saved listings, assistant, promotions and pricing built
- [x] Keyboard and screen-reader pass (deployed), 64/64 tests passing
- [x] Already set in Vercel: `BASE_URL`, `FIREBASE_*`, `ADMIN_*`, `CONTACT_EMAIL`, `LEGAL_ENTITY`, `PHOTO_STORE`

## 2. Security first (do these before sharing the link)
- [ ] **You** Delete the service-account key file from Downloads
      (`campusfind-baf86-firebase-adminsdk-...json`). It is already stored in Vercel.
      Optional but safest: in Firebase console > Project settings > Service accounts, generate a new key,
      update `FIREBASE_SERVICE_ACCOUNT` in Vercel, then revoke the old key.
- [ ] **You** Set the live super-admin password: open `/forgot` on the live site with the admin email
      and follow the reset email.
- [ ] **You** In Firebase console > Authentication > Templates > Password reset, set the action URL to
      `https://campusfind-ruby.vercel.app/reset` (same host as `BASE_URL`). Add that host under
      Authentication > Settings > Authorized domains. The app also passes `continueUrl` to Firebase when
      sending reset and verify emails.
- [ ] **You** Render is no longer used (Vercel only). After the Render service is deleted, delete the extra Firebase
      key made for it (Google Cloud Console > IAM > Service accounts > firebase-adminsdk > Keys, the key created
      2026-11-20 for Render). Keep the key Vercel uses. Also delete the unused Supabase project.
- [x] Removed the 7 `@campus.test` test accounts and dismissed their 3 test reports (#1, #3, #5) (Claude, 2026-11-26)
      (Firebase console > Authentication > Users; also delete their listings in Firestore if any).

## 3. Payments (promotions)
Pick one or both:
- [ ] **You** Paystack: add `PAYSTACK_SECRET_KEY` (use the live key, `sk_live_...`) in Vercel.
- [ ] **You** Paystack dashboard > Settings > API & Webhooks: set the webhook URL to
      `https://campusfind-ruby.vercel.app/pay/webhook`.
- [ ] **You** Manual fallback: add `MANUAL_PAYMENT_INSTRUCTIONS` (for example your Mobile Money number and name).
- [ ] After setup, buy the GH₵10 Featured promotion on a test listing and confirm it turns on.
      Admins confirm manual orders at `/admin/orders`.

## 3b. Contact and payments
- [ ] **You** Create a business mailbox (for example a new Gmail just for CampusFind) and add it in Vercel as `SUPPORT_EMAIL`. Until then the pages point to the Help centre chat.
- [ ] **You** Admin area > Super admin > Payments & contact details: enter the Mobile Money number, account name and network (and a support email if you have one). Saves instantly, no redeploy.

## 4. AI assistant
- [ ] **You** Add `ANTHROPIC_API_KEY` in Vercel, then redeploy.
- [ ] Open `/assistant` and ask a question. If it says "not set up", the key is missing or the redeploy has not run.

## 5. Legal details (fill the blanks the legal pages show)
- [ ] **You** `POSTAL_ADDRESS`, a real postal address, required for marketing emails
- [ ] **You** `GOVERNING_LAW` (for example "the laws of Ghana")
- [ ] **You** `LEGAL_ENTITY`, check it is your registered business or your own name
- [ ] **You** DMCA agent: register one, then set `DMCA_AGENT_NAME`, `DMCA_AGENT_EMAIL`,
      `DMCA_AGENT_ADDRESS`, `DMCA_REGISTRATION_NO`. This only applies if you serve US users.
- [ ] **You** Speak to an accountant about tax on promotion income, and a lawyer to review the terms.

## 6. Students only (recommended)
- [ ] **You** Set `ALLOWED_EMAIL_DOMAINS` to your campus domains, for example `ug.edu.gh,knust.edu.gh`,
      so only students can sign up. Leave it unset to keep sign-up open.

## 7. Final check after the last redeploy
- [ ] Sign up with a real student email, post an item with a photo, save it, message another account
- [ ] Report a listing, then confirm it appears in `/admin`
- [ ] Open the site on a phone, in light and dark mode
- [ ] Listen once with a screen reader (NVDA or VoiceOver) on Home, Browse and Post
- [ ] Check `https://campusfind-ruby.vercel.app/healthz` returns 200

## 8. Added on 2026-11-09
- [x] ernetinaeshn12@gmail.com is a super admin (done 2026-11-09 through the audited SUPERADMIN_EMAIL handover; setting removed afterwards).
      Old instructions, kept for reference: sign in as super admin → Admin → Members → search the email →
      open the record → Role: **Super admin (platform owner)** → Save. Only do this if you are sure she controls that inbox.
- [ ] **You** Turn on Cloudflare Turnstile (bot check on sign-up, sign-in, password reset, reports, staff sign-in):
      Cloudflare dashboard → Turnstile → Add widget (mode: Managed, hostname `campusfind-ruby.vercel.app`), then add in
      Vercel: `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` (mark Sensitive) and `TURNSTILE_HOSTNAMES=campusfind-ruby.vercel.app`.
      Release with `npm run bg:stage` then `npm run bg:promote`. Until then the check stays off.
- [ ] Releases now go through blue/green: see DEPLOYMENT.md.

## Staff two-step sign-in (on by default in production)
- [ ] **You** The next time you open the admin area, scan the QR code with Google Authenticator or Microsoft Authenticator.
- [ ] **You** Save the 8 recovery codes somewhere safe and offline (password manager or paper). They are shown once.
- [ ] Every other staff member does the same at their first admin visit. A super admin can reset a lost phone from the member's admin page.
- [ ] Lost your own phone and codes? In Vercel set `STAFF_2FA_RESET_EMAIL` to your email, redeploy, open the site once, then delete the variable and redeploy again.
