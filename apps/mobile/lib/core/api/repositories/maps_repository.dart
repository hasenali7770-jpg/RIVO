import '../api_client.dart';
import '../models/route.dart';

class MapsRepository {
  const MapsRepository(this._api);
  final ApiClient _api;

  /// Destination search. Proxied through RIVO so the Mapbox secret token stays
  /// on the server (Master Plan §12).
  Future<List<PlaceResult>> search(String query, {LatLng? near, int limit = 8}) async {
    final Map<String, dynamic> json = await _api.get<Map<String, dynamic>>(
      '/maps/search',
      query: <String, dynamic>{
        'q': query,
        'limit': limit,
        if (near != null) 'lat': near.lat,
        if (near != null) 'lng': near.lng,
      },
    );
    return (json['results'] as List<dynamic>)
        .map((dynamic r) => PlaceResult.fromJson(Map<String, dynamic>.from(r as Map)))
        .toList();
  }

  /// Traffic-aware route with alternatives.
  ///
  /// [originBearing] is passed while navigating so a reroute does not open with
  /// an immediate U-turn instruction.
  Future<RoutesResponse> route({
    required LatLng origin,
    required LatLng destination,
    List<LatLng> waypoints = const <LatLng>[],
    bool alternatives = true,
    double? originBearing,
    List<String> avoid = const <String>[],
  }) async {
    final Map<String, dynamic> json = await _api.post<Map<String, dynamic>>(
      '/maps/routes',
      body: <String, dynamic>{
        'origin': origin.toJson(),
        'destination': destination.toJson(),
        if (waypoints.isNotEmpty) 'waypoints': waypoints.map((LatLng w) => w.toJson()).toList(),
        'alternatives': alternatives,
        if (originBearing != null) 'originBearing': originBearing.round(),
        if (avoid.isNotEmpty) 'avoid': avoid,
      },
    );
    return RoutesResponse.fromJson(json);
  }

  /// `اذهب إلى العقار` — routes to a listing by id, using the coordinate the
  /// map actually shows for it (Master Plan §5).
  Future<RoutesResponse> routeToProperty({
    required LatLng origin,
    required String propertyId,
    bool alternatives = true,
  }) async {
    final Map<String, dynamic> json = await _api.post<Map<String, dynamic>>(
      '/maps/routes',
      body: <String, dynamic>{
        'origin': origin.toJson(),
        // The server overrides this with the listing's published coordinates;
        // it is sent because the endpoint requires a destination shape.
        'destination': origin.toJson(),
        'propertyId': propertyId,
        'alternatives': alternatives,
      },
    );
    return RoutesResponse.fromJson(json);
  }

  Future<Map<String, dynamic>> propertyDestination(String propertyId) =>
      _api.get<Map<String, dynamic>>('/maps/property/$propertyId/destination');

  /// Reports how the trip actually went, which calibrates future ETAs.
  Future<void> submitRouteFeedback({
    required String routeRequestId,
    required LatLng origin,
    required LatLng destination,
    required int predictedSeconds,
    required String outcome,
    int? actualSeconds,
    int? distanceM,
    int rerouteCount = 0,
    int? rating,
    String? comment,
  }) =>
      _api.post<dynamic>(
        '/maps/route-feedback',
        body: <String, dynamic>{
          'routeRequestId': routeRequestId,
          'origin': origin.toJson(),
          'destination': destination.toJson(),
          'predictedSeconds': predictedSeconds,
          'outcome': outcome,
          if (actualSeconds != null) 'actualSeconds': actualSeconds,
          if (distanceM != null) 'distanceM': distanceM,
          'rerouteCount': rerouteCount,
          if (rating != null) 'rating': rating,
          if (comment != null) 'comment': comment,
        },
      );
}

class TrafficRepository {
  const TrafficRepository(this._api);
  final ApiClient _api;

  Future<List<RoadIncident>> incidentsInView({
    required double minLng,
    required double minLat,
    required double maxLng,
    required double maxLat,
    List<IncidentType> types = const <IncidentType>[],
  }) async {
    final Map<String, dynamic> json = await _api.get<Map<String, dynamic>>(
      '/traffic/incidents',
      query: <String, dynamic>{
        'bbox': '$minLng,$minLat,$maxLng,$maxLat',
        if (types.isNotEmpty) 'type': types.map((IncidentType t) => t.wire).toList(),
      },
    );
    return (json['incidents'] as List<dynamic>)
        .map((dynamic i) => RoadIncident.fromJson(Map<String, dynamic>.from(i as Map)))
        .toList();
  }

  Future<List<RoadIncident>> incidentsNear(LatLng point, {int radiusM = 5000}) async {
    final Map<String, dynamic> json = await _api.get<Map<String, dynamic>>(
      '/traffic/incidents',
      query: <String, dynamic>{'lat': point.lat, 'lng': point.lng, 'radiusM': radiusM},
    );
    return (json['incidents'] as List<dynamic>)
        .map((dynamic i) => RoadIncident.fromJson(Map<String, dynamic>.from(i as Map)))
        .toList();
  }

  Future<RoadIncident> report({
    required IncidentType type,
    required LatLng at,
    double? headingDeg,
    String? note,
  }) async {
    final Map<String, dynamic> json = await _api.post<Map<String, dynamic>>(
      '/traffic/incidents',
      body: <String, dynamic>{
        'type': type.wire,
        'lat': at.lat,
        'lng': at.lng,
        if (headingDeg != null) 'headingDeg': headingDeg.round() % 360,
        if (note != null && note.isNotEmpty) 'note': note,
      },
    );
    return RoadIncident.fromJson(json);
  }

  Future<void> confirm(String incidentId, {required bool stillThere, LatLng? from}) => _api.post<dynamic>(
        '/traffic/incidents/$incidentId/confirm',
        body: <String, dynamic>{
          'confirmed': stillThere,
          if (from != null) 'lat': from.lat,
          if (from != null) 'lng': from.lng,
        },
      );

  /// Uploads consented, anonymous speed samples.
  ///
  /// [sessionKey] is a rotating pseudonymous id generated by the client, never a
  /// device or account identifier — Master Plan §4.
  Future<Map<String, dynamic>> uploadTelemetry({
    required String sessionKey,
    required List<Map<String, dynamic>> samples,
  }) =>
      _api.post<Map<String, dynamic>>(
        '/traffic/telemetry/batch',
        body: <String, dynamic>{'sessionKey': sessionKey, 'consent': true, 'samples': samples},
      );
}
