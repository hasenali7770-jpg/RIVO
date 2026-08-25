import 'package:flutter/material.dart';

import '../../../core/api/models/property.dart';
import '../../../core/config/business_rules.dart';
import '../../../core/theme/rivo_colors.dart';
import '../../../core/theme/rivo_theme.dart';
import '../../../shared/widgets/rivo_widgets.dart';
import '../listing_draft.dart';

/// Step 8 — preview (Master Plan §6).
///
/// Shown before payment, deliberately: the deck (p.8) specifies
/// "الدفع بعد المعاينة" — the seller sees exactly what they are paying to
/// publish before any money is asked for.
class PreviewStep extends StatelessWidget {
  const PreviewStep({required this.draft, super.key});
  final ListingDraft draft;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      children: <Widget>[
        Text('هكذا سيظهر إعلانك', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 6),
        Text(
          'راجع التفاصيل جيداً قبل الدفع. يمكنك الرجوع وتعديل أي خطوة.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 20),

        Container(
          decoration: BoxDecoration(
            color: RivoColors.surface,
            borderRadius: BorderRadius.circular(RivoTheme.radiusMd),
            border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              AspectRatio(
                aspectRatio: 16 / 10,
                child: Stack(
                  fit: StackFit.expand,
                  children: <Widget>[
                    if (draft.localPhotos.isNotEmpty)
                      Image.file(draft.localPhotos.first, fit: BoxFit.cover)
                    else
                      Container(
                        color: RivoColors.surfaceLighter,
                        child: Center(
                          child: Text(
                            '${draft.photoCount} صورة مرفوعة',
                            style: Theme.of(context).textTheme.bodyMedium,
                          ),
                        ),
                      ),
                    Positioned.fill(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.bottomCenter,
                            end: Alignment.center,
                            colors: <Color>[
                              Colors.black.withValues(alpha: 0.75),
                              Colors.transparent,
                            ],
                          ),
                        ),
                      ),
                    ),
                    Positioned(
                      top: 10,
                      right: 10,
                      child: PurposeChip(isSale: draft.purpose == ListingPurpose.sale),
                    ),
                    Positioned(
                      bottom: 10,
                      right: 12,
                      child: Text(
                        formatIqd(draft.priceIqd),
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: RivoColors.sand,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(draft.title, style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Row(
                      children: <Widget>[
                        _Fact(icon: Icons.straighten_rounded, label: '${draft.areaSqm?.round()} م²'),
                        if (draft.bedrooms != null) ...<Widget>[
                          const SizedBox(width: 14),
                          _Fact(icon: Icons.bed_rounded, label: '${draft.bedrooms}'),
                        ],
                        if (draft.bathrooms != null) ...<Widget>[
                          const SizedBox(width: 14),
                          _Fact(icon: Icons.bathtub_rounded, label: '${draft.bathrooms}'),
                        ],
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: <Widget>[
                        const Icon(Icons.place_rounded, size: 13, color: Colors.white38),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            <String>[draft.district, draft.city]
                                .where((String s) => s.trim().isNotEmpty)
                                .join('، '),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 24),
        Text('ملخص الإعلان', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 12),

        _Row(label: 'نوع العقار', value: draft.type?.labelAr ?? '—'),
        _Row(label: 'الغرض', value: draft.purpose?.labelAr ?? '—'),
        if (draft.purpose == ListingPurpose.rent)
          _Row(label: 'دورية الإيجار', value: draft.rentPeriod == 'MONTHLY' ? 'شهري' : 'سنوي'),
        _Row(label: 'السعر', value: formatIqd(draft.priceIqd), highlight: true),
        _Row(label: 'المساحة', value: '${draft.areaSqm?.round()} م²'),
        if (draft.bedrooms != null) _Row(label: 'غرف النوم', value: '${draft.bedrooms}'),
        if (draft.bathrooms != null) _Row(label: 'الحمامات', value: '${draft.bathrooms}'),
        _Row(label: 'المحافظة', value: draft.governorate == 'BAGHDAD' ? 'بغداد' : draft.governorate),
        if (draft.district.trim().isNotEmpty) _Row(label: 'المنطقة', value: draft.district),
        _Row(
          label: 'الموقع',
          value: draft.locationComplete ? 'محدد على الخريطة' : 'غير محدد',
        ),
        _Row(
          label: 'الصور',
          value: '${draft.photoCount} صورة '
              '(المطلوب ${RivoRules.photoMin}–${RivoRules.photoMax})',
        ),
        _Row(label: 'الريل', value: draft.reelVideoId != null ? 'مرفق' : 'بدون ريل'),
        _Row(label: 'رقم التواصل', value: draft.contactPhone, ltr: true),

        const SizedBox(height: 24),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: RivoColors.sand.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
            border: Border.all(color: RivoColors.sand.withValues(alpha: 0.25)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  const Icon(Icons.receipt_long_rounded, size: 18, color: RivoColors.sand),
                  const SizedBox(width: 8),
                  Text(
                    'رسوم النشر',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(color: RivoColors.sand),
                  ),
                  const Spacer(),
                  Text(
                    formatIqd('${RivoRules.listingFeeIqd}'),
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: RivoColors.sand,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                'تشمل رفع الصور، المعاينة، معالجة الصور بالذكاء الاصطناعي، '
                'ومراجعة الإعلان قبل النشر.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 13, color: Colors.white38),
          const SizedBox(width: 4),
          Text(label, style: Theme.of(context).textTheme.bodySmall),
        ],
      );
}

class _Row extends StatelessWidget {
  const _Row({
    required this.label,
    required this.value,
    this.highlight = false,
    this.ltr = false,
  });

  final String label;
  final String value;
  final bool highlight;
  final bool ltr;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 7),
        child: Row(
          children: <Widget>[
            Expanded(
              child: Text(label, style: Theme.of(context).textTheme.bodySmall),
            ),
            Text(
              value,
              textDirection: ltr ? TextDirection.ltr : null,
              style: TextStyle(
                fontSize: 14,
                fontWeight: highlight ? FontWeight.w700 : FontWeight.w500,
                color: highlight ? RivoColors.sand : RivoColors.white,
              ),
            ),
          ],
        ),
      );
}
