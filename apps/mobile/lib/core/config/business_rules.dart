/// RIVO business rules, mirrored from `packages/config/src/business-rules.ts`.
///
/// These exist so the app can validate before wasting the user's mobile data on
/// an upload the server will refuse. They are NOT the enforcement point: the API
/// re-checks every one of them, and the database enforces the critical ones as
/// CHECK constraints (Master Plan §24 — "Keep business rules server-side as well
/// as client-side").
///
/// `test/business_rules_test.dart` fails the build if these drift from the
/// TypeScript source of truth.
library;

class RivoRules {
  const RivoRules._();

  /// Property photos — Master Plan §6 step 5.
  static const int photoMin = 8;
  static const int photoMax = 18;
  static const int photoMaxBytes = 25 * 1024 * 1024;
  static const List<String> photoMimeTypes = <String>[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
  ];

  /// Property Reels — Master Plan §6 step 7.
  ///
  /// Measured on the SHORT edge, so 1920x1080 and 1080x1920 both pass and
  /// 1280x720 fails whichever way it is rotated.
  static const int reelMinShortEdge = 1080;
  static const int reelMinDurationSeconds = 10;
  static const int reelMaxDurationSeconds = 90;
  static const double reelPreferredAspect = 9 / 16;
  static const int reelMaxBytes = 512 * 1024 * 1024;

  /// Standard listing fee — Master Plan §6 step 9.
  static const int listingFeeIqd = 3000;
  static const String currency = 'IQD';

  /// Paging
  static const int defaultPageSize = 20;
  static const int maxSearchRadiusM = 100000;

  /// Routing
  static const int rerouteOffRouteThresholdM = 45;

  /// Telemetry
  static const int telemetryMaxBatchSize = 200;
  static const int telemetryRawRetentionDays = 14;

  /// Auth
  static const int otpCodeLength = 6;
  static const int otpTtlSeconds = 300;
}

/// Baghdad, the launch market. Used as the initial map camera before a GPS fix.
class RivoGeo {
  const RivoGeo._();

  static const double defaultLat = 33.3152;
  static const double defaultLng = 44.3661;
  static const double defaultZoom = 12.5;

  /// Iraq's bounding box: minLng, minLat, maxLng, maxLat.
  static const List<double> iraqBbox = <double>[38.7936, 28.9971, 48.5679, 37.3806];

  /// Approximate containment check.
  ///
  /// This is a BOUNDING BOX, not the national border, so it is deliberately
  /// permissive: a rectangle around Iraq also covers northern Kuwait, slivers of
  /// western Iran, and parts of eastern Syria and Jordan. It exists to catch the
  /// obviously-wrong cases instantly — a device reporting 0,0 with no GPS fix, or
  /// a pin left in another country — without a polygon lookup on the phone.
  ///
  /// It is not the authority on where a listing may be. The server applies the
  /// same check, and every listing's location is reviewed by a human moderator
  /// before it can be published (Master Plan §6 step 10), which is what actually
  /// keeps out-of-country pins off Darcom.
  static bool isWithinIraqBounds(double lng, double lat) =>
      lng >= iraqBbox[0] && lng <= iraqBbox[2] && lat >= iraqBbox[1] && lat <= iraqBbox[3];
}
