import 'package:dio/dio.dart';

/// A typed error carrying the API's machine-readable code and its Arabic
/// message, so screens can switch on the code and show the copy without
/// composing error text themselves.
class ApiException implements Exception {
  const ApiException({
    required this.code,
    required this.message,
    this.messageAr,
    this.statusCode,
    this.details,
  });

  final String code;

  /// English message, for logs and crash reports.
  final String message;

  /// Arabic message, safe to show to a user. Falls back to [message].
  final String? messageAr;

  final int? statusCode;
  final Map<String, dynamic>? details;

  /// What the user sees.
  String get display => messageAr ?? message;

  factory ApiException.fromResponse(Response<dynamic> response) {
    final dynamic data = response.data;
    if (data is Map && data['error'] is Map) {
      final Map<dynamic, dynamic> error = data['error'] as Map<dynamic, dynamic>;
      return ApiException(
        code: (error['code'] as String?) ?? 'UNKNOWN',
        message: (error['message'] as String?) ?? 'Request failed',
        messageAr: error['messageAr'] as String?,
        statusCode: response.statusCode,
        details: error['details'] is Map ? Map<String, dynamic>.from(error['details'] as Map) : null,
      );
    }
    return ApiException(
      code: 'UNKNOWN',
      message: 'Request failed with HTTP ${response.statusCode}',
      messageAr: 'حدث خطأ غير متوقع. يرجى المحاولة لاحقاً.',
      statusCode: response.statusCode,
    );
  }

  /// No route to the internet at all. Presented differently from a server error:
  /// the user can fix this one themselves.
  factory ApiException.offline() => const ApiException(
        code: 'OFFLINE',
        message: 'No internet connection',
        messageAr: 'لا يوجد اتصال بالإنترنت. تحقق من الشبكة وحاول مرة أخرى.',
      );

  factory ApiException.timeout() => const ApiException(
        code: 'TIMEOUT',
        message: 'The request timed out',
        messageAr: 'انتهت مهلة الاتصال. يرجى المحاولة مرة أخرى.',
      );

  factory ApiException.network(String? detail) => ApiException(
        code: 'NETWORK',
        message: detail ?? 'Network error',
        messageAr: 'تعذّر الاتصال بالخادم. يرجى المحاولة لاحقاً.',
      );

  factory ApiException.cancelled() => const ApiException(
        code: 'CANCELLED',
        message: 'Request cancelled',
        messageAr: 'تم إلغاء الطلب.',
      );

  bool get isOffline => code == 'OFFLINE' || code == 'TIMEOUT' || code == 'NETWORK';

  /// The deployment is missing a credential for this feature. The UI should hide
  /// the entry point rather than presenting a broken action.
  bool get isNotConfigured => code == 'INTEGRATION_NOT_CONFIGURED' || code == 'FEATURE_DISABLED';

  @override
  String toString() => 'ApiException($code, $statusCode): $message';
}

/// Unwraps the ApiException a DioException carries, so callers catch one type.
ApiException asApiException(Object error) {
  if (error is ApiException) return error;
  if (error is DioException && error.error is ApiException) return error.error! as ApiException;
  return ApiException(code: 'UNKNOWN', message: error.toString(), messageAr: 'حدث خطأ غير متوقع.');
}
