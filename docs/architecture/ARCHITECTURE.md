# RIVO — Architecture

How the pieces fit together, and the reasoning behind the choices that are not
obvious. For what was verified against a running system, see the
[acceptance report](../acceptance-tests/ACCEPTANCE_REPORT.md).

---

## Shape

```
                      Flutter app (Android / iOS)
                     Arabic-first, RTL, Riverpod
                                 │
                        HTTPS · JWT access token
                                 │
        ┌────────────────────────┴─────────────────────────┐
        │                    Nginx                         │
        └────────────────────────┬─────────────────────────┘
                                 │
   ┌─────────────────────────────┼──────────────────────────────┐
   │                             │                              │
NestJS API                  BullMQ worker              Next.js admin
REST /api/v1                media · AI · maintenance   13 role-gated modules
   │                             │                              │
   └──────────┬──────────────────┴──────────────┬───────────────┘
              │                                 │
   PostgreSQL 16 + PostGIS 3.4              Redis 7
   listings, media, payments,               queues, OTP counters,
   incidents, telemetry, audit              route and tile caches
              │
   ┌──────────┴────────────────────────────────────────┐
   │  Cloudflare R2 (photos) · Cloudflare Stream       │
   │  (reels) · Mapbox (search, routing) · payment     │
   │  gateway · SMS provider · Sentry                  │
   └───────────────────────────────────────────────────┘
```

Every external service is reached through an adapter behind an interface, and
every one of them is optional at boot: an unconfigured integration answers
`503 INTEGRATION_NOT_CONFIGURED` naming the variable it needs. Nothing is
stubbed, so a deployment can never look like it works when it does not.

---

## The two products, one map

خرائط and داركم are not separate apps. A listing is a point on the same map the
navigation runs on, which is why `اذهب إلى العقار` on a listing opens navigation
to its pin rather than handing off to another product. Both read the same
PostGIS geometry, and the traffic engine that ranks routes is the same one that
decides how long it takes to reach a house at 8am on a Sunday.

---

## Why these choices

**PostGIS rather than a geo library.** Radius search, viewport queries, incident
proximity and route-to-property all reduce to `ST_DWithin` and `ST_Distance`
against a GiST index. Doing this in application code would mean loading every
listing in the governorate to filter it. The `geography(Point,4326)` columns are
`Unsupported()` in the Prisma schema and are read and written through
`GeoRepository` with raw SQL — Prisma stays type-safe everywhere else.

**Business rules duplicated into the database.** The 8–18 photo rule, the 1080p
short-edge rule and the payment-before-publish rule are enforced in the API and
again as CHECK constraints. The API check gives a bilingual error a seller can
act on; the constraint is what makes the rule true. A migration script, an
admin's psql session, or a future service that forgets the rule all hit the same
wall. There are 19 such constraints.

**The audit trail is append-only in the database, not by convention.** Triggers
raise on UPDATE and DELETE against `audit_logs`. An admin with database access
cannot quietly erase a decision they made. Verified: both statements are
refused.

**Payment state is server-authoritative.** No client can move a payment to PAID.
The only routes are a webhook whose HMAC signature verifies, or a finance
operator's settlement, which requires a reference and an explanation and writes
an audit row naming them. The `manual` provider — the default until a gateway
contract is signed — returns `false` from `verifySignature()` unconditionally,
so no webhook can settle anything while it is in use. That is deliberate: a
provider with no signing secret must not be a way in.

**Telemetry is aggregated before it is useful.** Raw speed samples carry a
rotating pseudonymous session key and no account identifier — there is no column
for one. A per-segment bucket is only written once at least 5 distinct sessions
contributed to it, because a bucket built from one session describes one
person's journey. Raw samples are deleted after 14 days; the aggregates survive.
There is no read path for raw telemetry anywhere in the API, including for
admins.

**Refresh tokens rotate, and reuse kills the family.** Presenting a
refresh token that has already been exchanged revokes every session descended
from it, not just that token. A stolen token is therefore worth one use before
it locks both the thief and the victim out, and the victim notices.

---

## Request path

1. **Nginx** terminates TLS and forwards with the client address intact.
2. **Request id middleware** stamps every request; the id appears in every log
   line, every error envelope and every Sentry report.
3. **RivoThrottlerGuard** applies the default budget to everything, and a named
   budget only to routes that opted in with `@RateLimit`. (The stock
   `ThrottlerGuard` applies every configured budget to every route, which turned
   the 6/hour OTP budget into a global cap — see the acceptance report.)
4. **JwtAuthGuard** authenticates, unless the route is `@Public()` or
   `@OptionalAuth()`, and defers entirely on routes carrying `@RequireRoles` so
   the admin guard can handle them. Both guards fail closed.
5. **AdminRolesGuard** checks the admin session and its role.
6. **ValidationPipe** with `whitelist` and `forbidNonWhitelisted` — an unknown
   field is an error, not something silently dropped. This is why a client
   cannot smuggle `amountIqd` into a payment request.
7. The handler runs.
8. **AllExceptionsFilter** is the single exit for every error: one envelope
   shape, bilingual messages, never a stack trace or SQL text, always the
   request id.

---

## Listing lifecycle

```
DRAFT ──submit──▶ AWAITING_PAYMENT ──payment settled──▶ PENDING_REVIEW
  ▲                                                          │
  │                          ┌───────────────────────────────┼──────────────┐
  │                          ▼                               ▼              ▼
  │                      PUBLISHED                       REJECTED   CHANGES_REQUESTED
  │                          │                               │              │
  │            ┌─────────────┼─────────┐                     └──── edit ────┘
  │            ▼             ▼         ▼                            │
  │        ARCHIVED        SOLD      RENTED                         │
  └─────────────────────────────────────────────────────────────────┘
                    resubmit (fee already settled) ──▶ PENDING_REVIEW
```

Two transitions are impossible by construction: `AWAITING_PAYMENT →
PENDING_REVIEW` by anything except the payment layer, and anything →
`PUBLISHED` except an admin approval from `PENDING_REVIEW`.

The listing fee is charged once. A listing that was rejected, corrected and
resubmitted goes straight back to review — sending it to the payment step again
would strand it, because creating a second payment is refused.

---

## Media

Photos never pass through the API. The client asks for presigned PUT URLs
(content type and size validated first), uploads straight to R2, then confirms.
The API stores the object key. An AI-enhanced photo is a **new row** referencing
its original; the original is never overwritten, and a database constraint
refuses an enhanced row with no source. Sellers can compare the two and choose.

Enhancement operations are restricted to an allow-list — exposure, white
balance, sharpening, straightening, noise reduction. Anything that would change
what the property *is* (removing objects, adding furniture, replacing a sky,
generative fill) is on a forbidden list with a tripwire that throws if it is
ever requested. A listing photo that lies about the property is fraud, and the
system will not help produce one.

Reels go to Cloudflare Stream via a direct creator upload. `ffprobe` reads the
real dimensions from the encoded file — not the client's claim — and validation
is on the **short edge**, so 1080×1920 portrait passes and 1280×720 landscape
does not.

---

## Traffic engine

1. Consented clients post batches of speed samples, keyed by a rotating session
   id that must not be a device or advertising id.
2. Samples map to a segment key derived from a rounded coordinate grid plus
   heading, so the two directions of a road are distinct.
3. Every 15 minutes the worker aggregates samples into per-segment buckets,
   keeping only buckets with at least 5 distinct sessions, and stores
   day-of-week and minute-of-day in Baghdad time so "typical traffic at 8am on a
   Sunday" is answerable.
4. Routing prefers a live aggregate, falls back to the typical value for that
   time of week, and finally to the provider's own estimate.
5. Community incident reports adjust segment cost. A new reporter's first report
   is held for moderation; a reporter with a confirmed track record publishes
   immediately, capped so no single account can publish an unverified closure.

---

## Admin dashboard

Next.js 15 App Router, Arabic RTL, TanStack Query. Thirteen modules: dashboard,
properties, users, payments, reels, reports, verifications, incidents, jobs,
flags, admins, audit, change-password. Every route is gated by
`@RequireRoles` on the API side — the UI hides what a role cannot do, and the
API refuses it regardless.

| Role | Can |
| --- | --- |
| `SUPER_ADMIN` | everything, including staff accounts and the audit trail |
| `MODERATOR` | listings, reels, reports, incidents, users |
| `FINANCE` | payments and revenue only |
| `SUPPORT` | read-only on listings, users and reports |

Verified live: finance and support are both refused listing approval; a
moderator is refused payment settlement.

---

## Mobile app

Flutter with Riverpod for state, GoRouter for navigation, Dio for HTTP. Arabic
is the default locale and the app is RTL throughout. Business rules that affect
what the seller sees — the 8–18 photo range, the 1080p floor, the 3,000 IQD fee
— are mirrored in `lib/core/config/business_rules.dart` so the app can refuse
early with a clear message, but the server decides. The app never concludes a
payment succeeded on its own; it polls `/payments/:id/status`.

`/health/capabilities` tells the app what this deployment can actually do, so an
unconfigured feature renders an explanatory state instead of a dead button.

---

## Failure behaviour

| Situation | What happens |
| --- | --- |
| A credential is missing | `503` naming the variable. In production the API refuses to boot. |
| PostGIS is absent | The API refuses to start with a message saying how to install it. |
| Redis is down | Queues stop; the API keeps serving reads and writes that do not need it. |
| A worker job fails | BullMQ retries with backoff; the failure is visible in the admin Jobs module. |
| A webhook signature does not verify | `401`, no state change, and the attempt is not attributed to any payment. |
| An unexpected exception | One error envelope with a request id; the stack goes to the log and Sentry, never to the client. |
