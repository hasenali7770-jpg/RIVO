import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Token persistence.
///
/// Both tokens live in the platform keystore (Keychain on iOS, EncryptedSharedPreferences
/// on Android) rather than SharedPreferences — Master Plan §3 requires secure
/// storage for refresh tokens, and a refresh token is a long-lived credential
/// that must survive neither a rooted-device dump nor a backup extraction in
/// plaintext.
class TokenStorage {
  TokenStorage([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
            );

  final FlutterSecureStorage _storage;

  static const String _accessKey = 'rivo.access_token';
  static const String _refreshKey = 'rivo.refresh_token';
  static const String _deviceKey = 'rivo.device_key';

  Future<String?> get accessToken => _storage.read(key: _accessKey);
  Future<String?> get refreshToken => _storage.read(key: _refreshKey);

  Future<void> save({required String accessToken, required String refreshToken}) async {
    await _storage.write(key: _accessKey, value: accessToken);
    await _storage.write(key: _refreshKey, value: refreshToken);
  }

  Future<void> clear() async {
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
  }

  Future<bool> get hasSession async => (await refreshToken) != null;

  /// Stable per-install identifier used to name the device session.
  ///
  /// Generated locally and kept in secure storage; it is NOT an advertising id
  /// or a hardware serial, so it cannot be correlated with the user across apps.
  Future<String> deviceKey() async {
    final String? existing = await _storage.read(key: _deviceKey);
    if (existing != null) return existing;

    final String generated = 'dev_${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}'
        '${DateTime.now().hashCode.toRadixString(36)}';
    await _storage.write(key: _deviceKey, value: generated);
    return generated;
  }
}
