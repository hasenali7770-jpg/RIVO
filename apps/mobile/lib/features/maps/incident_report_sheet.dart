import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/models/route.dart';
import '../../core/providers/providers.dart';
import '../../core/theme/rivo_colors.dart';
import '../../core/theme/rivo_theme.dart';

/// Road incident reporting — Master Plan §4.
///
/// All seven reportable conditions, chosen in one tap. Designed to be usable at
/// a red light: large targets, no typing required, and the note is optional.
class IncidentReportSheet extends ConsumerStatefulWidget {
  const IncidentReportSheet({required this.at, super.key});
  final LatLng at;

  @override
  ConsumerState<IncidentReportSheet> createState() => _IncidentReportSheetState();
}

class _IncidentReportSheetState extends ConsumerState<IncidentReportSheet> {
  static const List<(IncidentType, String, IconData)> _options = <(IncidentType, String, IconData)>[
    (IncidentType.trafficJam, '🚗', Icons.traffic_rounded),
    (IncidentType.accident, '💥', Icons.car_crash_rounded),
    (IncidentType.roadClosure, '⛔', Icons.block_rounded),
    (IncidentType.roadWorks, '🚧', Icons.construction_rounded),
    (IncidentType.floodedRoad, '🌊', Icons.water_rounded),
    (IncidentType.pothole, '🕳️', Icons.dangerous_rounded),
    (IncidentType.hazard, '⚠️', Icons.warning_rounded),
  ];

  IncidentType? _selected;
  final TextEditingController _note = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_selected == null || _submitting) return;
    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      await ref.read(trafficRepositoryProvider).report(
            type: _selected!,
            at: widget.at,
            note: _note.text.trim().isEmpty ? null : _note.text.trim(),
          );
      if (!mounted) return;
      Navigator.pop(context, true);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('شكراً لك، تم إرسال البلاغ.')),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = asApiException(error).display);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text('الإبلاغ عن حالة طريق', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 6),
              Text(
                'سيساعد بلاغك السائقين الآخرين. لا يظهر اسمك لأحد.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 20),

              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: <Widget>[
                  for (final (IncidentType type, String glyph, IconData _) in _options)
                    _IncidentOption(
                      glyph: glyph,
                      label: type.labelAr,
                      selected: _selected == type,
                      onTap: () => setState(() => _selected = type),
                    ),
                ],
              ),

              const SizedBox(height: 20),
              TextField(
                controller: _note,
                maxLength: 280,
                maxLines: 2,
                decoration: const InputDecoration(
                  hintText: 'ملاحظة اختيارية…',
                  counterText: '',
                ),
              ),

              if (_error != null) ...<Widget>[
                const SizedBox(height: 10),
                Text(
                  _error!,
                  style: const TextStyle(color: RivoColors.signalRed, fontSize: 13),
                ),
              ],

              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: _selected != null && !_submitting ? _submit : null,
                child: _submitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('إرسال البلاغ'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _IncidentOption extends StatelessWidget {
  const _IncidentOption({
    required this.glyph,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String glyph;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 140),
          width: 96,
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
          decoration: BoxDecoration(
            color: selected
                ? RivoColors.signalRed.withValues(alpha: 0.16)
                : RivoColors.surfaceLighter,
            borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
            border: Border.all(
              color: selected ? RivoColors.signalRed : Colors.transparent,
              width: 1.5,
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(glyph, style: const TextStyle(fontSize: 26)),
              const SizedBox(height: 8),
              Text(
                label,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                  color: selected ? RivoColors.signalRed : RivoColors.white,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
