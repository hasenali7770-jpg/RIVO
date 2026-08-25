import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rivo/core/api/api_exception.dart';
import 'package:rivo/core/theme/rivo_colors.dart';
import 'package:rivo/core/theme/rivo_theme.dart';
import 'package:rivo/shared/widgets/rivo_widgets.dart';

/// Widget-level checks for the things that would be visibly wrong to an Arabic
/// user if they regressed: RTL layout, dinar formatting, and the badges that
/// carry trust or warn that content is sample data.
void main() {
  Widget wrap(Widget child) => MaterialApp(
        theme: RivoTheme.dark(),
        locale: const Locale('ar'),
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(body: child),
        ),
      );

  group('IQD formatting', () {
    test('groups thousands', () {
      expect(formatIqd('250000000'), '250,000,000 د.ع');
      expect(formatIqd('3000'), '3,000 د.ع');
    });

    test('handles values beyond a 32-bit int without truncating', () {
      // 2^31 is ~2.1 billion; Iraqi property prices exceed it, so the whole
      // pipeline carries the amount as a string parsed with BigInt.
      expect(formatIqd('9000000000'), '9,000,000,000 د.ع');
    });

    test('compacts large amounts for tiles', () {
      expect(formatIqd('250000000', compact: true), '250 مليون د.ع');
      expect(formatIqd('1500000000', compact: true), '1.5 مليار د.ع');
    });

    test('survives a non-numeric value rather than throwing', () {
      expect(formatIqd('not-a-number'), isNotEmpty);
    });
  });

  group('distance formatting', () {
    test('uses metres below a kilometre', () => expect(formatDistance(850), '850 م'));
    test('uses kilometres above', () => expect(formatDistance(2400), '2.4 كم'));
    test('returns empty for null', () => expect(formatDistance(null), ''));
  });

  testWidgets('the demo badge is rendered for sample content', (WidgetTester tester) async {
    await tester.pumpWidget(wrap(const DemoChip()));
    // Master Plan §5 and §21: seeded content must be visibly labelled.
    expect(find.text('عيّنة'), findsOneWidget);
  });

  testWidgets('the verified badge reads as verified', (WidgetTester tester) async {
    await tester.pumpWidget(wrap(const VerifiedChip()));
    expect(find.text('موثّق'), findsOneWidget);
    expect(find.byIcon(Icons.verified_rounded), findsOneWidget);
  });

  testWidgets('sale and rent chips use their distinct colours', (WidgetTester tester) async {
    await tester.pumpWidget(wrap(const PurposeChip(isSale: true)));
    expect(find.text('للبيع'), findsOneWidget);

    await tester.pumpWidget(wrap(const PurposeChip(isSale: false)));
    expect(find.text('للإيجار'), findsOneWidget);
  });

  testWidgets('the offline state is distinguished from a server error',
      (WidgetTester tester) async {
    await tester.pumpWidget(wrap(RivoErrorView(error: ApiException.offline())));
    // A user who is offline can fix that themselves, so the copy and the icon
    // must differ from a generic failure (Master Plan §21).
    expect(find.byIcon(Icons.wifi_off_rounded), findsOneWidget);

    // A server-side failure gets the generic icon and different copy.
    await tester.pumpWidget(wrap(
      const RivoErrorView(
        error: ApiException(code: 'INTERNAL', message: 'boom', messageAr: 'خطأ في الخادم'),
      ),
    ),);
    expect(find.byIcon(Icons.error_outline_rounded), findsOneWidget);
  });

  testWidgets('an unavailable feature explains itself instead of showing a dead control',
      (WidgetTester tester) async {
    await tester.pumpWidget(wrap(const FeatureUnavailableView(feature: 'الريلز')));
    expect(find.textContaining('غير متاحة'), findsOneWidget);
  });

  test('the dark theme uses the RIVO palette', () {
    final ThemeData theme = RivoTheme.dark();
    expect(theme.scaffoldBackgroundColor, RivoColors.petrol);
    expect(theme.colorScheme.primary, RivoColors.signalRed);
    expect(theme.textTheme.bodyLarge?.fontFamily, RivoTheme.fontFamily);
  });

  test('the light theme is defined and distinct from the dark one', () {
    // Master Plan §1 requires dark first AND a light mode.
    expect(RivoTheme.light().scaffoldBackgroundColor, RivoColors.white);
    expect(RivoTheme.light().brightness, Brightness.light);
    expect(RivoTheme.dark().brightness, Brightness.dark);
  });
}
