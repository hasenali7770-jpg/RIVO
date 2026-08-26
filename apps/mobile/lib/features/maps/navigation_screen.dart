import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart' as mb;

import '../../core/api/api_exception.dart';
import '../../core/api/models/route.dart' as rivo;
import '../../core/config/business_rules.dart';
import '../../core/providers/providers.dart';
import '../../core/theme/rivo_colors.dart';
import '../../core/theme/rivo_theme.dart';
import '../../shared/widgets/rivo_widgets.dart';
import 'location_service.dart';

/// Turn-by-turn navigation — Master Plan §4 "Navigation".
///
/// Provides guidance, rerouting, arrival detection and route feedback, driven
/// entirely by the step list the Directions API returns. There is no native
/// bridge: this is the whole implementation, which is why RIVO needs no Mapbox
/// Navigation SDK licence.
///
/// Voice guidance and a native heads-up display would require that SDK, and it
/// is licensed separately — a later decision, not a dependency of this screen.
class NavigationScreen extends ConsumerStatefulWidget {
  const NavigationScreen({
    this.destinationLat,
    this.destinationLng,
    this.destinationLabel,
    this.propertyId,
    super.key,
  });

  final double? destinationLat;
  final double? destinationLng;
  final String? destinationLabel;

  /// Set when navigation was started from `اذهب إلى العقار`.
  final String? propertyId;

  @override
  ConsumerState<NavigationScreen> createState() => _NavigationScreenState();
}

class _NavigationScreenState extends ConsumerState<NavigationScreen> {
  static const LocationService _location = LocationService();

  mb.MapboxMap? _map;
  mb.PolylineAnnotationManager? _routeLine;

  StreamSubscription<Position>? _positions;
  rivo.RoutesResponse? _routes;
  rivo.RivoRoute? _route;
  List<rivo.LatLng> _routePoints = <rivo.LatLng>[];

  int _stepIndex = 0;
  int _rerouteCount = 0;
  double _distanceToNextTurnM = 0;
  bool _loading = true;
  bool _arrived = false;
  bool _rerouting = false;
  String? _error;

  DateTime? _departedAt;
  int? _predictedSeconds;

  @override
  void initState() {
    super.initState();
    // The screen must stay lit while driving; released in dispose.
    unawaited(SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky));
    unawaited(_start());
  }

  @override
  void dispose() {
    unawaited(_positions?.cancel());
    unawaited(SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge));
    super.dispose();
  }

  Future<void> _start() async {
    final rivo.LatLng? origin = await _location.currentPosition();
    if (origin == null) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'نحتاج إذن الموقع لبدء الملاحة.';
      });
      return;
    }

    try {
      final rivo.RoutesResponse routes = widget.propertyId != null
          ? await ref.read(mapsRepositoryProvider).routeToProperty(
                origin: origin,
                propertyId: widget.propertyId!,
              )
          : await ref.read(mapsRepositoryProvider).route(
                origin: origin,
                destination: rivo.LatLng(widget.destinationLat!, widget.destinationLng!),
              );

      if (!mounted) return;
      final rivo.RivoRoute? primary = routes.primary;
      if (primary == null) {
        setState(() {
          _loading = false;
          _error = 'تعذّر إيجاد مسار.';
        });
        return;
      }

      setState(() {
        _routes = routes;
        _route = primary;
        _routePoints = _decodePolyline(primary.geometry);
        _departedAt = DateTime.now();
        _predictedSeconds = primary.durationInTrafficSeconds;
        _loading = false;
      });

      await _drawRoute();
      _followPosition();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = asApiException(error).display;
      });
    }
  }

  void _followPosition() {
    _positions?.cancel();
    _positions = _location.navigationStream().listen(_onPosition);
  }

  Future<void> _onPosition(Position position) async {
    if (!mounted || _route == null || _arrived) return;

    final rivo.LatLng here = rivo.LatLng(position.latitude, position.longitude);

    // Camera follows the driver, tilted and rotated to heading — a north-up flat
    // map is close to unusable at speed.
    await _map?.easeTo(
      mb.CameraOptions(
        center: mb.Point(coordinates: mb.Position(here.lng, here.lat)),
        zoom: 17,
        pitch: 55,
        bearing: position.heading.isFinite ? position.heading : 0,
      ),
      mb.MapAnimationOptions(duration: 800),
    );

    _advanceStep(here);

    final double toDestination = _distanceMetres(here, _routes!.destination);
    if (toDestination < 45) {
      await _onArrived();
      return;
    }

    // Off-route detection. The threshold is deliberately generous: GPS in a
    // dense urban canyon drifts, and rerouting on every wobble would be worse
    // than useless.
    final double offRoute = _distanceToRoute(here);
    if (offRoute > RivoRules.rerouteOffRouteThresholdM && !_rerouting) {
      await _reroute(here, position.heading);
    }
  }

  void _advanceStep(rivo.LatLng here) {
    final List<rivo.RouteStep> steps = _route!.allSteps;
    if (_stepIndex >= steps.length) return;

    final rivo.RouteStep current = steps[_stepIndex];
    final double distance = _distanceMetres(here, current.location);

    setState(() => _distanceToNextTurnM = distance);

    // Within 25 m the manoeuvre is being executed, so the next instruction is
    // what the driver needs to see.
    if (distance < 25 && _stepIndex < steps.length - 1) {
      setState(() => _stepIndex += 1);
    }
  }

  Future<void> _reroute(rivo.LatLng from, double heading) async {
    setState(() => _rerouting = true);
    try {
      final rivo.RoutesResponse routes = await ref.read(mapsRepositoryProvider).route(
            origin: from,
            destination: _routes!.destination,
            alternatives: false,
            // Passing the bearing stops the new route opening with a U-turn.
            originBearing: heading.isFinite ? heading : null,
          );

      if (!mounted) return;
      final rivo.RivoRoute? next = routes.primary;
      if (next != null) {
        setState(() {
          _routes = routes;
          _route = next;
          _routePoints = _decodePolyline(next.geometry);
          _stepIndex = 0;
          _rerouteCount += 1;
        });
        await _drawRoute();

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('تم تحديث المسار'), duration: Duration(seconds: 2)),
          );
        }
      }
    } catch (_) {
      // A failed reroute leaves the previous route on screen, which is still
      // more useful than a blank map.
    } finally {
      if (mounted) setState(() => _rerouting = false);
    }
  }

  Future<void> _onArrived() async {
    await _positions?.cancel();
    if (!mounted) return;
    setState(() => _arrived = true);

    // Predicted vs. actual is what calibrates future ETAs (Master Plan §4).
    final int actualSeconds =
        _departedAt == null ? 0 : DateTime.now().difference(_departedAt!).inSeconds;

    unawaited(
      ref
          .read(mapsRepositoryProvider)
          .submitRouteFeedback(
            routeRequestId: _routes!.requestId,
            origin: _routes!.origin,
            destination: _routes!.destination,
            predictedSeconds: _predictedSeconds ?? 0,
            actualSeconds: actualSeconds,
            distanceM: _route?.distanceM,
            rerouteCount: _rerouteCount,
            outcome: 'COMPLETED',
          )
          .catchError((_) {}),
    );
  }

  Future<void> _drawRoute() async {
    await _routeLine?.deleteAll();
    if (_routePoints.length < 2) return;

    await _routeLine?.create(
      mb.PolylineAnnotationOptions(
        geometry: mb.LineString(
          coordinates: _routePoints.map((rivo.LatLng p) => mb.Position(p.lng, p.lat)).toList(),
        ),
        lineColor: RivoColors.fastestRoute.toARGB32(),
        lineWidth: 8,
      ),
    );
  }

  Future<void> _stop() async {
    await _positions?.cancel();

    // An abandoned trip is recorded too: a route users give up on is a signal
    // about the route, not noise to discard.
    if (_routes != null && !_arrived && _departedAt != null) {
      unawaited(
        ref
            .read(mapsRepositoryProvider)
            .submitRouteFeedback(
              routeRequestId: _routes!.requestId,
              origin: _routes!.origin,
              destination: _routes!.destination,
              predictedSeconds: _predictedSeconds ?? 0,
              rerouteCount: _rerouteCount,
              outcome: 'ABANDONED',
            )
            .catchError((_) {}),
      );
    }

    if (mounted) context.pop();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: RivoLoading(label: 'جارٍ حساب المسار…'));
    }

    if (_error != null) {
      return Scaffold(
        appBar: AppBar(leading: const BackButton()),
        body: RivoErrorView(
          error: ApiException(code: 'NAV', message: _error!, messageAr: _error),
          onRetry: () {
            setState(() {
              _loading = true;
              _error = null;
            });
            unawaited(_start());
          },
        ),
      );
    }

    final AsyncValue<Capabilities> caps = ref.watch(capabilitiesProvider);
    final String? token = caps.valueOrNull?.mapboxPublicToken;
    if (token == null || token.isEmpty) {
      return const Scaffold(body: FeatureUnavailableView(feature: 'الملاحة'));
    }
    mb.MapboxOptions.setAccessToken(token);

    final List<rivo.RouteStep> steps = _route?.allSteps ?? <rivo.RouteStep>[];
    final rivo.RouteStep? currentStep = _stepIndex < steps.length ? steps[_stepIndex] : null;

    return Scaffold(
      body: Stack(
        children: <Widget>[
          mb.MapWidget(
            key: const ValueKey<String>('rivo-navigation-map'),
            styleUri: caps.valueOrNull?.mapStyleDark ?? mb.MapboxStyles.DARK,
            viewport: mb.CameraViewportState(
              center: mb.Point(
                coordinates: mb.Position(_routes!.origin.lng, _routes!.origin.lat),
              ),
              zoom: 17,
              pitch: 55,
            ),
            onMapCreated: (mb.MapboxMap map) async {
              _map = map;
              _routeLine = await map.annotations.createPolylineAnnotationManager();
              await map.location.updateSettings(
                mb.LocationComponentSettings(enabled: true, puckBearingEnabled: true),
              );
              await map.scaleBar.updateSettings(mb.ScaleBarSettings(enabled: false));
              await _drawRoute();
            },
          ),

          if (_arrived) _buildArrivalCard() else ...<Widget>[
            if (currentStep != null) _buildManeuverBanner(currentStep),
            _buildBottomBar(),
          ],

          if (_rerouting)
            Positioned(
              top: MediaQuery.of(context).padding.top + 130,
              left: 0,
              right: 0,
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: BoxDecoration(
                    color: RivoColors.surface,
                    borderRadius: BorderRadius.circular(RivoTheme.radiusPill),
                  ),
                  child: const Text('جارٍ إعادة توجيه المسار…', style: TextStyle(fontSize: 13)),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildManeuverBanner(rivo.RouteStep step) => Positioned(
        top: MediaQuery.of(context).padding.top + 10,
        left: 12,
        right: 12,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: RivoColors.petrol.withValues(alpha: 0.97),
            borderRadius: BorderRadius.circular(RivoTheme.radiusMd),
            border: Border.all(color: RivoColors.signalRed.withValues(alpha: 0.35)),
          ),
          child: Row(
            children: <Widget>[
              Icon(_maneuverIcon(step.maneuverType, step.maneuverModifier),
                  size: 40, color: RivoColors.signalRed,),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      _distanceToNextTurnM < 1000
                          ? '${_distanceToNextTurnM.round()} م'
                          : '${(_distanceToNextTurnM / 1000).toStringAsFixed(1)} كم',
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w700,
                        color: RivoColors.white,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      step.instruction,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 14, color: RivoColors.white.withValues(alpha: 0.85)),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      );

  Widget _buildBottomBar() => Positioned(
        left: 12,
        right: 12,
        bottom: MediaQuery.of(context).padding.bottom + 12,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: RivoColors.surface,
            borderRadius: BorderRadius.circular(RivoTheme.radiusMd),
          ),
          child: Row(
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      _route?.etaLabelAr ?? '',
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: RivoColors.white,
                      ),
                    ),
                    Text(
                      '${_route?.distanceLabelAr ?? ''}'
                      '${widget.destinationLabel != null ? ' · ${widget.destinationLabel}' : ''}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              SizedBox(
                width: 120,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: RivoColors.surfaceLighter,
                    minimumSize: const Size.fromHeight(46),
                  ),
                  onPressed: _stop,
                  child: const Text('إنهاء'),
                ),
              ),
            ],
          ),
        ),
      );

  Widget _buildArrivalCard() => Positioned(
        left: 16,
        right: 16,
        bottom: MediaQuery.of(context).padding.bottom + 24,
        child: Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: RivoColors.surface,
            borderRadius: BorderRadius.circular(RivoTheme.radiusMd),
            border: Border.all(color: RivoColors.success.withValues(alpha: 0.4)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const Icon(Icons.check_circle_rounded, size: 44, color: RivoColors.success),
              const SizedBox(height: 12),
              Text(
                'وصلت إلى وجهتك',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              if (widget.destinationLabel != null) ...<Widget>[
                const SizedBox(height: 4),
                Text(
                  widget.destinationLabel!,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
              const SizedBox(height: 20),
              ElevatedButton(onPressed: () => context.pop(), child: const Text('تم')),
            ],
          ),
        ),
      );

  static IconData _maneuverIcon(String type, String? modifier) {
    if (type == 'arrive') return Icons.place_rounded;
    if (type == 'roundabout' || type == 'rotary') return Icons.rotate_right_rounded;
    if (type == 'merge') return Icons.merge_rounded;
    if (type == 'fork') return Icons.call_split_rounded;

    return switch (modifier) {
      'left' || 'slight left' => Icons.turn_left_rounded,
      'sharp left' => Icons.turn_sharp_left_rounded,
      'right' || 'slight right' => Icons.turn_right_rounded,
      'sharp right' => Icons.turn_sharp_right_rounded,
      'uturn' => Icons.u_turn_left_rounded,
      _ => Icons.straight_rounded,
    };
  }

  /// Perpendicular distance from the driver to the nearest route segment.
  double _distanceToRoute(rivo.LatLng here) {
    if (_routePoints.length < 2) return 0;
    double best = double.infinity;
    for (int i = 0; i < _routePoints.length - 1; i += 1) {
      final double d = _distanceToSegment(here, _routePoints[i], _routePoints[i + 1]);
      if (d < best) best = d;
    }
    return best;
  }

  double _distanceToSegment(rivo.LatLng p, rivo.LatLng a, rivo.LatLng b) {
    // Over tens of metres a flat projection is accurate enough and far cheaper
    // than a spherical one run against every segment on every GPS tick.
    final double latRad = p.lat * math.pi / 180;
    const double mPerDegLat = 111132.92;
    final double mPerDegLng = 111412.84 * math.cos(latRad);

    final double px = (p.lng - a.lng) * mPerDegLng;
    final double py = (p.lat - a.lat) * mPerDegLat;
    final double bx = (b.lng - a.lng) * mPerDegLng;
    final double by = (b.lat - a.lat) * mPerDegLat;

    final double lengthSq = bx * bx + by * by;
    if (lengthSq == 0) return math.sqrt(px * px + py * py);

    final double t = ((px * bx + py * by) / lengthSq).clamp(0.0, 1.0);
    final double dx = px - t * bx;
    final double dy = py - t * by;
    return math.sqrt(dx * dx + dy * dy);
  }

  static double _distanceMetres(rivo.LatLng a, rivo.LatLng b) {
    const double earthRadius = 6371008.8;
    final double dLat = (b.lat - a.lat) * math.pi / 180;
    final double dLng = (b.lng - a.lng) * math.pi / 180;
    final double lat1 = a.lat * math.pi / 180;
    final double lat2 = b.lat * math.pi / 180;
    final double h = math.pow(math.sin(dLat / 2), 2) +
        math.cos(lat1) * math.cos(lat2) * math.pow(math.sin(dLng / 2), 2);
    return 2 * earthRadius * math.asin(math.min(1, math.sqrt(h)));
  }

  static List<rivo.LatLng> _decodePolyline(String encoded, {int precision = 6}) {
    final double factor = precision == 6 ? 1000000 : 100000;
    final List<rivo.LatLng> coordinates = <rivo.LatLng>[];
    int index = 0, lat = 0, lng = 0;

    while (index < encoded.length) {
      int result = 0, shift = 0, byte;
      do {
        byte = encoded.codeUnitAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      lat += (result & 1) != 0 ? ~(result >> 1) : result >> 1;

      result = 0;
      shift = 0;
      do {
        byte = encoded.codeUnitAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      lng += (result & 1) != 0 ? ~(result >> 1) : result >> 1;

      coordinates.add(rivo.LatLng(lat / factor, lng / factor));
    }
    return coordinates;
  }
}
