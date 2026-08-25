import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/otp_verify_screen.dart';
import '../../features/auth/phone_entry_screen.dart';
import '../../features/darcom/darcom_screen.dart';
import '../../features/darcom/property_detail_screen.dart';
import '../../features/listing/listing_wizard_screen.dart';
import '../../features/listing/my_listings_screen.dart';
import '../../features/maps/maps_screen.dart';
import '../../features/maps/navigation_screen.dart';
import '../../features/profile/privacy_screen.dart';
import '../../features/profile/profile_screen.dart';
import '../../features/reels/reels_screen.dart';
import '../../shared/widgets/rivo_shell.dart';
import '../providers/providers.dart';

/// Alias so main.dart does not need to import go_router directly.
typedef GoRouterLike = GoRouter;

final GlobalKey<NavigatorState> _rootKey = GlobalKey<NavigatorState>(debugLabel: 'root');
final GlobalKey<NavigatorState> _shellKey = GlobalKey<NavigatorState>(debugLabel: 'shell');

/// Routes that can be used without an account.
///
/// Browsing Darcom and the map signed-out is deliberate: requiring a phone
/// number before a user can even look at listings would cost RIVO most of its
/// first-time visitors. An account is required only to act — publish, favourite,
/// report or contribute traffic data.
const Set<String> _publicPrefixes = <String>{'/maps', '/darcom', '/reels', '/property', '/auth'};

final Provider<GoRouter> routerProvider = Provider<GoRouter>((Ref ref) {
  final AuthState auth = ref.watch(authProvider);

  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: '/maps',
    debugLogDiagnostics: false,

    redirect: (BuildContext context, GoRouterState state) {
      final String location = state.matchedLocation;

      // Nothing is decided until the stored session has been checked, otherwise
      // a returning user would flash the sign-in screen on every cold start.
      if (auth is AuthLoading) return null;

      final bool isPublic = _publicPrefixes.any((String prefix) => location.startsWith(prefix));
      final bool signedIn = auth is Authenticated;

      if (!signedIn && !isPublic) {
        // Remembers where the user was headed so they land there after signing in.
        return '/auth/phone?next=${Uri.encodeComponent(location)}';
      }

      if (signedIn && location.startsWith('/auth')) {
        final String? next = state.uri.queryParameters['next'];
        return next != null && next.isNotEmpty ? Uri.decodeComponent(next) : '/maps';
      }

      return null;
    },

    routes: <RouteBase>[
      // --- Auth ---------------------------------------------------------------
      GoRoute(
        path: '/auth/phone',
        parentNavigatorKey: _rootKey,
        builder: (BuildContext context, GoRouterState state) =>
            PhoneEntryScreen(next: state.uri.queryParameters['next']),
      ),
      GoRoute(
        path: '/auth/verify',
        parentNavigatorKey: _rootKey,
        builder: (BuildContext context, GoRouterState state) {
          final Map<String, dynamic> extra = (state.extra as Map<String, dynamic>?) ?? <String, dynamic>{};
          return OtpVerifyScreen(
            phone: extra['phone'] as String? ?? '',
            challengeToken: extra['challengeToken'] as String? ?? '',
            devCode: extra['devCode'] as String?,
            next: state.uri.queryParameters['next'],
          );
        },
      ),

      // --- Main shell: خرائط | داركم -----------------------------------------
      ShellRoute(
        navigatorKey: _shellKey,
        builder: (BuildContext context, GoRouterState state, Widget child) =>
            RivoShell(location: state.matchedLocation, child: child),
        routes: <RouteBase>[
          GoRoute(
            path: '/maps',
            pageBuilder: (BuildContext context, GoRouterState state) =>
                const NoTransitionPage<void>(child: MapsScreen()),
          ),
          GoRoute(
            path: '/darcom',
            pageBuilder: (BuildContext context, GoRouterState state) =>
                const NoTransitionPage<void>(child: DarcomScreen()),
          ),
          GoRoute(
            path: '/reels',
            pageBuilder: (BuildContext context, GoRouterState state) =>
                const NoTransitionPage<void>(child: ReelsScreen()),
          ),
          GoRoute(
            path: '/profile',
            pageBuilder: (BuildContext context, GoRouterState state) =>
                const NoTransitionPage<void>(child: ProfileScreen()),
          ),
        ],
      ),

      // --- Full-screen routes -------------------------------------------------
      GoRoute(
        path: '/property/:id',
        parentNavigatorKey: _rootKey,
        builder: (BuildContext context, GoRouterState state) =>
            PropertyDetailScreen(propertyId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/navigate',
        parentNavigatorKey: _rootKey,
        builder: (BuildContext context, GoRouterState state) {
          final Map<String, dynamic> extra = (state.extra as Map<String, dynamic>?) ?? <String, dynamic>{};
          return NavigationScreen(
            destinationLat: (extra['lat'] as num?)?.toDouble(),
            destinationLng: (extra['lng'] as num?)?.toDouble(),
            destinationLabel: extra['label'] as String?,
            propertyId: extra['propertyId'] as String?,
          );
        },
      ),
      GoRoute(
        path: '/listing/new',
        parentNavigatorKey: _rootKey,
        builder: (BuildContext context, GoRouterState state) => const ListingWizardScreen(),
      ),
      GoRoute(
        path: '/listing/:id/edit',
        parentNavigatorKey: _rootKey,
        builder: (BuildContext context, GoRouterState state) =>
            ListingWizardScreen(propertyId: state.pathParameters['id']),
      ),
      GoRoute(
        path: '/my-listings',
        parentNavigatorKey: _rootKey,
        builder: (BuildContext context, GoRouterState state) => const MyListingsScreen(),
      ),
      GoRoute(
        path: '/privacy',
        parentNavigatorKey: _rootKey,
        builder: (BuildContext context, GoRouterState state) => const PrivacyScreen(),
      ),
    ],

    errorBuilder: (BuildContext context, GoRouterState state) => Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Text('الصفحة غير موجودة', style: TextStyle(fontSize: 18)),
              const SizedBox(height: 12),
              TextButton(
                onPressed: () => context.go('/maps'),
                child: const Text('العودة إلى الخريطة'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
});
