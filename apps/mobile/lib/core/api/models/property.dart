import '../../config/business_rules.dart';

/// Darcom listing models, mirroring `packages/contracts/src/property.ts`.
///
/// Prices are kept as strings end-to-end: an Iraqi dinar price of 250,000,000
/// exceeds a 32-bit int, and parsing into one would silently truncate it.
/// [priceValue] is provided for comparisons and returns a BigInt.

enum PropertyType { house, apartment, shop, building, land, commercial }

extension PropertyTypeX on PropertyType {
  String get wire => switch (this) {
        PropertyType.house => 'HOUSE',
        PropertyType.apartment => 'APARTMENT',
        PropertyType.shop => 'SHOP',
        PropertyType.building => 'BUILDING',
        PropertyType.land => 'LAND',
        PropertyType.commercial => 'COMMERCIAL',
      };

  String get labelAr => switch (this) {
        PropertyType.house => 'منزل',
        PropertyType.apartment => 'شقة',
        PropertyType.shop => 'محل',
        PropertyType.building => 'بناية',
        PropertyType.land => 'أرض',
        PropertyType.commercial => 'عقار تجاري',
      };

  /// Rooms are meaningless for land and shops, so those steps are skipped in the
  /// listing wizard rather than asking for a number nobody can give.
  bool get hasRooms => this == PropertyType.house || this == PropertyType.apartment;

  static PropertyType fromWire(String value) => PropertyType.values.firstWhere(
        (PropertyType t) => t.wire == value,
        orElse: () => PropertyType.house,
      );
}

enum ListingPurpose { sale, rent }

extension ListingPurposeX on ListingPurpose {
  String get wire => this == ListingPurpose.sale ? 'SALE' : 'RENT';
  String get labelAr => this == ListingPurpose.sale ? 'للبيع' : 'للإيجار';
  static ListingPurpose fromWire(String value) =>
      value == 'RENT' ? ListingPurpose.rent : ListingPurpose.sale;
}

enum PropertyStatus {
  draft,
  awaitingPayment,
  pendingReview,
  changesRequested,
  rejected,
  published,
  archived,
  sold,
  rented,
}

extension PropertyStatusX on PropertyStatus {
  static PropertyStatus fromWire(String value) => switch (value) {
        'DRAFT' => PropertyStatus.draft,
        'AWAITING_PAYMENT' => PropertyStatus.awaitingPayment,
        'PENDING_REVIEW' => PropertyStatus.pendingReview,
        'CHANGES_REQUESTED' => PropertyStatus.changesRequested,
        'REJECTED' => PropertyStatus.rejected,
        'PUBLISHED' => PropertyStatus.published,
        'ARCHIVED' => PropertyStatus.archived,
        'SOLD' => PropertyStatus.sold,
        'RENTED' => PropertyStatus.rented,
        _ => PropertyStatus.draft,
      };

  String get labelAr => switch (this) {
        PropertyStatus.draft => 'مسودة',
        PropertyStatus.awaitingPayment => 'بانتظار الدفع',
        PropertyStatus.pendingReview => 'قيد المراجعة',
        PropertyStatus.changesRequested => 'مطلوب تعديل',
        PropertyStatus.rejected => 'مرفوض',
        PropertyStatus.published => 'منشور',
        PropertyStatus.archived => 'مؤرشف',
        PropertyStatus.sold => 'مُباع',
        PropertyStatus.rented => 'مؤجَّر',
      };

  bool get isEditable =>
      this == PropertyStatus.draft ||
      this == PropertyStatus.changesRequested ||
      this == PropertyStatus.rejected;
}

class PropertyListItem {
  const PropertyListItem({
    required this.id,
    required this.reference,
    required this.type,
    required this.purpose,
    required this.title,
    required this.priceIqd,
    required this.areaSqm,
    required this.governorate,
    required this.isVerified,
    required this.isDemo,
    required this.photoCount,
    required this.hasReel,
    required this.isFavorited,
    required this.lat,
    required this.lng,
    this.rentPeriod,
    this.bedrooms,
    this.bathrooms,
    this.city,
    this.district,
    this.distanceM,
    this.coverUrl,
    this.publishedAt,
  });

  final String id;
  final String reference;
  final PropertyType type;
  final ListingPurpose purpose;
  final String title;
  final String priceIqd;
  final String? rentPeriod;
  final String areaSqm;
  final int? bedrooms;
  final int? bathrooms;
  final String governorate;
  final String? city;
  final String? district;
  final bool isVerified;

  /// True only for seeded sample content. The UI must label it (Master Plan §5).
  final bool isDemo;

  final int photoCount;
  final bool hasReel;
  final bool isFavorited;
  final double lat;
  final double lng;
  final int? distanceM;
  final String? coverUrl;
  final DateTime? publishedAt;

  BigInt get priceValue => BigInt.tryParse(priceIqd) ?? BigInt.zero;

  factory PropertyListItem.fromJson(Map<String, dynamic> json) => PropertyListItem(
        id: json['id'] as String,
        reference: json['reference'] as String,
        type: PropertyTypeX.fromWire(json['type'] as String),
        purpose: ListingPurposeX.fromWire(json['purpose'] as String),
        title: json['title'] as String,
        priceIqd: json['priceIqd'].toString(),
        rentPeriod: json['rentPeriod'] as String?,
        areaSqm: json['areaSqm'].toString(),
        bedrooms: json['bedrooms'] as int?,
        bathrooms: json['bathrooms'] as int?,
        governorate: json['governorate'] as String,
        city: json['city'] as String?,
        district: json['district'] as String?,
        isVerified: json['isVerified'] as bool? ?? false,
        isDemo: json['isDemo'] as bool? ?? false,
        photoCount: json['photoCount'] as int? ?? 0,
        hasReel: json['hasReel'] as bool? ?? false,
        isFavorited: json['isFavorited'] as bool? ?? false,
        lat: (json['lat'] as num).toDouble(),
        lng: (json['lng'] as num).toDouble(),
        distanceM: json['distanceM'] as int?,
        coverUrl: json['coverUrl'] as String?,
        publishedAt: json['publishedAt'] == null ? null : DateTime.tryParse(json['publishedAt'] as String),
      );

  PropertyListItem copyWith({bool? isFavorited}) => PropertyListItem(
        id: id,
        reference: reference,
        type: type,
        purpose: purpose,
        title: title,
        priceIqd: priceIqd,
        rentPeriod: rentPeriod,
        areaSqm: areaSqm,
        bedrooms: bedrooms,
        bathrooms: bathrooms,
        governorate: governorate,
        city: city,
        district: district,
        isVerified: isVerified,
        isDemo: isDemo,
        photoCount: photoCount,
        hasReel: hasReel,
        isFavorited: isFavorited ?? this.isFavorited,
        lat: lat,
        lng: lng,
        distanceM: distanceM,
        coverUrl: coverUrl,
        publishedAt: publishedAt,
      );
}

class PropertyLocation {
  const PropertyLocation({
    required this.lat,
    required this.lng,
    required this.precision,
    required this.approxRadiusM,
    this.placeLabel,
  });

  final double lat;
  final double lng;

  /// EXACT or APPROXIMATE. When approximate, render a circle of
  /// [approxRadiusM] rather than a precise pin — showing a sharp marker for a
  /// deliberately fuzzy location would mislead the user.
  final String precision;
  final int approxRadiusM;
  final String? placeLabel;

  bool get isApproximate => precision == 'APPROXIMATE';

  factory PropertyLocation.fromJson(Map<String, dynamic> json) => PropertyLocation(
        lat: (json['lat'] as num).toDouble(),
        lng: (json['lng'] as num).toDouble(),
        precision: json['precision'] as String? ?? 'EXACT',
        approxRadiusM: json['approxRadiusM'] as int? ?? 0,
        placeLabel: json['placeLabel'] as String?,
      );
}

class PropertyPhoto {
  const PropertyPhoto({
    required this.id,
    required this.kind,
    required this.position,
    required this.isCover,
    this.url,
    this.width,
    this.height,
  });

  final String id;
  final String kind;
  final int position;
  final bool isCover;
  final String? url;
  final int? width;
  final int? height;

  factory PropertyPhoto.fromJson(Map<String, dynamic> json) => PropertyPhoto(
        id: json['id'] as String,
        kind: json['kind'] as String? ?? 'ORIGINAL',
        position: json['position'] as int? ?? 0,
        isCover: json['isCover'] as bool? ?? false,
        url: json['url'] as String?,
        width: json['width'] as int?,
        height: json['height'] as int?,
      );
}

class PropertySeller {
  const PropertySeller({
    required this.id,
    required this.sellerType,
    required this.isVerified,
    this.displayName,
    this.officeName,
  });

  final String id;
  final String sellerType;

  /// Rendered as a badge only when true — Master Plan §8.
  final bool isVerified;
  final String? displayName;
  final String? officeName;

  factory PropertySeller.fromJson(Map<String, dynamic> json) => PropertySeller(
        id: json['id'] as String? ?? '',
        sellerType: json['sellerType'] as String? ?? 'INDIVIDUAL',
        isVerified: json['isVerified'] as bool? ?? false,
        displayName: json['displayName'] as String?,
        officeName: json['officeName'] as String?,
      );
}

class PropertyReel {
  const PropertyReel({
    required this.id,
    this.hlsUrl,
    this.thumbnailUrl,
    this.durationSeconds,
    this.width,
    this.height,
    this.caption,
  });

  final String id;
  final String? hlsUrl;
  final String? thumbnailUrl;
  final double? durationSeconds;
  final int? width;
  final int? height;
  final String? caption;

  factory PropertyReel.fromJson(Map<String, dynamic> json) => PropertyReel(
        id: json['id'] as String,
        hlsUrl: json['hlsUrl'] as String?,
        thumbnailUrl: json['thumbnailUrl'] as String?,
        durationSeconds: (json['durationSeconds'] as num?)?.toDouble(),
        width: json['width'] as int?,
        height: json['height'] as int?,
        caption: json['caption'] as String?,
      );
}

class PropertyDetail {
  const PropertyDetail({
    required this.id,
    required this.reference,
    required this.status,
    required this.type,
    required this.purpose,
    required this.title,
    required this.priceIqd,
    required this.areaSqm,
    required this.governorate,
    required this.seller,
    required this.photos,
    required this.isFavorited,
    required this.isDemo,
    required this.viewCount,
    required this.favoriteCount,
    this.description,
    this.rentPeriod,
    this.bedrooms,
    this.bathrooms,
    this.floors,
    this.floorNumber,
    this.yearBuilt,
    this.furnished,
    this.city,
    this.district,
    this.addressLine,
    this.location,
    this.contactPhone,
    this.contactPreference,
    this.reel,
    this.publishedAt,
    this.moderationReason,
  });

  final String id;
  final String reference;
  final PropertyStatus status;
  final PropertyType type;
  final ListingPurpose purpose;
  final String title;
  final String? description;
  final String priceIqd;
  final String? rentPeriod;
  final String areaSqm;
  final int? bedrooms;
  final int? bathrooms;
  final int? floors;
  final int? floorNumber;
  final int? yearBuilt;
  final bool? furnished;
  final String governorate;
  final String? city;
  final String? district;
  final String? addressLine;
  final PropertyLocation? location;
  final String? contactPhone;
  final String? contactPreference;
  final PropertySeller seller;
  final List<PropertyPhoto> photos;
  final PropertyReel? reel;
  final bool isFavorited;
  final bool isDemo;
  final int viewCount;
  final int favoriteCount;
  final DateTime? publishedAt;

  /// The reviewer's reason, present on REJECTED and CHANGES_REQUESTED. Shown to
  /// the seller verbatim — Master Plan §6 step 10.
  final String? moderationReason;

  BigInt get priceValue => BigInt.tryParse(priceIqd) ?? BigInt.zero;

  bool get canCall => contactPreference == 'CALL' || contactPreference == 'BOTH';
  bool get canWhatsapp => contactPreference == 'WHATSAPP' || contactPreference == 'BOTH';

  factory PropertyDetail.fromJson(Map<String, dynamic> json) {
    final Map<String, dynamic> contact =
        json['contact'] is Map ? Map<String, dynamic>.from(json['contact'] as Map) : <String, dynamic>{};
    final Map<String, dynamic> stats =
        json['stats'] is Map ? Map<String, dynamic>.from(json['stats'] as Map) : <String, dynamic>{};

    return PropertyDetail(
      id: json['id'] as String,
      reference: json['reference'] as String,
      status: PropertyStatusX.fromWire(json['status'] as String? ?? 'DRAFT'),
      type: PropertyTypeX.fromWire(json['type'] as String),
      purpose: ListingPurposeX.fromWire(json['purpose'] as String),
      title: json['title'] as String,
      description: json['description'] as String?,
      priceIqd: json['priceIqd'].toString(),
      rentPeriod: json['rentPeriod'] as String?,
      areaSqm: json['areaSqm'].toString(),
      bedrooms: json['bedrooms'] as int?,
      bathrooms: json['bathrooms'] as int?,
      floors: json['floors'] as int?,
      floorNumber: json['floorNumber'] as int?,
      yearBuilt: json['yearBuilt'] as int?,
      furnished: json['furnished'] as bool?,
      governorate: json['governorate'] as String,
      city: json['city'] as String?,
      district: json['district'] as String?,
      addressLine: json['addressLine'] as String?,
      location: json['location'] == null
          ? null
          : PropertyLocation.fromJson(Map<String, dynamic>.from(json['location'] as Map)),
      contactPhone: contact['phone'] as String?,
      contactPreference: contact['preference'] as String?,
      seller: PropertySeller.fromJson(
        json['seller'] is Map ? Map<String, dynamic>.from(json['seller'] as Map) : <String, dynamic>{},
      ),
      photos: (json['photos'] as List<dynamic>? ?? <dynamic>[])
          .map((dynamic p) => PropertyPhoto.fromJson(Map<String, dynamic>.from(p as Map)))
          .toList(),
      reel: json['reel'] == null
          ? null
          : PropertyReel.fromJson(Map<String, dynamic>.from(json['reel'] as Map)),
      isFavorited: json['isFavorited'] as bool? ?? false,
      isDemo: json['isDemo'] as bool? ?? false,
      viewCount: stats['viewCount'] as int? ?? 0,
      favoriteCount: stats['favoriteCount'] as int? ?? 0,
      publishedAt: json['publishedAt'] == null ? null : DateTime.tryParse(json['publishedAt'] as String),
      // The owner view nests it under `moderation`; the public view omits it.
      moderationReason: json['moderation'] is Map
          ? (json['moderation'] as Map)['reason'] as String?
          : json['moderationReason'] as String?,
    );
  }
}

/// What the seller still has to do before the listing can be submitted.
class PropertyRequirements {
  const PropertyRequirements({
    required this.photoCount,
    required this.photosSatisfied,
    required this.missingFields,
    required this.hasLocation,
  });

  final int photoCount;
  final bool photosSatisfied;
  final List<String> missingFields;
  final bool hasLocation;

  bool get isComplete => photosSatisfied && missingFields.isEmpty && hasLocation;

  int get photosStillNeeded =>
      photoCount < RivoRules.photoMin ? RivoRules.photoMin - photoCount : 0;

  factory PropertyRequirements.fromJson(Map<String, dynamic> json) {
    final Map<String, dynamic> photos = Map<String, dynamic>.from(json['photos'] as Map);
    return PropertyRequirements(
      photoCount: photos['current'] as int? ?? 0,
      photosSatisfied: photos['satisfied'] as bool? ?? false,
      missingFields: (json['missingFields'] as List<dynamic>? ?? <dynamic>[]).cast<String>(),
      hasLocation: json['hasLocation'] as bool? ?? false,
    );
  }
}
