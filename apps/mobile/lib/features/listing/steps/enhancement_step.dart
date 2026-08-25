import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_exception.dart';
import '../../../core/providers/providers.dart';
import '../../../core/theme/rivo_colors.dart';
import '../../../core/theme/rivo_theme.dart';
import '../../../shared/widgets/rivo_widgets.dart';

/// Step 6 — AI photo enhancement (Master Plan §6).
///
/// Two things this screen is careful about:
///  1. It states exactly what enhancement does and does not do. Enhancement
///     adjusts exposure, colour, noise and sharpness; it never adds, removes or
///     alters anything in the property.
///  2. The seller chooses which version publishes. When enhancement is disabled,
///     skipped or failed, that is shown plainly — the original is published and
///     nothing pretends otherwise.
class EnhancementStep extends ConsumerStatefulWidget {
  const EnhancementStep({required this.propertyId, super.key});
  final String propertyId;

  @override
  ConsumerState<EnhancementStep> createState() => _EnhancementStepState();
}

class _EnhancementStepState extends ConsumerState<EnhancementStep> {
  List<Map<String, dynamic>> _photos = <Map<String, dynamic>>[];
  Map<String, dynamic>? _summary;
  bool _loading = true;
  String? _error;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    // Enhancement runs in a background worker; the screen polls until every job
    // has settled one way or another.
    _poll = Timer.periodic(const Duration(seconds: 4), (_) => _load(silent: true));
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _loading = true);
    try {
      final Map<String, dynamic> owner =
          await ref.read(apiClientProvider).get<Map<String, dynamic>>('/properties/${widget.propertyId}/edit');
      final Map<String, dynamic> jobs =
          await ref.read(mediaRepositoryProvider).propertyJobs(widget.propertyId);

      if (!mounted) return;
      setState(() {
        _photos = (owner['media'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic m) => Map<String, dynamic>.from(m as Map))
            .where((Map<String, dynamic> m) => m['kind'] == 'ORIGINAL')
            .toList();
        _summary = Map<String, dynamic>.from(jobs['summary'] as Map);
        _loading = false;
        _error = null;
      });

      // Nothing left running: stop polling rather than hitting the API forever.
      if ((_summary?['pending'] as int? ?? 0) == 0) _poll?.cancel();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        if (!silent) _error = asApiException(error).display;
      });
    }
  }

  Future<void> _select(String mediaId, {required bool useEnhanced}) async {
    try {
      await ref.read(mediaRepositoryProvider).selectVersion(mediaId, useEnhanced: useEnhanced);
      await _load(silent: true);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(asApiException(error).display)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<Capabilities> caps = ref.watch(capabilitiesProvider);
    final bool aiAvailable = caps.valueOrNull?.aiEnhancement ?? false;

    if (_loading && _photos.isEmpty) {
      return const RivoLoading(label: 'جارٍ تحميل الصور…');
    }
    if (_error != null && _photos.isEmpty) {
      return RivoErrorView(
        error: ApiException(code: 'LOAD', message: _error!, messageAr: _error),
        onRetry: _load,
      );
    }

    final int pending = _summary?['pending'] as int? ?? 0;
    final int skipped = _summary?['skipped'] as int? ?? 0;
    final int failed = _summary?['failed'] as int? ?? 0;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      children: <Widget>[
        // The disclosure. Master Plan §24 forbids enhancement that changes the
        // truth of the property, and the seller is told exactly that.
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: RivoColors.success.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
            border: Border.all(color: RivoColors.success.withValues(alpha: 0.25)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  const Icon(Icons.auto_awesome_rounded, size: 18, color: RivoColors.success),
                  const SizedBox(width: 8),
                  Text(
                    'تحسين الجودة وليس تزوير المحتوى',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(color: RivoColors.success),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                'التحسين يشمل الإضاءة والألوان وتقليل التشويش ورفع الحدة فقط. '
                'لا يضيف ولا يحذف ولا يغيّر أي شيء في العقار.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),

        const SizedBox(height: 18),

        if (!aiAvailable)
          const _Notice(
            icon: Icons.info_outline_rounded,
            color: RivoColors.sand,
            text: 'تحسين الصور غير مفعّل حالياً على هذا الخادم. '
                'سيتم نشر الصور الأصلية كما هي.',
          )
        else if (pending > 0)
          _Notice(
            icon: Icons.hourglass_top_rounded,
            color: RivoColors.sand,
            text: 'جارٍ تحسين $pending صورة… يمكنك المتابعة الآن وسنكمل في الخلفية.',
          )
        else if (failed > 0 || skipped > 0)
          _Notice(
            icon: Icons.info_outline_rounded,
            color: RivoColors.sand,
            text: 'لم يكتمل التحسين لـ ${failed + skipped} صورة. '
                'سيتم نشر النسخة الأصلية لها.',
          )
        else
          const _Notice(
            icon: Icons.check_circle_outline_rounded,
            color: RivoColors.success,
            text: 'اكتمل تحسين الصور. اختر النسخة التي تريد نشرها لكل صورة.',
          ),

        const SizedBox(height: 20),

        for (final Map<String, dynamic> photo in _photos)
          _PhotoComparison(
            photo: photo,
            onSelect: (bool useEnhanced) => _select(photo['id'] as String, useEnhanced: useEnhanced),
          ),
      ],
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.color, required this.text});

  final IconData icon;
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
        ),
        child: Row(
          children: <Widget>[
            Icon(icon, size: 18, color: color),
            const SizedBox(width: 10),
            Expanded(
              child: Text(text, style: TextStyle(fontSize: 13, color: color)),
            ),
          ],
        ),
      );
}

/// Original vs. enhanced, side by side. Both remain stored either way — choosing
/// one never deletes the other.
class _PhotoComparison extends StatelessWidget {
  const _PhotoComparison({required this.photo, required this.onSelect});

  final Map<String, dynamic> photo;
  final ValueChanged<bool> onSelect;

  @override
  Widget build(BuildContext context) {
    final Map<String, dynamic>? enhancement = photo['enhancement'] is Map
        ? Map<String, dynamic>.from(photo['enhancement'] as Map)
        : null;
    final String status = enhancement?['status'] as String? ?? 'NONE';
    final bool hasEnhanced = status == 'SUCCEEDED';
    final bool originalSelected = photo['isSelected'] as bool? ?? true;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: RivoColors.surface,
        borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: _Version(
                  label: 'الأصلية',
                  url: photo['url'] as String?,
                  selected: originalSelected,
                  onTap: () => onSelect(false),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: hasEnhanced
                    ? _Version(
                        label: 'المحسّنة',
                        url: photo['url'] as String?,
                        selected: !originalSelected,
                        onTap: () => onSelect(true),
                      )
                    : _PendingVersion(status: status),
              ),
            ],
          ),
          if (enhancement?['error'] != null) ...<Widget>[
            const SizedBox(height: 8),
            Text(
              enhancement!['error'] as String,
              style: const TextStyle(fontSize: 11, color: RivoColors.sandDim),
            ),
          ],
        ],
      ),
    );
  }
}

class _Version extends StatelessWidget {
  const _Version({
    required this.label,
    required this.url,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String? url;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
        child: Column(
          children: <Widget>[
            Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
                border: Border.all(
                  color: selected ? RivoColors.success : Colors.transparent,
                  width: 2,
                ),
              ),
              clipBehavior: Clip.antiAlias,
              child: AspectRatio(
                aspectRatio: 4 / 3,
                child: url == null
                    ? Container(color: RivoColors.surfaceLighter)
                    : CachedNetworkImage(imageUrl: url!, fit: BoxFit.cover),
              ),
            ),
            const SizedBox(height: 6),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                Icon(
                  selected ? Icons.check_circle_rounded : Icons.circle_outlined,
                  size: 14,
                  color: selected ? RivoColors.success : Colors.white38,
                ),
                const SizedBox(width: 5),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                    color: selected ? RivoColors.success : RivoColors.white,
                  ),
                ),
              ],
            ),
          ],
        ),
      );
}

class _PendingVersion extends StatelessWidget {
  const _PendingVersion({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final String label = switch (status) {
      'QUEUED' || 'RUNNING' => 'جارٍ التحسين…',
      'SKIPPED' => 'غير متاح',
      'FAILED' => 'تعذّر التحسين',
      _ => 'لا توجد نسخة محسّنة',
    };

    return Column(
      children: <Widget>[
        AspectRatio(
          aspectRatio: 4 / 3,
          child: Container(
            decoration: BoxDecoration(
              color: RivoColors.surfaceLighter,
              borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
            ),
            child: Center(
              child: status == 'QUEUED' || status == 'RUNNING'
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.image_not_supported_outlined, color: Colors.white24),
            ),
          ),
        ),
        const SizedBox(height: 6),
        Text(label, style: Theme.of(context).textTheme.labelSmall),
      ],
    );
  }
}
