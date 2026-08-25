import 'dart:async';
import 'dart:math';

import 'package:geolocator/geolocator.dart';

import '../../core/api/repositories/maps_repository.dart';
import '../../core/config/business_rules.dart';

/// Anonymous speed-sample collection — Master Plan §4
/// ("RIVO Traffic Engine foundation").
///
/// Privacy properties this class is responsible for:
///  - it only runs when [start] is called, which happens only after the user has
///    opted in on the privacy screen;
///  - the session key is random, rotates at least daily, and is derived from
///    nothing about the device or the account, so samples cannot be linked back
///    to a person or joined across days;
///  - samples are buffered and uploaded in batches, and the buffer is dropped
///    entirely on [stop] — withdrawing consent discards anything not yet sent.
class TelemetryCollector {
  TelemetryCollector(this._repository);

  final TrafficRepository _repository;

  StreamSubscription<Position>? _subscription;
  final List<Map<String, dynamic>> _buffer = <Map<String, dynamic>>[];
  Timer? _flushTimer;
  String? _sessionKey;
  DateTime? _sessionStartedAt;

  bool get isRunning => _subscription != null;

  /// Rotating pseudonymous id. Regenerated every 12 hours so a long drive cannot
  /// be stitched together with the next day's commute.
  String _currentSessionKey() {
    final DateTime now = DateTime.now();
    final bool stale = _sessionKey == null ||
        _sessionStartedAt == null ||
        now.difference(_sessionStartedAt!).inHours >= 12;

    if (stale) {
      final Random random = Random.secure();
      _sessionKey = List<int>.generate(16, (_) => random.nextInt(256))
          .map((int b) => b.toRadixString(16).padLeft(2, '0'))
          .join();
      _sessionStartedAt = now;
    }
    return _sessionKey!;
  }

  Future<void> start() async {
    if (isRunning) return;

    _subscription = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 25,
      ),
    ).listen(_onPosition, onError: (_) {});

    _flushTimer = Timer.periodic(const Duration(seconds: 60), (_) => unawaited(flush()));
  }

  Future<void> stop({bool flushPending = false}) async {
    await _subscription?.cancel();
    _subscription = null;
    _flushTimer?.cancel();
    _flushTimer = null;

    if (flushPending) {
      await flush();
    } else {
      // Consent withdrawn: anything still buffered is discarded rather than sent.
      _buffer.clear();
    }
  }

  void _onPosition(Position position) {
    // A poor fix produces a speed reading that is noise; a stationary sample
    // says nothing about traffic flow and would drag every average down.
    if (position.accuracy > 50) return;
    final double speedKph = position.speed * 3.6;
    if (speedKph < 3 || speedKph > 300) return;

    _buffer.add(<String, dynamic>{
      'lat': position.latitude,
      'lng': position.longitude,
      'speedKph': double.parse(speedKph.toStringAsFixed(1)),
      'headingDeg': position.heading.isFinite ? position.heading.round() % 360 : null,
      'accuracyM': double.parse(position.accuracy.toStringAsFixed(1)),
      'recordedAt': position.timestamp.toUtc().toIso8601String(),
    });

    if (_buffer.length >= RivoRules.telemetryMaxBatchSize) unawaited(flush());
  }

  Future<void> flush() async {
    if (_buffer.isEmpty) return;

    final List<Map<String, dynamic>> batch = List<Map<String, dynamic>>.from(
      _buffer.take(RivoRules.telemetryMaxBatchSize),
    );

    try {
      await _repository.uploadTelemetry(sessionKey: _currentSessionKey(), samples: batch);
      _buffer.removeRange(0, batch.length);
    } catch (_) {
      // Kept for the next attempt, but capped: an offline drive must not grow
      // the buffer without bound.
      if (_buffer.length > RivoRules.telemetryMaxBatchSize * 5) {
        _buffer.removeRange(0, _buffer.length - RivoRules.telemetryMaxBatchSize * 5);
      }
    }
  }

  void dispose() {
    unawaited(stop());
  }
}
