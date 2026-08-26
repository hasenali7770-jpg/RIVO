# App Store and Play Store release checklist

Master Plan §20. Nothing here is done yet — this is the list RIVO works through
once the app is feature-complete on a device and the accounts exist.

Assets and text are RIVO's to produce; this document says what is needed, in
what sizes, and what each store will reject a build for.

---

## Before anything else: the accounts

Both accounts must be in **RIVO's own name**, never a contractor's or an
individual developer's. Transferring an app between accounts later is painful on
Google and slow on Apple. See
[../purchase-checklist/ACCOUNTS_AND_PURCHASES.md](../purchase-checklist/ACCOUNTS_AND_PURCHASES.md).

| | |
| --- | --- |
| Apple Developer Program | $99/year, organisation account |
| Google Play Console | $25 once, organisation account |
| D-U-N-S number | free, required by Apple for an organisation, **allow up to 30 days** |
| Legal entity details | registered name, address, phone — must match the D-U-N-S record exactly |

Start the D-U-N-S application first. It is the longest lead time in this list and
everything at Apple waits on it.

---

## Assets

### Icon

| | |
| --- | --- |
| iOS | 1024×1024 PNG, no alpha channel, no rounded corners (Apple rounds it) |
| Android | 512×512 PNG for the listing, plus an adaptive icon: 108×108dp foreground and background layers |

The RIVO logo is at `brand/rivo-logo-source.png`. Both stores reject an icon
with transparency, and Apple rejects one with pre-rounded corners.

### Splash screen

Native launch screen for both platforms, on the RIVO dark background. Keep it to
the logo — a splash screen that animates or loads data delays first paint and
Apple has rejected builds for it.

### Screenshots

Arabic screenshots are the primary set; the store listing is Arabic-first.

| Store | Sizes needed |
| --- | --- |
| Apple | 6.7" (1290×2796) and 6.5" (1242×2688) — both required. iPad only if the app ships for iPad. |
| Google | at least 2, 1080×1920 or larger, plus a 1024×500 feature graphic |

Show, in this order: the map with live traffic, a property listing with its
photos, the map with price pins, the listing wizard's photo step, a Reel.

**Do not screenshot a screen showing a real person's phone number or a real
property's exact address.** Use demo content (`RIVO_SEED_DEMO=true`), which is
labelled in the app.

### Preview video (optional)

15–30 seconds, Arabic. Worth doing for navigation, which is hard to convey in
stills.

---

## Store text

Both languages, Arabic first.

| Field | Apple | Google |
| --- | --- | --- |
| App name | 30 characters | 30 characters |
| Subtitle / short description | 30 | 80 |
| Description | 4000 | 4000 |
| Keywords | 100 characters, comma-separated | (Google uses the description) |
| What's new | 4000 | 500 |

Say plainly that RIVO is for Iraq, that listings are reviewed before publication,
and that publishing a listing costs 3,000 IQD. Burying the fee gets a rejection
under Apple's guideline 2.3 (accurate metadata) and complaints under Google's.

---

## URLs — all three must be live before submission

| | |
| --- | --- |
| Privacy policy | required by both. **A 404 is an automatic rejection.** |
| Terms of use | required by Apple where a purchase exists |
| Support URL | required by both — a page with a real contact route |
| Marketing URL | optional |

Publish [`docs/legal/PRIVACY_POLICY.md`](../legal/PRIVACY_POLICY.md) and
[`TERMS_OF_USE.md`](../legal/TERMS_OF_USE.md) at stable addresses after legal
review.

---

## Data disclosures

Both stores ask you to declare what the app collects. The answers below are
drawn from the schema and the code, not from memory — but re-check them against
the shipping build, because a disclosure that does not match observed behaviour
is a removal, not a rejection.

### Apple — App Privacy

| Type | Collected | Linked to the user | Used for tracking | Purpose |
| --- | --- | --- | --- | --- |
| Phone number | yes | yes | no | account, sign-in |
| Precise location | yes | **no** | no | app functionality (navigation, traffic) |
| Photos or videos | yes | yes | no | listing content the user chooses to publish |
| User content | yes | yes | no | listings |
| Purchase history | yes | yes | no | the listing fee |
| Crash and performance data | yes | no | no | diagnostics |
| Identifiers | no | — | — | RIVO uses no advertising identifier |

Precise location is **not linked to the user**: traffic samples carry a rotating
session key and the table storing them has no user column. Be ready to explain
this if Apple queries it.

### Google — Data safety

Declare the same set. Answer **yes** to "data is encrypted in transit" and to
"users can request data deletion", and give the deletion route from the privacy
policy. Google now verifies that the deletion route works.

---

## Permission strings

Both stores reject vague ones. iOS `Info.plist`:

| Key | Arabic string (English gloss) |
| --- | --- |
| `NSLocationWhenInUseUsageDescription` | لعرض موقعك على الخريطة وحساب الطريق إلى وجهتك. *(to show your position and calculate your route)* |
| `NSLocationAlwaysAndWhenInUseUsageDescription` | لمتابعة إرشادك أثناء القيادة حتى عندما تكون الشاشة مطفأة. *(to keep guiding you while the screen is off)* |
| `NSCameraUsageDescription` | لتصوير عقارك مباشرة عند إنشاء الإعلان. *(to photograph your property when creating a listing)* |
| `NSPhotoLibraryUsageDescription` | لاختيار صور عقارك من معرض الصور. *(to choose your property's photos)* |
| `NSMicrophoneUsageDescription` | لتسجيل الصوت مع فيديو العقار. *(to record audio with the property video)* |

Android `AndroidManifest.xml`: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
`ACCESS_BACKGROUND_LOCATION` (only if turn-by-turn continues in the background),
`CAMERA`, `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `INTERNET`.

### Background location

If turn-by-turn guidance continues with the screen off, both stores require a
specific justification, and Google requires a **video** showing the in-app
disclosure and the feature that needs it. Budget time for this — it is the most
common cause of a rejected navigation app.

If background guidance is not in the first release, **do not request the
permission**. Requesting an unused permission is itself a rejection.

---

## Build and test tracks

| | |
| --- | --- |
| iOS | Archive, upload to App Store Connect, distribute to **TestFlight** internal testers, then external testers (external review takes 1–2 days) |
| Android | Signed AAB (not APK) to **internal testing**, then closed testing |

Both: bump the version and build number every upload. Test on a real device on
an Iraqi mobile network, not only on WiFi — routing and photo upload are the
parts that suffer on a slow connection.

Point the test build at a staging API with real credentials configured, so the
map actually renders and photos actually upload. A build submitted with maps
unconfigured shows the "map unavailable" state, and reviewers will reject it as
non-functional.

---

## Age rating

Apple 17+ / Google "Mature 17+" is not required. RIVO has no objectionable
content; the marketplace and user-generated reports mean **both stores will ask
about user-generated content moderation.** The answer is that every listing is
reviewed by a person before publication, road reports from new accounts are held
for review, and users can report both listings and reports — all of which is
true and demonstrable.

---

## Pre-submission checks

- [ ] The privacy policy URL loads
- [ ] The terms URL loads
- [ ] The support URL loads and reaches a real person
- [ ] Data disclosures match what the shipping build actually does
- [ ] Every permission requested is one the app uses
- [ ] Background location justified, or not requested
- [ ] Screenshots contain no real personal data
- [ ] The 3,000 IQD fee is stated in the description
- [ ] The build points at production, not staging
- [ ] Mapbox, R2 and Stream credentials are configured in that environment
- [ ] Sentry receives a test crash
- [ ] Arabic RTL reviewed on a physical device, not only the simulator
- [ ] Tested on an Iraqi mobile network
