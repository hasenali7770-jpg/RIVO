import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/api/repositories/media_repository.dart';
import '../../../core/config/business_rules.dart';
import '../../../core/theme/rivo_colors.dart';
import '../../../core/theme/rivo_theme.dart';
import '../listing_draft.dart';

/// Step 5 — photos (Master Plan §6).
///
/// The 8–18 rule is stated plainly and shown as live progress, so the seller
/// always knows where they stand. The same rule is enforced by the API and by a
/// database CHECK constraint; this screen exists to make it obvious, not to be
/// the thing that guarantees it.
class PhotosStep extends StatefulWidget {
  const PhotosStep({
    required this.draft,
    required this.onChanged,
    this.uploading = false,
    this.progress,
    super.key,
  });

  final ListingDraft draft;
  final ValueChanged<ListingDraft> onChanged;
  final bool uploading;
  final UploadProgress? progress;

  @override
  State<PhotosStep> createState() => _PhotosStepState();
}

class _PhotosStepState extends State<PhotosStep> {
  final ImagePicker _picker = ImagePicker();
  String? _pickError;

  Future<void> _pick({required bool fromCamera}) async {
    setState(() => _pickError = null);
    final int capacity = widget.draft.photosRemainingCapacity;

    if (capacity <= 0) {
      setState(() => _pickError = 'وصلت إلى الحد الأعلى (${RivoRules.photoMax} صورة).');
      return;
    }

    try {
      final List<XFile> picked;
      if (fromCamera) {
        final XFile? shot = await _picker.pickImage(
          source: ImageSource.camera,
          // Downscaled at capture: a 12 MP phone photo is far more than a
          // listing gallery needs, and the upload is on the seller's data plan.
          maxWidth: 2400,
          imageQuality: 88,
        );
        picked = shot == null ? <XFile>[] : <XFile>[shot];
      } else {
        picked = await _picker.pickMultiImage(maxWidth: 2400, imageQuality: 88);
      }

      if (picked.isEmpty) return;

      // Silently truncating a selection would be confusing, so the excess is
      // reported explicitly.
      final List<XFile> accepted = picked.take(capacity).toList();
      final int rejected = picked.length - accepted.length;

      setState(() {
        if (rejected > 0) {
          _pickError = 'تمت إضافة ${accepted.length} صورة. '
              'تم تجاهل $rejected صورة لتجاوز الحد الأعلى (${RivoRules.photoMax}).';
        }
      });

      widget.onChanged(
        widget.draft.copyWith(
          localPhotos: <File>[
            ...widget.draft.localPhotos,
            ...accepted.map((XFile file) => File(file.path)),
          ],
        ),
      );
    } catch (error) {
      setState(() => _pickError = 'تعذّر اختيار الصور. تحقق من أذونات التطبيق.');
    }
  }

  void _remove(int index) {
    final List<File> next = List<File>.from(widget.draft.localPhotos)..removeAt(index);
    widget.onChanged(widget.draft.copyWith(localPhotos: next));
  }

  /// `onReorderItem` already accounts for the removed item, so unlike the older
  /// `onReorder` callback the destination index needs no adjustment here.
  void _reorder(int oldIndex, int newIndex) {
    final List<File> next = List<File>.from(widget.draft.localPhotos);
    next.insert(newIndex, next.removeAt(oldIndex));
    widget.onChanged(widget.draft.copyWith(localPhotos: next));
  }

  @override
  Widget build(BuildContext context) {
    final int count = widget.draft.photoCount;
    final bool enough = count >= RivoRules.photoMin;
    final bool tooMany = count > RivoRules.photoMax;

    if (widget.uploading) {
      final UploadProgress? progress = widget.progress;
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              SizedBox(
                width: 64,
                height: 64,
                child: CircularProgressIndicator(
                  value: progress?.fraction,
                  strokeWidth: 4,
                  backgroundColor: RivoColors.surfaceLighter,
                ),
              ),
              const SizedBox(height: 24),
              Text('جارٍ رفع الصور…', style: Theme.of(context).textTheme.titleMedium),
              if (progress != null) ...<Widget>[
                const SizedBox(height: 8),
                Text(
                  '${progress.completed} من ${progress.total}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
              const SizedBox(height: 8),
              Text(
                'لا تغلق التطبيق أثناء الرفع.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      );
    }

    return Column(
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text('صور العقار', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 6),
              Text(
                'الحد الأدنى ${RivoRules.photoMin} صور والحد الأعلى ${RivoRules.photoMax} صورة. '
                'ننصح بصور الواجهة، الصالة، المطبخ، الغرف، الحمامات، المدخل والشارع.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 14),

              // Live progress against the rule.
              Row(
                children: <Widget>[
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: (count / RivoRules.photoMin).clamp(0.0, 1.0),
                        minHeight: 7,
                        backgroundColor: RivoColors.surfaceLighter,
                        color: tooMany
                            ? RivoColors.signalRed
                            : enough
                                ? RivoColors.success
                                : RivoColors.sand,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    '$count / ${RivoRules.photoMin}–${RivoRules.photoMax}',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      color: tooMany
                          ? RivoColors.signalRed
                          : enough
                              ? RivoColors.success
                              : RivoColors.sand,
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 8),
              Text(
                tooMany
                    ? 'احذف ${count - RivoRules.photoMax} صورة للمتابعة.'
                    : enough
                        ? 'عدد الصور مناسب. يمكنك إضافة المزيد حتى ${RivoRules.photoMax}.'
                        : 'تحتاج ${RivoRules.photoMin - count} صورة إضافية للمتابعة.',
                style: TextStyle(
                  fontSize: 13,
                  color: tooMany
                      ? RivoColors.signalRed
                      : enough
                          ? RivoColors.success
                          : RivoColors.sand,
                ),
              ),

              if (_pickError != null) ...<Widget>[
                const SizedBox(height: 10),
                Text(
                  _pickError!,
                  style: const TextStyle(fontSize: 12, color: RivoColors.signalRed),
                ),
              ],
            ],
          ),
        ),

        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
          child: Row(
            children: <Widget>[
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _pick(fromCamera: false),
                  icon: const Icon(Icons.photo_library_rounded, size: 18),
                  label: const Text('من المعرض'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _pick(fromCamera: true),
                  icon: const Icon(Icons.photo_camera_rounded, size: 18),
                  label: const Text('التقاط صورة'),
                ),
              ),
            ],
          ),
        ),

        Expanded(
          child: widget.draft.localPhotos.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(32),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Icon(
                          Icons.add_photo_alternate_outlined,
                          size: 52,
                          color: RivoColors.white.withValues(alpha: 0.25),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          widget.draft.uploadedPhotoCount > 0
                              ? 'تم رفع ${widget.draft.uploadedPhotoCount} صورة مسبقاً.'
                              : 'لم تضف أي صورة بعد.',
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                      ],
                    ),
                  ),
                )
              : ReorderableListView.builder(
                  padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                  itemCount: widget.draft.localPhotos.length,
                  onReorderItem: _reorder,
                  itemBuilder: (BuildContext context, int index) {
                    final File file = widget.draft.localPhotos[index];
                    return Padding(
                      key: ValueKey<String>(file.path),
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Row(
                        children: <Widget>[
                          ClipRRect(
                            borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
                            child: Image.file(
                              file,
                              width: 84,
                              height: 64,
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => Container(
                                width: 84,
                                height: 64,
                                color: RivoColors.surfaceLighter,
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Text(
                                  index == 0 ? 'الصورة الرئيسية' : 'صورة ${index + 1}',
                                  style: TextStyle(
                                    fontWeight: FontWeight.w600,
                                    color: index == 0 ? RivoColors.sand : RivoColors.white,
                                  ),
                                ),
                                if (index == 0)
                                  Text(
                                    'تظهر أولاً في نتائج البحث.',
                                    style: Theme.of(context).textTheme.labelSmall,
                                  ),
                              ],
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.delete_outline_rounded, size: 20),
                            color: RivoColors.signalRed,
                            onPressed: () => _remove(index),
                            tooltip: 'حذف',
                          ),
                          ReorderableDragStartListener(
                            index: index,
                            child: const Padding(
                              padding: EdgeInsets.all(8),
                              child: Icon(Icons.drag_handle_rounded, color: Colors.white38),
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
