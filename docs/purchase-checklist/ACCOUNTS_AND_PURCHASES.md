# RIVO — accounts, purchases and ownership

> Master Plan §18: **every production account must be owned by the RIVO
> client/company, not by the developer.** Developers receive the minimum team
> permission needed and nothing more.
>
> Prices are the public figures at the time of writing (August 2026) and **must
> be re-checked at purchase time** — Master Plan §19 says so explicitly.

## How to use this document

Work down **Required before launch**. Nothing in that section can be skipped: the
API refuses to boot in production without the credentials it lists, which is a
deliberate design decision, not an obstacle to route around.

For each account: the client creates it, the client owns the billing, and the
client adds the developer as a member.

---

## Required before launch

### 1. Domain
- Register after an availability **and trademark** check for Iraq.
- Registrar in the client's name, with the client's payment method.
- **Enable registrar lock and auto-renew.** A lapsed domain takes the app down.
- Cost: roughly **$10–40/year** depending on the TLD.

### 2. Business email on the domain
- Google Workspace or Microsoft 365, from **~$6/user/month**.
- Needed as the recovery address for every other account below. Do **not** use a
  personal Gmail for these — recovering an account tied to a departed
  individual's mailbox is a real and common failure.

### 3. GitHub organisation
- Free tier is sufficient.
- The **organisation** owns the repository, not any individual.
- Developers are added as members; keep the `main` branch protected.

### 4. Cloudflare account
- Free tier for DNS and WAF.
- Add the domain and point the nameservers at Cloudflare.
- Set SSL/TLS to **Full (strict)** — see the deployment guide for why.

### 5. Cloudflare R2 — property photos
- **First 10 GB-month free**, then about **$0.015/GB-month**.
- Class A operations ~$4.50/million, Class B ~$0.36/million.
- **No egress fees**, which is the reason R2 was chosen over S3: RIVO serves
  photos constantly, and egress would dominate the bill.
- Create a bucket (`rivo-media`) and an **API token scoped to that bucket only**.
- Rough sizing: 18 photos × ~2 MB ≈ 36 MB per listing. 1,000 listings ≈ 36 GB ≈
  **~$0.40/month**. Storage is not where the money goes.

### 6. Cloudflare Stream — reels
- About **$5 per 1,000 minutes stored** and **$1 per 1,000 minutes delivered**.
- A 60-second reel is 1 minute stored. 1,000 reels ≈ **~$5/month** stored;
  delivery depends entirely on viewing.
- Create an API token with **Stream:Edit**.
- Without this token the app **hides the reels feature** rather than showing a
  button that fails. Reels can be enabled later without a code change.

### 7. DigitalOcean
- Droplet, Basic 4 GB / 2 vCPU / 80 GB: **~$24/month**.
- Managed PostgreSQL 2 GB: **~$30.45/month**.
- Droplet backups: **+20%** of the droplet, worth taking.
- Team account owned by the client; developers invited as members.

### 8. Mapbox
- Account and **billing profile** in the client's name.
- The account page lists the current free allowances per service — read them
  there rather than from any document, Mapbox changes them. At the time of
  writing they include 50,000 web map loads and 25,000 monthly active users on
  the mobile SDKs per month, with Directions and Geocoding each carrying their
  own monthly allowance.
- Create **two** tokens:
  - a **public** token (`pk.*`), **restricted by Android package name and iOS
    bundle id**, for map rendering in the app. The account's default public
    token works to begin with;
  - a **secret** token (`sk.*`) with the **`Downloads:Read`** secret scope,
    used **server-side and on build machines only**.
- **Neither Directions nor Geocoding requires a scope** — they work with the
  default scopes every token carries. `Downloads:Read` is the only box to tick,
  and it is not optional: without it Gradle and CocoaPods cannot download the
  native Mapbox SDK and the mobile build fails with a bare `401`.
- A secret token is displayed **once**. Copy it when it is created.
- Setup detail, including where each credential goes on a build machine:
  [`apps/mobile/MAPBOX_SETUP.md`](../../apps/mobile/MAPBOX_SETUP.md).
- RIVO's turn-by-turn is implemented against the Directions API and needs no
  Navigation SDK licence. **Confirm Navigation SDK commercial terms only if**
  native voice guidance and the native HUD are added later — Master Plan §19
  flags this, and it is priced separately from the APIs above.
- Mapbox currently lists Iraq among the countries where ETAs use live and typical
  traffic, which is what makes the routing useful at launch.

### 9. SMS / OTP provider with Iraq coverage
- **Contract-dependent**; expect roughly **$0.01–0.05 per message**.
- Must cover Zain Iraq, Asiacell and Korek.
- Ask for: delivery-receipt reporting, a sender ID (alphanumeric if permitted),
  and the throughput cap.
- **Until this is signed, production cannot launch**: the API refuses to start in
  production with the development console provider, because that provider prints
  login codes to the server log.
- The `OtpProvider` adapter is generic HTTP and configured entirely through
  `.env`; connecting a vendor should not need code changes.

### 10. Iraqi payment gateway merchant account
- **Contract-dependent.** Options to evaluate: ZainCash, FastPay, Qi Card, and
  the bank-hosted processors.
- Ask specifically for: settlement period, per-transaction fee on a **3,000 IQD**
  charge (a percentage fee on a small amount can be a large share of it), refund
  handling, and **webhook signing**.
- **The webhook must be signed.** RIVO refuses unsigned callbacks by design, and
  a gateway that cannot sign its webhooks cannot be integrated safely.
- Until this exists, `PAYMENT_PROVIDER=manual`: a FINANCE admin settles each
  payment against a real transfer reference, and every settlement is audit-logged.
  Nothing is ever auto-marked as paid.

### 11. Apple Developer Program
- **$99/year**. Organisation account, not individual.
- Requires a **D-U-N-S number** for the company — this takes days to weeks, so
  **start it early**. It is the single most common cause of a delayed iOS launch.

### 12. Google Play Developer
- **$25 one-time**. Organisation account.
- Google now requires identity verification for new developer accounts; allow
  time for it.

### 13. Sentry
- Free tier covers a launch (5,000 errors/month); Team is **$26/month**.
- Three projects: API, admin, mobile.

---

## Recommended, not blocking

### AI provider (Replicate or equivalent)
- Usage-based; Real-ESRGAN runs at roughly **$0.002–0.01 per image**.
- 18 photos per listing ≈ **$0.04–0.18 per listing**. `AI_MAX_COST_USD_PER_PROPERTY`
  caps it per listing regardless.
- Without it, `AI_PROVIDER=none`: originals publish unchanged, every job is
  recorded as SKIPPED, and the app tells the seller no enhancement ran. Nothing
  fabricates an "enhanced" image.

### Off-host backup storage
- A second R2 bucket, or any S3-compatible store, for `RIVO_BACKUP_S3_BUCKET`.
- **A few cents a month.** Without it, backups sit on the same droplet they are
  meant to protect against losing.

---

## Cost summary

| Item | Monthly | Annual/one-off |
|---|---:|---:|
| DigitalOcean droplet (4 GB) | $24 | |
| Managed PostgreSQL (2 GB) | $30.45 | |
| Droplet backups | ~$5 | |
| Cloudflare DNS/WAF | $0 | |
| Cloudflare R2 (first 10 GB free) | ~$0–2 | |
| Cloudflare Stream (~1,000 reels) | ~$5 | |
| Mapbox (within free tier) | $0 | |
| Sentry (free tier) | $0 | |
| Business email (2 users) | ~$12 | |
| **Baseline** | **~$77–79/month** | |
| Domain | | ~$15–40/year |
| Apple Developer | | $99/year |
| Google Play | | $25 once |
| SMS OTP | usage | contract |
| Payment gateway | per transaction | contract |
| AI enhancement | usage | ~$0.04–0.18/listing |

This lands inside the **$60–150/month** baseline in Master Plan §19, before
material map, AI, SMS and video usage.

### What actually grows the bill

In order: **SMS** (every sign-in costs money — this is why the OTP endpoint is
rate-limited per phone *and* per IP), then **Stream delivery** if reels take off,
then **Mapbox Directions** past 100,000 requests (which is why the API caches
routes and geocoding in Redis), then **AI** in proportion to listings.

---

## Ownership handover checklist

Confirm each before treating the project as delivered:

- [ ] Domain registered to the client, with registrar lock and auto-renew on
- [ ] DNS in the client's Cloudflare account
- [ ] GitHub **organisation** owns the repository; `main` is protected
- [ ] Apple Developer account in the company name, D-U-N-S verified
- [ ] Google Play account in the company name
- [ ] Mapbox account and billing in the client's name; the public token is
      restricted by bundle id / package name
- [ ] Cloudflare account, R2 bucket and Stream in the client's name
- [ ] DigitalOcean team owned by the client
- [ ] Payment merchant account in the company name
- [ ] SMS account in the company name
- [ ] AI provider account in the client's name, with a spend cap set
- [ ] Sentry organisation owned by the client
- [ ] **Android release keystore backed up offline in at least two places** —
      losing it means the app can never be updated on Play again
- [ ] `.env` values recorded in the client's password manager, not only on the
      droplet
- [ ] Every developer holds **member** access, not owner, on every account
