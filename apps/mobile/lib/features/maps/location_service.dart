import 'dart:async';

import 'package:geolocator/geolocator.dart';

import '../../core/api/models/route.dart';

/// Location access and the GPS stream.
///
/// Permission is requested at the moment the user asks for something that needs
/// it — centring the map, or starting navigation — never at launch. An app that
/// demands location before showing anything is one users deny by reflex.
class LocationService {
  const LocationService();

  Future<LocationPermissionResult> ensurePermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return LocationPermissionResult.serviceDisabled;
    }

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }

    return switch (permission) {
      LocationPermission.denied => LocationPermissionResult.denied,
      LocationPermission.deniedForever => LocationPermissionResult.deniedForever,
      _ => LocationPermissionResult.granted,
    };
  }

  Future<LatLng?> currentPosition() async {
    if (await ensurePermission() != LocationPermissionResult.granted) return null;
    try {
      final Position position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 12)),
      );
      return LatLng(position.latitude, position.longitude);
    } on TimeoutException {
      // Falls back to the last known fix: a slightly stale position is far more
      // useful than none when a user taps "centre on me" indoors.
      final Position? last = await Geolocator.getLastKnownPosition();
      return last == null ? null : LatLng(last.latitude, last.longitude);
    } catch (_) {
      return null;
    }
  }

  /// Continuous updates for navigation.
  ///
  /// A 5 m distance filter keeps the stream responsive enough for turn prompts
  /// without waking the radio for every jitter of a stationary fix.
  Stream<Position> navigationStream() => Geolocator.getPositionStream(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.bestForNavigation,
          distanceFilter: 5,
        ),
      );

  Future<void> openSettings() => Geolocator.openAppSettings();
  Future<void> openLocationSettings() => Geolocator.openLocationSettings();
}

enum LocationPermissionResult { granted, denied, deniedForever, serviceDisabled }

extension LocationPermissionResultX on LocationPermissionResult {
  String get messageAr => switch (this) {
        LocationPermissionResult.granted => '',
        LocationPermissionResult.denied => 'نحتاج إذن الموقع لعرض موقعك على الخريطة.',
        LocationPermissionResult.deniedForever =>
          'تم رفض إذن الموقع نهائياً. يمكنك تفعيله من إعدادات التطبيق.',
        LocationPermissionResult.serviceDisabled =>
          'خدمة الموقع مغلقة على الجهاز. يرجى تشغيلها للمتابعة.',
      };
}
