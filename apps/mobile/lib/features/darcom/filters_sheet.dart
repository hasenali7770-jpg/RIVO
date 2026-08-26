import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api/models/property.dart';
import '../../core/api/repositories/properties_repository.dart';
import '../../core/theme/rivo_colors.dart';
import '../../shared/widgets/rivo_widgets.dart';

/// The full filter set required by Master Plan §5:
/// type, sale/rent, price range, area, bedrooms, bathrooms, verified only,
/// owner/office, plus sorting.
class FiltersSheet extends StatefulWidget {
  const FiltersSheet({required this.initial, super.key});
  final PropertyFilters initial;

  @override
  State<FiltersSheet> createState() => _FiltersSheetState();
}

class _FiltersSheetState extends State<FiltersSheet> {
  late PropertyFilters _filters;
  late final TextEditingController _minPrice;
  late final TextEditingController _maxPrice;
  late final TextEditingController _minArea;
  late final TextEditingController _maxArea;

  @override
  void initState() {
    super.initState();
    _filters = widget.initial;
    _minPrice = TextEditingController(text: widget.initial.minPrice ?? '');
    _maxPrice = TextEditingController(text: widget.initial.maxPrice ?? '');
    _minArea = TextEditingController(text: widget.initial.minArea?.toStringAsFixed(0) ?? '');
    _maxArea = TextEditingController(text: widget.initial.maxArea?.toStringAsFixed(0) ?? '');
  }

  @override
  void dispose() {
    _minPrice.dispose();
    _maxPrice.dispose();
    _minArea.dispose();
    _maxArea.dispose();
    super.dispose();
  }

  PropertyFilters _collect() => _filters.copyWith(
        minPrice: _minPrice.text.trim().isEmpty ? null : _minPrice.text.replaceAll(RegExp(r'\D'), ''),
        maxPrice: _maxPrice.text.trim().isEmpty ? null : _maxPrice.text.replaceAll(RegExp(r'\D'), ''),
        minArea: double.tryParse(_minArea.text.trim()),
        maxArea: double.tryParse(_maxArea.text.trim()),
      );

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        initialChildSize: 0.9,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        expand: false,
        builder: (BuildContext context, ScrollController controller) => Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Text('الفلاتر', style: Theme.of(context).textTheme.titleLarge),
                  ),
                  TextButton(
                    onPressed: () {
                      setState(() {
                        _filters = const PropertyFilters();
                        _minPrice.clear();
                        _maxPrice.clear();
                        _minArea.clear();
                        _maxArea.clear();
                      });
                    },
                    child: const Text('مسح الكل'),
                  ),
                ],
              ),
            ),

            Expanded(
              child: ListView(
                controller: controller,
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                children: <Widget>[
                  const _Label('نوع العقار'),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: <Widget>[
                      for (final PropertyType type in PropertyType.values)
                        FilterChip(
                          label: Text(type.labelAr),
                          selected: _filters.types.contains(type),
                          onSelected: (bool selected) {
                            setState(() {
                              final Set<PropertyType> next = Set<PropertyType>.from(_filters.types);
                              selected ? next.add(type) : next.remove(type);
                              _filters = _filters.copyWith(types: next);
                            });
                          },
                        ),
                    ],
                  ),

                  const _Label('الغرض'),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: ChoiceChip(
                          label: const Center(child: Text('الكل')),
                          selected: _filters.purpose == null,
                          onSelected: (_) => setState(() => _filters = _filters.copyWith(clearPurpose: true)),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: ChoiceChip(
                          label: const Center(child: Text('للبيع')),
                          selected: _filters.purpose == ListingPurpose.sale,
                          onSelected: (_) =>
                              setState(() => _filters = _filters.copyWith(purpose: ListingPurpose.sale)),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: ChoiceChip(
                          label: const Center(child: Text('للإيجار')),
                          selected: _filters.purpose == ListingPurpose.rent,
                          onSelected: (_) =>
                              setState(() => _filters = _filters.copyWith(purpose: ListingPurpose.rent)),
                        ),
                      ),
                    ],
                  ),

                  const _Label('السعر (دينار عراقي)'),
                  Row(
                    children: <Widget>[
                      Expanded(child: _NumberField(controller: _minPrice, hint: 'من', isPrice: true)),
                      const SizedBox(width: 12),
                      Expanded(child: _NumberField(controller: _maxPrice, hint: 'إلى', isPrice: true)),
                    ],
                  ),

                  const _Label('المساحة (م²)'),
                  Row(
                    children: <Widget>[
                      Expanded(child: _NumberField(controller: _minArea, hint: 'من')),
                      const SizedBox(width: 12),
                      Expanded(child: _NumberField(controller: _maxArea, hint: 'إلى')),
                    ],
                  ),

                  const _Label('غرف النوم (الحد الأدنى)'),
                  _CountSelector(
                    value: _filters.minBedrooms,
                    onChanged: (int? value) => setState(
                      () => _filters = value == null
                          ? _filters.copyWith(clearRooms: true)
                          : _filters.copyWith(minBedrooms: value),
                    ),
                  ),

                  const _Label('الحمامات (الحد الأدنى)'),
                  _CountSelector(
                    value: _filters.minBathrooms,
                    onChanged: (int? value) => setState(
                      () => _filters = value == null
                          ? _filters.copyWith(clearRooms: true)
                          : _filters.copyWith(minBathrooms: value),
                    ),
                  ),

                  const _Label('نوع البائع'),
                  Wrap(
                    spacing: 8,
                    children: <Widget>[
                      for (final (String value, String label) in const <(String, String)>[
                        ('INDIVIDUAL', 'مالك مباشر'),
                        ('OFFICE', 'مكتب عقاري'),
                        ('DEVELOPER', 'شركة تطوير'),
                      ])
                        ChoiceChip(
                          label: Text(label),
                          selected: _filters.sellerType == value,
                          onSelected: (bool selected) => setState(
                            () => _filters = _filters.copyWith(sellerType: selected ? value : null),
                          ),
                        ),
                    ],
                  ),

                  const SizedBox(height: 20),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: _filters.verifiedOnly,
                    onChanged: (bool value) => setState(() => _filters = _filters.copyWith(verifiedOnly: value)),
                    title: const Text('الإعلانات الموثّقة فقط'),
                    subtitle: Text(
                      'من بائعين تم التحقق من هويتهم.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    activeThumbColor: RivoColors.success,
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: _filters.hasReel,
                    onChanged: (bool value) => setState(() => _filters = _filters.copyWith(hasReel: value)),
                    title: const Text('التي تحتوي على ريل فقط'),
                    activeThumbColor: RivoColors.success,
                  ),

                  const _Label('الترتيب'),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: <Widget>[
                      for (final (String value, String label) in const <(String, String)>[
                        ('newest', 'الأحدث'),
                        ('price_asc', 'الأقل سعراً'),
                        ('price_desc', 'الأعلى سعراً'),
                        ('area_desc', 'الأكبر مساحة'),
                        ('relevance', 'الأكثر ملاءمة'),
                      ])
                        ChoiceChip(
                          label: Text(label),
                          selected: _filters.sort == value,
                          onSelected: (_) => setState(() => _filters = _filters.copyWith(sort: value)),
                        ),
                    ],
                  ),
                ],
              ),
            ),

            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                child: ElevatedButton(
                  onPressed: () => Navigator.pop(context, _collect()),
                  child: const Text('عرض النتائج'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(0, 22, 0, 10),
        child: Text(text, style: Theme.of(context).textTheme.titleMedium),
      );
}

class _NumberField extends StatelessWidget {
  const _NumberField({required this.controller, required this.hint, this.isPrice = false});

  final TextEditingController controller;
  final String hint;
  final bool isPrice;

  @override
  Widget build(BuildContext context) => TextField(
        controller: controller,
        keyboardType: TextInputType.number,
        textDirection: TextDirection.ltr,
        inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
        decoration: InputDecoration(
          hintText: hint,
          // Live preview of the grouped value so a user typing 250000000 can see
          // it is 250 million and not 25 million.
          helperText: isPrice && controller.text.isNotEmpty ? formatIqd(controller.text, compact: true) : null,
        ),
        onChanged: (_) => (context as Element).markNeedsBuild(),
      );
}

class _CountSelector extends StatelessWidget {
  const _CountSelector({required this.value, required this.onChanged});

  final int? value;
  final ValueChanged<int?> onChanged;

  @override
  Widget build(BuildContext context) => Wrap(
        spacing: 8,
        children: <Widget>[
          ChoiceChip(
            label: const Text('أي'),
            selected: value == null,
            onSelected: (_) => onChanged(null),
          ),
          for (int count = 1; count <= 5; count += 1)
            ChoiceChip(
              label: Text(count == 5 ? '+5' : '$count'),
              selected: value == count,
              onSelected: (_) => onChanged(count),
            ),
        ],
      );
}
