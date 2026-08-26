import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';

import '../../core/api/api_exception.dart';
import '../../core/providers/providers.dart';
import '../../core/theme/rivo_colors.dart';
import '../../shared/widgets/rivo_widgets.dart';

/// Darcom Reels — Master Plan §7.
///
/// Property-only, full-screen, vertical. Every reel is bound to a published
/// listing and carries its price, area, location and the three actions the plan
/// requires: تفاصيل العقار، الموقع والمسار، اتصال.
///
/// This is explicitly not a social feed: there is no way to post unrelated
/// content, because a reel cannot exist without a property.
class ReelsScreen extends ConsumerStatefulWidget {
  const ReelsScreen({super.key});

  @override
  ConsumerState<ReelsScreen> createState() => _ReelsScreenState();
}

class _ReelsScreenState extends ConsumerState<ReelsScreen> {
  final PageController _pages = PageController();
  final Map<int, VideoPlayerController> _controllers = <int, VideoPlayerController>{};

  List<Map<String, dynamic>> _items = <Map<String, dynamic>>[];
  int _index = 0;
  int _page = 1;
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = false;
  Object? _error;
  DateTime? _shownAt;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _reportView();
    for (final VideoPlayerController controller in _controllers.values) {
      controller.dispose();
    }
    _pages.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final Map<String, dynamic> feed = await ref.read(reelsRepositoryProvider).feed(page: 1);
      if (!mounted) return;
      setState(() {
        _items = (feed['items'] as List<dynamic>)
            .map((dynamic i) => Map<String, dynamic>.from(i as Map))
            .toList();
        _hasMore = (feed['pagination'] as Map)['hasMore'] as bool? ?? false;
        _page = 1;
        _loading = false;
      });
      if (_items.isNotEmpty) await _prepare(0);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error;
      });
    }
  }

  Future<void> _loadMore() async {
    if (!_hasMore || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final Map<String, dynamic> feed = await ref.read(reelsRepositoryProvider).feed(page: _page + 1);
      if (!mounted) return;
      setState(() {
        _items = <Map<String, dynamic>>[
          ..._items,
          ...(feed['items'] as List<dynamic>).map((dynamic i) => Map<String, dynamic>.from(i as Map)),
        ];
        _hasMore = (feed['pagination'] as Map)['hasMore'] as bool? ?? false;
        _page += 1;
      });
    } catch (_) {
      // The already-loaded reels stay watchable.
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  /// Prepares the current reel and pre-buffers the next one, so a swipe starts
  /// playing immediately rather than showing a spinner.
  Future<void> _prepare(int index) async {
    await _initController(index);
    if (index + 1 < _items.length) unawaited(_initController(index + 1));

    // Anything more than one either side is disposed: three decoders is already
    // a lot for a mid-range Android device.
    for (final int key in _controllers.keys.toList()) {
      if ((key - index).abs() > 1) {
        await _controllers.remove(key)?.dispose();
      }
    }

    await _controllers[index]?.play();
    _shownAt = DateTime.now();
  }

  Future<void> _initController(int index) async {
    if (_controllers.containsKey(index) || index >= _items.length) return;

    final String? url = _items[index]['hlsUrl'] as String?;
    if (url == null) return;

    final VideoPlayerController controller = VideoPlayerController.networkUrl(Uri.parse(url));
    _controllers[index] = controller;
    try {
      await controller.initialize();
      await controller.setLooping(true);
      if (mounted) setState(() {});
    } catch (_) {
      _controllers.remove(index);
      await controller.dispose();
    }
  }

  /// Reports watch time, which feeds feed ranking. Completion is clamped on the
  /// server too, so this cannot be used to inflate a reel's position.
  void _reportView() {
    final DateTime? shown = _shownAt;
    if (shown == null || _index >= _items.length) return;

    final VideoPlayerController? controller = _controllers[_index];
    final double watched = DateTime.now().difference(shown).inMilliseconds / 1000;
    final double duration = controller?.value.duration.inMilliseconds.toDouble() ?? 0;

    if (watched < 0.5) return;

    unawaited(
      ref
          .read(reelsRepositoryProvider)
          .recordView(
            _items[_index]['id'] as String,
            watchedSeconds: watched,
            completion: duration > 0 ? (watched * 1000 / duration).clamp(0.0, 1.0) : 0,
          )
          .catchError((_) {}),
    );
  }

  Future<void> _onPageChanged(int index) async {
    _reportView();
    await _controllers[_index]?.pause();
    setState(() => _index = index);
    await _prepare(index);
    if (index >= _items.length - 3) unawaited(_loadMore());
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<Capabilities> caps = ref.watch(capabilitiesProvider);

    if (!(caps.valueOrNull?.reels ?? true)) {
      return const Scaffold(body: FeatureUnavailableView(feature: 'الريلز'));
    }

    if (_loading) {
      return const Scaffold(backgroundColor: Colors.black, body: RivoLoading());
    }

    if (_error != null) {
      final ApiException api = asApiException(_error!);
      if (api.isNotConfigured) {
        return const Scaffold(body: FeatureUnavailableView(feature: 'الريلز'));
      }
      return Scaffold(
        backgroundColor: Colors.black,
        body: RivoErrorView(error: _error!, onRetry: _load),
      );
    }

    if (_items.isEmpty) {
      return Scaffold(
        backgroundColor: Colors.black,
        body: RivoEmptyView(
          icon: Icons.videocam_off_outlined,
          title: 'لا توجد ريلز بعد',
          hint: 'كن أول من ينشر ريل لعقاره.',
          action: OutlinedButton(
            onPressed: () => context.push('/listing/new'),
            child: const Text('أضف عقارك'),
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: Colors.black,
      body: PageView.builder(
        controller: _pages,
        scrollDirection: Axis.vertical,
        itemCount: _items.length,
        onPageChanged: _onPageChanged,
        itemBuilder: (BuildContext context, int index) => _ReelPage(
          reel: _items[index],
          controller: _controllers[index],
          onDetails: () => context.push('/property/${_items[index]['property']['id']}'),
          onRoute: () {
            final Map<String, dynamic> property =
                Map<String, dynamic>.from(_items[index]['property'] as Map);
            context.push(
              '/navigate',
              extra: <String, dynamic>{
                'lat': (property['lat'] as num?)?.toDouble(),
                'lng': (property['lng'] as num?)?.toDouble(),
                'label': property['title'],
                'propertyId': property['id'],
              },
            );
          },
        ),
      ),
    );
  }
}

class _ReelPage extends StatelessWidget {
  const _ReelPage({
    required this.reel,
    required this.controller,
    required this.onDetails,
    required this.onRoute,
  });

  final Map<String, dynamic> reel;
  final VideoPlayerController? controller;
  final VoidCallback onDetails;
  final VoidCallback onRoute;

  Future<void> _call(String phone) async {
    final Uri uri = Uri.parse('tel:$phone');
    if (await canLaunchUrl(uri)) await launchUrl(uri);
  }

  @override
  Widget build(BuildContext context) {
    final Map<String, dynamic> property = Map<String, dynamic>.from(reel['property'] as Map);
    final Map<String, dynamic> seller = Map<String, dynamic>.from(reel['seller'] as Map);
    final bool isSale = property['purpose'] == 'SALE';
    final String? phone = property['contactPhone'] as String?;

    return Stack(
      fit: StackFit.expand,
      children: <Widget>[
        if (controller != null && controller!.value.isInitialized)
          FittedBox(
            fit: BoxFit.cover,
            child: SizedBox(
              width: controller!.value.size.width,
              height: controller!.value.size.height,
              child: VideoPlayer(controller!),
            ),
          )
        else if (reel['thumbnailUrl'] != null)
          CachedNetworkImage(imageUrl: reel['thumbnailUrl'] as String, fit: BoxFit.cover)
        else
          Container(color: RivoColors.petrol),

        if (controller == null || !controller!.value.isInitialized)
          const Center(child: CircularProgressIndicator(color: Colors.white54)),

        // Gradient so the overlaid listing facts stay readable over any frame.
        Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.bottomCenter,
                end: Alignment.topCenter,
                colors: <Color>[
                  Colors.black.withValues(alpha: 0.85),
                  Colors.transparent,
                  Colors.black.withValues(alpha: 0.3),
                ],
                stops: const <double>[0, 0.55, 1],
              ),
            ),
          ),
        ),

        Positioned(
          left: 16,
          right: 16,
          bottom: 110,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Row(
                children: <Widget>[
                  PurposeChip(isSale: isSale),
                  const SizedBox(width: 8),
                  if (property['isVerified'] == true) const VerifiedChip(),
                ],
              ),
              const SizedBox(height: 12),

              Text(
                formatIqd(property['priceIqd'].toString()),
                style: const TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w700,
                  color: RivoColors.sand,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                property['title'] as String,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 8),

              Row(
                children: <Widget>[
                  const Icon(Icons.straighten_rounded, size: 14, color: Colors.white70),
                  const SizedBox(width: 4),
                  Text(
                    '${property['areaSqm']} م²',
                    style: const TextStyle(color: Colors.white70, fontSize: 13),
                  ),
                  const SizedBox(width: 14),
                  const Icon(Icons.place_rounded, size: 14, color: Colors.white70),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      <String?>[property['district'] as String?, property['governorate'] as String?]
                          .whereType<String>()
                          .join('، '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Colors.white70, fontSize: 13),
                    ),
                  ),
                ],
              ),

              if (seller['displayName'] != null) ...<Widget>[
                const SizedBox(height: 6),
                Text(
                  seller['displayName'] as String,
                  style: const TextStyle(color: Colors.white54, fontSize: 12),
                ),
              ],

              const SizedBox(height: 16),

              // The three actions Master Plan §7 requires on every reel.
              Row(
                children: <Widget>[
                  Expanded(
                    child: ElevatedButton(
                      onPressed: onDetails,
                      style: ElevatedButton.styleFrom(minimumSize: const Size.fromHeight(44)),
                      child: const Text('تفاصيل العقار', style: TextStyle(fontSize: 13)),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: onRoute,
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(44),
                        foregroundColor: Colors.white,
                        side: const BorderSide(color: Colors.white38),
                      ),
                      child: const Text('الموقع والمسار', style: TextStyle(fontSize: 13)),
                    ),
                  ),
                  if (phone != null) ...<Widget>[
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 52,
                      height: 44,
                      child: OutlinedButton(
                        onPressed: () => _call(phone),
                        style: OutlinedButton.styleFrom(
                          padding: EdgeInsets.zero,
                          foregroundColor: Colors.white,
                          side: const BorderSide(color: Colors.white38),
                        ),
                        child: const Icon(Icons.phone_rounded, size: 18),
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}
