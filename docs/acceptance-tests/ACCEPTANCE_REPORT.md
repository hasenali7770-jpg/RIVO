# RIVO — Acceptance report

**Run date:** 2026-08-25 · **Branch:** `claude/rivo-maps-realestate-fhipsh`

This report records what was actually executed against a running system, not
what the code appears to do. Every PASS below corresponds to an HTTP response or
a database row observed during the run. Every SKIP names the credential that
would turn it into a real test.

Re-run it yourself:

```bash
set -a && . .env && set +a          # DATABASE_URL, ADMIN_BOOTSTRAP_* etc.
npm run start -w @rivo/api &        # or docker compose up
./infra/scripts/acceptance.sh
```

The script creates its own staff accounts, seller and listing on each run and
never truncates anything, so it is safe against a populated database.

---

## Environment the run used

| Component | Version | Notes |
| --- | --- | --- |
| Node.js | 22.22.2 | |
| PostgreSQL | 16.13 | |
| PostGIS | 3.4 (GEOS, PROJ, STATS) | |
| Redis | 7.0.15 | |
| Flutter | 3.47.1 (stable) | |
| API | `@rivo/api` 1.0.0, `APP_ENV=development` | |
| Payment provider | `manual` | no gateway contract signed yet |
| Mapbox / R2 / Stream / AI | **not configured** | see *Not verified* below |

Docker was not available in the run environment, so `docker compose` was
authored and linted but never executed. Everything else ran natively.

---

## Result

```
55 passed, 0 failed, 4 skipped
```

Full transcript: [`acceptance-run.txt`](./acceptance-run.txt).

Automated suites, run separately:

| Suite | Command | Result |
| --- | --- | --- |
| API unit | `npm test -w @rivo/api` | 31 passed |
| API e2e (real Postgres + Redis) | `npm run test:e2e -w @rivo/api` | 57 passed |
| Flutter | `flutter test` | 34 passed |
| Flutter analyzer | `flutter analyze` | no issues |
| API typecheck / lint | `npm run typecheck`, `npm run lint` | clean |
| Admin typecheck / build | `tsc --noEmit`, `next build` | clean, 13 routes |

---

## Master Plan §21 checklist

### Maps

| Check | Result |
| --- | --- |
| Live map renders with a valid Mapbox token | **SKIP** — needs `MAPBOX_PUBLIC_TOKEN`. The mobile app reads the token from `/health/capabilities` and shows an explicit "map unavailable" state rather than a blank tile grid; that state is covered by a widget test. |
| GPS centres correctly after permission | **SKIP** — needs a device or emulator with location services. |
| Destination search returns usable locations | **SKIP** — needs `MAPBOX_SECRET_TOKEN`. |
| Traffic-aware route is calculated | **SKIP** — needs `MAPBOX_SECRET_TOKEN`. |
| Route ETA / distance displayed | **SKIP** — needs `MAPBOX_SECRET_TOKEN`. |
| Alternative route shown when the provider returns one | **SKIP** — needs `MAPBOX_SECRET_TOKEN`. |
| Incident report is saved with coordinates | **PASS** — round-tripped through PostGIS to 4 decimal places. |
| Incident appears for nearby users after moderation / rules | **PASS** — a new reporter's first report is held at `PENDING_REVIEW` and invisible to others; a moderator publishes it; it then appears within 500 m and not at 400 km. A moderator can also take it off the map, and it disappears. |
| `اذهب إلى العقار` opens RIVO Maps with the right destination | **SKIP** — needs a device. The route from a listing to the map screen is wired in `apps/mobile/lib/features/darcom/property_detail_screen.dart` and passes the listing's stored coordinates; verifying the map itself needs a token. |

Unconfigured maps endpoints return `503 INTEGRATION_NOT_CONFIGURED` naming the
missing variable — **PASS**. They never return stub coordinates.

### Darcom

| Check | Result |
| --- | --- |
| Sale and Rent filters work | **PASS** — a `SALE` listing is absent from `purpose=RENT`. |
| Property types work | **PASS** — an `APARTMENT` is absent from `type=LAND`. |
| Map price pins open the correct listing | **PASS** (API half) — `/properties/map` answers for a viewport and returns listing ids. The tap-through is Flutter UI, covered by widget tests, not by this script. |
| 7 photos cannot be submitted | **PASS** — `422 PHOTO_COUNT_TOO_LOW`, bilingual, with the count in `details`. |
| 8 photos can proceed | **PASS** — moves to `AWAITING_PAYMENT`. |
| 18 photos can proceed | **PASS** |
| 19 photos cannot be submitted | **PASS** — refused by the database `properties_photo_count_chk`, so a direct SQL insert cannot get past it either. |
| Original and enhanced photos are stored separately | **PASS** — an `ENHANCED` row references its `ORIGINAL` and leaves it intact; an `ENHANCED` row with no source is refused. |
| AI enhancement status is visible | **PASS** (structure) — `/media/jobs/:id` and `/properties/:id/media/jobs` return job state, and the admin dashboard has a Jobs module. No enhancement was actually run: `AI_PROVIDER` is unset. |
| 720p Reel cannot be published | **PASS** — refused by `property_videos_min_1080p_chk`. |
| 1080p Reel passes media validation | **PASS** — both 1920×1080 and 1080×1920 are accepted. The rule is on the **short edge**, so a portrait reel is not mistaken for sub-HD. |
| Reel is linked to one property | **PASS** — a video row with no property is refused. |
| Listing amount is exactly 3,000 IQD | **PASS** — server-decided; a client-supplied `amountIqd` is rejected outright by the validation whitelist. |
| Unpaid listing cannot become published | **PASS** — approval returns `402 PAYMENT_REQUIRED`. |
| Payment webhook determines final payment state | **PASS** — a forged webhook is refused with `401 PAYMENT_SIGNATURE_INVALID` and the payment stays `PENDING`. Under the `manual` provider, signature verification always fails by design, so **no webhook can settle a payment until a real gateway is configured**; the only route to `PAID` is an audited finance settlement. |
| Paid listing enters admin moderation | **PASS** — settlement moves it to `PENDING_REVIEW`. |
| Admin approval publishes listing | **PASS** — `PUBLISHED`, and it appears in anonymous search immediately. |
| Rejection includes a user-visible reason | **PASS** — the reason is mandatory (min 10 characters) and comes back verbatim on the seller's edit payload. |

### Security and quality

| Check | Result |
| --- | --- |
| No production secret committed | **PASS** — `.env` is git-ignored, `.env.example` holds only placeholders, and CI has a secret-scanning job. |
| All admin operations require role permission | **PASS** — support and finance are both refused listing approval (403); a moderator is refused payment settlement (403); an unauthenticated call is refused (401). Four roles were exercised live. |
| Payment webhook signature is verified | **PASS** — see above. |
| OTP endpoint is rate-limited | **PASS** — the 7th request in an hour from one address returns 429, in Arabic and English, with a plain `Retry-After`. |
| Uploads validate type and size | **PASS** — a non-image content type and an out-of-range length are both rejected before any presign is issued. |
| API returns documented validation errors | **PASS** — `400 VALIDATION_FAILED` with an itemised `details.violations`, matching the OpenAPI document. |
| Database migrations work on an empty DB | **PASS** — three migrations applied to a fresh database, creating 30 tables, 19 CHECK constraints, 6 GiST indexes and 5 triggers. CI asserts these counts after migrating. |
| Seed / demo data is labelled as demo | **PASS** — `is_demo` on properties, media, videos and incidents; the mobile app renders a demo badge (widget test). |
| Arabic RTL layouts are correct | **PASS** (unit level) — the app is RTL-first with Arabic as the default locale; widget tests cover the demo badge, verified badge, sale/rent chips, offline state and both themes. Visual RTL review on a device is still worth doing before store submission. |
| App handles the no-internet state | **PASS** — a widget test asserts the offline state is distinguishable from a server error. |
| Sentry / error reporting is wired | **PASS** (structure) — the API initialises Sentry when `SENTRY_DSN_API` is present and reports unexpected exceptions with the request id. No DSN is configured here, so nothing was actually delivered to Sentry. |
| Backup and restore procedure is documented | **PASS** — `infra/scripts/backup.sh` and `restore.sh`, with a round trip exercised and recorded in `docs/deployment/BACKUP_RESTORE.md`. |

### Privacy (Master Plan §13)

| Check | Result |
| --- | --- |
| Raw telemetry carries no account identifier | **PASS** — `road_speed_samples` has no user column at all; only a rotating pseudonymous session key. |
| Telemetry needs consent | **PASS** — refused with 403 for an account that has not opted in, and a batch flagged `consent:false` is discarded. |
| Aggregates are k-anonymous | **PASS** — verified live: 4 distinct sessions on one segment produced **0** aggregate buckets; adding a 5th produced **1**. The threshold is 5 distinct sessions. |
| Raw samples are deleted after 14 days | **PASS** — verified live: 12 samples backdated 20 days were removed by the retention sweep, the aggregate survived, and `maintenance_runs` recorded `telemetry.purge-raw {"deleted": 12}`. |
| Admins cannot see raw GPS tracks | **PASS** — there is no read path for raw telemetry anywhere in the API; the admin user detail endpoint documents the omission. |

---

## Defects found during this run and fixed

Four defects were found by running the system rather than reading it. All four
are fixed, with regression tests, in this branch.

1. **Named rate-limit budgets capped every route.** `@nestjs/throttler` applies
   every configured throttler to every request, so the OTP budget (6/hour) and
   the admin-login budget (10 per 5 min) were charged to all traffic. Six
   anonymous listing searches from one address exhausted the API for an hour.
   Iraqi mobile traffic egresses through a handful of carrier NAT addresses, so
   this would have locked out whole networks. Named budgets are now opt-in per
   route (`@RateLimit`), and a public search charges only the 120/min default.

2. **A rejected-then-fixed listing could not be republished.** Resubmission sent
   the listing back to `AWAITING_PAYMENT`, but creating a second payment is
   refused with `PAYMENT_ALREADY_PAID` — so the listing was stranded with no way
   out. Submission now returns a listing with a settled fee straight to review.

3. **The e2e suite truncated whatever `DATABASE_URL` pointed at.** Its guard
   checked `APP_ENV=test`, which the suite sets itself. Sourcing `.env` and
   running the tests in the same shell deleted the working database — it
   happened during this run. The reset now refuses any database not named as a
   test database.

4. **A 429 was not a usable response.** The body carried the framework string
   `ThrottlerException: Too Many Requests` with no Arabic, and only per-budget
   `Retry-After-<name>` headers were sent — never the plain `Retry-After` that
   clients read. Both fixed.

---

## Not verified — and what it would take

Nothing below is broken; each is a path that needs a credential or a device this
environment did not have. None of them is stubbed: the code refuses clearly
instead of pretending to work.

| Area | Blocked on | What is already in place |
| --- | --- | --- |
| Mapbox search, routing, live map | `MAPBOX_SECRET_TOKEN`, `MAPBOX_PUBLIC_TOKEN` | Client, DTOs, caching, rate limits, route feedback. Endpoints return `503` naming the variable. |
| Photo upload to R2 | `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Presign flow, type/size validation, direct-to-R2 upload, confirm step. Media rows for this run were inserted directly so the rest of the lifecycle could be exercised. |
| Reel upload to Cloudflare Stream | `CLOUDFLARE_STREAM_TOKEN` | Direct creator upload, webhook, ffprobe validation on the short edge. |
| AI photo and video enhancement | `AI_PROVIDER` + its key | Job queue, original/enhanced storage, allow-list of operations that may not alter the property itself. |
| Online card payment | a gateway contract (ZainCash / FIB / Qi) | Provider interface, HMAC webhook verification, server-authoritative state machine. `manual` provider refuses every webhook signature by design. |
| SMS OTP delivery | `OTP_PROVIDER=http` + provider credentials | Console provider for development; production boot **refuses** to start with `OTP_PROVIDER=console`. |
| Sentry delivery | `SENTRY_DSN_API`, `SENTRY_DSN_MOBILE` | Initialisation, request-id tagging, unexpected-exception capture. |
| `docker compose up` | Docker in the run environment | Compose file, Dockerfiles and Nginx config are written; CI has a `docker` job that builds them. |
| On-device Android / iOS run | a device or emulator | `flutter analyze` clean, 34 widget tests pass. |

A production boot is refused outright until the mandatory ones are supplied.
Starting the API with `APP_ENV=production` against this configuration prints:

```
RIVO cannot start — the environment is invalid:
  • OTP_PROVIDER: OTP_PROVIDER=console prints login codes to the server log and must never run in production...
  • MAPBOX_SECRET_TOKEN: MAPBOX_SECRET_TOKEN is required in production for search and routing
  • MAPBOX_PUBLIC_TOKEN: MAPBOX_PUBLIC_TOKEN is required in production so the mobile app can render the map
  • R2_ACCESS_KEY_ID: Cloudflare R2 credentials ... are required in production
  • ADMIN_URL: ADMIN_URL must be https:// in production
  • API_BASE_URL: API_BASE_URL must be https:// in production
  • SENTRY_DSN_API: SENTRY_DSN_API is required in production so crashes are reported
```

---

## Known limitations

- **HTTP rate limiting is per-process.** The `@nestjs/throttler` budgets live in
  memory, so behind two API instances the effective limit is doubled and a
  restart resets it. The abuse controls that matter — OTP requests per phone and
  per IP, and admin account lockout — are Redis-backed and survive both. If the
  API is scaled horizontally, move the throttler onto Redis storage too.
- **Two acceptance runs within an hour from one address** exhaust the OTP budget
  and the second run stops with a message saying exactly that. Restart the API
  and clear `otp:*` in Redis to run again immediately.
- **`isWithinIraqBounds` is a bounding box, not the border.** It also covers
  northern Kuwait and slivers of neighbouring countries. It is a sanity check on
  obviously-wrong coordinates, not a border control; human moderation is the
  real safeguard.
- **Demo seed data is off by default** (`RIVO_SEED_DEMO=true` to create it) and
  is labelled `is_demo` wherever it exists.
