import 'dart:io';

import 'package:http/http.dart' as http;

import '../../config/business_rules.dart';
import '../api_client.dart';
import '../api_exception.dart';

class ReelUploadTicket {
  const ReelUploadTicket({required this.videoId, required this.uploadUrl, required this.streamUid});
  final String videoId;
  final String uploadUrl;
  final String streamUid;

  factory ReelUploadTicket.fromJson(Map<String, dynamic> json) => ReelUploadTicket(
        videoId: json['videoId'] as String,
        uploadUrl: json['uploadUrl'] as String,
        streamUid: json['streamUid'] as String,
      );
}

class ReelStatus {
  const ReelStatus({
    required this.id,
    required this.status,
    this.width,
    this.height,
    this.shortEdge,
    this.durationSeconds,
    this.thumbnailUrl,
    this.hlsUrl,
    this.validationError,
  });

  final String id;
  final String status;
  final int? width;
  final int? height;

  /// Server-measured shortest edge. The 1080p rule is enforced against this,
  /// never against what the phone reported.
  final int? shortEdge;
  final double? durationSeconds;
  final String? thumbnailUrl;
  final String? hlsUrl;
  final String? validationError;

  bool get isReady => status == 'READY';
  bool get isProcessing => status == 'PROCESSING' || status == 'UPLOADED';
  bool get isRejected => status == 'VALIDATION_FAILED' || status == 'REJECTED';

  factory ReelStatus.fromJson(Map<String, dynamic> json) => ReelStatus(
        id: json['id'] as String,
        status: json['status'] as String,
        width: json['width'] as int?,
        height: json['height'] as int?,
        shortEdge: json['shortEdge'] as int?,
        durationSeconds: (json['durationSeconds'] as num?)?.toDouble(),
        thumbnailUrl: json['thumbnailUrl'] as String?,
        hlsUrl: json['playbackHlsUrl'] as String?,
        validationError: json['validationError'] as String?,
      );
}

class ReelsRepository {
  const ReelsRepository(this._api);
  final ApiClient _api;

  Future<Map<String, dynamic>> feed({
    double? lat,
    double? lng,
    String? purpose,
    String? governorate,
    int page = 1,
    int limit = 10,
  }) =>
      _api.get<Map<String, dynamic>>(
        '/reels/feed',
        query: <String, dynamic>{
          if (lat != null) 'lat': lat,
          if (lng != null) 'lng': lng,
          if (purpose != null) 'purpose': purpose,
          if (governorate != null) 'governorate': governorate,
          'page': page,
          'limit': limit,
        },
      );

  /// Uploads a reel to Cloudflare Stream.
  ///
  /// The local checks here are a courtesy — they stop a user burning mobile data
  /// on a file the server will reject. The binding rule is server-side: after
  /// encoding, Cloudflare's own measurement decides, so a 720p file is refused
  /// even if the device claimed otherwise (Master Plan §6 step 7).
  Future<ReelUploadTicket> upload({
    required String propertyId,
    required File video,
    required int width,
    required int height,
    required double durationSeconds,
    void Function(double)? onProgress,
  }) async {
    final int shortEdge = width < height ? width : height;
    if (shortEdge < RivoRules.reelMinShortEdge) {
      throw ApiException(
        code: 'REEL_RESOLUTION_TOO_LOW',
        message: 'Video is ${width}x$height; shortest edge $shortEdge is below ${RivoRules.reelMinShortEdge}',
        messageAr:
            'دقة الفيديو $width×$height غير كافية. الحد الأدنى ${RivoRules.reelMinShortEdge}p (أقصر ضلع).',
      );
    }
    if (durationSeconds < RivoRules.reelMinDurationSeconds ||
        durationSeconds > RivoRules.reelMaxDurationSeconds) {
      throw ApiException(
        code: 'REEL_DURATION_INVALID',
        message: 'Duration ${durationSeconds.round()}s is outside the allowed range',
        messageAr:
            'مدة الفيديو يجب أن تكون بين ${RivoRules.reelMinDurationSeconds} و ${RivoRules.reelMaxDurationSeconds} ثانية.',
      );
    }

    final int size = await video.length();
    if (size > RivoRules.reelMaxBytes) {
      throw const ApiException(
        code: 'REEL_TOO_LARGE',
        message: 'Video exceeds the size limit',
        messageAr: 'حجم الفيديو كبير جداً.',
      );
    }

    final Map<String, dynamic> ticketJson = await _api.post<Map<String, dynamic>>(
      '/reels/upload',
      body: <String, String>{'propertyId': propertyId},
    );
    final ReelUploadTicket ticket = ReelUploadTicket.fromJson(ticketJson);

    // Cloudflare's direct creator upload takes a multipart POST, so the file
    // goes phone → Cloudflare and never through the RIVO API.
    final http.MultipartRequest request = http.MultipartRequest('POST', Uri.parse(ticket.uploadUrl))
      ..files.add(await http.MultipartFile.fromPath('file', video.path));

    final http.StreamedResponse response = await request.send();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(
        code: 'UPLOAD_FAILED',
        message: 'Cloudflare Stream rejected the upload (HTTP ${response.statusCode})',
        messageAr: 'تعذّر رفع الفيديو. تحقق من الاتصال وحاول مرة أخرى.',
      );
    }
    onProgress?.call(1);

    await _api.post<dynamic>('/reels/${ticket.videoId}/uploaded', body: <String, dynamic>{});
    return ticket;
  }

  Future<ReelStatus> status(String videoId) async {
    final Map<String, dynamic> json = await _api.get<Map<String, dynamic>>('/reels/$videoId/status');
    return ReelStatus.fromJson(json);
  }

  /// Polls until validation resolves. Encoding a 90-second reel takes time, and
  /// the server measures it only once Cloudflare finishes.
  Stream<ReelStatus> watch(String videoId, {Duration interval = const Duration(seconds: 5)}) async* {
    for (int attempt = 0; attempt < 60; attempt += 1) {
      final ReelStatus current = await status(videoId);
      yield current;
      if (current.isReady || current.isRejected) return;
      await Future<void>.delayed(interval);
    }
  }

  Future<void> setCaption(String videoId, String caption) =>
      _api.patch<dynamic>('/reels/$videoId/caption', body: <String, String>{'caption': caption});

  Future<void> setCover(String videoId, double seconds) =>
      _api.post<dynamic>('/reels/$videoId/cover', body: <String, double>{'seconds': seconds});

  Future<void> delete(String videoId) => _api.delete<dynamic>('/reels/$videoId');

  Future<void> recordView(String videoId, {required double watchedSeconds, required double completion}) =>
      _api.post<dynamic>(
        '/reels/$videoId/view-event',
        body: <String, dynamic>{
          'watchedSeconds': watchedSeconds,
          // Clamped again on the server, so a client cannot inflate its ranking.
          'completion': completion.clamp(0.0, 1.0),
        },
      );
}

class PaymentsRepository {
  const PaymentsRepository(this._api);
  final ApiClient _api;

  /// Creates the listing-fee payment. The amount is decided by the server and
  /// is always 3,000 IQD — it is never sent from here.
  Future<Map<String, dynamic>> createListingPayment(String propertyId) =>
      _api.post<Map<String, dynamic>>(
        '/payments/listing/create',
        body: <String, String>{'propertyId': propertyId},
      );

  /// The authoritative payment state, set by the verified gateway webhook.
  ///
  /// The app must poll this after returning from the gateway and must never
  /// treat its own return screen as proof of payment (Master Plan §6 step 9).
  Future<Map<String, dynamic>> status(String paymentId) =>
      _api.get<Map<String, dynamic>>('/payments/$paymentId/status');

  Future<Map<String, dynamic>> mine({int page = 1}) =>
      _api.get<Map<String, dynamic>>('/payments/mine', query: <String, dynamic>{'page': page});
}
