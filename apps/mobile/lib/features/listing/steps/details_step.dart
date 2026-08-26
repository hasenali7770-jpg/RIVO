import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/models/property.dart';
import '../../../core/providers/providers.dart';
import '../../../core/theme/rivo_colors.dart';
import '../../../shared/widgets/rivo_widgets.dart';
import '../listing_draft.dart';

/// Step 4 — property details (Master Plan §6).
class DetailsStep extends ConsumerStatefulWidget {
  const DetailsStep({required this.draft, required this.onChanged, super.key});

  final ListingDraft draft;
  final ValueChanged<ListingDraft> onChanged;

  @override
  ConsumerState<DetailsStep> createState() => _DetailsStepState();
}

class _DetailsStepState extends ConsumerState<DetailsStep> {
  late final TextEditingController _title;
  late final TextEditingController _description;
  late final TextEditingController _price;
  late final TextEditingController _area;
  late final TextEditingController _district;
  late final TextEditingController _address;
  late final TextEditingController _phone;

  @override
  void initState() {
    super.initState();
    _title = TextEditingController(text: widget.draft.title);
    _description = TextEditingController(text: widget.draft.description);
    _price = TextEditingController(text: widget.draft.priceIqd);
    _area = TextEditingController(text: widget.draft.areaSqm?.toStringAsFixed(0) ?? '');
    _district = TextEditingController(text: widget.draft.district);
    _address = TextEditingController(text: widget.draft.addressLine);

    // Defaults to the account's own number so most sellers never have to type it.
    _phone = TextEditingController(
      text: widget.draft.contactPhone.isNotEmpty
          ? widget.draft.contactPhone
          : ref.read(currentUserProvider)?.phone ?? '',
    );

    if (widget.draft.contactPhone.isEmpty && _phone.text.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        widget.onChanged(widget.draft.copyWith(contactPhone: _phone.text));
      });
    }
  }

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    _price.dispose();
    _area.dispose();
    _district.dispose();
    _address.dispose();
    _phone.dispose();
    super.dispose();
  }

  void _push() {
    widget.onChanged(
      widget.draft.copyWith(
        title: _title.text,
        description: _description.text,
        priceIqd: _price.text.replaceAll(RegExp(r'\D'), ''),
        areaSqm: double.tryParse(_area.text.trim()),
        district: _district.text,
        addressLine: _address.text,
        contactPhone: _phone.text,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bool needsRooms = widget.draft.type?.hasRooms ?? false;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
      children: <Widget>[
        _Field(
          label: 'عنوان الإعلان',
          controller: _title,
          hint: 'مثال: دار للبيع في الكرادة قرب الشارع الرئيسي',
          maxLength: 160,
          onChanged: (_) => _push(),
          helper: 'اكتب عنواناً واضحاً — ٨ أحرف على الأقل.',
        ),

        _Field(
          label: 'السعر (دينار عراقي)',
          controller: _price,
          keyboardType: TextInputType.number,
          formatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
          ltr: true,
          onChanged: (_) => setState(_push),
          helper: _price.text.isNotEmpty ? formatIqd(_price.text) : null,
        ),

        if (widget.draft.purpose?.name == 'rent')
          Padding(
            padding: const EdgeInsets.only(bottom: 18),
            child: Text(
              'السعر ${widget.draft.rentPeriod == 'MONTHLY' ? 'شهري' : 'سنوي'}.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),

        _Field(
          label: 'المساحة (م²)',
          controller: _area,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          ltr: true,
          onChanged: (_) => _push(),
        ),

        if (needsRooms) ...<Widget>[
          _Counter(
            label: 'غرف النوم',
            value: widget.draft.bedrooms,
            onChanged: (int value) => widget.onChanged(widget.draft.copyWith(bedrooms: value)),
          ),
          _Counter(
            label: 'الحمامات',
            value: widget.draft.bathrooms,
            onChanged: (int value) => widget.onChanged(widget.draft.copyWith(bathrooms: value)),
          ),
          _Counter(
            label: 'عدد الطوابق',
            value: widget.draft.floors,
            optional: true,
            onChanged: (int value) => widget.onChanged(widget.draft.copyWith(floors: value)),
          ),
        ],

        _Field(
          label: 'المنطقة / الحي',
          controller: _district,
          hint: 'مثال: الكرادة',
          maxLength: 120,
          onChanged: (_) => _push(),
        ),

        _Field(
          label: 'العنوان التفصيلي (اختياري)',
          controller: _address,
          hint: 'أقرب نقطة دالة',
          maxLength: 300,
          onChanged: (_) => _push(),
        ),

        _Field(
          label: 'رقم التواصل',
          controller: _phone,
          keyboardType: TextInputType.phone,
          ltr: true,
          onChanged: (_) => _push(),
          helper: 'الرقم الذي سيتواصل عليه المشترون.',
        ),

        const SizedBox(height: 4),
        Text('طريقة التواصل المفضّلة', style: Theme.of(context).textTheme.labelMedium),
        const SizedBox(height: 10),
        Row(
          children: <Widget>[
            for (final (String value, String label) in const <(String, String)>[
              ('BOTH', 'اتصال وواتساب'),
              ('CALL', 'اتصال فقط'),
              ('WHATSAPP', 'واتساب فقط'),
            ])
              Padding(
                padding: const EdgeInsets.only(left: 8),
                child: ChoiceChip(
                  label: Text(label),
                  selected: widget.draft.contactPreference == value,
                  onSelected: (_) => widget.onChanged(widget.draft.copyWith(contactPreference: value)),
                ),
              ),
          ],
        ),

        const SizedBox(height: 22),
        _Field(
          label: 'وصف العقار',
          controller: _description,
          hint: 'اذكر المميزات، الخدمات القريبة، وحالة العقار…',
          maxLines: 5,
          maxLength: 4000,
          onChanged: (_) => _push(),
          helper: 'وصف واضح يزيد فرص التواصل — ٢٠ حرفاً على الأقل.',
        ),

        if (widget.draft.missingDetailFields.isNotEmpty) ...<Widget>[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: RivoColors.sand.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text(
                  'لإكمال هذه الخطوة:',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: RivoColors.sand),
                ),
                const SizedBox(height: 6),
                for (final String field in widget.draft.missingDetailFields)
                  Padding(
                    padding: const EdgeInsets.only(top: 3),
                    child: Text(
                      '• $field',
                      style: const TextStyle(fontSize: 12, color: RivoColors.sand),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({
    required this.label,
    required this.controller,
    required this.onChanged,
    this.hint,
    this.helper,
    this.keyboardType,
    this.formatters,
    this.maxLines = 1,
    this.maxLength,
    this.ltr = false,
  });

  final String label;
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final String? hint;
  final String? helper;
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? formatters;
  final int maxLines;
  final int? maxLength;
  final bool ltr;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(label, style: Theme.of(context).textTheme.labelMedium),
            const SizedBox(height: 8),
            TextField(
              controller: controller,
              keyboardType: keyboardType,
              inputFormatters: formatters,
              maxLines: maxLines,
              maxLength: maxLength,
              textDirection: ltr ? TextDirection.ltr : null,
              onChanged: onChanged,
              decoration: InputDecoration(
                hintText: hint,
                helperText: helper,
                helperMaxLines: 2,
                counterText: '',
              ),
            ),
          ],
        ),
      );
}

class _Counter extends StatelessWidget {
  const _Counter({
    required this.label,
    required this.value,
    required this.onChanged,
    this.optional = false,
  });

  final String label;
  final int? value;
  final ValueChanged<int> onChanged;
  final bool optional;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 18),
        child: Row(
          children: <Widget>[
            Expanded(
              child: Text(
                optional ? '$label (اختياري)' : label,
                style: Theme.of(context).textTheme.labelMedium,
              ),
            ),
            IconButton.filledTonal(
              onPressed: (value ?? 0) > 0 ? () => onChanged((value ?? 0) - 1) : null,
              icon: const Icon(Icons.remove_rounded, size: 18),
            ),
            SizedBox(
              width: 48,
              child: Text(
                value?.toString() ?? '—',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            IconButton.filledTonal(
              onPressed: () => onChanged((value ?? 0) + 1),
              icon: const Icon(Icons.add_rounded, size: 18),
            ),
          ],
        ),
      );
}
