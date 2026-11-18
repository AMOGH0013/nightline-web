# NIGHTLINE staging and launch checklist

Current status: **NOT READY for production launch.** Local synthetic workflows are not a substitute for validating the intended cloud project.

## Safe local acceptance

- [ ] Start the isolated local PostgreSQL service using the project README instructions; confirm the target database name before applying migrations.
- [ ] Apply migrations to a disposable local database only. Keep `.env.local` unchanged and do not connect to production Supabase.
- [ ] Run `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
- [ ] Run security, HTTP, parser, identity, concurrency, load, Manychat-simulator, lookup and import tests against fresh isolated databases as their scripts require.
- [ ] Re-run end-user browser flows for sign-in, registration, duplicate registration, ticket refresh, profile edit, manifest privacy, voting duplicate prevention and public verification on desktop and mobile.
- [ ] Verify admin authorization, import preview/confirmation, content publication, passenger operations and export restrictions in browser.
- [ ] Use synthetic follower fixtures only until the creator approves a verified export format and data-handling plan.

## Staging project checks (before production)

- [ ] Confirm staging is a separate Supabase project, with an isolated disposable dataset and no production credentials.
- [ ] Review the complete migration set in order and apply to staging; inspect grants, RLS, security-definer functions, views and auth hooks using non-admin and admin test accounts.
- [ ] Verify sign-in code/email delivery, redirect allowlists, session expiry, logout, recovery and account deletion/anonymization.
- [ ] Verify the 500 founding allocation boundary, first Stowaway number, idempotent registration and simultaneous registration against staging fixtures.
- [ ] Verify private ticket/profile access, public manifest fields, verification-code behavior and admin-route denial for ordinary users.
- [ ] Verify one-vote-per-passenger behavior and permitted content/submission access.
- [ ] Configure Manychat only with a staging integration and synthetic identities; test webhook authentication, retries, duplicate claims and persistent ticket links.
- [ ] Confirm production deployment cannot receive service-role secrets in client bundles or logs; review backups, retention, rate limits and operational monitoring.
- [ ] Review legal copy, privacy notice, consent text and retention/deletion behavior with the responsible owner.

## Decisions required before any paid or public launch

- [ ] Confirm official launch timestamp/timezone and final registration/manifest rules.
- [ ] Decide Passenger 500 recognition/role; keep Conductor and Driver unassigned until explicitly resolved.
- [ ] Resolve all seat prices and eligibility, including blocked L-010 and future-upgrade seats; verify purchase controls remain disabled until payment/webhook/refund handling is implemented and tested.
- [ ] Approve checkout provider, currency, taxes, refunds, dispute handling, idempotency and reconciliation before enabling any real transaction. Do not enable payments as part of QA.
- [ ] Review the actual Instagram export shape and mapping using an approved, access-controlled staging sample before importing real followers.
- [ ] Provide an account claim path for imported identities and test it end to end before inviting passengers to edit profiles or vote.
- [ ] Obtain final human sign-off for staging results, production access, content, migration/backup plan and rollback procedure.

## Local startup

From `D:\NIGHTLINE\web`, use two terminals:

```powershell
npm run db
```

Leave the first terminal running. In the second terminal:

```powershell
npm run dev
```

Open `http://localhost:3000`. The database script creates `.env.local` only if it does not exist. Keep any existing environment file untouched; do not use production credentials for local testing.
