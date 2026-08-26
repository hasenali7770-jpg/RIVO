# RIVO — Milestone A Audit Report

> Date: 2026-08-25
> Reference document: `RIVO_CLAUDE_MASTER_PLAN.md` (treated as the primary and final specification)
> Auditor: lead engineer (Claude)

---

## A.1 — Inputs actually received

| Input | Status | Notes |
|---|---|---|
| `RIVO_CLAUDE_MASTER_PLAN_1.md` | **Received** | 24 sections, full executive spec. Adopted as the single source of truth. |
| `RIVO_CLAUDE_MASTER_PLAN_1.txt` | **Received** | Byte-identical to the `.md` (verified by diff). No conflicts. |
| `RIVO_Full_Project_Presentation.pdf` | **Received** | 15 pages (not 24 as the file listing suggested). Business/brand deck. |
| `RIVO_Client_Handover_v1.0.zip` | **NOT RECEIVED** | The ZIP referenced in the task was never uploaded and does not exist anywhere on this machine or in the git repository. A full-filesystem search (`find / -iname '*RIVO*'`) returned only the two plan files, the PDF, and this repository. |
| PowerPoint (`.pptx`) | **NOT RECEIVED** | Only the PDF export of the deck was supplied. |
| Git repository `hasenali7770-jpg/RIVO` | **Received — effectively empty** | Single commit `bc3b885 "Add files via upload"` containing exactly one file: a WhatsApp logo PNG (89 KB). No source code of any kind. |

### A.1.1 — Consequence

There is **no pre-existing RIVO codebase to preserve**. The Master Plan's instruction
*"do not discard working code"* is satisfied vacuously: there is no working code, no
partial modules, no prior migrations and no prior configuration in the repository.

The only pre-existing asset — the logo PNG — has been **preserved**, moved to
`brand/rivo-logo-source.png` via `git mv` (history retained), not deleted.

Therefore this project is a **greenfield production build against the Master Plan**,
not a refactor of a handover ZIP. If the client later supplies
`RIVO_Client_Handover_v1.0.zip`, it must be diffed against this repository before any
merge; nothing here assumes its contents.

---

## A.2 — Current architecture (before this milestone)

```text
RIVO/
  WhatsApp_Image_2026-04-06_at_7.32.17_PM-removebg.png   # logo raster, transparent background
```

- **Mobile app:** none.
- **Backend:** none.
- **Admin:** none.
- **Database:** none.
- **Infrastructure / CI:** none.
- **Documentation:** none.

"Run the project" (Master Plan Milestone A) was attempted and is **not applicable** —
there is no build manifest (`pubspec.yaml`, `package.json`, `Dockerfile`,
`docker-compose.yml`) anywhere in the tree, so nothing can be started. This is
recorded as a finding, not as a failure to execute the milestone.

---

## A.3 — Deck vs. Master Plan: conflicts found and how they were resolved

The PDF deck and the Master Plan disagree in two places. The user instruction is
explicit that the Master Plan is *"المرجع الأساسي والنهائي"* (the primary and final
reference), so the Master Plan wins in both cases. Both are recorded here so nothing
is silently dropped.

### Conflict 1 — Brand palette

| Source | Palette |
|---|---|
| **Master Plan §1 (AUTHORITATIVE)** | Petrol `#071416`, Surface `#102326`, Sand `#D8C7A6`, Signal Red `#EF4B43`, Success `#6E9D76`, White `#F7F7F4` |
| Deck p.2 ("Obsidian Coral Theme") | An obsidian/coral/petrol/sand/green variant with an electric-coral accent |

**Resolution:** the Master Plan palette is implemented as the RIVO design system
(`packages/config` + Flutter theme + Tailwind theme). The deck's "Obsidian Coral"
direction is *compatible in spirit* — dark base, warm sand for prices, red/coral for
the fastest route and alerts, green for verified/success — so the Master Plan hex
values are used with the deck's **semantic role assignments**:

- Signal Red `#EF4B43` → fastest route highlight, CTAs, critical incident alerts.
- Sand `#D8C7A6` → prices and highlight/premium accents.
- Success `#6E9D76` → verified badge, success states.
- Petrol `#071416` / Surface `#102326` → map and app chrome.

The deck's exact coral hex codes could not be recovered reliably from the PDF text
layer (bidirectional RTL text scrambles the hex digits), which is a second reason to
follow the Master Plan values.

### Conflict 2 — Page count

The upload listing reported the PDF as 24 pages; the actual document is 15 pages.
No content is missing — all 15 pages were extracted and read.

### Non-conflicts worth recording from the deck

These deck items are consistent with the Master Plan and are treated as requirements:

- **p.8 — "الدفع بعد المعاينة"**: the user pays *after* previewing the finished
  listing. This matches Master Plan §6 step 8 (preview) → step 9 (payment) and is
  implemented in that order.
- **p.8 — future upgrades** (featured listing, pinned listing, agency packages, extra
  reels, view/contact analytics) are **out of MVP scope** but the schema carries the
  seams for them (see `docs/architecture/ARCHITECTURE.md` → roadmap).
- **p.5 — traffic pipeline**: anonymous speed/heading → road reports → ETA
  computation → route decision. Matches Master Plan §4 "RIVO Traffic Engine
  foundation".
- **p.12 — customer journey** ends at "يذهب للعقار" → RIVO Maps route. This is the
  `اذهب إلى العقار` handoff in Master Plan §5.
- **p.13 — trust layer**: OTP before publishing/editing, listing review, non-property
  content detection, owner/office/company distinction, user reports. All in scope.

---

## A.4 — Gap list (everything that must be built)

Every line below was missing at audit time. Each maps to the milestone that delivers it.

### Foundation (Milestone B)
- [ ] Monorepo layout per Master Plan §2
- [ ] `.env.example` with all §14 variables and no secrets
- [ ] Fail-fast environment validation
- [ ] PostgreSQL + PostGIS schema, all 26 entities of §10
- [ ] Migrations that run on an empty database
- [ ] Demo-labelled seed data
- [ ] Redis + BullMQ queues
- [ ] Phone-OTP auth, access + refresh tokens, device sessions, rate limiting
- [ ] Shared contracts package
- [ ] Docker Compose one-command local stack

### Darcom (Milestone C)
- [ ] Property CRUD and lifecycle state machine
- [ ] PostGIS geospatial + filtered search, map pins, sorting
- [ ] R2 presigned direct upload
- [ ] **8-photo minimum / 18-photo maximum enforced on the server**
- [ ] AI enhancement jobs storing original **and** enhanced separately
- [ ] Original-vs-enhanced comparison and user selection
- [ ] **3,000 IQD** server-authoritative payment state machine
- [ ] Signed payment webhook as the only authority on payment state
- [ ] Moderation: approve / reject-with-reason / request-changes

### Reels (Milestone D)
- [ ] Cloudflare Stream direct creator upload
- [ ] Server-side media validation (FFprobe / Stream metadata)
- [ ] **1080p minimum enforced server-side**, 720p rejected
- [ ] Reel ↔ property link mandatory (no general social feed)
- [ ] Ranked property-only feed

### Maps (Milestone E)
- [ ] Live Mapbox map (mobile)
- [ ] Geocoding search proxied server-side
- [ ] `driving-traffic` routing with alternatives, ETA, distance, traffic delay
- [ ] Turn-by-turn guidance + rerouting + arrival
- [ ] Incident reporting (7 types) with confidence, expiry, moderation
- [ ] `اذهب إلى العقار` route-to-property handoff
- [ ] Consented telemetry ingestion + segment aggregation

### Admin (Milestone F)
- [ ] Next.js dashboard, all 13 modules of §9
- [ ] 4 roles with RBAC
- [ ] Audit log on every sensitive action

### Hardening & handover (Milestones G, H)
- [ ] Security controls of §13
- [ ] Backup + documented, tested restore
- [ ] Sentry, structured logs, request IDs, `/health`
- [ ] GitHub Actions CI
- [ ] Android / iOS release configuration
- [ ] Deployment docs, purchase checklist, acceptance report

---

## A.5 — Risks and constraints recorded at audit time

1. **No external credentials exist.** Mapbox, R2, Stream, Replicate, the SMS provider
   and the Iraqi payment gateway all require accounts owned by the client
   (Master Plan §18). Per §0 and §24, no fake keys are used anywhere. Every
   integration is implemented as a real adapter that fails loudly and explicitly when
   its credential is absent — never as a stub that pretends to succeed.
2. **The Iraqi payment gateway is not selected yet.** A `PaymentProvider` interface
   plus a real HMAC-signed webhook contract is implemented; no gateway response is
   ever simulated as successful in production mode.
3. **Docker is unavailable in this build container**, so `docker compose up` could not
   be executed here. It is mitigated by running the *same* PostgreSQL 16 + PostGIS 3.4
   and Redis 7 versions natively in this container and executing the real migrations
   and integration tests against them. Compose files are still authored and linted.
4. **Flutter SDK is unavailable in this build container**, so `flutter analyze` /
   `flutter test` could not be executed here. The mobile app is written to compile
   against pinned stable package versions and CI runs `flutter analyze` and
   `flutter test` on every push.
5. **Mapbox Navigation SDK licensing** for native turn-by-turn must be confirmed on
   the client's own Mapbox account before launch (§19).

---

## A.6 — Milestone A conclusion

- Nothing functional was deleted, because nothing functional existed.
- The one pre-existing asset (the logo) was preserved under `brand/`.
- The Master Plan is adopted verbatim as the specification.
- The two Master-Plan-vs-deck conflicts are resolved in favour of the Master Plan and
  documented above.
- Build proceeds to Milestone B.
