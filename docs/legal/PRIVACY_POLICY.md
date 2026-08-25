# RIVO — Privacy Policy (draft)

**Draft for legal review. Not yet in force.**
Last updated: [date] · Controller: [registered company name], [address], Iraq
Contact: [privacy@…]

RIVO (ريفو) provides navigation (خرائط) and a property marketplace (داركم).
This policy describes what we collect, why, and for how long. It describes the
system as actually built; where a limit is enforced by the software rather than
by promise, that is stated.

## 1. What we collect

**Your phone number.** Sign-in is by phone number and a one-time code. We store
the number in international format and a hashed form of the code — never the
code itself in readable form. Codes expire after 5 minutes.

**Listings you create.** Property details, price, the location you pin on the
map, your photos and any Reel, and the contact preference you choose. This is
published deliberately: a listing exists to be seen.

**Your location, while you are navigating.** Used to draw your position and
guide you. It is not stored as a track.

**Traffic measurements, only if you turn them on.** If — and only if — you
enable traffic data sharing in privacy settings, the app sends anonymous speed
measurements while you drive. These carry a rotating pseudonymous session
identifier and **no account identifier**: the table they are stored in has no
column for a user id. They are combined with other drivers' measurements and
deleted after 14 days. Only the combined averages are kept.

**Device and diagnostic data.** Device model, operating system version, app
version, and crash reports, to fix faults.

**Payment records.** Amount, reference, and status for the 3,000 IQD listing
fee. We do not store card numbers; those are handled by the payment provider.

## 2. What we do not do

- We do not sell your personal data.
- We do not build or keep a history of where you have driven. There is no
  interface, for staff or anyone else, that can show one person's journeys.
- We do not share your phone number with other users. Buyers reach you through
  the contact method you chose for the listing.
- We do not use your photos to train any model.

## 3. Traffic data and how anonymity is kept

An average speed for a stretch of road is only calculated and stored once
measurements from **at least five different sessions** have contributed to it.
A figure drawn from a single session would describe one person's journey, so it
is discarded rather than stored. This is enforced in the aggregation query, not
by policy alone.

You can turn traffic sharing off at any time in privacy settings. Turning it off
stops collection immediately. Measurements already combined into an average
cannot be separated back out, because nothing links them to you.

## 4. How long we keep things

| Data | Kept for |
| --- | --- |
| Account and phone number | while your account exists |
| Published listings | while published, then [retention period] after removal |
| Photos and Reels | with the listing; deleted when it is deleted |
| Raw traffic measurements | 14 days, then deleted automatically |
| Combined traffic averages | indefinitely — they identify no one |
| One-time code challenges | 5 minutes, then purged |
| Payment records | [retention period, per Iraqi accounting requirements] |
| Administrative audit records | retained; they cannot be edited or deleted, by design |

## 5. Who else is involved

| Provider | What they handle | Where |
| --- | --- | --- |
| Cloudflare (R2, Stream) | listing photos and Reels | global network |
| Mapbox | map tiles, place search, route calculation | global |
| [SMS provider] | delivering your sign-in code | [region] |
| [Payment gateway] | the listing fee | Iraq |
| Sentry | crash reports | [region] |

Each receives only what it needs for that task.

## 6. Your choices

- **Turn off traffic sharing** — privacy settings, any time.
- **Delete a listing** — from your listings; photos and Reels go with it.
- **Delete your account** — contact [support@…]. We remove your account,
  listings and media. Payment records and audit records are kept where Iraqi law
  requires; audit records name the administrator who acted, not you.
- **Ask what we hold about you** — [privacy@…].

## 7. Children

RIVO is not for people under 18. We do not knowingly collect their data.

## 8. Security

Traffic is encrypted in transit. Sign-in codes and administrator passwords are
stored hashed. Administrative access is limited by role, and every
administrative action is recorded in a log that cannot be altered or erased.
Backups are encrypted and held for [retention period].

## 9. Changes

We will post changes here and, for anything significant, notify you in the app
before it takes effect.

## 10. Contact

[registered company name], [address], Iraq — [privacy@…]
