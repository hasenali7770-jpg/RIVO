import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../../config/business_rules.dart';
import '../api_client.dart';
import '../api_exception.dart';

class PresignedUpload {
  const PresignedUpload({
    required this.mediaId,
    required this.uploadUrl,
    required this.objectKey,
    required this.requiredHeaders,
  });

  final String mediaId;
  final String uploadUrl;
  final String objectKey;
  final Map<String, String> requiredHeaders;

  factory PresignedUpload.fromJson(Map<String, dynamic> json) => PresignedUpload(
        mediaId: json['mediaId'] as String,
        uploadUrl: json['uploadUrl'] as String,
        objectKey: json['objectKey'] as String,
        requiredHeaders: Map<String, String>.from(json['requiredHeaders'] as Map),
      );
}

class UploadProgress {
  const UploadProgress({required this.completed, required this.total, this.currentFile});
  final int completed;
  final int total;
  final String? currentFile;

  double get fraction => total == 0 ? 0 : completed / total;
}

class MediaRepository {
  const MediaRepository(this._api);
  final ApiClient _api;

  /// Uploads property photos straight to Cloudflare R2.
  ///
  /// The bytes never pass through the RIVO API: the server issues a presigned
  /// PUT, the device uploads to R2, and the server then verifies the object
  /// exists before it counts toward the 8-photo minimum. That verification is
  /// why a failed upload cannot be passed off as a successful one.
  Future<List<String>> uploadPhotos({
    required String propertyId,
    required List<File> files,
    void Function(UploadProgress)? onProgress,
  }) async {
    if (files.isEmpty) return <String>[];

    // Checked locally first so an over-limit selection fails instantly instead
    // of after the user has waited for an upload.
    if (files.length > RivoRules.photoMax) {
      throw const ApiException(
        code: 'PHOTO_COUNT_TOO_HIGH',
        message: 'Too many photos selected',
        messageAr: 'الحد الأعلى ${RivoRules.photoMax} صورة.',
      );
    }

    final List<Map<String, dynamic>> descriptors = <Map<String, dynamic>>[];
    for (final File file in files) {
      final int length = await file.length();
      if (length > RivoRules.photoMaxBytes) {
        throw const ApiException(
          code: 'PHOTO_TOO_LARGE',
          message: 'Photo exceeds the size limit',
          messageAr: 'حجم إحدى الصور يتجاوز ${RivoRules.photoMaxBytes ~/ (1024 * 1024)} ميغابايت.',
        );
      }
      descriptors.add(<String, dynamic>{
        'contentType': _mimeFor(file.path),
        'contentLength': length,
      });
    }

    final Map<String, dynamic> presignResponse = await _api.post<Map<String, dynamic>>(
      '/uploads/images/presign',
      body: <String, dynamic>{'propertyId': propertyId, 'files': descriptors},
    );

    final List<PresignedUpload> uploads = (presignResponse['uploads'] as List<dynamic>)
        .map((dynamic u) => PresignedUpload.fromJson(Map<String, dynamic>.from(u as Map)))
        .toList();

    final List<String> uploaded = <String>[];
    for (int i = 0; i < uploads.length; i += 1) {
      onProgress?.call(UploadProgress(
        completed: i,
        total: uploads.length,
        currentFile: files[i].path.split('/').last,
      ),);

      final PresignedUpload upload = uploads[i];
      final Uint8List bytes = await files[i].readAsBytes();

      final http.Response response = await http.put(
        Uri.parse(upload.uploadUrl),
        // The exact headers that were signed. Changing or omitting one makes R2
        // reject the signature, so they are forwarded verbatim.
        headers: upload.requiredHeaders,
        body: bytes,
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ApiException(
          code: 'UPLOAD_FAILED',
          message: 'Object storage rejected the upload (HTTP ${response.statusCode})',
          messageAr: 'تعذّر رفع الصورة. تحقق من الاتصال وحاول مرة أخرى.',
        );
      }
      uploaded.add(upload.mediaId);
    }

    onProgress?.call(UploadProgress(completed: uploads.length, total: uploads.length));

    // The server verifies each object against R2 here. Anything it cannot find
    // comes back in `failed` and does NOT count toward the minimum.
    final Map<String, dynamic> completion = await _api.post<Map<String, dynamic>>(
      '/uploads/images/complete',
      body: <String, dynamic>{
        'items': uploaded.map((String id) => <String, String>{'mediaId': id}).toList(),
      },
    );

    final List<dynamic> failed = completion['failed'] as List<dynamic>? ?? <dynamic>[];
    if (failed.isNotEmpty) {
      throw ApiException(
        code: 'UPLOAD_NOT_CONFIRMED',
        message: 'Some uploads could not be verified: ${failed.length}',
        messageAr: 'تعذّر التحقق من ${failed.length} صورة. يرجى إعادة رفعها.',
        details: <String, dynamic>{'failed': failed},
      );
    }

    return (completion['confirmed'] as List<dynamic>).cast<String>();
  }

  Future<Map<String, dynamic>> compareVersions(String mediaId) =>
      _api.get<Map<String, dynamic>>('/media/$mediaId/compare');

  /// Chooses which version publishes. Both remain stored either way.
  Future<void> selectVersion(String mediaId, {required bool useEnhanced}) => _api.post<dynamic>(
        '/media/$mediaId/select',
        body: <String, String>{'use': useEnhanced ? 'ENHANCED' : 'ORIGINAL'},
      );

  Future<void> deletePhoto(String mediaId) => _api.delete<dynamic>('/media/$mediaId');

  Future<Map<String, dynamic>> propertyJobs(String propertyId) =>
      _api.get<Map<String, dynamic>>('/properties/$propertyId/media/jobs');

  static String _mimeFor(String path) {
    final String ext = path.toLowerCase().split('.').last;
    return switch (ext) {
      'png' => 'image/png',
      'webp' => 'image/webp',
      'heic' || 'heif' => 'image/heic',
      _ => 'image/jpeg',
    };
  }
}
