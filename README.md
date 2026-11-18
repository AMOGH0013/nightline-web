# NIGHTLINE

Existing Next.js passenger website. The app uses PostgreSQL for server-side queries and Supabase Auth for cloud authentication. Payments are disabled.

## Run locally

Requirements: Node.js 20+, npm, and Windows support for the bundled embedded PostgreSQL package.

1. In PowerShell, from `D:\NIGHTLINE\web`, run `npm ci`.
2. Run `npm run db` and leave that terminal open. On a fresh local cluster it generates an admin password stored under ignored `.pgdata/`, applies additive migrations, and writes `.env.local` only if the file does not already exist. Existing local clusters without that ignored credential file require `NIGHTLINE_PG_ADMIN_PASSWORD` to be set in the shell before starting; the script will not guess or reset a cluster password.
3. In a second terminal, run `npm run dev` and open `http://localhost:3000`.
4. Local sign-in uses the dev one-time-code page. The default local admin is `conductor@nightline.local`; change this in local configuration before use.

Do not point local test scripts at production or a passenger database. `node scripts/feature-db.mjs` creates a timestamped, unique database and refuses to reuse an existing one.

## Checks

```powershell
npm run lint
npx tsc --noEmit
npm run test:follower-parser
npm run test:security
npm run test:concurrency
npm run test:http
npm run test:public-lookup
npm run test:manychat
npm run test:import-http
npm run build
```

The database-backed tests require local PostgreSQL. The admin password is read from ignored `.pgdata/local-admin-password` or `NIGHTLINE_PG_ADMIN_PASSWORD`; the helper refuses non-loopback hosts. For new identity tests, set a new unique `NIGHTLINE_FEATURE_TEST_DB` name beginning `nightline_feature_test_`, run `node scripts/feature-db.mjs`, then `npm run test:feature-identity`. For security tests set `NIGHTLINE_SECURITY_TEST_DB` to an isolated database. For the HTTP suites set `NIGHTLINE_TEST_URL` to the local QA app; Manychat additionally requires a test-only `NIGHTLINE_MANYCHAT_TEST_DB` and a synthetic 32+ character `MANYCHAT_WEBHOOK_SECRET`. Import and public lookup tests use synthetic data. Do not point any test at production or a passenger database. Browser QA evidence is documented in `BUILD_STATUS.md`; local screenshots and test artifacts are excluded from Git.

Migrations `0001` through `0006` extend the application schema. `0000_local_auth_stub.sql` is strictly for the local embedded PostgreSQL environment and must not be applied to Supabase. For a cloud database, use Supabase's existing `auth` schema and roles, then apply `0001`–`0006` in order.

## Follower import

Sign into the admin console, open **Import Instagram Followers**, choose an official followers JSON export or ZIP, review validation and proposed passenger identities, then confirm. The app supports `followers.json`, `followers_1.json` and split Instagram follower files. Uploads are capped at 20 MB. Missing timestamps and malformed identities block import. Equal timestamps are flagged; their file order is retained. Later historical followers are appended after existing identities only after explicit approval.

Imported profiles start private. Keep the original Instagram export secure and delete local copies according to your privacy policy. The application stores normalized handles and follower timestamps needed for allocation, not unrelated export content.

## Deploying

Do not deploy until staging migrations, auth, import, claims and all required browser flows have been verified. See [NIGHTLINE_FINAL_DELIVERY.md](NIGHTLINE_FINAL_DELIVERY.md) for the cloud setup boundary and current readiness assessment. In particular, do not apply `0000_local_auth_stub.sql` to Supabase; it is for local PostgreSQL only.
