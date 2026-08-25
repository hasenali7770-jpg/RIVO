# RIVO — MASTER EXECUTION PLAN FOR CLAUDE

## 0) Mission
You are the lead engineer responsible for turning the attached RIVO project into a production-ready client handover. Work from the uploaded repository/ZIP and presentation; do not discard working code or rebuild blindly. Inspect the codebase first, run it, identify gaps, then implement the missing production pieces.

The product is **RIVO | ريفو**, one mobile application with two primary modes:

1. **خرائط | Maps** — smart navigation, traffic-aware routing, incidents and road reports.
2. **داركم | Darcom** — Iraqi real-estate marketplace with map-based discovery, paid property listings, AI photo enhancement, and property-only Reels.

This must be real software, not a visual prototype. Do not use fake API keys, fake payment success, hard-coded production data, placeholder buttons, or dead screens. Where an external credential is required, implement the adapter fully, document the required secret in `.env.example`, and provide a safe demo/sandbox mode.

---

# 1) Product identity

- Product name: **RIVO**
- Arabic: **ريفو**
- Main navigation label: **خرائط | داركم**
- Primary market at launch: Iraq, beginning with Baghdad.
- Languages: Arabic (RTL) first, English, Kurdish-ready architecture.
- Theme: Dark first + Light mode.

## Brand palette
Use a distinctive petroleum/sand/red identity:
- RIVO Petrol: `#071416`
- RIVO Surface: `#102326`
- RIVO Sand: `#D8C7A6`
- RIVO Signal Red: `#EF4B43`
- RIVO Success: `#6E9D76`
- White: `#F7F7F4`

Do not copy Waze, Google Maps, Property Finder, TikTok, Instagram, or another brand visually. RIVO needs its own design language.

---

# 2) Required repository structure

Use a monorepo with a clear handover structure:

```text
rivo/
  apps/
    mobile/              # Flutter mobile app
    admin/               # Next.js TypeScript admin dashboard
    api/                 # NestJS TypeScript backend
  packages/
    contracts/           # shared API schemas/types
    config/              # shared constants and feature flags
  infra/
    docker/
    nginx/
    scripts/
  docs/
    architecture/
    api/
    deployment/
    purchase-checklist/
    acceptance-tests/
  .env.example
  docker-compose.yml
  README_AR.md
  README_EN.md
```

If the uploaded repository has a different structure, preserve it unless migration is clearly beneficial. Document any restructuring.

---

# 3) Recommended technology stack

## Mobile
- Flutter stable + Dart.
- Riverpod or BLoC for state management; choose one and use it consistently.
- GoRouter for navigation.
- Dio for API calls.
- Secure storage for refresh tokens.
- Official Mapbox Maps SDK for Flutter for map rendering.
- For advanced native turn-by-turn navigation, bridge the official Mapbox Navigation SDK for Android (Kotlin) and iOS (Swift) through platform channels if Flutter does not expose every required production feature.
- video_player/camera or equivalent stable packages for Reels.
- image_picker with strict media validation.

## Backend
- NestJS + TypeScript.
- PostgreSQL + PostGIS.
- Redis/Valkey for caching, rate limiting, queues, live state.
- BullMQ for background image/video/AI jobs.
- WebSockets for live incident/traffic updates and job status.
- OpenAPI/Swagger generated from backend contracts.

## Admin
- Next.js + TypeScript.
- Tailwind CSS.
- TanStack Query.
- Role-based access control.

## Infrastructure
- Docker and Docker Compose.
- DigitalOcean production environment.
- Cloudflare DNS/WAF/CDN.
- Cloudflare R2 for original/enhanced property images and other objects.
- Cloudflare Stream for Reels video ingestion, transcoding and delivery.
- GitHub + GitHub Actions CI/CD.
- Sentry for crash/error tracking.

---

# 4) RIVO Maps — functional scope

The Maps mode must open as a real live map, not a screenshot.

## Main map screen
- Current GPS location.
- Search destination.
- Saved Home and Work.
- Recent destinations.
- Traffic layer.
- Zoom/location controls.
- Light/dark map styling.
- Arabic RTL support.
- Bottom switch: `خرائط | داركم`.

## Routing
Use traffic-aware routing. At launch, use Mapbox `driving-traffic`/Navigation services and design the backend so RIVO can add its own traffic intelligence later.

Route result must include:
- Best route.
- At least one alternative when available.
- ETA.
- Distance.
- Estimated traffic delay.
- Route polyline.
- Re-route when conditions change or driver leaves the route.

## Navigation
- Turn-by-turn guidance.
- Voice guidance where supported.
- Rerouting.
- Destination arrival.
- Route preview.
- Avoidances/settings architecture for future tolls, ferries, bad roads, etc.

## Road incident reports
Allow users to submit:
- Accident.
- Traffic jam.
- Road closure.
- Road works.
- Flooded street.
- Pothole / damaged road.
- Hazard.

Each report needs:
- Coordinates.
- Type.
- Timestamp.
- Optional short note.
- Confidence/verification score.
- Expiration logic.
- Admin moderation ability.
- Community confirmations/dismissals in a later-ready schema.

## RIVO Traffic Engine foundation
Do not attempt to recreate Waze traffic intelligence immediately. Build the data foundation:
- Explicit user consent for telemetry.
- Pseudonymous device/session identifier.
- Road speed samples.
- Heading.
- Timestamp.
- Map-matched road segment.
- Aggregate samples by road segment/time bucket.
- Never expose another user’s raw track.
- Minimize raw-location retention.
- Provide opt-out and privacy controls.

Create tables/services so future RIVO routing can combine:
`Mapbox traffic + RIVO aggregated speed + incidents + road quality reports`.

---

# 5) Darcom — real estate marketplace

Darcom is a mode inside RIVO, not a separate app.

## Supported property types
- House / منزل.
- Apartment / شقة.
- Shop / محل.
- Building / بناية.
- Land / أرض.
- Commercial property / عقار تجاري.

## Listing purpose
- For Sale / للبيع.
- For Rent / للإيجار.

## Discovery
- Map with price pins.
- List view.
- Search by area.
- Filters:
  - property type
  - sale/rent
  - price range
  - area in m²
  - bedrooms
  - bathrooms
  - verified only
  - owner/office
- Sorting by newest, price and relevance.

## Property details
- Real user-uploaded property photos.
- Price in IQD.
- Area.
- Rooms.
- Bathrooms.
- Floors where applicable.
- Description.
- Neighborhood/city.
- Seller type.
- Contact button.
- Save/favorite.
- Share.
- Report listing.
- `اذهب إلى العقار` button that passes the property coordinates into RIVO Maps and starts route planning.

Do not present AI-generated demonstration images as real properties in production. Seed/demo assets must be clearly marked as sample content.

---

# 6) Property listing flow — mandatory

Implement this exact flow.

## Step 1 — account
User signs in via phone number OTP.

Account types:
- Individual owner.
- Real-estate office.
- Developer/company.

## Step 2 — property type and purpose
User chooses property type and Sale/Rent.

## Step 3 — location
- Use current GPS or map pin.
- User can fine-tune pin.
- Store PostGIS point.
- Seller may choose exact or approximate public display policy if enabled later.

## Step 4 — property details
At minimum:
- price IQD
- area m²
- bedrooms
- bathrooms
- floors if relevant
- title
- description
- governorate/city/district
- contact preference

## Step 5 — photos
Mandatory rule:
- Minimum: **8 images**.
- Maximum: **18 images**.

Reject submission with 0–7 or 19+ images.

Upload behavior:
- Request pre-signed upload URL from API.
- Upload original directly to Cloudflare R2.
- Save media record.
- Queue validation and enhancement job.
- Show upload and AI processing state to user.
- User can reorder images and choose cover.

## Step 6 — AI photo enhancement
Enhancement must improve quality without falsifying the property.

Allowed:
- exposure/white balance
- denoise
- clarity/sharpness
- super-resolution/upscale
- lens/perspective correction
- natural color correction
- smart crop

Not allowed automatically:
- adding/removing furniture
- changing walls/windows/rooms
- making a room larger
- adding a pool/garden/view
- materially altering property condition

Store:
- original asset
- enhanced asset
- model/version
- job timestamp
- enhancement status

The user must be able to compare original vs enhanced and select the version used in the listing.

## Step 7 — optional property Reel
Only property-related Reels are allowed.

Requirements:
- minimum Full HD 1080p.
- preferred vertical 9:16 `1080x1920`.
- reject 720p and below for publishing.
- configurable duration, recommended 10–90 seconds for MVP.
- linked to an existing draft property listing.

Use server-side media metadata validation with FFprobe or equivalent; do not trust only mobile metadata.

AI video enhancement may include:
- stabilization
- lighting correction
- mild denoise
- clarity
- smart cover selection
- caption/title suggestion

Never fabricate property features.

## Step 8 — preview
Show the final listing exactly as it will appear.

## Step 9 — listing fee
Standard listing fee: **3,000 Iraqi dinars**.

Payment flow must be server-authoritative:
1. Backend creates payment/order record with amount = 3000 IQD.
2. User is redirected to or completes the configured Iraqi payment gateway.
3. Gateway webhook/callback reaches backend.
4. Backend verifies signature/reference.
5. Only `PAID` listings may move to moderation.
6. A client-side success screen can never mark a listing paid.

Implement a PaymentProvider interface so the final Iraqi gateway can be connected without rewriting listing logic.

## Step 10 — moderation
After successful payment:
- status = `PENDING_REVIEW`.
- admin reviews listing, photos, Reel and contact data.
- approve -> `PUBLISHED`.
- reject -> reason shown to user.
- request changes -> user can edit and resubmit.

---

# 7) Darcom Reels feed

Create a vertical full-screen real-estate-only feed.

Each Reel displays:
- video
- sale/rent badge
- price
- area
- location
- property type
- favorite
- share
- seller
- `تفاصيل العقار`
- `الموقع والمسار`
- `اتصال`

Feed ranking MVP inputs:
- recency
- location relevance
- user-selected property filters
- completion/watch rate
- saves
- listing verification

Do not create a general social network. No unrelated lifestyle/personal posts.

---

# 8) Authentication and user accounts

## Authentication
- phone OTP
- access token + refresh token
- device sessions
- logout from current device/all devices
- rate limit OTP attempts

## User profile
- display name
- phone
- optional profile photo
- account type
- saved properties
- own listings
- payments
- notifications
- privacy settings

## Seller verification
Foundation for:
- verified phone
- verified owner/office
- admin verification
- badge displayed only when actual verification state is true

---

# 9) Admin dashboard

Admin dashboard is mandatory.

## Modules
1. Dashboard KPIs.
2. Users.
3. Properties.
4. Pending listings.
5. Photos/AI jobs.
6. Reels.
7. Payments.
8. Road incidents.
9. Seller verification.
10. Reports/abuse.
11. Notifications.
12. Feature flags/configuration.
13. Audit logs.

## Roles
- Super Admin.
- Moderator.
- Finance.
- Support.

Every sensitive action must create an audit-log entry.

---

# 10) Database design

Use UUID primary keys and timestamps.

Minimum tables/entities:

- users
- user_devices
- otp_challenges
- refresh_sessions
- seller_profiles
- properties
- property_locations
- property_media
- property_videos
- favorites
- listing_payments
- payment_events
- seller_verifications
- property_reports
- road_incidents
- road_incident_confirmations
- road_speed_samples
- road_speed_aggregates
- route_feedback
- notifications
- media_jobs
- ai_jobs
- admin_users
- admin_roles
- audit_logs
- feature_flags

Use PostGIS indexes on geospatial columns.
Use appropriate indexes for property filters and feed queries.
Add migrations and seed data.

---

# 11) API contract

Implement versioned routes `/api/v1/...`.

Minimum endpoints:

## Auth
- POST `/auth/request-otp`
- POST `/auth/verify-otp`
- POST `/auth/refresh`
- POST `/auth/logout`

## Maps
- GET `/maps/search`
- POST `/maps/routes`
- POST `/maps/route-feedback`
- GET `/traffic/incidents`
- POST `/traffic/incidents`
- POST `/traffic/telemetry/batch`

## Properties
- GET `/properties`
- GET `/properties/:id`
- POST `/properties`
- PATCH `/properties/:id`
- POST `/properties/:id/submit`
- POST `/properties/:id/favorite`
- DELETE `/properties/:id/favorite`
- POST `/properties/:id/report`

## Media
- POST `/uploads/images/presign`
- POST `/uploads/images/complete`
- POST `/uploads/video/create`
- GET `/media/jobs/:id`
- POST `/properties/:id/media/reorder`

## Reels
- GET `/reels/feed`
- GET `/reels/:id`
- POST `/reels/:id/view-event`

## Payments
- POST `/payments/listing/create`
- POST `/payments/webhook/:provider`
- GET `/payments/:id/status`

## Admin
- `/admin/users/...`
- `/admin/properties/...`
- `/admin/payments/...`
- `/admin/incidents/...`
- `/admin/reels/...`
- `/admin/verifications/...`

Use DTO validation and consistent error envelopes.
Generate Swagger/OpenAPI.

---

# 12) External integrations

## Mapbox
Use for:
- live map
- geocoding/search
- Directions traffic-aware routing
- traffic visualization
- production navigation SDK

Never put secret Mapbox tokens in the mobile app. Use public restricted token for map rendering and server-side secrets for protected calls where needed.

## Cloudflare R2
Use for:
- original photos
- enhanced photos
- optional source media/exports

Use direct signed uploads.

## Cloudflare Stream
Use for:
- Reels upload
- encoding
- adaptive playback
- delivery

Prefer Direct Creator Upload so the mobile device does not send large video through the API server.

## AI provider
Start with a provider abstraction. Replicate can be used initially for image super-resolution/quality enhancement, but do not couple the domain layer to a single provider.

Interface examples:
- `enhancePhoto()`
- `analyzePhotoQuality()`
- `selectVideoCover()`
- `enhanceVideoMetadata()`

## SMS OTP
Create `OtpProvider` adapter. Final production provider will be selected based on Iraq coverage and commercial agreement.

## Iraqi payment gateway
Create `PaymentProvider` adapter. Do not invent credentials or fake gateway responses. Final provider requires merchant onboarding and signed webhook validation.

---

# 13) Security requirements

Mandatory:
- HTTPS everywhere.
- Secrets only in environment/secret manager.
- Never commit `.env`.
- API rate limits.
- OTP abuse controls.
- JWT rotation/refresh strategy.
- RBAC for admin.
- input validation.
- upload MIME validation.
- upload size limits.
- malware/media validation path.
- signed media URLs where appropriate.
- payment webhook signature verification.
- audit logs.
- daily DB backups.
- dependency vulnerability scanning.
- no raw user GPS history exposed to admin unless strictly required and explicitly designed.
- privacy controls for traffic telemetry.

Prepare:
- Privacy Policy placeholders.
- Terms of Use placeholders.
- Property listing policy.
- AI enhancement disclosure.
- Community/reporting policy.

---

# 14) Environment variables

Create a complete `.env.example` with descriptions and no real secrets.

Minimum variables:

```env
APP_ENV=
API_BASE_URL=
WEB_APP_URL=
ADMIN_URL=
DATABASE_URL=
REDIS_URL=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=

MAPBOX_PUBLIC_TOKEN=
MAPBOX_SECRET_TOKEN=

CLOUDFLARE_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_BASE_URL=

CLOUDFLARE_STREAM_TOKEN=
CLOUDFLARE_STREAM_CUSTOMER_CODE=

AI_PROVIDER=
REPLICATE_API_TOKEN=

OTP_PROVIDER=
OTP_API_KEY=
OTP_SENDER_ID=

PAYMENT_PROVIDER=
PAYMENT_MERCHANT_ID=
PAYMENT_SECRET=
PAYMENT_WEBHOOK_SECRET=

SENTRY_DSN_API=
SENTRY_DSN_MOBILE=
SENTRY_DSN_ADMIN=
```

---

# 15) Production deployment architecture

Initial production architecture:

```text
Mobile apps
   |
Cloudflare DNS/WAF
   |
api.<RIVO_DOMAIN>
   |
DigitalOcean Droplet (Docker)
   |-- NestJS API
   |-- Worker process
   |-- Redis/Valkey (or managed service)
   |
Managed PostgreSQL + PostGIS

Images -> Cloudflare R2
Reels  -> Cloudflare Stream
Maps   -> Mapbox
AI     -> provider API / worker
Admin  -> admin.<RIVO_DOMAIN>
```

Use Nginx or Caddy as reverse proxy.
Use automatic TLS.
Restrict DB networking to application infrastructure.

## Recommended launch server
- DigitalOcean Basic Droplet, 4 GiB RAM / 2 vCPU / 80 GiB SSD.
- Managed PostgreSQL 2 GiB plan for safer production separation.
- Scale API and workers separately when media/traffic load grows.

Do not introduce Kubernetes for the first release unless real load requires it.

---

# 16) CI/CD

GitHub Actions must run:
- lint
- typecheck
- unit tests
- API integration tests
- build admin
- build API container
- Flutter analyze/tests

Production branch strategy:
- `main` = production-ready
- `develop` = integration
- feature branches

Deployment must support rollback.

---

# 17) Observability and backups

- Sentry for mobile/API/admin errors.
- structured JSON logs.
- request IDs.
- health endpoint `/health`.
- uptime monitor.
- database automated backup.
- restore procedure documented and tested.
- media is not considered backed up merely because it exists in one bucket; document retention strategy.

---

# 18) Accounts/purchases that the project owner must create

All production accounts must be owned by the RIVO client/company, not the developer.

## Required now
1. Domain for RIVO after availability/trademark check.
2. Business email on the domain.
3. GitHub organization/repository.
4. Mapbox account and billing profile.
5. Cloudflare account.
6. Cloudflare R2 subscription.
7. Cloudflare Stream subscription.
8. DigitalOcean team/account.
9. AI provider account such as Replicate.
10. SMS/OTP commercial account that supports Iraq.
11. Iraqi payment gateway merchant account.
12. Apple Developer organization account.
13. Google/Android developer organization account for full distribution.
14. Sentry organization.

## Important ownership rule
The client owns:
- domain
- DNS
- source repository
- App Store/Android developer accounts
- cloud accounts
- payment merchant
- SMS account
- Mapbox account
- AI account
- database backups

Developers receive the minimum required team permissions.

---

# 19) Current baseline infrastructure cost assumptions

These are planning figures and must be verified at purchase time:

- DigitalOcean Basic 4 GiB / 2 vCPU Droplet: about **$24/month**.
- DigitalOcean Managed PostgreSQL 2 GiB: about **$30.45/month**.
- Cloudflare R2: first 10 GB-month included, then about **$0.015/GB-month**, with operation charges and zero internet egress fees for R2.
- Cloudflare Stream: about **$5 per 1,000 stored video minutes** and **$1 per 1,000 delivered minutes**.
- Apple Developer Program: **$99/year**.
- Android full-distribution developer registration: **$25 one-time**.
- Mapbox Directions API: current public pricing includes a free tier up to 100,000 monthly requests; after that the next public tier is usage-based. Native Navigation SDK commercial pricing must be confirmed for the production account before launch.
- AI, OTP and payment gateway: usage/contract dependent.

A reasonable small-production baseline before material map/AI/SMS/video usage is roughly **$60–$150/month**, then scales with traffic and media consumption.

---

# 20) App Store release requirements

Prepare:
- application icons
- splash screen
- screenshots
- Arabic/English store descriptions
- privacy policy URL
- support URL
- terms URL
- data collection disclosures
- location permission explanation
- background location justification if navigation requires it
- photo/video permission descriptions
- TestFlight build
- Android internal/closed testing build

For organization accounts, prepare the legal organization information and D-U-N-S verification required by Apple/Google.

---

# 21) Acceptance tests — must pass before client handover

## Maps
- [ ] Live map renders with a valid Mapbox token.
- [ ] GPS centers correctly after permission.
- [ ] Destination search returns usable locations.
- [ ] Traffic-aware route is calculated.
- [ ] Route ETA/distance displayed.
- [ ] Alternative route shown when provider returns one.
- [ ] Incident report is saved with coordinates.
- [ ] Incident appears for nearby users after moderation/rules.
- [ ] `اذهب إلى العقار` opens RIVO Maps with correct destination.

## Darcom
- [ ] Sale and Rent filters work.
- [ ] Property types work.
- [ ] Map price pins open correct listing.
- [ ] 7 photos cannot be submitted.
- [ ] 8 photos can proceed.
- [ ] 18 photos can proceed.
- [ ] 19 photos cannot be submitted.
- [ ] Original and enhanced photos are stored separately.
- [ ] AI enhancement status is visible.
- [ ] 720p Reel cannot be published.
- [ ] 1080p Reel passes media validation.
- [ ] Reel is linked to one property.
- [ ] Listing amount is exactly 3,000 IQD.
- [ ] Unpaid listing cannot become published.
- [ ] Payment webhook determines final payment state.
- [ ] Paid listing enters admin moderation.
- [ ] Admin approval publishes listing.
- [ ] Rejection includes user-visible reason.

## Security/quality
- [ ] No production secret committed to repository.
- [ ] All admin operations require role permission.
- [ ] Payment webhook signature is verified.
- [ ] OTP endpoint is rate-limited.
- [ ] Uploads validate type and size.
- [ ] API returns documented validation errors.
- [ ] Database migrations work on empty DB.
- [ ] Seed/demo data is labeled as demo.
- [ ] Arabic RTL layouts are correct.
- [ ] App handles no-internet state.
- [ ] Sentry/error reporting is wired.
- [ ] Backup and restore procedure is documented.

---

# 22) Definition of Done

Do not call the project complete until all of the following exist:

1. Mobile app boots and core flows work.
2. API boots from Docker.
3. Database migrations complete successfully.
4. Admin dashboard works.
5. Real Mapbox integration works when credentials are supplied.
6. Real R2 signed image upload works.
7. Real Stream video upload works.
8. Photo count validation is enforced by mobile and server.
9. Reel 1080p requirement is enforced by mobile and server.
10. Payment adapter + verified webhook contract are implemented.
11. Listing moderation works end-to-end.
12. AI enhancement worker and fallback behavior are documented.
13. Swagger/OpenAPI is generated.
14. `.env.example` is complete.
15. README contains exact setup commands.
16. Docker Compose provides a one-command local stack.
17. CI checks pass.
18. Acceptance test report is provided.
19. No critical/high security issue is left knowingly open.
20. Client handover document lists every external account and owner.

---

# 23) Execution order for Claude

Perform work in this order and report results after each milestone:

### Milestone A — audit
- inspect all uploaded files
- document current architecture
- run project
- list broken/missing items
- do not delete functioning modules

### Milestone B — foundation
- env validation
- PostgreSQL/PostGIS migrations
- Redis/queue
- auth
- API contracts
- Docker

### Milestone C — Darcom core
- property CRUD
- geospatial search
- media 8–18 flow
- AI jobs
- 3,000 IQD payment state machine
- moderation

### Milestone D — Reels
- Stream direct upload
- FFprobe server validation
- minimum 1080p
- property-linked feed

### Milestone E — Maps
- Mapbox map/search
- traffic-aware routing
- incidents
- route-to-property
- telemetry consent/foundation

### Milestone F — Admin
- listings
- users
- payments
- incidents
- Reels
- verification
- audit logs

### Milestone G — production hardening
- security
- backups
- monitoring
- CI/CD
- performance
- tests

### Milestone H — release/handover
- Android release configuration
- iOS release configuration
- store checklist
- deployment docs
- purchase checklist
- acceptance report

---

# 24) Strict implementation rules for Claude

- Do not respond with only an architecture proposal; edit/build the repository.
- Do not create fake APIs where real adapters are required.
- Do not mark simulated payments as production-ready.
- Do not invent production credentials.
- Do not commit secrets.
- Do not silently remove requirements.
- Do not use a web mockup as a substitute for the mobile application.
- Do not make AI enhancement change the truth of the property.
- Do not allow non-property Reels.
- Do not lower the 8-photo minimum, 18-photo maximum, 1080p Reel minimum, or 3,000-IQD standard listing fee without explicit approval.
- Keep business rules server-side as well as client-side.
- Prefer stable, maintained packages.
- Explain any library/provider substitution before making it.
- Every button shown in the production UI must either work or be clearly feature-flagged/disabled; no dead controls.

At completion, provide:
- exact run commands
- exact build commands
- exact deployment commands
- final folder tree
- database schema summary
- API endpoint list
- outstanding credentials/purchases
- acceptance test results
- known limitations
- next-phase roadmap for RIVO-owned traffic intelligence and advanced navigation.

