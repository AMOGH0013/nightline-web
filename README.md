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

### Supabase PostgreSQL TLS

The server-side `pg` pool supports the official Supabase database CA without disabling certificate or hostname verification. Keep SSL options out of `DATABASE_URL`; the application rejects URL SSL parameters to avoid conflicting settings. URI-reserved characters in the database username or password must be percent-encoded exactly once in `DATABASE_URL` (for example, `@` becomes `%40`).

For local staging, put `DATABASE_CA_CERT_PATH` in the ignored `.env.staging.local` and point it to the downloaded CA PEM file. For Vercel, the local Windows file path is not available to serverless functions. Add a server-only environment variable named `DATABASE_CA_CERT_BASE64` to the appropriate Vercel environment and set its value to a single-line base64 encoding of the official Supabase CA certificate. Do not add it as a `NEXT_PUBLIC_` variable. On Windows, generate the value in the local PowerShell session with:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\prod-ca-2021.crt")) | Set-Clipboard
```

Paste that value into Vercel's environment-variable editor; do not place it in source control. The server decodes the CA in memory and configures `rejectUnauthorized: true` plus Node's hostname verification. Keep `.env.staging.local` and all database URLs/passwords out of Git.

### Supabase staging database

The staging helper scripts are hard-guarded to project reference `ytyqirvelfatkbtjuyzf`, the `aws-1-ap-south-1.pooler.supabase.com` shared pooler, and database `postgres`. They use session mode on port `5432` for migrations, require the verified CA, and never use the local embedded database runner. From this directory, run `npm run db:staging:migrate` only after confirming `.env.staging.local` targets the verified staging project. Migration `0000_local_auth_stub.sql` is local-only and intentionally excluded. Then run `npm run test:staging:verify` and `npm run test:staging:acceptance`. The acceptance script rolls its synthetic passenger/auth/claim fixtures back and restores the Stowaway sequence. It does not switch payments on; concurrent eligible reservation races therefore remain untested while payment reservations are disabled.

## Follower import

Sign into the admin console, open **Import Instagram Followers**, choose an official followers JSON export or ZIP, review validation and proposed passenger identities, then confirm. The app supports `followers.json`, `followers_1.json` and split Instagram follower files. Uploads are capped at 20 MB. Missing timestamps and malformed identities block import. Equal timestamps are flagged; their file order is retained. Later historical followers are appended after existing identities only after explicit approval.

Imported profiles start private. Keep the original Instagram export secure and delete local copies according to your privacy policy. The application stores normalized handles and follower timestamps needed for allocation, not unrelated export content.

## Deploying

Do not deploy until staging migrations, auth, import, claims and all required browser flows have been verified. See [NIGHTLINE_FINAL_DELIVERY.md](NIGHTLINE_FINAL_DELIVERY.md) for the cloud setup boundary and current readiness assessment. In particular, do not apply `0000_local_auth_stub.sql` to Supabase; it is for local PostgreSQL only.
