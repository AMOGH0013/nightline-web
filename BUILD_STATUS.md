# NIGHTLINE build status

Last verified: 2026-11-18

## Existing implementation audit

- Next.js 16 app shell and public pages are present: home, board/sign-in, registration, ticket and verification, manifest, dashboard, profile, voting, archive, store, terms, privacy, and admin.
- Auth paths support local development one-time codes and Supabase Auth. Registration requires a signed-in session and current terms/privacy versions.
- Passenger allocation and persistent ticket issuance are performed together by the database `register_passenger` function. Founding seats are allocated in order; later passengers receive stowaway numbers. Passenger 500 has no special role configured.
- Public manifest and ticket verification use restricted database views/functions. Profile fields, ticket codes, and account identifiers are not included in the manifest.
- Profile editing and account anonymization, voting, submissions, and admin content/moderation controls are implemented.
- Payment processing is not enabled. Paid products and roles remain disabled pending configuration.
- The initial working tree already contained substantial uncommitted work. This continuation preserved it and made targeted corrections only.

## Corrections made

- Fixed the HTTP error helper's `ERROR_TEXT` import.
- Removed build-time Google Font downloads so the app can build without external network access; system font stacks are defined in CSS.
- Fixed PostgreSQL migration syntax that incorrectly schema-qualified `NULLIF` and `session_user`.
- Corrected Supabase registration result typing.
- Require `DATABASE_URL` alongside Supabase credentials because the existing server data layer uses direct PostgreSQL queries.
- Added the missing database security, allocation concurrency, and unauthenticated HTTP test scripts referenced by `package.json`.
- Configured `npm run build` to use Next.js's supported Webpack builder; Turbopack's CSS worker exited before completing in this environment.

## Verification results

- `npm run lint` — passed with no warnings.
- `npm run test:security` — passed: grants, registration function access, ticket verification access, and manifest privacy columns checked.
- `npm run test:concurrency` — passed: 24 simultaneous registrations received unique serials and founding seat numbers.
- `npm run test:http` — passed: unauthenticated registration, profile, voting, and admin requests returned 401.
- `npm run build` — passed using Webpack; all 28 static pages generated and routes compiled.

The checks used the project's local PostgreSQL instance and test databases. No production deployment or real payment action was performed. The local database server and production preview server were stopped after testing.

## Setup notes

- Local development: run `npm run db` and leave it running, then start the app with `npm run dev`.
- The database setup creates `.env.local` only when it does not already exist; existing environment files are left untouched.
- Supabase deployments need all three Supabase settings plus a server-side `DATABASE_URL` for this database architecture.
- `npm run test:http` expects the application at `http://127.0.0.1:3000` or the URL set through `NIGHTLINE_TEST_URL`.

## End-to-end QA sprint — 2026-11-18

### Environment and boundaries

- All runtime checks used local PostgreSQL on port `54329` and the isolated `nightline_qa_ui` and `nightline_qa_load` databases. The ordinary local `nightline` passenger database was not reset or used for QA registrations.
- The browser was installed Google Chrome in headless mode with a temporary profile. The browser automation exercised the running Next.js app at `http://localhost:3000`; screenshots are saved in `qa-artifacts/`.
- No production Supabase project, deployment, payment provider, or live transaction was used. `.env.local` was not printed or overwritten.
- Registration and profile forms rendered in Chrome. Their API submissions were driven from the authenticated browser session because DOM-driven React form submission was unreliable in this automation environment; this sprint therefore verifies the real page rendering and server workflows but does not claim a successful human-like form submission by keyboard/mouse.

### Results

- `npm run lint` — passed with no warnings after adding the QA runner.
- `npm run build` — passed with Next.js 16.4.6/Webpack; TypeScript and all 28 static-generation steps completed. An earlier build attempt overlapped the dev server and failed to write `.next`; the build passed after the server was stopped.
- `npm run test:security` — passed: privilege grants, allocation function access, ticket verification access, and manifest privacy schema.
- `npm run test:concurrency` — passed: 24 simultaneous registrations received unique allocations.
- `npm run test:http` — passed: unauthenticated registration, profile, voting, and admin requests were rejected.
- `scripts/qa-load-520.mjs` on a fresh isolated database — passed: 520 simultaneous registrations produced exactly 500 unique founding passenger numbers (1–500) followed by 20 unique Stowaway numbers (1–20). No passenger 500 special role was assigned.
- `scripts/qa-privacy.mjs` — passed: under the `authenticated` database role, a test passenger could read their own profile but could not read another passenger’s profile or ticket. The payment master switch was false; no paid product or Conductor/Driver role was enabled.
- Chrome route checks passed for `/`, `/board`, `/register`, `/ticket`, `/verify/[code]`, `/manifest`, `/dashboard`, `/profile`, `/vote`, `/archive`, `/store`, `/terms`, `/privacy`, and `/admin`.
- Authenticated browser workflow passed for local code sign-in, registration API allocation, persistent ticket after revisiting the ticket route, public verification, profile API update, updated manifest entry, duplicate registration returning the existing ticket, and authorized admin publication. The duplicate check returned the same serial (`NL-F017`) and did not allocate another passenger.
- Security responses in the browser: unauthenticated registration `401`; ordinary passenger admin write `403` and sealed admin page; disabled purchases endpoint `403`. Admin content and poll publication succeeded only for the configured local administrator. A passenger’s first vote returned `200`; a second vote in that poll returned `400`.
- Desktop and 390px mobile layouts were checked for horizontal overflow on landing, registration, ticket, manifest, dashboard, and admin pages. All measured widths equaled the 390px viewport, including the authorized admin console. Mobile checks were viewport/overflow checks, not a device lab test.
- Client bundle scan found no configured Supabase service-role credential value in `.next/static`.

### Browser screenshots

- Desktop: `qa-artifacts/landing-desktop.png`, `qa-artifacts/registration-desktop.png`, `qa-artifacts/ticket-desktop.png`, `qa-artifacts/manifest-desktop.png`, `qa-artifacts/dashboard-desktop.png`, `qa-artifacts/admin-desktop.png`.
- Mobile: `qa-artifacts/mobile-landing.png`, `qa-artifacts/mobile-register.png`, `qa-artifacts/mobile-ticket.png`, `qa-artifacts/mobile-manifest.png`, `qa-artifacts/mobile-dashboard.png`, `qa-artifacts/mobile-admin.png`, `qa-artifacts/mobile-admin-authorized.png`.

### Remaining before launch

- Repeat sign-in, registration, and profile submissions with normal keyboard/mouse interaction in a non-headless browser. In this sandbox the local browser form automation could render the forms but did not reliably drive React’s controlled inputs; the authenticated API paths and persistence were exercised instead.
- Repeat authorization, email delivery, and admin access checks against the intended Supabase staging project with staging credentials and its deployed migrations. No cloud connection was made here.
- Review legal copy, set production domain/redirect allowlists, and decide Passenger 500/Conductor/Driver rules before enabling any paid products. Payments remain disabled; no production launch is authorized by these tests.

### Start locally

1. From `D:\NIGHTLINE\web`, run `npm run db` and leave the local PostgreSQL service running.
2. In a second terminal at `D:\NIGHTLINE\web`, run `npm run dev` and open `http://localhost:3000`.
3. `.env.local` is created only if absent by the database setup script. Keep it local and never point the QA scripts at production data.

## Master implementation continuation — 2026-11-18

### Added and corrected

- Added authenticated Manychat claim API and token-protected persistent passenger ticket route; contact ID and Instagram-scoped ID are stored independently. Local simulator verifies idempotent retries and username changes against the same stable contact identity.
- Added migration `0004_manychat_claims.sql`, idempotent `0005_manual_follower_order.sql`, and `0006_follower_import_reports.sql` for report snapshots. `0000_local_auth_stub.sql` remains local-only.
- Added admin import report CSV/JSON export and persistent import snapshots, with private fields excluded. Public username ticket lookup now gives the same generic claim response for known and unknown usernames.
- Added `scripts/public-lookup.test.mjs`; made security/privacy test DB selection explicit so tests do not silently use a passenger database. Added ESLint ignore for `.next-nightline-qa` generated output and updated local/deployment notes in README.
- Corrected the HTTP import fixture expectation: an empty database classifies initial fixture records as new, not late historical. Late historical behavior remains unverified by this latest HTTP case.

### Latest checks

- `npm run lint` — passed.
- `npx tsc --noEmit` — passed.
- `npm run build` — passed using Webpack, isolated to `.next-nightline-qa`; 36 static-generation steps completed and all routes compiled.
- `npm run test:follower-parser` — passed.
- `npm run test:feature-identity` — passed on fresh isolated `nightline_feature_test_finalidentity2` (1,000 identities and entitlement/seat boundaries).
- `npm run test:security` — passed on isolated `nightline_feature_test_finalhttp`.
- `node scripts/qa-privacy.mjs` — passed on existing read-only `nightline_qa_ui` fixture; cross-account RLS and disabled commerce verified. This run rolled back its session and did not reset the database.
- `npm run test:http` — passed for unauthenticated registration/profile/vote/admin requests.
- `npm run test:public-lookup` — passed; imported and absent synthetic usernames received identical generic responses.
- `npm run test:manychat` — passed against the local app and test-only secret: authorization, validation, claims, retry idempotency, stable-ID username update, ticket rendering and unknown identity.
- `npm run test:import-http` — passed against the local production-mode app: authenticated synthetic ZIP upload through the HTTP API, preview, confirmation, CSV/JSON export and re-import recognition.
- The local landing page rendered and was inspected in the browser at port 3001. Existing screenshots are retained in `qa-artifacts/`; this continuation did not save a new screenshot set. File chooser automation had stalled earlier, so actual browser drag/drop/Browse-and-confirm remains unverified.
- Earlier 520-registration load, 24-request concurrency, legacy browser flows, and mobile viewport results remain recorded above; they were not rerun against migrations 0004–0006.

### Boundaries and status

- All latest database and HTTP checks used synthetic data and disposable local feature-test databases. Supabase, staging, live Instagram/Manychat delivery, real export data, and live payments were not used.
- Existing database `nightline_qa_ui` was read only for the cross-account fixture (transaction rolled back). Other existing QA/passenger databases were not reset. `.env.local` and the phase-one backup were left untouched.
- Payment processing remains disabled; Conductor and Driver roles remain disabled/unassigned.
- Final readiness classification: **NOT READY — EXTERNAL STAGING AND HUMAN BROWSER VERIFICATION REMAIN.** See `NIGHTLINE_FINAL_DELIVERY.md` for setup, test details, retained screenshot paths, Manychat mapping, and remaining blockers.

## Follower identity and Luxury seat phase — 2026-11-18

### Implementation in this continuation

- Added additive migration `supabase/migrations/0003_follower_identity_and_seats.sql`; historical migrations remain unchanged. It keeps legacy registration identifiers separate from imported follower rank, permanent passenger number, entitlement and physical Luxury seat.
- Added JSON/ZIP follower parsing, normalized username deduplication, missing/malformed record reporting, deterministic same-timestamp ordering that preserves source-file order, preview/confirm flow and import history.
- New imported passengers now default to unlisted with a neutral `Passenger N` display name. This corrected a privacy issue found in the browser: the previous import default exposed handles through display names despite a private handle setting.
- Added a 400-seat inventory (99 premium, 100 first-follower entitlement, 201 blocked future upgrade seats) and the specified prices. L-010 and L-200–L-400 remain blocked. The homepage and admin counters now reflect follower identities rather than the legacy 500-seat registration model.
- Added admin inventory and Journey Day controls, consent-only CSV/Blender JSON export, and permanent identity details to passenger tickets, public verification and manifest pages.
- Fixed an ambiguous SQL output-column reference in the reservation function after a concurrent reservation test found it.
- Fixed the admin page’s timestamp serialization error after a real browser render found PostgreSQL `Date` values were being passed to a client component.
- Checkout remains unavailable. The reservation race test used a disposable local database and a test-only mock provider reference; no payment provider, transaction or production setting was used.

### Checks performed in this continuation

- `npm run lint` — passed with no warnings.
- `npm run build` — passed with TypeScript and 34 generated static pages.
- `npm run test:follower-parser` — passed: supported JSON shapes, normalization, duplicate, malformed and missing timestamp cases, plus stable source order for equal timestamps.
- `npm run test:feature-identity` on fresh isolated database `nightline_feature_test_20261118_i` — passed: 1,000 sequential identities, entitlement boundaries, all 400 seat pools, automatic L-100–L-199 assignment, configured price table, private-by-default manifest, two simultaneous reservations for one seat (exactly one succeeded), database-priced reservation, and Passenger 499 retaining number 499 and Silver original entitlement after mock Luxury seat finalization. The `payments_enabled` setting was restored to false in that isolated database.
- Migration 0003 applied successfully after migrations 0000–0002 on fresh isolated local databases. The test runner refuses an existing database. No existing `nightline_qa_ui`, `nightline_qa_load`, `nightline_test`, `nightline_race`, or ordinary `nightline` passenger database was reset or used by this phase’s feature tests.
- Production app browser checks on `http://localhost:3001` used an isolated feature database. The homepage ticket lookup returned synthetic Passenger 499; the ticket showed follower rank 400, original Silver entitlement, current Luxury accommodation and L-002. Refresh/deep-link lookup worked. Public verification displayed Passenger 499 with the same identity and accommodation fields. The manifest showed no rows because imports are private by default. Store showed the configured prices, L-010 blocked, all purchases disabled, and no payment action.
- Admin browser render was authenticated with a disposable local-only test identity against isolated database `nightline_feature_test_20261118_f`. The 400-seat inventory, follower import history and Journey Day controls rendered after the timestamp fix.
- Mobile store layout was checked at a 390px viewport; document width remained within the viewport. The passenger ticket was also inspected at a 390px responsive viewport; measured document width was 376px against a 391px inner viewport.
- The pre-existing application tests and the prior 520-registration legacy QA result are recorded in the earlier section above; they were not rerun against the newly created schema in this continuation.

### Current screenshots

- `qa-artifacts/identity-home-desktop.png`
- `qa-artifacts/identity-ticket-desktop.png` — synthetic Passenger 499 fixture, with Luxury seat L-002
- `qa-artifacts/identity-manifest-desktop.png`
- `qa-artifacts/identity-store-desktop.png`
- `qa-artifacts/identity-ticket-mobile.png`
- The existing `qa-artifacts/admin-desktop.png` is from the earlier QA pass. The updated admin page was rendered and inspected in the browser during this phase, but a fresh admin screenshot file was not captured.

### Not yet verified / launch blockers

- The actual follower importer’s UI file-selection/preview/confirmation flow was not completed. Browser file-upload automation stalled. Parser logic and the underlying database allocation function passed separate tests, but this phase does not claim full import end-to-end coverage.
- No real Instagram export was supplied. Confirm the parser against the creator’s actual export format before importing any live follower data.
- Imported passengers can view tickets without an account, but a secure claim flow for imported identities is not implemented. Profile editing, voting and consent changes still require the existing authenticated passenger account; a verified follower cannot yet claim an imported ticket and edit profile settings through a ticket-only session.
- The updated voting, dashboard and profile behavior has not been rerun end to end against the new migration. Existing previous-phase results apply to the legacy account flow only.
- No Supabase staging project, cloud migration, email delivery, production domain, real payment provider or webhook was tested. Paid checkout remains disabled. Silver/Bronze prices and upgrade capacity, L-010 price, Pool C prices, refund policy and official launch timestamp remain unresolved.
- The temporary local app used port 3001 and an isolated test DB. The existing local app on port 3000 and local PostgreSQL service were left untouched. `.env.local` was neither read out nor overwritten.

### Safest feature-test instructions

From `D:\NIGHTLINE\web`, choose a new unique database name and run:

```powershell
$env:NIGHTLINE_FEATURE_TEST_DB = "nightline_feature_test_<unique_suffix>"
node scripts/feature-db.mjs
npm run test:feature-identity
npm run test:follower-parser
```

The database runner creates only a previously nonexistent database and stops if the name already exists. Do not point it at an existing passenger or QA database. To run the website against an already migrated disposable database, set `DATABASE_URL` in that terminal session and use `npm run dev`; do not copy database credentials into source files or screenshots.

## Final acceptance continuation — 2026-11-18

### Fresh local browser exercise

- Started the local production-mode app at `http://localhost:3002` against a new isolated PostgreSQL cluster on port `54339`, database `nightline_feature_test_browserfinal`. Existing local PostgreSQL/app ports and passenger databases were not used or modified. No Supabase project, production service, real credentials, payments, or live messaging were contacted.
- Signed in to the local-only admin workflow and opened the actual Admin page in desktop Chrome. The page showed the local-development authentication banner and the full protected admin console.
- Used the page's native Browse Files chooser to select only `qa-artifacts/import-ui-fixture/followers-export.zip` (two synthetic handles), reviewed the browser-generated allocation preview, and confirmed it. The preview showed 2 records, 2 unique, 0 duplicates, 0 invalid, 0 conflicts, and new passenger numbers 100 and 101 with seats L-100 and L-101. After submission, the rendered page reported “Import completed successfully”, 2 new passengers, 0 retained, 0 duplicates skipped, 0 needing review, and a confirmed import-history row for two unique records. Admin summary showed highest passenger number 101. This is UI plus server/database persistence evidence on the isolated local database; it does not validate real Instagram export data or an end-user ticket claim.
- Desktop screenshot observations were captured in the CUA session but were not persisted to image files in this continuation. Existing retained screenshots under `qa-artifacts/` are from earlier runs; `admin-desktop.png` predates the current identity/import UI and must not be represented as a screenshot of the current admin page.
- `npx tsc --noEmit` — passed on this continuation. `npm run lint` completed without diagnostics. A fresh `npm run test:security` rerun against port 54339 was blocked with `connect EACCES 127.0.0.1:54339` by the command sandbox; earlier passing security results remain recorded in the sections above and are not a fresh rerun.

### Remaining acceptance gaps

- This continuation did not repeat the broad route, mobile layout, passenger login, registration, profile, vote, payment-safety, or admin authorization matrix in a real browser. Their previously recorded test evidence remains as stated in earlier sections; the new browser flow only covers local admin sign-in and a synthetic follower import.
- The 520-user load test, full security matrix, and production build were not rerun against this new database/schema in this continuation. Do not infer a current fresh pass from earlier test records.
- Real Instagram data format, imported-passenger account claim/profile flow, real Manychat delivery, Supabase staging authorization/RLS and email delivery, production domain/redirects, legal copy, and launch decisions remain unverified or unresolved. Payments remain disabled and Conductor/Driver roles remain disabled and unassigned.
- Current readiness remains **NOT READY for launch** until staging and the identified human/browser and external integration checks are completed.

## Supabase staging connection attempt — 2026-11-18

### Configuration and tooling inspection

- `.env.staging.local` exists and `git check-ignore` confirmed it is ignored by the existing `.env*` rule in `.gitignore`. It is not tracked. No change to `.gitignore` was needed, and the file was not printed, copied, uploaded, or committed.
- The file contains only `DATABASE_URL`. Its host parsed as `aws-1-ap-south-1.pooler.supabase.com` on port 6543, database `postgres`. The username encodes project reference `ytyqirvelfatkbtjuyzf`; the staging project display name `NIGHTLINE-STAGING` is not present in this configuration and could not be independently checked against Supabase dashboard metadata.
- The application uses the `pg` package (`^8.23.1`) and `src/lib/db.ts` constructs `new Pool({ connectionString: DATABASE_URL, max: 8 })`. The existing `scripts/db.mjs` uses embedded PostgreSQL at `127.0.0.1:54329`, applies every migration including local-only `0000_local_auth_stub.sql`, and may create `.env.local`; it was not used for staging.
- Supabase migration guidance in `README.md` specifies migrations `0001` through `0006`; `0000_local_auth_stub.sql` is explicitly local-only. Reviewed migration contents before any attempt: there are no table/schema drops or truncates in `0001`–`0006`, while `0003` alters existing columns and policies and contains a runtime account-deletion function. These statements would only be run after an emptiness check; no migration was run.
- The `pg` driver rejected the supplied connection string as invalid URL syntax before opening a connection. A second connection attempt using parsed in-memory fields reached TLS but failed certificate verification with `SELF_SIGNED_CERT_IN_CHAIN`, including when Node's OS CA store was enabled. Credentials and full connection string were withheld from output.

### Outcome

- Connectivity: **not verified**; TLS certificate verification did not pass.
- Target project name: **not independently verified**; only the host and connection-encoded project reference were available from the file.
- Staging emptiness: **not inspected**, because no authenticated PostgreSQL session was established.
- Migrations: **not applied**. The existing `scripts/db.mjs` is local-only and unsafe for Supabase use. No app-level staging query was possible; the runtime's `pg` URL parsing failure and TLS trust failure both prevent claiming that the application can connect with this configuration.
- No staging schema/data was altered. `.env.local`, local PostgreSQL databases, and production data were untouched.

### To resume safely

- Confirm in the Supabase dashboard that project reference `ytyqirvelfatkbtjuyzf` is the `NIGHTLINE-STAGING` project.
- Download that project's database root CA certificate from Supabase Database Settings and provide a local certificate path/configuration so Node can validate the server certificate. Do not disable certificate verification.
- Correct the `DATABASE_URL` URI syntax locally (percent-encode any reserved username/password characters) without pasting it into chat or a report. Keep it in the ignored `.env.staging.local` file.
- After both identity and TLS are verified, connect read-only first and inspect public schema objects, migration ledger, and data. Only if the target is confirmed staging and safe/empty, apply `0001`–`0006` transactionally and verify grants/RLS/schema. Do not use `npm run db` for this cloud operation.
