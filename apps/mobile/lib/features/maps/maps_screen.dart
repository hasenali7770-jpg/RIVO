import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart' as mb;

import '../../core/api/api_exception.dart';
import '../../core/api/models/route.dart' as rivo;
import '../../core/config/business_rules.dart';
import '../../core/providers/providers.dart';
import '../../core/theme/rivo_colors.dart';
import '../../core/theme/rivo_theme.dart';
import '../../shared/widgets/rivo_widgets.dart';
import 'incident_report_sheet.dart';
import 'location_service.dart';
import 'search_sheet.dart';

/// RIVO Maps — Master Plan §4.
///
/// A real live Mapbox map, not a screenshot: current position, destination
/// search, saved places, the traffic layer, RIVO's own incident reports, and a
/// route preview that hands off to turn-by-turn navigation.
class MapsScreen extends ConsumerStatefulWidget {
  const MapsScreen({super.key});

  @override
  ConsumerState<MapsScreen> createState() => _MapsScreenState();
}

class _MapsScreenState extends ConsumerState<MapsScreen> {
  static const LocationService _location = LocationService();

  mb.MapboxMap? _map;
  mb.PointAnnotationManager? _incidentMarkers;
  mb.PolylineAnnotationManager? _routeLines;

  rivo.LatLng? _currentPosition;
  rivo.RoutesResponse? _routes;
  rivo.RivoRoute? _selectedRoute;
  String? _destinationLabel;

  bool _loadingRoute = false;
  bool _trafficLayerOn = true;
  String? _error;
  Timer? _incidentRefresh;

  @override
  void initState() {
    super.initState();
    // Refreshed on a timer rather than a socket: incidents change on the order
    // of minutes, and a persistent connection would cost battery for no gain.
    _incidentRefresh = Timer.periodic(const Duration(seconds: 90), (_) => _loadIncidents());
  }

  @override
  void dispose() {
    _incidentRefresh?.cancel();
    super.dispose();
  }

  Future<void> _onMapCreated(mb.MapboxMap map) async {
    _map = map;

    await map.scaleBar.updateSettings(mb.ScaleBarSettings(enabled: false));
    await map.compass.updateSettings(mb.CompassSettings(enabled: true, marginTop: 120));
    await map.attribution.updateSettings(mb.AttributionSettings(marginBottom: 96));
    await map.logo.updateSettings(mb.LogoSettings(marginBottom: 96));

    _incidentMarkers = await map.annotations.createPointAnnotationManager();
    _routeLines = await map.annotations.createPolylineAnnotationManager();

    await _centreOnUser(initial: true);
    await _loadIncidents();
  }

  Future<void> _centreOnUser({bool initial = false}) async {
    final LocationPermissionResult permission = await _location.ensurePermission();

    if (permission != LocationPermissionResult.granted) {
      if (!initial && mounted) {
        _showPermissionSheet(permission);
      }
      return;
    }

    // The blue dot is only enabled once permission is actually granted, so the
    // map never renders a location puck it cannot fill.
    await _map?.location.updateSettings(
      mb.LocationComponentSettings(enabled: true, pulsingEnabled: true, showAccuracyRing: true),
    );

    final rivo.LatLng? position = await _location.currentPosition();
    if (position == null || !mounted) return;

    setState(() => _currentPosition = position);
    await _map?.flyTo(
      mb.CameraOptions(
        center: mb.Point(coordinates: mb.Position(position.lng, position.lat)),
        zoom: 15,
      ),
      mb.MapAnimationOptions(duration: 900),
    );
  }

  void _showPermissionSheet(LocationPermissionResult permission) {
    showModalBottomSheet<void>(
      context: context,
      builder: (BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const Icon(Icons.location_off_rounded, size: 40, color: RivoColors.sand),
            const SizedBox(height: 16),
            Text(
              permission.messageAr,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () {
                Navigator.pop(context);
                if (permission == LocationPermissionResult.serviceDisabled) {
                  _location.openLocationSettings();
                } else {
                  _location.openSettings();
                }
              },
              child: const Text('فتح الإعدادات'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _loadIncidents() async {
    final mb.MapboxMap? map = _map;
    if (map == null || _incidentMarkers == null) return;

    try {
      final mb.CoordinateBounds bounds = await map.getBounds().then(
            (mb.CameraBounds b) => b.bounds,
          );

      final List<rivo.RoadIncident> incidents =
          await ref.read(trafficRepositoryProvider).incidentsInView(
                minLng: bounds.southwest.coordinates.lng.toDouble(),
                minLat: bounds.southwest.coordinates.lat.toDouble(),
                maxLng: bounds.northeast.coordinates.lng.toDouble(),
                maxLat: bounds.northeast.coordinates.lat.toDouble(),
              );

      if (!mounted) return;
      await _incidentMarkers?.deleteAll();

      for (final rivo.RoadIncident incident in incidents) {
        await _incidentMarkers?.create(
          mb.PointAnnotationOptions(
            geometry: mb.Point(coordinates: mb.Position(incident.lng, incident.lat)),
            textField: _incidentGlyph(incident.type),
            textSize: 22,
            // Lower-confidence reports are drawn faded rather than hidden: the
            // driver still deserves to know something was reported there.
            textOpacity: 0.55 + (incident.confidence * 0.45),
          ),
        );
      }
    } catch (_) {
      // Incident overlay is additive; a failure must never blank the map.
    }
  }

  static String _incidentGlyph(rivo.IncidentType type) => switch (type) {
        rivo.IncidentType.accident => '💥',
        rivo.IncidentType.trafficJam => '🚗',
        rivo.IncidentType.roadClosure => '⛔',
        rivo.IncidentType.roadWorks => '🚧',
        rivo.IncidentType.floodedRoad => '🌊',
        rivo.IncidentType.pothole => '🕳️',
        rivo.IncidentType.hazard => '⚠️',
      };

  Future<void> _routeTo(rivo.LatLng destination, String label) async {
    final rivo.LatLng? origin = _currentPosition ?? await _location.currentPosition();
    if (origin == null) {
      if (mounted) _showPermissionSheet(LocationPermissionResult.denied);
      return;
    }

    setState(() {
      _loadingRoute = true;
      _error = null;
      _destinationLabel = label;
    });

    try {
      final rivo.RoutesResponse routes =
          await ref.read(mapsRepositoryProvider).route(origin: origin, destination: destination);

      if (!mounted) return;
      setState(() {
        _routes = routes;
        _selectedRoute = routes.primary;
        _currentPosition = origin;
      });
      await _drawRoutes(routes);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = asApiException(error).display);
    } finally {
      if (mounted) setState(() => _loadingRoute = false);
    }
  }

  Future<void> _drawRoutes(rivo.RoutesResponse routes) async {
    await _routeLines?.deleteAll();

    // Alternatives are drawn first so the selected route sits on top of them.
    for (final rivo.RivoRoute route in routes.routes.reversed) {
      final bool isSelected = route.id == _selectedRoute?.id;
      final List<rivo.LatLng> points = _decodePolyline(route.geometry);
      if (points.length < 2) continue;

      await _routeLines?.create(
        mb.PolylineAnnotationOptions(
          geometry: mb.LineString(
            coordinates: points
                .map((rivo.LatLng p) => mb.Position(p.lng, p.lat))
                .toList(),
          ),
          lineColor: (isSelected ? RivoColors.fastestRoute : RivoColors.alternativeRoute).toARGB32(),
          lineWidth: isSelected ? 7 : 4.5,
          lineOpacity: isSelected ? 1.0 : 0.55,
        ),
      );
    }

    if (routes.routes.isNotEmpty) {
      await _fitToRoute(routes.primary ?? routes.routes.first);
    }
  }

  Future<void> _fitToRoute(rivo.RivoRoute route) async {
    final List<rivo.LatLng> points = _decodePolyline(route.geometry);
    if (points.isEmpty) return;

    double minLat = points.first.lat, maxLat = points.first.lat;
    double minLng = points.first.lng, maxLng = points.first.lng;
    for (final rivo.LatLng p in points) {
      minLat = p.lat < minLat ? p.lat : minLat;
      maxLat = p.lat > maxLat ? p.lat : maxLat;
      minLng = p.lng < minLng ? p.lng : minLng;
      maxLng = p.lng > maxLng ? p.lng : maxLng;
    }

    final mb.CameraOptions camera = await _map!.cameraForCoordinateBounds(
      mb.CoordinateBounds(
        southwest: mb.Point(coordinates: mb.Position(minLng, minLat)),
        northeast: mb.Point(coordinates: mb.Position(maxLng, maxLat)),
        infiniteBounds: false,
      ),
      // Generous bottom inset so the route card does not cover the line.
      mb.MbxEdgeInsets(top: 140, left: 48, bottom: 320, right: 48),
      null,
      null,
      null,
      null,
    );
    await _map?.flyTo(camera, mb.MapAnimationOptions(duration: 800));
  }

  void _clearRoute() {
    setState(() {
      _routes = null;
      _selectedRoute = null;
      _destinationLabel = null;
      _error = null;
    });
    _routeLines?.deleteAll();
  }

  Future<void> _openSearch() async {
    final rivo.PlaceResult? place = await showModalBottomSheet<rivo.PlaceResult>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext context) => SearchSheet(near: _currentPosition),
    );
    if (place != null) await _routeTo(place.position, place.name);
  }

  Future<void> _reportIncident() async {
    if (!ref.read(isSignedInProvider)) {
      // Reporting needs an account so a report can be attributed and rate
      // limited; browsing the map does not.
      if (mounted) {
        unawaited(context.push('/auth/phone?next=${Uri.encodeComponent('/maps')}'));
      }
      return;
    }

    final rivo.LatLng? at = _currentPosition ?? await _location.currentPosition();
    if (at == null || !mounted) return;

    final bool? reported = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext context) => IncidentReportSheet(at: at),
    );
    if (reported == true) await _loadIncidents();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<Capabilities> capabilities = ref.watch(capabilitiesProvider);

    return capabilities.when(
      loading: () => const Scaffold(body: RivoLoading(label: 'جارٍ التحميل…')),
      error: (Object error, StackTrace stack) => Scaffold(body: RivoErrorView(error: error)),
      data: (Capabilities caps) {
        // Without a Mapbox token there is no map to render. Saying so plainly is
        // better than an empty grey rectangle (Master Plan §24).
        if (!caps.maps || caps.mapboxPublicToken == null || caps.mapboxPublicToken!.isEmpty) {
          return const Scaffold(body: FeatureUnavailableView(feature: 'الخرائط'));
        }

        mb.MapboxOptions.setAccessToken(caps.mapboxPublicToken!);

        return Scaffold(
          body: Stack(
            children: <Widget>[
              mb.MapWidget(
                key: const ValueKey<String>('rivo-map'),
                styleUri: caps.mapStyleDark ?? mb.MapboxStyles.DARK,
                viewport: mb.CameraViewportState(
                  center: mb.Point(
                    coordinates: mb.Position(RivoGeo.defaultLng, RivoGeo.defaultLat),
                  ),
                  zoom: RivoGeo.defaultZoom,
                ),
                onMapCreated: _onMapCreated,
                onCameraChangeListener: (_) {},
              ),

              _buildTopBar(),
              _buildSideControls(),
              if (_routes != null) _buildRouteCard(),
              if (_error != null) _buildErrorBanner(),
            ],
          ),
        );
      },
    );
  }

  Widget _buildTopBar() => Positioned(
        top: MediaQuery.of(context).padding.top + 10,
        left: 16,
        right: 16,
        child: Row(
          children: <Widget>[
            Expanded(
              child: GestureDetector(
                onTap: _openSearch,
                child: Container(
                  height: 52,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  decoration: BoxDecoration(
                    color: RivoColors.surface.withValues(alpha: 0.97),
                    borderRadius: BorderRadius.circular(RivoTheme.radiusPill),
                    boxShadow: <BoxShadow>[
                      BoxShadow(color: Colors.black.withValues(alpha: 0.3), blurRadius: 16),
                    ],
                  ),
                  child: Row(
                    children: <Widget>[
                      const Icon(Icons.search_rounded, color: RivoColors.sand),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          _destinationLabel ?? 'إلى أين تريد الذهاب؟',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: _destinationLabel != null
                                ? RivoColors.white
                                : RivoColors.white.withValues(alpha: 0.5),
                            fontSize: 15,
                          ),
                        ),
                      ),
                      if (_destinationLabel != null)
                        IconButton(
                          icon: const Icon(Icons.close_rounded, size: 20),
                          onPressed: _clearRoute,
                          tooltip: 'إلغاء المسار',
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      );

  Widget _buildSideControls() => Positioned(
        top: MediaQuery.of(context).padding.top + 78,
        right: 16,
        child: Column(
          children: <Widget>[
            _MapButton(
              icon: Icons.my_location_rounded,
              tooltip: 'موقعي',
              onTap: _centreOnUser,
            ),
            const SizedBox(height: 10),
            _MapButton(
              icon: Icons.traffic_rounded,
              tooltip: 'طبقة الازدحام',
              active: _trafficLayerOn,
              onTap: () async {
                setState(() => _trafficLayerOn = !_trafficLayerOn);
                // The navigation styles carry Mapbox's own traffic layer; the
                // day/night switch is what turns it on and off.
                final AsyncValue<Capabilities> caps = ref.read(capabilitiesProvider);
                final String style = _trafficLayerOn
                    ? (caps.valueOrNull?.mapStyleDark ?? mb.MapboxStyles.DARK)
                    : mb.MapboxStyles.DARK;
                await _map?.loadStyleURI(style);
              },
            ),
            const SizedBox(height: 10),
            _MapButton(
              icon: Icons.add_alert_rounded,
              tooltip: 'الإبلاغ عن حالة طريق',
              onTap: _reportIncident,
            ),
          ],
        ),
      );

  Widget _buildErrorBanner() => Positioned(
        top: MediaQuery.of(context).padding.top + 72,
        left: 16,
        right: 16,
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: RivoColors.signalRed.withValues(alpha: 0.95),
            borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
          ),
          child: Row(
            children: <Widget>[
              const Icon(Icons.error_outline_rounded, color: Colors.white, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Text(_error!, style: const TextStyle(color: Colors.white, fontSize: 13)),
              ),
              IconButton(
                icon: const Icon(Icons.close_rounded, color: Colors.white, size: 18),
                onPressed: () => setState(() => _error = null),
              ),
            ],
          ),
        ),
      );

  Widget _buildRouteCard() {
    final rivo.RoutesResponse routes = _routes!;
    final rivo.RivoRoute? selected = _selectedRoute;
    if (selected == null) return const SizedBox.shrink();

    return Positioned(
      left: 16,
      right: 16,
      bottom: 96,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: RivoColors.surface,
          borderRadius: BorderRadius.circular(RivoTheme.radiusMd),
          border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
          boxShadow: <BoxShadow>[
            BoxShadow(color: Colors.black.withValues(alpha: 0.4), blurRadius: 24),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        selected.etaLabelAr,
                        style: const TextStyle(
                          fontSize: 26,
                          fontWeight: FontWeight.w700,
                          color: RivoColors.white,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        selected.distanceLabelAr,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      if (selected.delayLabelAr != null) ...<Widget>[
                        const SizedBox(height: 6),
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: <Widget>[
                            const Icon(Icons.schedule_rounded, size: 14, color: RivoColors.signalRed),
                            const SizedBox(width: 5),
                            Text(
                              selected.delayLabelAr!,
                              style: const TextStyle(fontSize: 12, color: RivoColors.signalRed),
                            ),
                          ],
                        ),
                      ],
                      if (selected.incidents.isNotEmpty) ...<Widget>[
                        const SizedBox(height: 6),
                        Text(
                          '${selected.incidents.length} بلاغ على هذا المسار',
                          style: const TextStyle(fontSize: 12, color: RivoColors.sand),
                        ),
                      ],
                    ],
                  ),
                ),
                if (_loadingRoute)
                  const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
              ],
            ),

            // Alternatives are offered explicitly rather than silently chosen —
            // Master Plan §4 requires at least one when the provider returns it.
            if (routes.routes.length > 1) ...<Widget>[
              const SizedBox(height: 14),
              SizedBox(
                height: 38,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: routes.routes.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (BuildContext context, int index) {
                    final rivo.RivoRoute route = routes.routes[index];
                    final bool isSelected = route.id == selected.id;
                    return ChoiceChip(
                      selected: isSelected,
                      label: Text(
                        index == 0
                            ? 'الأسرع · ${route.etaLabelAr}'
                            : 'بديل $index · ${route.etaLabelAr}',
                      ),
                      onSelected: (_) async {
                        setState(() => _selectedRoute = route);
                        await _drawRoutes(routes);
                      },
                    );
                  },
                ),
              ),
            ],

            const SizedBox(height: 14),
            ElevatedButton.icon(
              onPressed: () => context.push(
                '/navigate',
                extra: <String, dynamic>{
                  'lat': routes.destination.lat,
                  'lng': routes.destination.lng,
                  'label': _destinationLabel,
                },
              ),
              icon: const Icon(Icons.navigation_rounded),
              label: const Text('ابدأ الملاحة'),
            ),
          ],
        ),
      ),
    );
  }

  /// Decodes a precision-6 encoded polyline.
  static List<rivo.LatLng> _decodePolyline(String encoded, {int precision = 6}) {
    final double factor = 1.0 * (precision == 6 ? 1000000 : 100000);
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

class _MapButton extends StatelessWidget {
  const _MapButton({
    required this.icon,
    required this.onTap,
    required this.tooltip,
    this.active = false,
  });

  final IconData icon;
  final VoidCallback onTap;
  final String tooltip;
  final bool active;

  @override
  Widget build(BuildContext context) => Tooltip(
        message: tooltip,
        child: Material(
          color: RivoColors.surface.withValues(alpha: 0.97),
          shape: const CircleBorder(),
          elevation: 6,
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: SizedBox(
              width: 48,
              height: 48,
              child: Icon(
                icon,
                size: 22,
                color: active ? RivoColors.signalRed : RivoColors.white.withValues(alpha: 0.85),
              ),
            ),
          ),
        ),
      );
}
