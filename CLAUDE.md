# RIVO | ريفو — خرائط | داركم

Smart navigation (خرائط) and the Iraqi real-estate marketplace (داركم) in one
product. Arabic is the primary language and the whole product is RTL-first.

`docs/RIVO_CLAUDE_MASTER_PLAN.md` is the specification and the final authority.
When something here disagrees with it, the Master Plan wins.

---

## Rules that are not negotiable

These came from the client and are enforced in the API **and** again as database
constraints, so no code path — not even direct SQL — can get around them. Do not
relax one without being asked to explicitly.

| Rule | Enforced by |
| --- | --- |
| A listing needs 8–18 photos before it can be published | `properties_photo_count_chk` |
| A Reel must be ≥1080p on its **short edge** (so 1080×1920 passes, 1280×720 does not) | `property_videos_min_1080p_chk` |
| The listing fee is exactly 3,000 IQD and the server decides it | `LISTING_FEE_IQD`, validation whitelist |
| Only a verified webhook or an audited finance settlement can mark a payment paid | payment state machine |
| Only an admin approval from `PENDING_REVIEW` can publish a listing | `apps/api/src/modules/properties/property-state.ts` |
| The audit trail is append-only | `rivo_audit_logs_immutable()` triggers |
| Raw location samples carry no account identifier and expire after 14 days | schema + retention sweep |
| A traffic aggregate needs ≥5 distinct sessions | `TELEMETRY_MIN_SAMPLES_PER_BUCKET` |
| AI enhancement may change how a photo looks, never what the property is | `apps/api/src/integrations/ai/allowed-operations.ts` |

Business-rule constants live in `packages/config/src/business-rules.ts` and are
mirrored — never re-derived — in `apps/mobile/lib/core/config/business_rules.dart`.

## How this project treats missing credentials

**Never invent an API key, and never stub an integration to make it look like it
works.** An unconfigured integration returns `503 INTEGRATION_NOT_CONFIGURED`
naming the exact environment variable it needs, and the API refuses to boot in
production without the mandatory ones. A placeholder or a mock is not a finished
feature — say so rather than marking it done.

`/health/capabilities` tells clients what this deployment can actually do, so the
mobile app renders an explanatory state instead of a dead button.

---

## Commands

```bash
./infra/scripts/setup.sh            # first run: env, database, migrations, seed, start
./infra/scripts/status.sh           # what is ready, what is missing (Ctrl+Shift+B in VS Code)
./infra/scripts/demo.sh             # populated demo on its own database
./infra/scripts/acceptance.sh       # the Master Plan §21 checklist against a live API
./infra/scripts/verify-mapbox.sh    # checks Mapbox tokens and the Downloads:Read scope

npm run typecheck && npm run lint && npm test
npm run test:e2e -w @rivo/api       # real Postgres + Redis, needs rivo_test
npm run api:dev                     # API with reload
npm run admin:dev                   # dashboard on :3002
npm run openapi:generate -w @rivo/api   # regenerates docs/api/

cd apps/mobile && flutter analyze && flutter test
```

## Two things that will bite

**Never run `prisma migrate dev`.** The PostGIS geography columns, the GiST
indexes, the CHECK constraints and the append-only triggers are hand-written SQL
that Prisma does not know about; it will generate a migration that drops them.
Use `migrate deploy`, and add new hand-written SQL as its own migration file.

**`npm run test:e2e` deletes every row.** It runs against `rivo_test` and
`PrismaService.truncateAllForTests` refuses any database not named as a test
database — because `APP_ENV=test` alone was not enough: the suite sets that
itself, and inheriting `DATABASE_URL` from a sourced `.env` once wiped the
development database mid-run.

---

## Layout

```
apps/api/        NestJS 11 + Prisma 6. src/modules (features), src/integrations
                 (external services, each behind an interface), src/worker (BullMQ).
apps/admin/      Next.js 15, 13 role-gated modules, Arabic RTL.
apps/mobile/     Flutter 3.47, Riverpod + GoRouter + Dio.
packages/config/     business rules, governorates, brand constants.
packages/contracts/  zod schemas shared by the API and the dashboard.
infra/scripts/   setup, status, demo, acceptance, verify-mapbox, backup, restore.
docs/            architecture, api (generated), deployment, acceptance-tests,
                 legal, store-release, purchase-checklist, getting-started.
```

Geometry is `geography(Point,4326)`, `Unsupported()` in the Prisma schema, and is
read and written through `GeoRepository` with raw SQL. Everything else uses the
type-safe client.

Named rate-limit budgets are opt-in per route via `@RateLimit` — `@Throttle`
directly applies a budget to *every* route, which once turned the 6/hour OTP cap
into a global one. See `apps/api/src/common/rate-limit/`.

---

## Conventions

- Errors leave through `AllExceptionsFilter` only: one envelope, bilingual
  messages, a request id, never a stack trace or SQL text to a client.
- Every user-facing message needs `messageAr` alongside `message`.
- `ValidationPipe` runs with `whitelist` and `forbidNonWhitelisted`: an unknown
  field is an error, which is why a client cannot smuggle `amountIqd` into a
  payment request.
- Comments explain **why**, not what. A comment restating the code is noise.
- Prefer verifying against a running system over asserting from a reading. Every
  defect found in this repository so far was found by running it.

## Before saying something works

Run the checks. `npm run typecheck && npm run lint && npm test`, plus
`test:e2e` when the API changed and `flutter analyze` when the app did. For a
change to a business rule or a lifecycle, run `./infra/scripts/acceptance.sh`
against a live API — it is the §21 checklist and it catches what unit tests do
not.

## More

| | |
| --- | --- |
| [HANDOVER.md](./HANDOVER.md) | run/build/deploy commands, schema, endpoints, outstanding purchases, roadmap |
| [docs/architecture/ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md) | how the pieces fit, and why |
| [docs/acceptance-tests/ACCEPTANCE_REPORT.md](./docs/acceptance-tests/ACCEPTANCE_REPORT.md) | what was actually verified, and what was not |
| [docs/getting-started/VSCODE_AR.md](./docs/getting-started/VSCODE_AR.md) | running it locally (Arabic) |
