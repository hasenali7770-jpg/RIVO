import '../../storage/token_storage.dart';
import '../api_client.dart';

class RivoUser {
  const RivoUser({
    required this.id,
    required this.phone,
    required this.sellerType,
    required this.locale,
    this.displayName,
    this.avatarUrl,
    this.telemetryOptIn = false,
    this.isVerifiedSeller = false,
  });

  final String id;
  final String phone;
  final String sellerType;
  final String locale;
  final String? displayName;
  final String? avatarUrl;
  final bool telemetryOptIn;
  final bool isVerifiedSeller;

  factory RivoUser.fromJson(Map<String, dynamic> json) {
    final Map<String, dynamic>? seller = json['sellerProfile'] is Map
        ? Map<String, dynamic>.from(json['sellerProfile'] as Map)
        : null;
    return RivoUser(
      id: json['id'] as String,
      phone: json['phone'] as String,
      sellerType: json['sellerType'] as String? ?? 'INDIVIDUAL',
      locale: json['locale'] as String? ?? 'ar',
      displayName: json['displayName'] as String?,
      avatarUrl: json['avatarUrl'] as String?,
      telemetryOptIn: json['telemetryOptIn'] as bool? ?? false,
      isVerifiedSeller: seller?['isVerified'] as bool? ?? false,
    );
  }
}

class OtpChallenge {
  const OtpChallenge({required this.challengeToken, required this.expiresInSeconds, this.devCode});

  final String challengeToken;
  final int expiresInSeconds;

  /// Only present when the server runs OTP_PROVIDER=console (development).
  /// Never populated in production — the API refuses to boot that way.
  final String? devCode;

  factory OtpChallenge.fromJson(Map<String, dynamic> json) => OtpChallenge(
        challengeToken: json['challengeToken'] as String,
        expiresInSeconds: json['expiresInSeconds'] as int,
        devCode: json['devCode'] as String?,
      );
}

class AuthRepository {
  const AuthRepository(this._api, this._tokens);

  final ApiClient _api;
  final TokenStorage _tokens;

  Future<OtpChallenge> requestOtp(String phone, {String locale = 'ar'}) async {
    final String deviceKey = await _tokens.deviceKey();
    final Map<String, dynamic> json = await _api.post<Map<String, dynamic>>(
      '/auth/request-otp',
      body: <String, dynamic>{'phone': phone, 'locale': locale, 'deviceKey': deviceKey},
      auth: false,
    );
    return OtpChallenge.fromJson(json);
  }

  Future<RivoUser> verifyOtp({
    required String phone,
    required String challengeToken,
    required String code,
    String? platform,
    String? appVersion,
    String? osVersion,
    String? deviceModel,
  }) async {
    final String deviceKey = await _tokens.deviceKey();
    final Map<String, dynamic> json = await _api.post<Map<String, dynamic>>(
      '/auth/verify-otp',
      body: <String, dynamic>{
        'phone': phone,
        'challengeToken': challengeToken,
        'code': code,
        'deviceKey': deviceKey,
        if (platform != null) 'platform': platform,
        if (appVersion != null) 'appVersion': appVersion,
        if (osVersion != null) 'osVersion': osVersion,
        if (deviceModel != null) 'deviceModel': deviceModel,
      },
      auth: false,
    );

    await _tokens.save(
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String,
    );

    return RivoUser.fromJson(Map<String, dynamic>.from(json['user'] as Map));
  }

  Future<RivoUser> me() async {
    final Map<String, dynamic> json = await _api.get<Map<String, dynamic>>('/users/me');
    return RivoUser.fromJson(json);
  }

  Future<void> logout({bool allDevices = false}) async {
    final String? refreshToken = await _tokens.refreshToken;
    try {
      await _api.post<dynamic>(
        '/auth/logout',
        body: <String, dynamic>{
          if (refreshToken != null) 'refreshToken': refreshToken,
          'allDevices': allDevices,
        },
      );
    } catch (_) {
      // The local session is cleared regardless: a user who taps sign-out must
      // end up signed out even if the network call fails.
    }
    await _tokens.clear();
  }

  Future<RivoUser> updateProfile(Map<String, dynamic> body) async {
    final Map<String, dynamic> json = await _api.patch<Map<String, dynamic>>('/users/me', body: body);
    return RivoUser.fromJson(json);
  }

  /// Telemetry consent. Turning it off stops collection immediately and triggers
  /// deletion of the raw samples already gathered (Master Plan §4).
  Future<void> setTelemetryConsent(bool enabled) =>
      _api.patch<dynamic>('/users/me/privacy', body: <String, dynamic>{'telemetryOptIn': enabled});

  Future<bool> get hasSession => _tokens.hasSession;
}

/// Which optional integrations this deployment actually has.
///
/// Fetched at launch so the UI hides what cannot work rather than presenting a
/// control that would fail — Master Plan §24, "no dead controls".
class Capabilities {
  const Capabilities({
    required this.maps,
    required this.photoUploads,
    required this.reels,
    required this.aiEnhancement,
    required this.onlinePayments,
    required this.paymentProvider,
    this.mapboxPublicToken,
    this.mapStyleDark,
    this.mapStyleLight,
  });

  final bool maps;
  final bool photoUploads;
  final bool reels;
  final bool aiEnhancement;
  final bool onlinePayments;
  final String paymentProvider;
  final String? mapboxPublicToken;
  final String? mapStyleDark;
  final String? mapStyleLight;

  /// The safe default when /health/capabilities cannot be reached: assume
  /// nothing optional is available rather than showing broken controls.
  static const Capabilities unknown = Capabilities(
    maps: false,
    photoUploads: false,
    reels: false,
    aiEnhancement: false,
    onlinePayments: false,
    paymentProvider: 'manual',
  );

  factory Capabilities.fromJson(Map<String, dynamic> json) {
    final Map<String, dynamic> styles =
        json['mapStyles'] is Map ? Map<String, dynamic>.from(json['mapStyles'] as Map) : <String, dynamic>{};
    return Capabilities(
      maps: json['maps'] as bool? ?? false,
      photoUploads: json['photoUploads'] as bool? ?? false,
      reels: json['reels'] as bool? ?? false,
      aiEnhancement: json['aiEnhancement'] as bool? ?? false,
      onlinePayments: json['onlinePayments'] as bool? ?? false,
      paymentProvider: json['paymentProvider'] as String? ?? 'manual',
      mapboxPublicToken: json['mapboxPublicToken'] as String?,
      mapStyleDark: styles['dark'] as String?,
      mapStyleLight: styles['light'] as String?,
    );
  }
}

class ConfigRepository {
  const ConfigRepository(this._api);
  final ApiClient _api;

  Future<Capabilities> capabilities() async {
    final Map<String, dynamic> json =
        await _api.get<Map<String, dynamic>>('/health/capabilities', auth: false);
    return Capabilities.fromJson(json);
  }

  Future<Map<String, bool>> featureFlags() async {
    final Map<String, dynamic> json = await _api.get<Map<String, dynamic>>('/config/flags', auth: false);
    return json.map((String key, dynamic value) => MapEntry<String, bool>(key, value as bool? ?? false));
  }
}
