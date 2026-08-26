/// Routing models, mirroring `packages/contracts/src/maps.ts`.
library;

class LatLng {
  const LatLng(this.lat, this.lng);
  final double lat;
  final double lng;

  Map<String, double> toJson() => <String, double>{'lat': lat, 'lng': lng};

  factory LatLng.fromJson(Map<String, dynamic> json) =>
      LatLng((json['lat'] as num).toDouble(), (json['lng'] as num).toDouble());

  @override
  String toString() => '$lat,$lng';
}

class RouteStep {
  const RouteStep({
    required this.instruction,
    required this.distanceM,
    required this.durationSeconds,
    required this.maneuverType,
    required this.location,
    this.maneuverModifier,
    this.name,
    this.exit,
  });

  final String instruction;
  final int distanceM;
  final int durationSeconds;

  /// Mapbox maneuver type: turn, merge, roundabout, fork, arrive, …
  final String maneuverType;
  final String? maneuverModifier;
  final LatLng location;
  final String? name;
  final int? exit;

  factory RouteStep.fromJson(Map<String, dynamic> json) => RouteStep(
        instruction: json['instruction'] as String,
        distanceM: json['distanceM'] as int,
        durationSeconds: json['durationSeconds'] as int,
        maneuverType: json['maneuverType'] as String,
        maneuverModifier: json['maneuverModifier'] as String?,
        location: LatLng.fromJson(Map<String, dynamic>.from(json['location'] as Map)),
        name: json['name'] as String?,
        exit: json['exit'] as int?,
      );
}

class RouteLeg {
  const RouteLeg({
    required this.distanceM,
    required this.durationSeconds,
    required this.durationInTrafficSeconds,
    required this.steps,
  });

  final int distanceM;
  final int durationSeconds;
  final int durationInTrafficSeconds;
  final List<RouteStep> steps;

  factory RouteLeg.fromJson(Map<String, dynamic> json) => RouteLeg(
        distanceM: json['distanceM'] as int,
        durationSeconds: json['durationSeconds'] as int,
        durationInTrafficSeconds: json['durationInTrafficSeconds'] as int,
        steps: (json['steps'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic s) => RouteStep.fromJson(Map<String, dynamic>.from(s as Map)))
            .toList(),
      );
}

class RivoRoute {
  const RivoRoute({
    required this.id,
    required this.distanceM,
    required this.durationSeconds,
    required this.durationInTrafficSeconds,
    required this.trafficDelaySeconds,
    required this.geometry,
    required this.legs,
    required this.isPrimary,
    this.congestion,
    this.incidents = const <RouteIncident>[],
  });

  final String id;
  final int distanceM;

  /// Free-flow duration, from the provider's historical baseline.
  final int durationSeconds;

  /// Duration accounting for current traffic. This is the ETA to display.
  final int durationInTrafficSeconds;

  /// durationInTraffic − duration: what congestion is costing on this route.
  final int trafficDelaySeconds;

  /// Encoded polyline, precision 6.
  final String geometry;

  final List<RouteLeg> legs;
  final bool isPrimary;

  /// Per-segment congestion classes, used to paint the route line.
  final List<String>? congestion;

  /// RIVO incident reports lying on this route.
  final List<RouteIncident> incidents;

  List<RouteStep> get allSteps => legs.expand((RouteLeg l) => l.steps).toList();

  /// Human ETA text in Arabic, e.g. "١ ساعة ١٥ دقيقة".
  String get etaLabelAr {
    final int minutes = (durationInTrafficSeconds / 60).round();
    if (minutes < 60) return '$minutes دقيقة';
    final int hours = minutes ~/ 60;
    final int rest = minutes % 60;
    return rest == 0 ? '$hours ساعة' : '$hours ساعة $rest دقيقة';
  }

  String get distanceLabelAr {
    if (distanceM < 1000) return '$distanceM م';
    return '${(distanceM / 1000).toStringAsFixed(1)} كم';
  }

  /// Only surfaced when the delay is material; a 40-second delay is noise.
  String? get delayLabelAr {
    if (trafficDelaySeconds < 60) return null;
    final int minutes = (trafficDelaySeconds / 60).round();
    return 'تأخير $minutes دقيقة بسبب الازدحام';
  }

  factory RivoRoute.fromJson(Map<String, dynamic> json, {List<RouteIncident> incidents = const <RouteIncident>[]}) =>
      RivoRoute(
        id: json['id'].toString(),
        distanceM: json['distanceM'] as int,
        durationSeconds: json['durationSeconds'] as int,
        durationInTrafficSeconds: json['durationInTrafficSeconds'] as int,
        trafficDelaySeconds: json['trafficDelaySeconds'] as int? ?? 0,
        geometry: json['geometry'] as String,
        legs: (json['legs'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic l) => RouteLeg.fromJson(Map<String, dynamic>.from(l as Map)))
            .toList(),
        isPrimary: json['isPrimary'] as bool? ?? false,
        congestion: (json['congestion'] as List<dynamic>?)?.cast<String>(),
        incidents: incidents,
      );
}

class RouteIncident {
  const RouteIncident({
    required this.id,
    required this.type,
    required this.lat,
    required this.lng,
    required this.distanceFromRouteM,
    this.note,
  });

  final String id;
  final String type;
  final double lat;
  final double lng;
  final int distanceFromRouteM;
  final String? note;

  factory RouteIncident.fromJson(Map<String, dynamic> json) => RouteIncident(
        id: json['id'] as String,
        type: json['type'] as String,
        lat: (json['lat'] as num).toDouble(),
        lng: (json['lng'] as num).toDouble(),
        distanceFromRouteM: json['distanceFromRouteM'] as int? ?? 0,
        note: json['note'] as String?,
      );
}

class RoutesResponse {
  const RoutesResponse({
    required this.requestId,
    required this.routes,
    required this.origin,
    required this.destination,
    this.destinationProperty,
  });

  /// Correlates this result with the feedback the app later posts back.
  final String requestId;
  final List<RivoRoute> routes;
  final LatLng origin;
  final LatLng destination;
  final DestinationProperty? destinationProperty;

  RivoRoute? get primary => routes.isEmpty ? null : routes.firstWhere(
        (RivoRoute r) => r.isPrimary,
        orElse: () => routes.first,
      );

  List<RivoRoute> get alternatives => routes.where((RivoRoute r) => !r.isPrimary).toList();

  factory RoutesResponse.fromJson(Map<String, dynamic> json) {
    // Incidents arrive alongside the routes keyed by route id; they are attached
    // to their route here so a screen never has to correlate them itself.
    final Map<String, List<RouteIncident>> byRoute = <String, List<RouteIncident>>{};
    for (final dynamic entry in json['incidentsOnRoute'] as List<dynamic>? ?? <dynamic>[]) {
      final Map<String, dynamic> map = Map<String, dynamic>.from(entry as Map);
      byRoute[map['routeId'].toString()] = (map['incidents'] as List<dynamic>? ?? <dynamic>[])
          .map((dynamic i) => RouteIncident.fromJson(Map<String, dynamic>.from(i as Map)))
          .toList();
    }

    return RoutesResponse(
      requestId: json['requestId'] as String,
      routes: (json['routes'] as List<dynamic>? ?? <dynamic>[]).map((dynamic r) {
        final Map<String, dynamic> map = Map<String, dynamic>.from(r as Map);
        return RivoRoute.fromJson(
          map,
          incidents: byRoute[map['id'].toString()] ?? const <RouteIncident>[],
        );
      }).toList(),
      origin: LatLng.fromJson(Map<String, dynamic>.from(json['origin'] as Map)),
      destination: LatLng.fromJson(Map<String, dynamic>.from(json['destination'] as Map)),
      destinationProperty: json['destinationProperty'] == null
          ? null
          : DestinationProperty.fromJson(Map<String, dynamic>.from(json['destinationProperty'] as Map)),
    );
  }
}

class DestinationProperty {
  const DestinationProperty({required this.id, required this.reference, required this.title});
  final String id;
  final String reference;
  final String title;

  factory DestinationProperty.fromJson(Map<String, dynamic> json) => DestinationProperty(
        id: json['id'] as String,
        reference: json['reference'] as String,
        title: json['title'] as String,
      );
}

class PlaceResult {
  const PlaceResult({
    required this.id,
    required this.name,
    required this.address,
    required this.lat,
    required this.lng,
    this.distanceM,
  });

  final String id;
  final String name;
  final String address;
  final double lat;
  final double lng;
  final int? distanceM;

  LatLng get position => LatLng(lat, lng);

  factory PlaceResult.fromJson(Map<String, dynamic> json) => PlaceResult(
        id: json['id'] as String,
        name: json['name'] as String,
        address: json['address'] as String,
        lat: (json['lat'] as num).toDouble(),
        lng: (json['lng'] as num).toDouble(),
        distanceM: json['distanceM'] as int?,
      );
}

/// The seven reportable road conditions — Master Plan §4.
enum IncidentType { accident, trafficJam, roadClosure, roadWorks, floodedRoad, pothole, hazard }

extension IncidentTypeX on IncidentType {
  String get wire => switch (this) {
        IncidentType.accident => 'ACCIDENT',
        IncidentType.trafficJam => 'TRAFFIC_JAM',
        IncidentType.roadClosure => 'ROAD_CLOSURE',
        IncidentType.roadWorks => 'ROAD_WORKS',
        IncidentType.floodedRoad => 'FLOODED_ROAD',
        IncidentType.pothole => 'POTHOLE',
        IncidentType.hazard => 'HAZARD',
      };

  String get labelAr => switch (this) {
        IncidentType.accident => 'حادث',
        IncidentType.trafficJam => 'ازدحام',
        IncidentType.roadClosure => 'إغلاق طريق',
        IncidentType.roadWorks => 'حفريات',
        IncidentType.floodedRoad => 'شارع مغمور',
        IncidentType.pothole => 'حفرة',
        IncidentType.hazard => 'خطر',
      };

  static IncidentType fromWire(String value) => IncidentType.values.firstWhere(
        (IncidentType t) => t.wire == value,
        orElse: () => IncidentType.hazard,
      );
}

class RoadIncident {
  const RoadIncident({
    required this.id,
    required this.type,
    required this.lat,
    required this.lng,
    required this.confidence,
    required this.confirmCount,
    required this.dismissCount,
    required this.expiresAt,
    required this.reportedAt,
    this.note,
    this.distanceM,
  });

  final String id;
  final IncidentType type;
  final double lat;
  final double lng;
  final double confidence;
  final int confirmCount;
  final int dismissCount;
  final DateTime expiresAt;
  final DateTime reportedAt;
  final String? note;
  final int? distanceM;

  factory RoadIncident.fromJson(Map<String, dynamic> json) => RoadIncident(
        id: json['id'] as String,
        type: IncidentTypeX.fromWire(json['type'] as String),
        lat: (json['lat'] as num).toDouble(),
        lng: (json['lng'] as num).toDouble(),
        confidence: (json['confidence'] as num?)?.toDouble() ?? 0.5,
        confirmCount: json['confirmCount'] as int? ?? 0,
        dismissCount: json['dismissCount'] as int? ?? 0,
        expiresAt: DateTime.parse(json['expiresAt'] as String),
        reportedAt: DateTime.parse(json['reportedAt'] as String),
        note: json['note'] as String?,
        distanceM: json['distanceM'] as int?,
      );
}
