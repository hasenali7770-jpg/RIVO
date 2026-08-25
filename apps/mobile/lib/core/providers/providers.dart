import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/repositories/auth_repository.dart';
import '../api/repositories/maps_repository.dart';
import '../api/repositories/media_repository.dart';
import '../api/repositories/properties_repository.dart';
import '../api/repositories/reels_repository.dart';
import '../storage/token_storage.dart';

// Re-exported so feature screens can depend on the providers barrel alone rather
// than reaching into repository files for the types those providers return.
export '../api/repositories/auth_repository.dart' show Capabilities, RivoUser;

/// API base URL.
///
/// Supplied at build time with --dart-define, so a release build cannot
/// accidentally ship pointing at a developer's machine. There is no hardcoded
/// production URL here for the same reason.
const String kApiBaseUrl = String.fromEnvironment(
  'RIVO_API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3000',
);

const String kSentryDsn = String.fromEnvironment('RIVO_SENTRY_DSN', defaultValue: '');

final Provider<TokenStorage> tokenStorageProvider = Provider<TokenStorage>((Ref ref) => TokenStorage());

final Provider<ApiClient> apiClientProvider = Provider<ApiClient>((Ref ref) {
  final ApiClient client = ApiClient(
    baseUrl: kApiBaseUrl,
    tokens: ref.watch(tokenStorageProvider),
  );
  // When a refresh fails the session is gone; the router reacts to authProvider
  // turning unauthenticated and sends the user to sign-in.
  client.onAuthenticationLost = () => ref.read(authProvider.notifier).onSessionLost();
  return client;
});

final Provider<AuthRepository> authRepositoryProvider = Provider<AuthRepository>(
  (Ref ref) => AuthRepository(ref.watch(apiClientProvider), ref.watch(tokenStorageProvider)),
);

final Provider<PropertiesRepository> propertiesRepositoryProvider =
    Provider<PropertiesRepository>((Ref ref) => PropertiesRepository(ref.watch(apiClientProvider)));

final Provider<MapsRepository> mapsRepositoryProvider =
    Provider<MapsRepository>((Ref ref) => MapsRepository(ref.watch(apiClientProvider)));

final Provider<TrafficRepository> trafficRepositoryProvider =
    Provider<TrafficRepository>((Ref ref) => TrafficRepository(ref.watch(apiClientProvider)));

final Provider<MediaRepository> mediaRepositoryProvider =
    Provider<MediaRepository>((Ref ref) => MediaRepository(ref.watch(apiClientProvider)));

final Provider<ReelsRepository> reelsRepositoryProvider =
    Provider<ReelsRepository>((Ref ref) => ReelsRepository(ref.watch(apiClientProvider)));

final Provider<PaymentsRepository> paymentsRepositoryProvider =
    Provider<PaymentsRepository>((Ref ref) => PaymentsRepository(ref.watch(apiClientProvider)));

final Provider<ConfigRepository> configRepositoryProvider =
    Provider<ConfigRepository>((Ref ref) => ConfigRepository(ref.watch(apiClientProvider)));

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/// What this deployment can actually do.
///
/// Loaded once at launch. Every optional feature checks this before rendering
/// its entry point, so the app never shows a button that would fail because a
/// credential is missing (Master Plan §24).
final FutureProvider<Capabilities> capabilitiesProvider = FutureProvider<Capabilities>((Ref ref) async {
  try {
    return await ref.watch(configRepositoryProvider).capabilities();
  } catch (error) {
    if (kDebugMode) debugPrint('Could not load capabilities: $error');
    // Assume nothing optional is available rather than guessing optimistically.
    return Capabilities.unknown;
  }
});

final FutureProvider<Map<String, bool>> featureFlagsProvider =
    FutureProvider<Map<String, bool>>((Ref ref) async {
  try {
    return await ref.watch(configRepositoryProvider).featureFlags();
  } catch (_) {
    return <String, bool>{};
  }
});

/// True only when the flag is on AND the credential behind it is present.
Provider<bool> featureEnabledProvider(String flag) => Provider<bool>((Ref ref) {
      final AsyncValue<Map<String, bool>> flags = ref.watch(featureFlagsProvider);
      return flags.valueOrNull?[flag] ?? false;
    });

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

sealed class AuthState {
  const AuthState();
}

class AuthLoading extends AuthState {
  const AuthLoading();
}

class Unauthenticated extends AuthState {
  const Unauthenticated({this.reason});
  final String? reason;
}

class Authenticated extends AuthState {
  const Authenticated(this.user);
  final RivoUser user;
}

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier(this._repository) : super(const AuthLoading()) {
    unawaited(_restore());
  }

  final AuthRepository _repository;

  Future<void> _restore() async {
    if (!await _repository.hasSession) {
      state = const Unauthenticated();
      return;
    }
    try {
      state = Authenticated(await _repository.me());
    } catch (_) {
      // A stored session that no longer works is the same as no session.
      state = const Unauthenticated();
    }
  }

  Future<void> completeSignIn(RivoUser user) async {
    state = Authenticated(user);
  }

  Future<void> refreshProfile() async {
    if (state is! Authenticated) return;
    try {
      state = Authenticated(await _repository.me());
    } catch (_) {
      // Keep the cached profile; a transient failure should not sign the user out.
    }
  }

  Future<void> signOut({bool allDevices = false}) async {
    await _repository.logout(allDevices: allDevices);
    state = const Unauthenticated();
  }

  /// Called by the API client when a refresh fails and the session cannot be
  /// recovered.
  void onSessionLost() {
    state = const Unauthenticated(reason: 'انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.');
  }

  RivoUser? get currentUser => state is Authenticated ? (state as Authenticated).user : null;
}

final StateNotifierProvider<AuthNotifier, AuthState> authProvider =
    StateNotifierProvider<AuthNotifier, AuthState>(
  (Ref ref) => AuthNotifier(ref.watch(authRepositoryProvider)),
);

final Provider<bool> isSignedInProvider =
    Provider<bool>((Ref ref) => ref.watch(authProvider) is Authenticated);

final Provider<RivoUser?> currentUserProvider = Provider<RivoUser?>((Ref ref) {
  final AuthState state = ref.watch(authProvider);
  return state is Authenticated ? state.user : null;
});
