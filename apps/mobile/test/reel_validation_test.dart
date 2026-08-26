import 'package:flutter_test/flutter_test.dart';
import 'package:rivo/core/config/business_rules.dart';

/// Client-side reel checks, mirroring the server rule in
/// `apps/api/src/modules/reels/reel-validation.ts`.
///
/// The measurement that binds is the server's, taken from Cloudflare after
/// encoding. These cases pin the client's pre-check so a user is not asked to
/// upload a file that will certainly be refused.
int shortEdge(int width, int height) => width < height ? width : height;

bool passesResolution(int width, int height) =>
    shortEdge(width, height) >= RivoRules.reelMinShortEdge;

bool passesDuration(double seconds) =>
    seconds >= RivoRules.reelMinDurationSeconds && seconds <= RivoRules.reelMaxDurationSeconds;

void main() {
  group('reel resolution, measured on the short edge', () {
    test('accepts portrait 1080x1920', () => expect(passesResolution(1080, 1920), isTrue));
    test('accepts landscape 1920x1080', () => expect(passesResolution(1920, 1080), isTrue));
    test('accepts 4K 2160x3840', () => expect(passesResolution(2160, 3840), isTrue));

    test('rejects 1280x720', () => expect(passesResolution(1280, 720), isFalse));
    test('rejects portrait 720x1280 — rotating 720p does not make it 1080p', () {
      expect(passesResolution(720, 1280), isFalse);
    });
    test('rejects one pixel under the limit', () => expect(passesResolution(1079, 1920), isFalse));
    test('accepts exactly at the limit', () => expect(passesResolution(1080, 1080), isTrue));
  });

  group('reel duration', () {
    test('accepts 30 seconds', () => expect(passesDuration(30), isTrue));
    test('accepts the boundaries', () {
      expect(passesDuration(10), isTrue);
      expect(passesDuration(90), isTrue);
    });
    test('rejects too short', () => expect(passesDuration(9.5), isFalse));
    test('rejects too long', () => expect(passesDuration(91), isFalse));
  });
}
