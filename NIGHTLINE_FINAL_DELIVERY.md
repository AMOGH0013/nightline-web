# NIGHTLINE final implementation and readiness report

Updated: 2026-11-18

## Final status

**NOT READY — EXTERNAL STAGING AND HUMAN BROWSER VERIFICATION REMAIN.**

The local application builds and the new identity, import, public lookup privacy, and Manychat boundary checks passed using synthetic data and disposable local databases. Do not treat this as launch approval: Supabase staging, the creator’s actual Instagram export, live Manychat delivery, and the real file-selection/confirmation flow in a browser have not been verified. No production deployment or real payment action was performed.

## Implementation delivered

- Preserved the existing Next.js site, identity rules, follower-rank allocation, class entitlements, physical seat inventory, voting, archive, store, terms, privacy, dashboard, ticket, and admin features.
- Added migrations `0004_manychat_claims.sql`, `0005_manual_follower_order.sql`, and `0006_follower_import_reports.sql`; migrations `0001`–`0003` remain in place. `0000_local_auth_stub.sql` is local-only and must not be applied to Supabase.
- Added `POST /api/webhooks/manychat/claim` with a server-side bearer secret, payload validation, rate limiting, idempotent identity reconciliation, and stable ticket links. Contact IDs and Instagram-scoped IDs remain separate. Ticket access uses a stored hash and the ticket route requires its opaque token.
- Added import history report snapshots and admin-only CSV/JSON exports. Export reports omit account IDs, email and ticket verification codes.
- Made username ticket lookup return the same generic claim instruction for present and absent usernames; a public username is not treated as ownership proof.
- Added an isolated QA output directory option, a public lookup privacy test, and safer database selection for security checks. Updated README test and migration instructions.
- Payment processing remains disabled. Conductor and Driver were not assigned or enabled.

Key implementation areas: `src/app/api/webhooks/manychat/claim/route.ts`, `src/app/ticket/claim/[token]/page.tsx`, `src/app/api/admin/followers/export/route.ts`, `src/app/api/ticket-lookup/route.ts`, `src/components/follower-import-panel.tsx`, `src/lib/follower-import.ts`, `src/lib/followers.ts`, and `supabase/migrations/0004_manychat_claims.sql`–`0006_follower_import_reports.sql`.

## Verification performed

All new database-backed checks used local PostgreSQL on port 54329 and databases prefixed `nightline_feature_test_`. No passenger database was reset. The local production-mode app ran on port 3001 with a synthetic webhook secret and an isolated database.

- `npm run lint` — passed.
- `npx tsc --noEmit` — passed.
- `npm run build` — passed using Webpack; 36 static generation steps and all routes, including claim and report export APIs, compiled in `.next-nightline-qa`.
- `npm run test:follower-parser` — passed for Instagram JSON shapes, normalization, duplicates, malformed and missing timestamps, and stable equal-time ordering.
- `npm run test:feature-identity` — passed on fresh `nightline_feature_test_finalidentity2`: 1,000 immutable identities, entitlement boundaries, 400-seat inventory and configured prices.
- `npm run test:security` — passed on isolated `nightline_feature_test_finalhttp`: grants, registration/verification function privileges, and manifest privacy columns.
- `node scripts/qa-privacy.mjs` — passed against the existing read-only `nightline_qa_ui` fixture: cross-account profile/ticket RLS, payments disabled, no enabled paid products, and Conductor/Driver disabled. Its session changes were rolled back.
- `npm run test:http` — passed: unauthenticated registration, profile, voting, and admin writes were rejected.
- `npm run test:public-lookup` — passed: an imported synthetic username and an unknown username got equivalent generic responses with no private fields.
- `npm run test:manychat` — passed against the local simulator: unauthorized and malformed requests, claim, idempotent retry, stable-ID username update, ticket URL rendering, and unknown identity.
- `npm run test:import-http` — passed against the local production-mode app: admin sign-in, synthetic ZIP upload to the HTTP route, preview, confirmation, CSV/JSON export, privacy field exclusions, and repeat-import recognition.
- A first import-suite run found an incorrect fixture expectation: a fresh empty identity database classifies its two followers as new, not late historical. The test now reflects that business rule and passes. It does not establish the late-history approval scenario.
- Existing earlier results remain in `BUILD_STATUS.md`: 520-registration load test, 24-request concurrency test, legacy registration/profile/voting QA, and previous route/layout checks. Those suites were not rerun against migrations `0004`–`0006` in this continuation.

### Browser and screenshots

The current local landing page at `http://localhost:3001` was opened and visually/accessibility inspected. During the final continuation, the admin page was also exercised in desktop Chrome at `http://localhost:3002` against a new isolated local database. Existing screenshots from earlier live local browser sessions remain at:

- Desktop: `qa-artifacts/landing-desktop.png`, `qa-artifacts/registration-desktop.png`, `qa-artifacts/ticket-desktop.png`, `qa-artifacts/manifest-desktop.png`, `qa-artifacts/dashboard-desktop.png`, `qa-artifacts/admin-desktop.png`.
- Mobile: `qa-artifacts/mobile-landing.png`, `qa-artifacts/mobile-register.png`, `qa-artifacts/mobile-ticket.png`, `qa-artifacts/mobile-manifest.png`, `qa-artifacts/mobile-dashboard.png`, `qa-artifacts/mobile-admin.png`, `qa-artifacts/mobile-admin-authorized.png`.
- Identity phase: `qa-artifacts/identity-home-desktop.png`, `qa-artifacts/identity-ticket-desktop.png`, `qa-artifacts/identity-manifest-desktop.png`, `qa-artifacts/identity-store-desktop.png`, and `qa-artifacts/identity-ticket-mobile.png`.

These files are earlier QA captures, not fresh screenshots of every current route. A screenshot of the current admin page and resulting successful import appeared during the live desktop browser session, but this continuation did not persist a new image file; the listed `admin-desktop.png` is older. The actual browser Browse Files chooser, synthetic ZIP selection, allocation preview, and confirmation were completed successfully. The page reported two new passengers, zero retained, zero duplicates skipped, zero review records, and confirmed import history. The allocation preview assigned Passenger 100/L-100 and Passenger 101/L-101. This does not validate user account claims or live Instagram imports; do not claim all browser workflows are complete.

## Configuration and local run

From PowerShell:

```powershell
cd D:\NIGHTLINE\web
npm ci
npm run db
```

Leave the database terminal running. In another terminal:

```powershell
cd D:\NIGHTLINE\web
npm run dev
```

Open `http://localhost:3000`. Local development authentication displays its one-time code locally; it is not production authentication. `npm run db` creates `.env.local` only when absent. Do not point local development at production data.

The runtime configuration uses these environment variables (descriptions are kept here; environment files and templates are intentionally excluded from Git):

- `DATABASE_URL` (required by the current server data layer), `NEXT_PUBLIC_SITE_URL`.
- Local auth: `LOCAL_SESSION_SECRET`, `LOCAL_ADMIN_EMAILS`.
- Cloud auth: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY` plus `DATABASE_URL`.
- Optional Manychat webhook: server-only `MANYCHAT_WEBHOOK_SECRET` (32+ characters). Leave unset until the webhook is configured and verified.
- `NIGHTLINE_DIST_DIR` is optional for isolated builds; `NEXT_PUBLIC_SITE_URL` is embedded at build time.

Never copy secrets into source, browser variables, screenshots, or Manychat response content. `.env.local` was not printed or overwritten.

## Supabase/Vercel staging procedure

No cloud connection was made, so these are setup steps, not verified deployment instructions:

1. Create separate Supabase staging and production projects and a Vercel preview/staging environment. Do not reuse local QA credentials or databases.
2. Set the environment variables above in staging. Add exact staging domains to Supabase auth redirect allowlists and set `NEXT_PUBLIC_SITE_URL` before building.
3. In Supabase SQL editor, apply `0001_identity_allocation.sql` through `0006_follower_import_reports.sql` in numeric order. Do not apply `0000_local_auth_stub.sql`; Supabase supplies its own auth schema and roles.
4. Create an administrator account through the supported auth flow, then provision the matching admin record using the project’s documented database model. Verify admin authorization before importing data.
5. Deploy a Vercel preview build, then verify sign-in, registration/claim, migration behavior, import and export, RLS, privacy, redirects, and rollback/backup on staging.
6. Keep payments disabled. No production deployment is authorized by this report.

Back up the staging database before each migration. Validate migrations and restoration on staging before considering production. No production migration or recovery exercise was performed here.

## Manychat configuration boundary

Configure a Manychat External Request only after staging is verified:

- Method: `POST`
- URL: `https://<staging-domain>/api/webhooks/manychat/claim`
- Header: `Authorization: Bearer <same value as server MANYCHAT_WEBHOOK_SECRET>`
- JSON body fields: `contact_id` (Manychat contact ID), `instagram_username` (current IG username), and optional `instagram_scoped_id` (native stable ID if available).
- The returned payload includes claim status, passenger number, original class, physical seat when assigned, and persistent ticket URL.
- Standard flow: DM keyword `BOARD`, then send the contact’s fields through the authenticated request and deliver the returned ticket URL. Follow-to-DM beta is optional and was not assumed.

The local simulator passed. No Manychat account, Meta approval, live Instagram DM, webhook delivery, or live Follow-to-DM trigger was tested. Do not label the integration connected or delivery-tested.

## Remaining blockers and known limits

- Complete a human-like browser test of login, import Browse/drag-drop, preview, confirmation, passenger claim, ticket sharing/download, profile, voting, dashboard and admin workflows on staging.
- Validate the parser and ordering against the creator’s real official Instagram export; only synthetic fixtures were available.
- Apply migrations and verify RLS/auth/admin setup against a real Supabase staging project.
- Verify Manychat credentials, payload mapping, and live delivery in a controlled staging account.
- Confirm legal copy, redirect domains, backup/recovery procedures, launch schedule, and commercial decisions before launch. Payments remain disabled; premium checkout and external delivery are unverified.
- Older 520 and concurrency load results predate the last claim/import report migrations; rerun on staging before launch.

The protected local QA databases `nightline_feature_test_finalidentity2` and `nightline_feature_test_finalhttp` contain synthetic data and were retained. The app process started by this QA run was stopped; the pre-existing app on port 3000 and local PostgreSQL service were left running. The phase-one backup was verified present and unchanged. No cloud, production, payment or live messaging operation occurred.

## Final browser acceptance continuation — 2026-11-18

- A separate temporary local PostgreSQL cluster on port `54339` and fresh database `nightline_feature_test_browserfinal` were used. No existing passenger database, the earlier local PostgreSQL cluster, production service, or Supabase instance was modified or contacted.
- The running app on port `3002` displayed its local-auth warning. A local admin session selected only the synthetic fixture `qa-artifacts/import-ui-fixture/followers-export.zip` using the page's real Browse Files chooser. Preview counters and final successful import were inspected in the actual browser. The resulting page showed the two fixture passengers persisted and import history confirmed.
- The screenshot was visible in the desktop browser QA session but was not saved as a new file. Earlier screenshot files listed above remain unchanged.
- `npx tsc --noEmit` passed and `npm run lint` finished without diagnostics. A fresh `npm run test:security` attempt on the isolated cluster was blocked by sandbox network policy (`connect EACCES 127.0.0.1:54339`); earlier passing security test results above remain historical evidence and were not repeated in that attempt.
- No other user journeys, mobile layouts, load test, production build, staging connection, real Manychat delivery or transaction were retested in this continuation. The detailed, current launch checklist is `STAGING_DEPLOYMENT_CHECKLIST.md`. Readiness remains **NOT READY**.

## Supabase staging connection attempt — 2026-11-18

- `.env.staging.local` is ignored by the existing `.env*` rule; it was not displayed, committed, uploaded or changed. Its host matches `aws-1-ap-south-1.pooler.supabase.com`. The connection username encodes project reference `ytyqirvelfatkbtjuyzf`, but the file has no project display name or Supabase project URL; the label `NIGHTLINE-STAGING` cannot be independently confirmed from it.
- The application currently uses `pg` with `new Pool({ connectionString })`. The existing `scripts/db.mjs` is an embedded-local PostgreSQL setup and includes the local-only migration 0000, so it was not used for Supabase. The applicable existing cloud migration set is 0001–0006.
- The supplied URL failed the `pg` URL parser before a socket connection. Parsing the credentials only in memory and connecting with peer verification enabled reached TLS but returned `SELF_SIGNED_CERT_IN_CHAIN`, including with Node's system CA store enabled. No credential or raw error text was logged.
- No PostgreSQL session/schema inspection or migration was possible, so emptiness, permissions, and application connectivity remain unverified. No staging changes were made; local configuration, local databases and production data were untouched.
- Safe next step: confirm in the dashboard that the encoded reference belongs to `NIGHTLINE-STAGING`, download that project's root CA certificate, and locally correct any unescaped reserved characters in the URL. Then repeat read-only identity/emptiness checks before applying 0001–0006. Do not disable TLS verification or use `npm run db` for Supabase.
