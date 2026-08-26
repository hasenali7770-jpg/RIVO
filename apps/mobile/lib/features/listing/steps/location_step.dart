import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart' as mb;

import '../../../core/api/models/route.dart' as rivo;
import '../../../core/config/business_rules.dart';
import '../../../core/providers/providers.dart';
import '../../../core/theme/rivo_colors.dart';
import '../../../core/theme/rivo_theme.dart';
import '../../../shared/widgets/rivo_widgets.dart';
import '../../maps/location_service.dart';
import '../listing_draft.dart';

/// Step 3 — location (Master Plan §6).
///
/// The pin is placed by moving the map under a fixed centre marker rather than
/// by dragging a marker: it keeps the target under the user's thumb instead of
/// beneath it, which matters on a phone held one-handed.
class LocationStep extends ConsumerStatefulWidget {
  const LocationStep({required this.draft, required this.onChanged, super.key});

  final ListingDraft draft;
  final ValueChanged<ListingDraft> onChanged;

  @override
  ConsumerState<LocationStep> createState() => _LocationStepState();
}

class _LocationStepState extends ConsumerState<LocationStep> {
  static const LocationService _location = LocationService();

  mb.MapboxMap? _map;
  double? _lat;
  double? _lng;
  bool _outsideIraq = false;

  @override
  void initState() {
    super.initState();
    _lat = widget.draft.lat;
    _lng = widget.draft.lng;
    if (_lat == null) _useCurrentLocation();
  }

  Future<void> _useCurrentLocation() async {
    final rivo.LatLng? position = await _location.currentPosition();
    if (position == null || !mounted) return;

    setState(() {
      _lat = position.lat;
      _lng = position.lng;
    });
    _commit();

    await _map?.flyTo(
      mb.CameraOptions(
        center: mb.Point(coordinates: mb.Position(position.lng, position.lat)),
        zoom: 16,
      ),
      mb.MapAnimationOptions(duration: 800),
    );
  }

  void _commit() {
    if (_lat == null || _lng == null) return;

    // The server rejects a pin outside Iraq, so it is caught here first with a
    // message the seller can act on.
    final bool inside = RivoGeo.isWithinIraqBounds(_lng!, _lat!);
    setState(() => _outsideIraq = !inside);
    if (!inside) return;

    widget.onChanged(widget.draft.copyWith(lat: _lat, lng: _lng));
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<Capabilities> caps = ref.watch(capabilitiesProvider);
    final String? token = caps.valueOrNull?.mapboxPublicToken;

    if (token == null || token.isEmpty) {
      return const FeatureUnavailableView(feature: 'تحديد الموقع على الخريطة');
    }
    mb.MapboxOptions.setAccessToken(token);

    return Column(
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text('حدّد موقع العقار', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 6),
              Text(
                'حرّك الخريطة حتى تصبح العلامة فوق موقع العقار بالضبط.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),

        Expanded(
          child: Stack(
            alignment: Alignment.center,
            children: <Widget>[
              mb.MapWidget(
                key: const ValueKey<String>('rivo-pin-map'),
                styleUri: caps.valueOrNull?.mapStyleDark ?? mb.MapboxStyles.DARK,
                viewport: mb.CameraViewportState(
                  center: mb.Point(
                    coordinates: mb.Position(
                      _lng ?? RivoGeo.defaultLng,
                      _lat ?? RivoGeo.defaultLat,
                    ),
                  ),
                  zoom: _lat == null ? RivoGeo.defaultZoom : 16,
                ),
                onMapCreated: (mb.MapboxMap map) async {
                  _map = map;
                  await map.scaleBar.updateSettings(mb.ScaleBarSettings(enabled: false));
                },
                onCameraChangeListener: (mb.CameraChangedEventData event) {
                  final mb.Point centre = event.cameraState.center;
                  _lat = centre.coordinates.lat.toDouble();
                  _lng = centre.coordinates.lng.toDouble();
                },
                // Committed on idle rather than on every frame: reverse geocoding
                // runs server-side and is billed per call.
                onMapIdleListener: (_) => _commit(),
              ),

              // Fixed centre marker, lifted so its point sits on the map centre.
              IgnorePointer(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 36),
                  child: Icon(
                    Icons.location_on_rounded,
                    size: 48,
                    color: _outsideIraq ? RivoColors.sandDim : RivoColors.signalRed,
                    shadows: const <Shadow>[Shadow(color: Colors.black54, blurRadius: 8)],
                  ),
                ),
              ),

              Positioned(
                bottom: 16,
                right: 16,
                child: FloatingActionButton.small(
                  heroTag: 'pin-locate',
                  backgroundColor: RivoColors.surface,
                  onPressed: _useCurrentLocation,
                  child: const Icon(Icons.my_location_rounded, color: RivoColors.white),
                ),
              ),

              if (_outsideIraq)
                Positioned(
                  top: 16,
                  left: 16,
                  right: 16,
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: RivoColors.signalRed.withValues(alpha: 0.95),
                      borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
                    ),
                    child: const Text(
                      'يجب أن يكون موقع العقار داخل العراق.',
                      style: TextStyle(color: Colors.white, fontSize: 13),
                    ),
                  ),
                ),
            ],
          ),
        ),

        if (_lat != null && _lng != null && !_outsideIraq)
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
            child: Row(
              children: <Widget>[
                const Icon(Icons.check_circle_rounded, size: 16, color: RivoColors.success),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'تم تحديد الموقع',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: RivoColors.success),
                  ),
                ),
                Text(
                  '${_lat!.toStringAsFixed(5)}, ${_lng!.toStringAsFixed(5)}',
                  textDirection: TextDirection.ltr,
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ],
            ),
          ),
      ],
    );
  }
}
