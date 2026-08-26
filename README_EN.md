# RIVO | ريفو — خرائط | داركم

Smart navigation and the Iraqi real-estate marketplace in one product.

- **خرائط (Maps)** — traffic-aware routing, alternatives, turn-by-turn, and
  community reports of accidents, jams, closures, road works and flooded roads.
- **داركم (Darcom)** — houses, apartments, shops, buildings, land and commercial
  property for sale or rent, pinned on the map, with 8–18 photos, optional
  1080p Reels, a 3,000 IQD listing fee, and admin review before anything is
  published.

Arabic is the primary language; the whole product is RTL-first.

**العربية:** [README_AR.md](./README_AR.md)

---

## What is in this repository

```
apps/
  api/         NestJS 11 + Prisma 6 — REST API, worker, migrations, tests
  admin/       Next.js 15 — admin dashboard (13 modules, role-gated)
  mobile/      Flutter 3.47 — the Android and iOS app
packages/
  config/      business rules and shared constants (one source of truth)
  contracts/   zod schemas shared by the API and the admin dashboard
infra/
  docker/      Dockerfiles for api, worker and admin
  nginx/       reverse-proxy configuration
  scripts/     backup.sh, restore.sh, acceptance.sh
docs/
  api/         generated OpenAPI document and endpoint reference
  architecture/  ARCHITECTURE.md, AUDIT.md
  deployment/  DEPLOYMENT.md, BACKUP_RESTORE.md
  acceptance-tests/  ACCEPTANCE_REPORT.md and the run transcript
  legal/       privacy policy, terms, listing and AI policies
  purchase-checklist/  every external account and what it costs
```

---

## Requirements

| | Version | Why |
| --- | --- | --- |
| Node.js | 22 LTS or newer | API, admin, tooling |
| PostgreSQL | 16 | |
| PostGIS | 3.4 | every map query depends on it |
| Redis | 7 | queues, OTP counters, caches |
| Flutter | 3.47 stable | the mobile app |
| Docker | 24+ | optional, for the one-command stack |

---

## Running it from VS Code

Step-by-step, from cloning to a running app — Docker or native, Windows, macOS
or Linux: **[دليل التشغيل من VS Code](./docs/getting-started/VSCODE_AR.md)**
(Arabic). The workspace ships run configurations and tasks, so most of it is
`Ctrl+Shift+P` → `Tasks: Run Task`.

## Show it to someone — one command

```bash
./infra/scripts/demo.sh
```

Creates its own database, seeds a populated marketplace with sample photos and
a moderation queue, and starts the API and the dashboard. No Cloudflare,
payment or SMS account needed. For the live map, get a free Mapbox token first
and export `MAPBOX_PUBLIC_TOKEN` and `MAPBOX_SECRET_TOKEN` — five minutes, no
cost, and it is the account you need anyway.

## Run the whole stack with Docker

```bash
cp .env.example .env          # then fill in the values — see "Credentials" below
npm run stack:up              # docker compose up -d --build
npm run stack:logs
```

This starts PostgreSQL+PostGIS, Redis, the API, the worker and the admin
dashboard. Migrations run on API start.

## Run it natively

```bash
cp .env.example .env
npm install

# 1. database
createdb rivo
psql rivo -c 'CREATE EXTENSION postgis;'
npm run api:migrate           # applies every migration
npm run api:seed              # feature flags + the bootstrap Super Admin

# 2. API and worker
set -a && . .env && set +a
npm run api:dev               # http://localhost:3000, Swagger at /api/docs
npm run worker:dev -w @rivo/api

# 3. admin dashboard
npm run admin:dev             # http://localhost:3002

# 4. mobile app
cd apps/mobile
flutter pub get
flutter run --dart-define=RIVO_API_BASE_URL=http://10.0.2.2:3000/api/v1
```

The seed prints the bootstrap Super Admin's email. Its password is
`ADMIN_BOOTSTRAP_PASSWORD` from your `.env`, and it must be changed at first
sign-in.

---

## Checks

```bash
npm run typecheck             # every workspace
npm run lint
npm test                      # unit tests
npm run test:e2e -w @rivo/api # against a real Postgres + Redis
cd apps/mobile && flutter analyze && flutter test

./infra/scripts/acceptance.sh # the Master Plan §21 checklist, live
```

`test:e2e` uses `rivo_test` and refuses to run against any database not named as
a test database — it deletes every row.

```bash
createdb rivo_test && psql rivo_test -c 'CREATE EXTENSION postgis;'
DATABASE_URL='postgresql://postgres@127.0.0.1:5432/rivo_test?schema=public' \
  npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

---

## Credentials

`.env.example` documents all 71 variables. Nothing is stubbed: a feature whose
credential is missing returns `503 INTEGRATION_NOT_CONFIGURED` naming the exact
variable, and the API **refuses to boot** in production without the mandatory
ones.

Every account must be opened in RIVO's own name, never a contractor's — see
[docs/purchase-checklist/ACCOUNTS_AND_PURCHASES.md](./docs/purchase-checklist/ACCOUNTS_AND_PURCHASES.md)
for the full list with prices.

| Feature | Variables |
| --- | --- |
| Map, search, routing | `MAPBOX_PUBLIC_TOKEN`, `MAPBOX_SECRET_TOKEN` |
| Photo storage | `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |
| Reels | `CLOUDFLARE_STREAM_TOKEN` |
| AI enhancement | `AI_PROVIDER` and its key |
| SMS OTP | `OTP_PROVIDER=http` and the provider's credentials |
| Payments | `PAYMENT_PROVIDER`, its key and `PAYMENT_WEBHOOK_SECRET` |
| Error reporting | `SENTRY_DSN_API`, `SENTRY_DSN_MOBILE` |

---

## Rules the server enforces

These are not suggestions the client can skip; each is enforced in the API and
again as a database constraint, so no code path — not even direct SQL — can get
around them.

| Rule | Where |
| --- | --- |
| 8–18 photos before a listing may be published | `properties_photo_count_chk` |
| A Reel must be at least 1080p on its **short edge** | `property_videos_min_1080p_chk` |
| The listing fee is exactly 3,000 IQD, decided by the server | `LISTING_FEE_IQD`, whitelist validation |
| Only a verified webhook or an audited finance settlement can mark a payment paid | payment state machine |
| Only an admin approval from `PENDING_REVIEW` can publish a listing | listing state machine |
| The audit trail can be appended to and never edited or deleted | `rivo_audit_logs_immutable()` triggers |
| Raw location samples carry no account identifier and expire after 14 days | schema + retention sweep |
| A traffic aggregate needs at least 5 distinct sessions | `TELEMETRY_MIN_SAMPLES_PER_BUCKET` |

---

## Documentation

| | |
| --- | --- |
| **[Handover](./HANDOVER.md)** | **run, build and deploy commands, schema, endpoints, outstanding purchases, roadmap** |
| [Architecture](./docs/architecture/ARCHITECTURE.md) | how the pieces fit, and why |
| [API reference](./docs/api/ENDPOINTS.md) | 103 operations; `openapi.json` alongside it |
| [Deployment](./docs/deployment/DEPLOYMENT.md) | server setup, TLS, first deploy |
| [Backup and restore](./docs/deployment/BACKUP_RESTORE.md) | nightly dumps and a tested restore |
| [Acceptance report](./docs/acceptance-tests/ACCEPTANCE_REPORT.md) | what was actually verified |
| [Accounts and purchases](./docs/purchase-checklist/ACCOUNTS_AND_PURCHASES.md) | what to buy, in whose name |
| [Legal drafts](./docs/legal/) | privacy, terms, listing, AI and community policies — for legal review |
| [Store release checklist](./docs/store-release/STORE_CHECKLIST.md) | what Apple and Google need |
| [Initial audit](./docs/architecture/AUDIT.md) | what existed at the start |
