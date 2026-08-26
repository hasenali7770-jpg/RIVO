import 'package:flutter_test/flutter_test.dart';
import 'package:rivo/core/config/business_rules.dart';

/// A tripwire, mirroring `apps/api/test/business-rules.spec.ts`.
///
/// Master Plan §24 forbids lowering the photo bounds, the reel minimum or the
/// listing fee without explicit approval. These values are duplicated in Dart so
/// the app can validate before spending the user's mobile data; if they ever
/// drift from the TypeScript source of truth, this suite fails the build.
void main() {
  group('protected business constants', () {
    test('photo minimum is 8', () => expect(RivoRules.photoMin, 8));
    test('photo maximum is 18', () => expect(RivoRules.photoMax, 18));
    test('reel minimum short edge is 1080', () => expect(RivoRules.reelMinShortEdge, 1080));
    test('listing fee is 3,000 IQD', () {
      expect(RivoRules.listingFeeIqd, 3000);
      expect(RivoRules.currency, 'IQD');
    });
    test('reel duration window is 10-90 seconds', () {
      expect(RivoRules.reelMinDurationSeconds, 10);
      expect(RivoRules.reelMaxDurationSeconds, 90);
    });
  });

  group('Iraq bounds check', () {
    test('accepts every launch governorate centre', () {
      expect(RivoGeo.isWithinIraqBounds(44.3661, 33.3152), isTrue, reason: 'Baghdad');
      expect(RivoGeo.isWithinIraqBounds(47.7804, 30.5085), isTrue, reason: 'Basra');
      expect(RivoGeo.isWithinIraqBounds(44.0092, 36.1911), isTrue, reason: 'Erbil');
      expect(RivoGeo.isWithinIraqBounds(42.9883, 36.8669), isTrue, reason: 'Duhok');
      expect(RivoGeo.isWithinIraqBounds(45.4375, 35.5613), isTrue, reason: 'Sulaymaniyah');
    });

    test('rejects clearly foreign coordinates', () {
      expect(RivoGeo.isWithinIraqBounds(51.3890, 35.6892), isFalse, reason: 'Tehran');
      expect(RivoGeo.isWithinIraqBounds(35.2137, 31.7683), isFalse, reason: 'Jerusalem');
      expect(RivoGeo.isWithinIraqBounds(46.6753, 24.7136), isFalse, reason: 'Riyadh');
      expect(RivoGeo.isWithinIraqBounds(28.9784, 41.0082), isFalse, reason: 'Istanbul');
    });

    test('rejects the null island', () {
      // The common no-GPS-fix failure mode: a device reporting exactly 0,0.
      expect(RivoGeo.isWithinIraqBounds(0, 0), isFalse);
    });

    test('is a bounding box, so it admits some neighbouring territory', () {
      // Documented behaviour, not a defect: a rectangle around Iraq necessarily
      // covers northern Kuwait. The check is a cheap first filter; the server
      // repeats it and a human moderator reviews every pin before publishing.
      expect(RivoGeo.isWithinIraqBounds(47.9774, 29.3759), isTrue, reason: 'Kuwait City');
    });
  });
}
