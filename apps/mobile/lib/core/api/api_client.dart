import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../storage/token_storage.dart';
import 'api_exception.dart';

/// RIVO API client.
///
/// Responsibilities beyond plain HTTP:
///  - attaches the access token,
///  - refreshes it once on a 401 and replays the request, with concurrent 401s
///    sharing a single refresh rather than each firing their own,
///  - converts the API's error envelope into a typed [ApiException] carrying the
///    Arabic message, so screens never have to build error copy themselves,
///  - distinguishes "no internet" from "server error", which the UI presents
///    very differently (Master Plan §21 — the app must handle a no-internet state).
class ApiClient {
  ApiClient({required String baseUrl, required TokenStorage tokens})
      : _tokens = tokens,
        _dio = Dio(
          BaseOptions(
            baseUrl: '$baseUrl/api/v1',
            connectTimeout: const Duration(seconds: 15),
            receiveTimeout: const Duration(seconds: 30),
            sendTimeout: const Duration(seconds: 30),
            headers: <String, String>{'Content-Type': 'application/json'},
            // Non-2xx is handled by the interceptor below rather than by Dio
            // throwing before the envelope can be parsed.
            validateStatus: (int? status) => status != null && status < 500,
          ),
        ) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: _onRequest,
        onResponse: _onResponse,
        onError: _onError,
      ),
    );

    if (kDebugMode) {
      _dio.interceptors.add(LogInterceptor(requestBody: false, responseBody: false));
    }
  }

  final Dio _dio;
  final TokenStorage _tokens;

  /// Shared across concurrent 401s so the refresh endpoint is called once.
  Future<bool>? _refreshInFlight;

  /// Called when the session cannot be recovered; the app routes to sign-in.
  void Function()? onAuthenticationLost;

  Dio get raw => _dio;

  Future<void> _onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    if (options.extra['skipAuth'] != true) {
      final String? token = await _tokens.accessToken;
      if (token != null) options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  Future<void> _onResponse(Response<dynamic> response, ResponseInterceptorHandler handler) async {
    final int status = response.statusCode ?? 0;

    if (status == 401 && response.requestOptions.extra['retried'] != true) {
      final bool refreshed = await _refreshOnce();
      if (refreshed) {
        final Response<dynamic> replay = await _replay(response.requestOptions);
        return handler.resolve(replay);
      }
      onAuthenticationLost?.call();
    }

    if (status >= 400) {
      return handler.reject(
        DioException(
          requestOptions: response.requestOptions,
          response: response,
          error: ApiException.fromResponse(response),
          type: DioExceptionType.badResponse,
        ),
      );
    }

    handler.next(response);
  }

  void _onError(DioException error, ErrorInterceptorHandler handler) {
    if (error.error is ApiException) return handler.next(error);

    final ApiException mapped = switch (error.type) {
      DioExceptionType.connectionTimeout ||
      DioExceptionType.sendTimeout ||
      DioExceptionType.receiveTimeout =>
        ApiException.timeout(),
      DioExceptionType.connectionError => error.error is SocketException
          ? ApiException.offline()
          : ApiException.network(error.message),
      DioExceptionType.cancel => ApiException.cancelled(),
      _ => error.response != null
          ? ApiException.fromResponse(error.response!)
          : ApiException.network(error.message),
    };

    handler.next(
      DioException(
        requestOptions: error.requestOptions,
        response: error.response,
        error: mapped,
        type: error.type,
      ),
    );
  }

  /// Refreshes the token pair, collapsing concurrent callers onto one request.
  Future<bool> _refreshOnce() {
    return _refreshInFlight ??= _performRefresh().whenComplete(() => _refreshInFlight = null);
  }

  Future<bool> _performRefresh() async {
    final String? refreshToken = await _tokens.refreshToken;
    if (refreshToken == null) return false;

    try {
      // A bare Dio instance: routing this through _dio would recurse into the
      // interceptor that is already handling a 401.
      final Dio plain = Dio(BaseOptions(baseUrl: _dio.options.baseUrl));
      final Response<dynamic> response = await plain.post<dynamic>(
        '/auth/refresh',
        data: <String, String>{'refreshToken': refreshToken},
      );

      final Map<String, dynamic> body = Map<String, dynamic>.from(response.data as Map);
      await _tokens.save(
        accessToken: body['accessToken'] as String,
        refreshToken: body['refreshToken'] as String,
      );
      return true;
    } catch (_) {
      // Reuse detection on the server revokes the whole family, so there is
      // nothing to retry: the user must sign in again.
      await _tokens.clear();
      return false;
    }
  }

  /// Re-issues the original request with the freshly refreshed token. The
  /// `retried` flag stops a second 401 from looping back into another refresh.
  Future<Response<dynamic>> _replay(RequestOptions options) async {
    final String? token = await _tokens.accessToken;
    options.extra['retried'] = true;
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    } else {
      options.headers.remove('Authorization');
    }
    return _dio.fetch<dynamic>(options);
  }

  // --- Verbs -----------------------------------------------------------------

  Future<T> get<T>(String path, {Map<String, dynamic>? query, bool auth = true}) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      path,
      queryParameters: query,
      options: Options(extra: <String, dynamic>{'skipAuth': !auth}),
    );
    return response.data as T;
  }

  Future<T> post<T>(String path, {Object? body, bool auth = true}) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      path,
      data: body,
      options: Options(extra: <String, dynamic>{'skipAuth': !auth}),
    );
    return response.data as T;
  }

  Future<T> patch<T>(String path, {Object? body}) async {
    final Response<dynamic> response = await _dio.patch<dynamic>(path, data: body);
    return response.data as T;
  }

  Future<T> delete<T>(String path, {Object? body}) async {
    final Response<dynamic> response = await _dio.delete<dynamic>(path, data: body);
    return response.data as T;
  }
}
