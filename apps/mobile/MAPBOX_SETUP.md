# Mapbox credentials — what RIVO needs and where each one goes

Three distinct things, easy to confuse because Mapbox calls them all "tokens".

| # | What | Scope needed | Where it goes | Shipped in the app? |
| --- | --- | --- | --- | --- |
| 1 | **Public token** `pk.…` | none (defaults) | `MAPBOX_PUBLIC_TOKEN` on the API — the app fetches it from `/health/capabilities` | yes, by design |
| 2 | **Server token** `sk.…` | none (defaults) | `MAPBOX_SECRET_TOKEN` on the API, for place search and routing | **no** |
| 3 | **Downloads token** `sk.…` | **`Downloads:Read`** | the build machine only — Gradle and CocoaPods use it to fetch the native SDK | **no** |

Tokens 2 and 3 can be **the same secret token**, as long as it carries
`Downloads:Read`: a secret token also has the default public scopes, so the same
one can call Directions and Geocoding. Two separate tokens is tidier — the
build credential and the production server credential can then be rotated
independently — but one is enough to start.

Neither Directions nor Geocoding needs a special scope. `Downloads:Read` is the
only scope you have to tick.

---

## 1. Public token

Already exists: **Default public token** on your Mapbox account overview. It
works as-is.

Before release, create a dedicated one instead and restrict it to RIVO's
Android package name and iOS bundle id (Tokens → Create a token → URL
restrictions). A public token is visible to anyone who installs the app; the
restriction is what stops it being used elsewhere on your bill.

## 2 & 3. Secret token

[account.mapbox.com/access-tokens](https://account.mapbox.com/access-tokens/) →
**Create a token**

- Name: `rivo-server` (or `rivo-build`)
- Public scopes: leave as they are
- **Secret scopes: tick `Downloads:Read`**
- Create, then **copy it immediately** — Mapbox shows a secret token once and
  never again. Lose it and you create a new one.

---

## Where to put them

**API server** (`.env`, never committed):

```bash
MAPBOX_PUBLIC_TOKEN=pk....
MAPBOX_SECRET_TOKEN=sk....
```

**Android build machine** — `~/.gradle/gradle.properties`, *not* this
repository:

```properties
MAPBOX_DOWNLOADS_TOKEN=sk....
```

Or export `MAPBOX_DOWNLOADS_TOKEN` in the environment. Without it the build
fails with a bare `401` from `api.mapbox.com`; `android/build.gradle.kts` warns
first and says why.

**iOS build machine** — `~/.netrc`, permissions `600`:

```
machine api.mapbox.com
login mapbox
password sk....
```

`login` is the literal word `mapbox`, not your account name. Same for the
Gradle username.

**CI** — store the secret token as a repository secret named
`MAPBOX_DOWNLOADS_TOKEN`. The Gradle configuration reads it from the
environment.

---

## Free tier

Your account overview shows the allowances. At the time of writing: 50,000 web
map loads, 25,000 monthly active users on the mobile SDKs, 200,000 static tile
requests, and 50,000 static image requests per month. Directions and Geocoding
have their own monthly free allowances. Check the numbers on your own account
page rather than trusting this paragraph — Mapbox changes them.

## Turn-by-turn

RIVO's turn-by-turn guidance is implemented in Dart against the Directions API
response — steps, rerouting, arrival detection. It needs no Navigation SDK and
no separate commercial agreement.

Voice guidance and a native heads-up display would need the **Mapbox Navigation
SDK**, which is licensed and priced separately. That is a decision for later,
not something to buy now.
