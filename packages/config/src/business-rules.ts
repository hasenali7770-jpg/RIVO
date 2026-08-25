/**
 * RIVO business rules — the single source of truth.
 *
 * These constants are consumed by the API (server-side enforcement), the admin
 * dashboard (display + validation hints) and mirrored into the Flutter app
 * (`apps/mobile/lib/core/config/business_rules.dart`).
 *
 * Master Plan §24 forbids lowering any of these without explicit written approval
 * from the project owner. `apps/api/test/business-rules.spec.ts` fails the build if
 * any of them drift, and `apps/mobile/test/business_rules_test.dart` fails the
 * Flutter build if the mirrored Dart values drift from these.
 */

/** Property photos — Master Plan §6 step 5. Enforced by mobile AND server. */
export const PROPERTY_PHOTO_MIN = 8;
export const PROPERTY_PHOTO_MAX = 18;

/** Single original photo upload ceiling (bytes). 25 MB. */
export const PROPERTY_PHOTO_MAX_BYTES = 25 * 1024 * 1024;

/** Accepted photo MIME types for direct-to-R2 upload. */
export const PROPERTY_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;

/** Property Reels — Master Plan §6 step 7. Enforced by mobile AND server. */
export const REEL_MIN_HEIGHT = 1080;
export const REEL_MIN_WIDTH = 1080;
/** Shortest edge must be >= 1080 so 1920x1080 and 1080x1920 both pass, 1280x720 fails. */
export const REEL_MIN_SHORT_EDGE = 1080;
export const REEL_MIN_DURATION_SECONDS = 10;
export const REEL_MAX_DURATION_SECONDS = 90;
export const REEL_PREFERRED_ASPECT = 9 / 16;
/** Tolerance around the preferred 9:16 aspect before a reel is flagged (not rejected). */
export const REEL_ASPECT_TOLERANCE = 0.12;
export const REEL_MAX_BYTES = 512 * 1024 * 1024;

/** Standard listing fee — Master Plan §6 step 9. Iraqi dinars, integer (IQD has no minor unit in practice). */
export const LISTING_FEE_IQD = 3000;
export const CURRENCY = 'IQD';

/** Road incident lifetime defaults, in minutes — Master Plan §4. */
export const INCIDENT_DEFAULT_TTL_MINUTES: Record<string, number> = {
  ACCIDENT: 90,
  TRAFFIC_JAM: 45,
  ROAD_CLOSURE: 720,
  ROAD_WORKS: 10080,
  FLOODED_ROAD: 360,
  POTHOLE: 43200,
  HAZARD: 120,
};

/** An incident is hidden from the public feed once its score falls to or below this. */
export const INCIDENT_MIN_VISIBLE_SCORE = -2;
/** Score at which an incident is auto-trusted without moderation. */
export const INCIDENT_AUTO_TRUST_SCORE = 3;

/** Traffic telemetry — Master Plan §4 "RIVO Traffic Engine foundation". */
export const TELEMETRY_MAX_BATCH_SIZE = 200;
/** Raw GPS samples are deleted after this many days. Aggregates are kept. */
export const TELEMETRY_RAW_RETENTION_DAYS = 14;
/** Aggregation bucket width in minutes. */
export const TELEMETRY_BUCKET_MINUTES = 15;
/** A segment aggregate is only served to routing once it has this many samples (k-anonymity). */
export const TELEMETRY_MIN_SAMPLES_PER_BUCKET = 5;

/** Auth — Master Plan §8. */
export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_VERIFY_ATTEMPTS = 5;
/** Max OTP requests per phone number per hour. */
export const OTP_MAX_REQUESTS_PER_HOUR = 5;
/** Max OTP requests per IP per hour. */
export const OTP_MAX_REQUESTS_PER_IP_PER_HOUR = 20;
export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_DAYS = 60;

/** Search / feed paging. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
/** Maximum radius accepted by geospatial property search, in metres. */
export const MAX_SEARCH_RADIUS_M = 100_000;

/** Routing — Master Plan §4. */
export const ROUTE_MAX_ALTERNATIVES = 2;
/** Distance from the route line beyond which the driver is considered off-route. */
export const REROUTE_OFF_ROUTE_THRESHOLD_M = 45;
