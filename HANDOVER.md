# RIVO — Handover

Everything needed to run, build, deploy and continue this project.
Master Plan §24.

**Branch:** `claude/rivo-maps-realestate-fhipsh` · **Date:** 2026-08-25

---

## 1. Exact run commands

### One command, everything (Docker)

```bash
cp .env.example .env        # fill in values first — see §7
npm run stack:up            # docker compose up -d --build
npm run stack:logs
```

API on `:3000`, admin on `:3002`, PostgreSQL on `:5432`, Redis on `:6379`.
Migrations apply on API start.

### Natively

```bash
npm install

createdb rivo
psql rivo -c 'CREATE EXTENSION postgis;'
npm run api:migrate
npm run api:seed

set -a && . .env && set +a
npm run api:dev                       # API + Swagger at /api/docs
npm run worker:dev -w @rivo/api       # media, AI and maintenance jobs
npm run admin:dev                     # admin dashboard on :3002

cd apps/mobile && flutter pub get
flutter run --dart-define=RIVO_API_BASE_URL=http://10.0.2.2:3000/api/v1
```

### Checks

```bash
npm run typecheck && npm run lint && npm test
npm run test:e2e -w @rivo/api              # needs rivo_test — see below
cd apps/mobile && flutter analyze && flutter test
./infra/scripts/acceptance.sh              # the §21 checklist against a live system
```

`test:e2e` deletes every row and **refuses any database not named as a test
database**:

```bash
createdb rivo_test && psql rivo_test -c 'CREATE EXTENSION postgis;'
DATABASE_URL='postgresql://postgres@127.0.0.1:5432/rivo_test?schema=public' \
  npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

### Operational one-offs

```bash
npx ts-node --transpile-only apps/api/scripts/maintenance-once.ts   # force a full sweep
npx ts-node --transpile-only apps/api/scripts/aggregate-once.ts     # force traffic aggregation
npm run openapi:generate -w @rivo/api                               # regenerate docs/api/
./infra/scripts/backup.sh                                           # nightly dump (cron)
./infra/scripts/restore.sh <dump>                                   # tested restore
```

---

## 2. Exact build commands

```bash
npm run build                    # every workspace: config, contracts, api, admin
npm run build -w @rivo/api       # → apps/api/dist
npm run build -w @rivo/admin     # → apps/admin/.next

cd apps/mobile
flutter build appbundle --release \
  --dart-define=RIVO_API_BASE_URL=https://api.rivo.iq/api/v1     # → build/app/outputs/bundle/release/
flutter build ipa --release \
  --dart-define=RIVO_API_BASE_URL=https://api.rivo.iq/api/v1     # → build/ios/ipa/
```

Android release signing reads `apps/mobile/android/key.properties`, which is
**not** committed. Without it the build falls back to the debug key and says so
— a debug-signed bundle cannot be uploaded to Play. Create it from
`key.properties.example` with the keystore RIVO generates and keeps.

---

## 3. Exact deployment commands

Full procedure with TLS, firewall and first-boot in
[`docs/deployment/DEPLOYMENT.md`](./docs/deployment/DEPLOYMENT.md). Short form,
on a server that already has Docker and a filled `.env`:

```bash
git clone <repo> /opt/rivo && cd /opt/rivo
cp .env.example .env && $EDITOR .env       # APP_ENV=production
docker compose -f docker-compose.yml up -d --build
docker compose logs -f api

# TLS
certbot --nginx -d api.rivo.iq -d admin.rivo.iq

# nightly backup
sudo cp infra/scripts/backup.sh /opt/rivo/infra/scripts/
echo '0 2 * * * /opt/rivo/infra/scripts/backup.sh >> /var/log/rivo-backup.log 2>&1' | sudo crontab -
```

Deploying an update:

```bash
cd /opt/rivo && git pull
docker compose up -d --build api worker admin
docker compose exec api npm run migrate:deploy
```

Migrations are additive and run before the new code serves traffic. The API
**refuses to start** in production if any mandatory credential is missing, so a
misconfigured deploy fails at boot rather than at the first request.

---

## 4. Folder tree

```
RIVO/
├── apps/
│   ├── api/                      NestJS 11 + Prisma 6
│   │   ├── prisma/               schema.prisma, 3 migrations, seed.ts
│   │   ├── scripts/              openapi generation, one-off maintenance
│   │   ├── src/
│   │   │   ├── common/           env, prisma, redis, guards, filters, rate-limit, geo
│   │   │   ├── integrations/     mapbox, storage(R2), stream, otp, payments, ai
│   │   │   ├── modules/          auth, users, properties, media, reels,
│   │   │   │                     payments, maps, traffic, admin, health, notifications
│   │   │   ├── worker/           BullMQ processors and the maintenance sweep
│   │   │   ├── main.ts           API entry
│   │   │   └── worker.ts         worker entry
│   │   └── test/                 5 suites — unit and e2e against real Postgres/Redis
│   ├── admin/                    Next.js 15, 13 role-gated modules
│   └── mobile/                   Flutter 3.47
│       ├── android/  ios/        release configuration
│       ├── lib/
│       │   ├── core/             api client, config, theme, widgets
│       │   └── features/         maps, darcom, reels, listing, profile, auth
│       └── test/                 3 suites, 34 tests
├── packages/
│   ├── config/                   business rules, governorates, brand constants
│   └── contracts/                zod schemas shared by API and admin
├── infra/
│   ├── docker/                   Dockerfile.api, Dockerfile.worker, Dockerfile.admin
│   ├── nginx/                    reverse proxy config
│   └── scripts/                  backup.sh, restore.sh, acceptance.sh
├── docs/
│   ├── RIVO_CLAUDE_MASTER_PLAN.md
│   ├── api/                      openapi.json, ENDPOINTS.md (generated)
│   ├── architecture/             ARCHITECTURE.md, AUDIT.md
│   ├── deployment/               DEPLOYMENT.md, BACKUP_RESTORE.md
│   ├── acceptance-tests/         ACCEPTANCE_REPORT.md, acceptance-run.txt
│   ├── legal/                    5 policy drafts for legal review
│   ├── store-release/            STORE_CHECKLIST.md
│   └── purchase-checklist/       ACCOUNTS_AND_PURCHASES.md
├── brand/                        rivo-logo-source.png
├── .github/workflows/ci.yml      5 jobs
├── docker-compose.yml
├── .env.example                  71 variables, no secrets
├── README_AR.md · README_EN.md · HANDOVER.md
```

---

## 5. Database schema summary

PostgreSQL 16 + PostGIS 3.4. **30 tables**, 19 CHECK constraints, 6 GiST
indexes, 5 triggers, applied by 3 migrations. CI asserts these counts after
migrating a fresh database.

| Group | Tables |
| --- | --- |
| Identity | `users`, `user_devices`, `refresh_sessions`, `otp_challenges`, `seller_profiles`, `seller_verifications` |
| Listings | `properties`, `property_locations`, `property_media`, `property_videos`, `property_status_events`, `property_reports`, `favorites`, `saved_places` |
| Money | `listing_payments`, `payment_events` |
| Jobs | `media_jobs`, `ai_jobs`, `maintenance_runs` |
| Traffic | `road_incidents`, `road_incident_confirmations`, `road_speed_samples`, `road_speed_aggregates`, `route_feedback` |
| Reels | `reel_view_events` |
| Administration | `admin_users`, `admin_sessions`, `audit_logs`, `feature_flags` |
| Messaging | `notifications` |

**Geometry** lives in `property_locations.point`, `road_incidents.point`,
`road_speed_samples.point` and `saved_places.point` as
`geography(Point,4326)`, each with a GiST index. These columns are
`Unsupported()` in the Prisma schema and are read and written through
`GeoRepository` with raw SQL.

**Rules the database itself enforces** (a direct SQL insert cannot get past
them):

| Constraint | Rule |
| --- | --- |
| `properties_photo_count_chk` | 8–18 photos on anything past draft |
| `property_videos_min_1080p_chk` | a READY reel is ≥1080 on its short edge |
| `property_media_derivation_chk` | an ENHANCED photo must reference an ORIGINAL |
| `rivo_audit_logs_immutable()` | `audit_logs` refuses UPDATE and DELETE |
| `rivo_sync_property_photo_count()` | `properties.photo_count` cannot drift from the media rows |

> **Never run `prisma migrate dev` against a database you care about.** The
> PostGIS objects, triggers and CHECK constraints are hand-written SQL that
> Prisma does not know about, and it will generate a migration that drops them.
> Use `migrate deploy`, and add new hand-written SQL as its own migration file.

---

## 6. API endpoint list

**103 operations.** Full table with auth requirements in
[`docs/api/ENDPOINTS.md`](./docs/api/ENDPOINTS.md); machine-readable contract in
[`docs/api/openapi.json`](./docs/api/openapi.json). Regenerate both with
`npm run openapi:generate -w @rivo/api`. The running API serves Swagger UI at
`/api/docs` in every environment except production.

| Group | Operations | Auth |
| --- | --- | --- |
| `auth` | 6 | public, then user token |
| `users` | 9 | user |
| `properties` | 17 | public reads, user writes |
| `media` | 9 | user |
| `reels` | 9 | public feed, user upload |
| `payments` | 4 | user, plus a public signed webhook |
| `maps` | 4 | optional auth |
| `traffic` | 6 | public reads, user reports |
| `notifications` | 3 | user |
| `admin` | 33 | admin session, gated by role |
| `health`, `config` | 3 | public |

---

## 7. Outstanding credentials and purchases

Nothing below is stubbed. Every one of these features currently answers
`503 INTEGRATION_NOT_CONFIGURED` naming the variable it needs, and the API
refuses to boot in production without the mandatory ones. Prices and account
guidance: [`docs/purchase-checklist/ACCOUNTS_AND_PURCHASES.md`](./docs/purchase-checklist/ACCOUNTS_AND_PURCHASES.md).

| Needed | Variables | Blocks |
| --- | --- | --- |
| **Mapbox** account | `MAPBOX_PUBLIC_TOKEN`, `MAPBOX_SECRET_TOKEN` | the map, search, routing — the whole خرائط half |
| **Cloudflare R2** bucket | `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | photo upload — no listing can be published |
| **Cloudflare Stream** | `CLOUDFLARE_STREAM_TOKEN` | Reels |
| **SMS provider** | `OTP_PROVIDER=http` + its credentials | sign-in in production (the API refuses to boot with `console`) |
| **Payment gateway** (ZainCash / FIB / Qi) | `PAYMENT_PROVIDER`, its key, `PAYMENT_WEBHOOK_SECRET` | online payment. Until then `manual` is used: finance settles each fee by hand, audited. No webhook can settle a payment under `manual`. |
| **AI enhancement** provider | `AI_PROVIDER` + its key | photo enhancement (optional — listings publish without it) |
| **Sentry** | `SENTRY_DSN_API`, `SENTRY_DSN_MOBILE` | crash reporting (mandatory in production) |
| **Apple Developer** $99/yr | — | iOS release |
| **Google Play** $25 once | — | Android release |
| **D-U-N-S number** | — | Apple organisation account — **apply first, up to 30 days** |
| **Domain + TLS** | `API_BASE_URL`, `ADMIN_URL` | production |
| **Server** | — | 4 GB RAM minimum; PostGIS, Redis and ffmpeg all run on it |

Every account must be opened in **RIVO's own name**. An account in a
contractor's name is a hostage.

---

## 8. Acceptance results

Full report: [`docs/acceptance-tests/ACCEPTANCE_REPORT.md`](./docs/acceptance-tests/ACCEPTANCE_REPORT.md).

```
55 passed, 0 failed, 4 skipped
```

The four skips are Mapbox search and routing, which need a token. Every other
§21 item was executed against a running API, PostgreSQL+PostGIS and Redis.

| Suite | Result |
| --- | --- |
| API unit | 31 passed |
| API e2e (real Postgres + Redis) | 57 passed |
| Flutter | 34 passed |
| `flutter analyze` | no issues |
| typecheck, lint, admin build | clean |

Running the system found four defects that reading it had not, all fixed here
with regression tests: named rate-limit budgets capping every route; a
rejected-then-fixed listing stranded in `AWAITING_PAYMENT`; the e2e suite
truncating whatever `DATABASE_URL` pointed at; and a 429 response that was
neither bilingual nor carried a usable `Retry-After`.

---

## 9. Known limitations

**Needs a credential, not a fix**

- Mapbox, R2, Stream, AI, the payment gateway and SMS are unconfigured. Each
  refuses clearly and names its variable.
- `docker compose` was authored and is built by CI, but was never executed here
   — Docker was not available in the build environment.
- The app has not been run on a physical device or emulator. `flutter analyze`
  is clean and 34 widget tests pass.

**Real limitations of the design**

- **HTTP rate limiting is per-process.** The budgets live in memory, so two API
  instances double the effective limit and a restart resets it. The controls
  that matter — OTP per phone and per IP, admin account lockout — are
  Redis-backed and survive both. Move the throttler to Redis storage before
  scaling horizontally.
- **`isWithinIraqBounds` is a bounding box, not the border.** It also covers
  northern Kuwait and slivers of neighbouring countries. It catches obviously
  wrong coordinates; human moderation is the real safeguard.
- **The traffic engine has no data yet.** Aggregation, k-anonymity and retention
  all work and were verified, but a segment with no measurements falls back to
  the provider's estimate. This is a cold-start problem that only real usage
  fixes.
- **Two acceptance runs within an hour from one address** exhaust the OTP budget;
  the script says so and how to clear it.
- **Payment is manual until a gateway contract exists.** Finance settles each
  3,000 IQD fee by hand with a reference and an explanation, audited. This works
  and is safe, but it does not scale past a modest listing volume.

---

## 10. Next-phase roadmap

### Phase 1 — go live (weeks 1–4)

Buy the accounts, configure credentials, run the acceptance script against
staging with everything real, run the app on devices, sign the gateway contract,
have counsel adopt the legal drafts, submit to both stores. Nothing here is
development work; it is procurement, review and verification.

### Phase 2 — RIVO-owned traffic intelligence (months 2–6)

The engine is built and the privacy properties hold. What it lacks is data.

1. **Seed coverage.** Traffic sharing is opt-in and off by default. Ask for it
   at the right moment — after a completed journey, framed as helping other
   drivers — and show what it produces. An opt-in nobody accepts yields nothing.
2. **Segment the road network properly.** Segment keys are a coordinate grid
   plus heading today. Import OpenStreetMap geometry for Iraqi cities and map
   samples onto real road segments; a grid cell spanning two parallel streets
   averages them together.
3. **Typical-conditions profiles.** Day-of-week and minute-of-day are already
   stored in Baghdad time. Once a few weeks of data exist, serve "typical
   traffic at this hour" for segments with no live measurements — this is what
   makes an ETA trustworthy at 7am on a workday.
4. **Close the loop on predictions.** `route_feedback` already records predicted
   versus actual duration. Use it: measure error per segment, and weight
   provider estimates against RIVO's own where RIVO's are better.
5. **Incident quality.** Reporter reputation exists. Add corroboration by
   independent sessions passing the same segment at low speed — a jam three
   drivers' phones agree on needs no report at all.

The goal is that RIVO's routing beats a generic provider's inside Iraqi cities,
because it is measuring the roads Iraqis actually drive.

### Phase 3 — advanced navigation (months 4–9)

- **Turn-by-turn refinement**: lane guidance, junction views, spoken Arabic
  instructions with Iraqi place-name pronunciation.
- **Rerouting on measured conditions** rather than provider signals alone, once
  Phase 2 coverage is real.
- **Offline map regions** for Iraqi governorates — mobile data is expensive and
  coverage is uneven outside cities.
- **Journey history, on the device only.** Useful to the driver, and it must not
  become a server-side track: that would undo the privacy property the whole
  telemetry design is built around.

### Phase 4 — marketplace depth (months 6–12)

- Seller verification badges and office accounts with multiple agents.
- Saved searches with alerts — "new 3-bedroom in المنصور under 200m IQD".
- Price history per district, from RIVO's own listing data.
- In-app messaging, so phone numbers need not be published at all.
- Property comparison and a mortgage/instalment calculator for Iraqi lenders.

### Ongoing

Dependency updates monthly, a restore drill quarterly (a backup that has never
been restored is a guess), and the acceptance script in CI against staging so a
regression in any §21 rule fails a build rather than reaching a seller.
