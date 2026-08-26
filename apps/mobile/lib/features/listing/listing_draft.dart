import 'dart:io';

import '../../core/api/models/property.dart';
import '../../core/config/business_rules.dart';

/// In-progress listing state, held while the seller works through the wizard.
///
/// The steps mirror Master Plan §6 exactly. Nothing here is authoritative: the
/// server re-validates every field, and the photo rule is enforced there and in
/// the database.
class ListingDraft {
  const ListingDraft({
    this.propertyId,
    this.type,
    this.purpose,
    this.rentPeriod = 'MONTHLY',
    this.lat,
    this.lng,
    this.placeLabel,
    this.title = '',
    this.description = '',
    this.priceIqd = '',
    this.areaSqm,
    this.bedrooms,
    this.bathrooms,
    this.floors,
    this.floorNumber,
    this.yearBuilt,
    this.furnished,
    this.governorate = 'BAGHDAD',
    this.city = 'بغداد',
    this.district = '',
    this.addressLine = '',
    this.contactPreference = 'BOTH',
    this.contactPhone = '',
    this.localPhotos = const <File>[],
    this.uploadedPhotoCount = 0,
    this.reelFile,
    this.reelVideoId,
  });

  /// Set once the draft has been created on the server.
  final String? propertyId;

  // Step 2 — type and purpose
  final PropertyType? type;
  final ListingPurpose? purpose;
  final String rentPeriod;

  // Step 3 — location
  final double? lat;
  final double? lng;
  final String? placeLabel;

  // Step 4 — details
  final String title;
  final String description;
  final String priceIqd;
  final double? areaSqm;
  final int? bedrooms;
  final int? bathrooms;
  final int? floors;
  final int? floorNumber;
  final int? yearBuilt;
  final bool? furnished;
  final String governorate;
  final String city;
  final String district;
  final String addressLine;
  final String contactPreference;
  final String contactPhone;

  // Step 5 — photos
  final List<File> localPhotos;
  final int uploadedPhotoCount;

  // Step 7 — optional reel
  final File? reelFile;
  final String? reelVideoId;

  int get photoCount => uploadedPhotoCount > 0 ? uploadedPhotoCount : localPhotos.length;

  bool get typeAndPurposeComplete => type != null && purpose != null;
  bool get locationComplete => lat != null && lng != null;

  /// Mirrors the server's own completeness check so the wizard can point at the
  /// missing field rather than surfacing a rejection after submission.
  List<String> get missingDetailFields {
    final List<String> missing = <String>[];
    if (title.trim().length < 8) missing.add('عنوان الإعلان (٨ أحرف على الأقل)');
    if (description.trim().length < 20) missing.add('وصف العقار (٢٠ حرفاً على الأقل)');
    if (BigInt.tryParse(priceIqd.replaceAll(RegExp(r'\D'), '')) == null ||
        BigInt.parse(priceIqd.replaceAll(RegExp(r'\D'), '').isEmpty
                ? '0'
                : priceIqd.replaceAll(RegExp(r'\D'), ''),) <=
            BigInt.zero) {
      missing.add('السعر');
    }
    if (areaSqm == null || areaSqm! <= 0) missing.add('المساحة');
    if (contactPhone.trim().isEmpty) missing.add('رقم التواصل');

    // Rooms are only meaningful for dwellings; asking for them on land or a
    // shop would be a question with no answer.
    if (type != null && type!.hasRooms) {
      if (bedrooms == null) missing.add('عدد غرف النوم');
      if (bathrooms == null) missing.add('عدد الحمامات');
    }
    return missing;
  }

  bool get detailsComplete => missingDetailFields.isEmpty;

  bool get photosComplete =>
      photoCount >= RivoRules.photoMin && photoCount <= RivoRules.photoMax;

  int get photosStillNeeded =>
      photoCount < RivoRules.photoMin ? RivoRules.photoMin - photoCount : 0;

  int get photosRemainingCapacity =>
      photoCount >= RivoRules.photoMax ? 0 : RivoRules.photoMax - photoCount;

  bool get readyToSubmit =>
      typeAndPurposeComplete && locationComplete && detailsComplete && photosComplete;

  Map<String, dynamic> toCreatePayload() => <String, dynamic>{
        'type': type!.wire,
        'purpose': purpose!.wire,
        'title': title.trim(),
        'description': description.trim(),
        'priceIqd': priceIqd.replaceAll(RegExp(r'\D'), ''),
        if (purpose == ListingPurpose.rent) 'rentPeriod': rentPeriod,
        'areaSqm': areaSqm,
        if (bedrooms != null) 'bedrooms': bedrooms,
        if (bathrooms != null) 'bathrooms': bathrooms,
        if (floors != null) 'floors': floors,
        if (floorNumber != null) 'floorNumber': floorNumber,
        if (yearBuilt != null) 'yearBuilt': yearBuilt,
        if (furnished != null) 'furnished': furnished,
        'governorate': governorate,
        if (city.trim().isNotEmpty) 'city': city.trim(),
        if (district.trim().isNotEmpty) 'district': district.trim(),
        if (addressLine.trim().isNotEmpty) 'addressLine': addressLine.trim(),
        'lat': lat,
        'lng': lng,
        'contactPreference': contactPreference,
        if (contactPhone.trim().isNotEmpty) 'contactPhone': contactPhone.trim(),
      };

  ListingDraft copyWith({
    String? propertyId,
    PropertyType? type,
    ListingPurpose? purpose,
    String? rentPeriod,
    double? lat,
    double? lng,
    String? placeLabel,
    String? title,
    String? description,
    String? priceIqd,
    double? areaSqm,
    int? bedrooms,
    int? bathrooms,
    int? floors,
    int? floorNumber,
    int? yearBuilt,
    bool? furnished,
    String? governorate,
    String? city,
    String? district,
    String? addressLine,
    String? contactPreference,
    String? contactPhone,
    List<File>? localPhotos,
    int? uploadedPhotoCount,
    File? reelFile,
    String? reelVideoId,
    bool clearReel = false,
  }) =>
      ListingDraft(
        propertyId: propertyId ?? this.propertyId,
        type: type ?? this.type,
        purpose: purpose ?? this.purpose,
        rentPeriod: rentPeriod ?? this.rentPeriod,
        lat: lat ?? this.lat,
        lng: lng ?? this.lng,
        placeLabel: placeLabel ?? this.placeLabel,
        title: title ?? this.title,
        description: description ?? this.description,
        priceIqd: priceIqd ?? this.priceIqd,
        areaSqm: areaSqm ?? this.areaSqm,
        bedrooms: bedrooms ?? this.bedrooms,
        bathrooms: bathrooms ?? this.bathrooms,
        floors: floors ?? this.floors,
        floorNumber: floorNumber ?? this.floorNumber,
        yearBuilt: yearBuilt ?? this.yearBuilt,
        furnished: furnished ?? this.furnished,
        governorate: governorate ?? this.governorate,
        city: city ?? this.city,
        district: district ?? this.district,
        addressLine: addressLine ?? this.addressLine,
        contactPreference: contactPreference ?? this.contactPreference,
        contactPhone: contactPhone ?? this.contactPhone,
        localPhotos: localPhotos ?? this.localPhotos,
        uploadedPhotoCount: uploadedPhotoCount ?? this.uploadedPhotoCount,
        reelFile: clearReel ? null : (reelFile ?? this.reelFile),
        reelVideoId: clearReel ? null : (reelVideoId ?? this.reelVideoId),
      );
}

/// The ten steps of Master Plan §6.
enum ListingStep {
  typeAndPurpose,
  location,
  details,
  photos,
  enhancement,
  reel,
  preview,
  payment,
  submitted,
}

extension ListingStepX on ListingStep {
  String get titleAr => switch (this) {
        ListingStep.typeAndPurpose => 'نوع العقار والغرض',
        ListingStep.location => 'موقع العقار',
        ListingStep.details => 'تفاصيل العقار',
        ListingStep.photos => 'صور العقار',
        ListingStep.enhancement => 'تحسين الصور',
        ListingStep.reel => 'ريل العقار (اختياري)',
        ListingStep.preview => 'معاينة الإعلان',
        ListingStep.payment => 'رسوم النشر',
        ListingStep.submitted => 'تم الإرسال',
      };

  int get displayNumber => index + 1;
}
