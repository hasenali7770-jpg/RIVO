import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import 'core/providers/providers.dart';
import 'core/router/app_router.dart';
import 'core/theme/rivo_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Portrait-only: the map, the listing wizard and the reels feed are all
  // designed around a vertical layout, and a rotating navigation screen is
  // actively unhelpful while driving.
  await SystemChrome.setPreferredOrientations(<DeviceOrientation>[
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  if (kSentryDsn.isEmpty) {
    // No DSN configured: run without crash reporting rather than failing to
    // start. The absence is visible in the deployment checklist, not hidden.
    runApp(const ProviderScope(child: RivoApp()));
    return;
  }

  await SentryFlutter.init(
    (SentryFlutterOptions options) {
      options.dsn = kSentryDsn;
      options.tracesSampleRate = 0.1;
      // Property photos and the map can carry location detail, so no screenshot
      // is ever attached to a crash report, and no PII is sent by default.
      options.attachScreenshot = false;
      options.sendDefaultPii = false;
      options.beforeSend = (SentryEvent event, Hint hint) {
        // Belt and braces: strip anything that could carry a token.
        event.request?.headers.remove('Authorization');
        return event;
      };
    },
    appRunner: () => runApp(const ProviderScope(child: RivoApp())),
  );
}

class RivoApp extends ConsumerWidget {
  const RivoApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final GoRouterLike router = ref.watch(routerProvider);

    return MaterialApp.router(
      title: 'RIVO',
      debugShowCheckedModeBanner: false,
      routerConfig: router,

      theme: RivoTheme.light(),
      darkTheme: RivoTheme.dark(),
      // Dark first — Master Plan §1.
      themeMode: ThemeMode.dark,

      // Arabic first, RTL by default (Master Plan §1). English and Kurdish are
      // listed so the architecture is ready for them; Arabic is what ships.
      locale: const Locale('ar'),
      supportedLocales: const <Locale>[Locale('ar'), Locale('en'), Locale('ckb')],
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],

      builder: (BuildContext context, Widget? child) {
        return Directionality(
          textDirection: TextDirection.rtl,
          child: MediaQuery.withClampedTextScaling(
            // Arabic script at very large scale factors breaks the map HUD and
            // the wizard's step indicators; clamped rather than ignored so
            // accessibility settings still take effect within a workable range.
            minScaleFactor: 0.85,
            maxScaleFactor: 1.4,
            child: child ?? const SizedBox.shrink(),
          ),
        );
      },
    );
  }
}
