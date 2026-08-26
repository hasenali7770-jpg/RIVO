import '../api_client.dart';
import '../models/property.dart';

/// Search filters — Master Plan §5 "Discovery".
class PropertyFilters {
  const PropertyFilters({
    this.query,
    this.types = const <PropertyType>{},
    this.purpose,
    this.minPrice,
    this.maxPrice,
    this.minArea,
    this.maxArea,
    this.minBedrooms,
    this.minBathrooms,
    this.governorate,
    this.district,
    this.verifiedOnly = false,
    this.sellerType,
    this.hasReel = false,
    this.sort = 'newest',
  });

  final String? query;
  final Set<PropertyType> types;
  final ListingPurpose? purpose;
  final String? minPrice;
  final String? maxPrice;
  final double? minArea;
  final double? maxArea;
  final int? minBedrooms;
  final int? minBathrooms;
  final String? governorate;
  final String? district;
  final bool verifiedOnly;
  final String? sellerType;
  final bool hasReel;
  final String sort;

  /// Whether anything narrower than the defaults is applied — used to decide
  /// whether to show the "clear filters" affordance.
  bool get isActive =>
      (query?.isNotEmpty ?? false) ||
      types.isNotEmpty ||
      purpose != null ||
      minPrice != null ||
      maxPrice != null ||
      minArea != null ||
      maxArea != null ||
      minBedrooms != null ||
      minBathrooms != null ||
      district != null ||
      verifiedOnly ||
      sellerType != null ||
      hasReel;

  int get activeCount => <bool>[
        query?.isNotEmpty ?? false,
        types.isNotEmpty,
        purpose != null,
        minPrice != null || maxPrice != null,
        minArea != null || maxArea != null,
        minBedrooms != null,
        minBathrooms != null,
        district != null,
        verifiedOnly,
        sellerType != null,
        hasReel,
      ].where((bool active) => active).length;

  Map<String, dynamic> toQuery() => <String, dynamic>{
        if (query != null && query!.isNotEmpty) 'q': query,
        if (types.isNotEmpty) 'type': types.map((PropertyType t) => t.wire).join(','),
        if (purpose != null) 'purpose': purpose!.wire,
        if (minPrice != null) 'minPrice': minPrice,
        if (maxPrice != null) 'maxPrice': maxPrice,
        if (minArea != null) 'minArea': minArea,
        if (maxArea != null) 'maxArea': maxArea,
        if (minBedrooms != null) 'minBedrooms': minBedrooms,
        if (minBathrooms != null) 'minBathrooms': minBathrooms,
        if (governorate != null) 'governorate': governorate,
        if (district != null) 'district': district,
        if (verifiedOnly) 'verifiedOnly': true,
        if (sellerType != null) 'sellerType': sellerType,
        if (hasReel) 'hasReel': true,
        'sort': sort,
      };

  PropertyFilters copyWith({
    String? query,
    Set<PropertyType>? types,
    ListingPurpose? purpose,
    String? minPrice,
    String? maxPrice,
    double? minArea,
    double? maxArea,
    int? minBedrooms,
    int? minBathrooms,
    String? governorate,
    String? district,
    bool? verifiedOnly,
    String? sellerType,
    bool? hasReel,
    String? sort,
    bool clearPurpose = false,
    bool clearPrice = false,
    bool clearArea = false,
    bool clearRooms = false,
  }) =>
      PropertyFilters(
        query: query ?? this.query,
        types: types ?? this.types,
        purpose: clearPurpose ? null : (purpose ?? this.purpose),
        minPrice: clearPrice ? null : (minPrice ?? this.minPrice),
        maxPrice: clearPrice ? null : (maxPrice ?? this.maxPrice),
        minArea: clearArea ? null : (minArea ?? this.minArea),
        maxArea: clearArea ? null : (maxArea ?? this.maxArea),
        minBedrooms: clearRooms ? null : (minBedrooms ?? this.minBedrooms),
        minBathrooms: clearRooms ? null : (minBathrooms ?? this.minBathrooms),
        governorate: governorate ?? this.governorate,
        district: district ?? this.district,
        verifiedOnly: verifiedOnly ?? this.verifiedOnly,
        sellerType: sellerType ?? this.sellerType,
        hasReel: hasReel ?? this.hasReel,
        sort: sort ?? this.sort,
      );
}

class PropertyPage {
  const PropertyPage({required this.items, required this.page, required this.totalPages, required this.total, required this.hasMore});

  final List<PropertyListItem> items;
  final int page;
  final int totalPages;
  final int total;
  final bool hasMore;

  factory PropertyPage.fromJson(Map<String, dynamic> json) {
    final Map<String, dynamic> pagination = Map<String, dynamic>.from(json['pagination'] as Map);
    return PropertyPage(
      items: (json['items'] as List<dynamic>)
          .map((dynamic i) => PropertyListItem.fromJson(Map<String, dynamic>.from(i as Map)))
          .toList(),
      page: pagination['page'] as int,
      totalPages: pagination['totalPages'] as int? ?? 1,
      total: pagination['total'] as int? ?? 0,
      hasMore: pagination['hasMore'] as bool? ?? false,
    );
  }
}

class MapPin {
  const MapPin({
    required this.id,
    required this.lat,
    required this.lng,
    required this.priceIqd,
    required this.purpose,
    required this.type,
    required this.isVerified,
  });

  final String id;
  final double lat;
  final double lng;
  final String priceIqd;
  final ListingPurpose purpose;
  final PropertyType type;
  final bool isVerified;

  factory MapPin.fromJson(Map<String, dynamic> json) => MapPin(
        id: json['id'] as String,
        lat: (json['lat'] as num).toDouble(),
        lng: (json['lng'] as num).toDouble(),
        priceIqd: json['priceIqd'].toString(),
        purpose: ListingPurposeX.fromWire(json['purpose'] as String),
        type: PropertyTypeX.fromWire(json['type'] as String),
        isVerified: json['isVerified'] as bool? ?? false,
      );
}

class PropertiesRepository {
  const PropertiesRepository(this._api);
  final ApiClient _api;

  Future<PropertyPage> search({
    required PropertyFilters filters,
    int page = 1,
    int limit = 20,
    double? lat,
    double? lng,
    int? radiusM,
  }) async {
    final Map<String, dynamic> query = <String, dynamic>{
      ...filters.toQuery(),
      'page': page,
      'limit': limit,
      if (lat != null) 'lat': lat,
      if (lng != null) 'lng': lng,
      if (radiusM != null) 'radiusM': radiusM,
    };
    final Map<String, dynamic> json = await _api.get<Map<String, dynamic>>('/properties', query: query);
    return PropertyPage.fromJson(json);
  }

  /// Trimmed payload for the map viewport — a full search result per pin would
  /// be many times larger over a mobile connection.
  Future<List<MapPin>> mapPins({
    required double minLng,
    required double minLat,
    required double maxLng,
    required double maxLat,
    PropertyFilters? filters,
  }) async {
    final Map<String, dynamic> json = await _api.get<Map<String, dynamic>>(
      '/properties/map',
      query: <String, dynamic>{
        'bbox': '$minLng,$minLat,$maxLng,$maxLat',
        ...?filters?.toQuery(),
      },
    );
    return (json['pins'] as List<dynamic>)
        .map((dynamic p) => MapPin.fromJson(Map<String, dynamic>.from(p as Map)))
        .toList();
  }

  Future<PropertyDetail> detail(String id) async {
    final Map<String, dynamic> json = await _api.get<Map<String, dynamic>>('/properties/$id');
    return PropertyDetail.fromJson(json);
  }

  Future<PropertyDetail> ownerView(String id) async {
    final Map<String, dynamic> json = await _api.get<Map<String, dynamic>>('/properties/$id/edit');
    return PropertyDetail.fromJson(json);
  }

  Future<PropertyRequirements> requirements(String id) async {
    final Map<String, dynamic> json = await _api.get<Map<String, dynamic>>('/properties/$id/edit');
    return PropertyRequirements.fromJson(Map<String, dynamic>.from(json['requirements'] as Map));
  }

  Future<PropertyPage> mine({String? status, int page = 1}) async {
    final Map<String, dynamic> json = await _api.get<Map<String, dynamic>>(
      '/properties/mine',
      query: <String, dynamic>{if (status != null) 'status': status, 'page': page},
    );
    return PropertyPage.fromJson(json);
  }

  Future<PropertyPage> favorites({int page = 1}) async {
    final Map<String, dynamic> json = await _api.get<Map<String, dynamic>>(
      '/properties/favorites',
      query: <String, dynamic>{'page': page},
    );
    return PropertyPage.fromJson(json);
  }

  Future<Map<String, dynamic>> create(Map<String, dynamic> body) =>
      _api.post<Map<String, dynamic>>('/properties', body: body);

  Future<Map<String, dynamic>> update(String id, Map<String, dynamic> body) =>
      _api.patch<Map<String, dynamic>>('/properties/$id', body: body);

  /// Submits for payment. Throws `PHOTO_COUNT_TOO_LOW` / `PHOTO_COUNT_TOO_HIGH`
  /// when the 8–18 rule is not met, which the wizard surfaces directly.
  Future<Map<String, dynamic>> submit(String id) =>
      _api.post<Map<String, dynamic>>('/properties/$id/submit');

  Future<void> favorite(String id) => _api.post<dynamic>('/properties/$id/favorite');
  Future<void> unfavorite(String id) => _api.delete<dynamic>('/properties/$id/favorite');

  Future<void> report(String id, {required String reason, String? note}) => _api.post<dynamic>(
        '/properties/$id/report',
        body: <String, dynamic>{'reason': reason, if (note != null) 'note': note},
      );

  Future<void> reorderMedia(String id, {required List<String> mediaIds, String? coverMediaId}) =>
      _api.post<dynamic>(
        '/properties/$id/media/reorder',
        body: <String, dynamic>{'mediaIds': mediaIds, if (coverMediaId != null) 'coverMediaId': coverMediaId},
      );
}
