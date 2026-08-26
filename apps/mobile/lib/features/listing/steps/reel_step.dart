import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:video_player/video_player.dart';

import '../../../core/api/api_exception.dart';
import '../../../core/api/repositories/reels_repository.dart';
import '../../../core/config/business_rules.dart';
import '../../../core/providers/providers.dart';
import '../../../core/theme/rivo_colors.dart';
import '../../../core/theme/rivo_theme.dart';
import '../../../shared/widgets/rivo_widgets.dart';
import '../listing_draft.dart';

/// Step 7 — optional property reel (Master Plan §6 step 7, §7).
///
/// Local checks catch an obviously wrong file before the upload starts. The rule
/// that actually binds is server-side: Cloudflare measures the encoded video and
/// RIVO validates the short edge against 1080, so a 720p file is refused even if
/// the device reported otherwise.
class ReelStep extends ConsumerStatefulWidget {
  const ReelStep({required this.draft, required this.onChanged, super.key});

  final ListingDraft draft;
  final ValueChanged<ListingDraft> onChanged;

  @override
  ConsumerState<ReelStep> createState() => _ReelStepState();
}

class _ReelStepState extends ConsumerState<ReelStep> {
  final ImagePicker _picker = ImagePicker();

  VideoPlayerController? _preview;
  File? _file;
  int? _width;
  int? _height;
  double? _duration;
  String? _localError;
  bool _uploading = false;
  ReelStatus? _status;

  @override
  void dispose() {
    _preview?.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    setState(() => _localError = null);

    try {
      final XFile? picked = await _picker.pickVideo(
        source: ImageSource.gallery,
        maxDuration: const Duration(seconds: RivoRules.reelMaxDurationSeconds),
      );
      if (picked == null) return;

      final File file = File(picked.path);
      final VideoPlayerController controller = VideoPlayerController.file(file);
      await controller.initialize();

      final int width = controller.value.size.width.round();
      final int height = controller.value.size.height.round();
      final double duration = controller.value.duration.inMilliseconds / 1000;
      final int shortEdge = width < height ? width : height;

      setState(() {
        _preview?.dispose();
        _preview = controller;
        _file = file;
        _width = width;
        _height = height;
        _duration = duration;

        // Explained precisely, so the seller knows what to change rather than
        // being told only that the video "does not qualify".
        if (shortEdge < RivoRules.reelMinShortEdge) {
          _localError = 'دقة الفيديو $width×$height غير كافية. '
              'الحد الأدنى ${RivoRules.reelMinShortEdge}p على أقصر ضلع.';
        } else if (duration < RivoRules.reelMinDurationSeconds) {
          _localError = 'الفيديو قصير جداً (${duration.round()} ثانية). '
              'الحد الأدنى ${RivoRules.reelMinDurationSeconds} ثوانٍ.';
        } else if (duration > RivoRules.reelMaxDurationSeconds) {
          _localError = 'الفيديو طويل جداً (${duration.round()} ثانية). '
              'الحد الأعلى ${RivoRules.reelMaxDurationSeconds} ثانية.';
        }
      });
    } catch (_) {
      setState(() => _localError = 'تعذّر قراءة الفيديو. جرّب ملفاً آخر.');
    }
  }

  Future<void> _upload() async {
    if (_file == null || _localError != null || widget.draft.propertyId == null) return;

    setState(() => _uploading = true);
    try {
      final ReelUploadTicket ticket = await ref.read(reelsRepositoryProvider).upload(
            propertyId: widget.draft.propertyId!,
            video: _file!,
            width: _width!,
            height: _height!,
            durationSeconds: _duration!,
          );

      widget.onChanged(widget.draft.copyWith(reelFile: _file, reelVideoId: ticket.videoId));

      // Validation happens after Cloudflare finishes encoding, so the result is
      // watched rather than assumed.
      await for (final ReelStatus status in ref.read(reelsRepositoryProvider).watch(ticket.videoId)) {
        if (!mounted) return;
        setState(() => _status = status);
        if (status.isReady || status.isRejected) break;
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _localError = asApiException(error).display);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<Capabilities> caps = ref.watch(capabilitiesProvider);
    final bool reelsAvailable = caps.valueOrNull?.reels ?? false;

    if (!reelsAvailable) {
      return ListView(
        padding: const EdgeInsets.all(20),
        children: <Widget>[
          const _RulesCard(),
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: RivoColors.sand.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
            ),
            child: const Text(
              'خدمة الريلز غير مفعّلة حالياً. يمكنك متابعة نشر الإعلان بالصور، '
              'وإضافة ريل لاحقاً عند تفعيل الخدمة.',
              style: TextStyle(fontSize: 13, color: RivoColors.sand),
            ),
          ),
        ],
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      children: <Widget>[
        Text('ريل العقار (اختياري)', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 6),
        Text(
          'فيديو قصير للعقار يظهر في قسم الريلز ويزيد فرص التواصل.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 18),

        const _RulesCard(),
        const SizedBox(height: 20),

        if (_preview != null && _preview!.value.isInitialized) ...<Widget>[
          ClipRRect(
            borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
            child: AspectRatio(
              aspectRatio: _preview!.value.aspectRatio,
              child: Stack(
                alignment: Alignment.center,
                children: <Widget>[
                  VideoPlayer(_preview!),
                  IconButton(
                    iconSize: 52,
                    icon: Icon(
                      _preview!.value.isPlaying
                          ? Icons.pause_circle_filled_rounded
                          : Icons.play_circle_fill_rounded,
                      color: Colors.white70,
                    ),
                    onPressed: () => setState(
                      () => _preview!.value.isPlaying ? _preview!.pause() : _preview!.play(),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: <Widget>[
              Icon(
                _localError == null ? Icons.check_circle_rounded : Icons.error_rounded,
                size: 15,
                color: _localError == null ? RivoColors.success : RivoColors.signalRed,
              ),
              const SizedBox(width: 6),
              Text(
                '$_width×$_height · ${_duration?.round()} ثانية',
                textDirection: TextDirection.ltr,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ],

        if (_localError != null) ...<Widget>[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: RivoColors.signalRed.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
            ),
            child: Text(
              _localError!,
              style: const TextStyle(color: RivoColors.signalRed, fontSize: 13),
            ),
          ),
        ],

        if (_status != null) ...<Widget>[
          const SizedBox(height: 12),
          _StatusCard(status: _status!),
        ],

        const SizedBox(height: 20),

        if (_uploading)
          const Center(child: RivoLoading(label: 'جارٍ رفع الفيديو ومعالجته…'))
        else ...<Widget>[
          OutlinedButton.icon(
            onPressed: _pick,
            icon: const Icon(Icons.video_library_rounded, size: 18),
            label: Text(_file == null ? 'اختر فيديو' : 'تغيير الفيديو'),
          ),
          if (_file != null && _localError == null && _status == null) ...<Widget>[
            const SizedBox(height: 12),
            ElevatedButton.icon(
              onPressed: _upload,
              icon: const Icon(Icons.cloud_upload_rounded, size: 18),
              label: const Text('رفع الريل'),
            ),
          ],
        ],

        const SizedBox(height: 16),
        Center(
          child: Text(
            'يمكنك تخطي هذه الخطوة والمتابعة.',
            style: Theme.of(context).textTheme.labelSmall,
          ),
        ),
      ],
    );
  }
}

class _RulesCard extends StatelessWidget {
  const _RulesCard();

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: RivoColors.surface,
          borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text('شروط النشر', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 10),
            const _Rule('فيديو عمودي 9:16 (مُفضّل 1080×1920)'),
            const _Rule('الحد الأدنى للدقة ${RivoRules.reelMinShortEdge}p على أقصر ضلع'),
            const _Rule(
              'المدة بين ${RivoRules.reelMinDurationSeconds} و ${RivoRules.reelMaxDurationSeconds} ثانية',
            ),
            const _Rule('محتوى عقاري فقط، ومرتبط بهذا الإعلان'),
            const SizedBox(height: 10),
            Text(
              'يتم فحص الدقة والمدة على الخادم بعد الرفع. الفيديو الذي لا يحقق الشروط يُرفض تلقائياً.',
              style: Theme.of(context).textTheme.labelSmall,
            ),
          ],
        ),
      );
}

class _Rule extends StatelessWidget {
  const _Rule(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 5),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Icon(Icons.check_rounded, size: 14, color: RivoColors.sand),
            const SizedBox(width: 8),
            Expanded(
              child: Text(text, style: Theme.of(context).textTheme.bodySmall),
            ),
          ],
        ),
      );
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.status});
  final ReelStatus status;

  @override
  Widget build(BuildContext context) {
    final (Color color, IconData icon, String label) = status.isReady
        ? (RivoColors.success, Icons.check_circle_rounded, 'تم قبول الريل وسيظهر بعد نشر الإعلان.')
        : status.isRejected
            ? (RivoColors.signalRed, Icons.cancel_rounded, status.validationError ?? 'لم يتم قبول الفيديو.')
            : (RivoColors.sand, Icons.hourglass_top_rounded, 'جارٍ معالجة الفيديو…');

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(label, style: TextStyle(fontSize: 13, color: color)),
                if (status.shortEdge != null)
                  Text(
                    'القياس على الخادم: ${status.width}×${status.height} '
                    '(أقصر ضلع ${status.shortEdge}px)',
                    textDirection: TextDirection.ltr,
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
