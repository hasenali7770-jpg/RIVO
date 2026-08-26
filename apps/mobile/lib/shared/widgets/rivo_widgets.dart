import 'package:flutter/material.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/rivo_colors.dart';
import '../../core/theme/rivo_theme.dart';

/// Formats an Iraqi dinar amount held as a string.
///
/// BigInt, not int: 250,000,000 IQD is common and larger values exist, and
/// parsing into a 32-bit int would silently truncate them.
String formatIqd(String raw, {bool compact = false}) {
  final BigInt? value = BigInt.tryParse(raw.replaceAll(RegExp(r'[^\d]'), ''));
  if (value == null) return raw;

  if (compact) {
    if (value >= BigInt.from(1000000000)) {
      return '${(value / BigInt.from(1000000000)).toStringAsFixed(1)} مليار د.ع';
    }
    if (value >= BigInt.from(1000000)) {
      return '${(value / BigInt.from(1000000)).toStringAsFixed(0)} مليون د.ع';
    }
    if (value >= BigInt.from(1000)) {
      return '${(value / BigInt.from(1000)).toStringAsFixed(0)} ألف د.ع';
    }
  }

  final String grouped = value.toString().replaceAllMapped(
        RegExp(r'\B(?=(\d{3})+(?!\d))'),
        (Match m) => ',',
      );
  return '$grouped د.ع';
}

String formatDistance(int? metres) {
  if (metres == null) return '';
  if (metres < 1000) return '$metres م';
  return '${(metres / 1000).toStringAsFixed(1)} كم';
}

/// Marks seeded sample content so it is never mistaken for a real listing
/// (Master Plan §5, §21).
class DemoChip extends StatelessWidget {
  const DemoChip({super.key});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: RivoColors.sand.withValues(alpha: 0.2),
          borderRadius: BorderRadius.circular(RivoTheme.radiusPill),
        ),
        child: const Text(
          'عيّنة',
          style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: RivoColors.sand),
        ),
      );
}

/// Shown only when the seller is genuinely verified — Master Plan §8.
class VerifiedChip extends StatelessWidget {
  const VerifiedChip({super.key});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: RivoColors.success.withValues(alpha: 0.18),
          borderRadius: BorderRadius.circular(RivoTheme.radiusPill),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.verified_rounded, size: 13, color: RivoColors.success),
            SizedBox(width: 4),
            Text(
              'موثّق',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: RivoColors.success),
            ),
          ],
        ),
      );
}

class PurposeChip extends StatelessWidget {
  const PurposeChip({required this.isSale, super.key});
  final bool isSale;

  @override
  Widget build(BuildContext context) {
    final Color color = isSale ? RivoColors.signalRed : RivoColors.sand;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.18),
        borderRadius: BorderRadius.circular(RivoTheme.radiusPill),
      ),
      child: Text(
        isSale ? 'للبيع' : 'للإيجار',
        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: color),
      ),
    );
  }
}

/// Error state that distinguishes "you are offline" from "the server failed" —
/// the user can act on the first and not the second.
class RivoErrorView extends StatelessWidget {
  const RivoErrorView({required this.error, this.onRetry, super.key});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final ApiException api = asApiException(error);

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(
              api.isOffline ? Icons.wifi_off_rounded : Icons.error_outline_rounded,
              size: 44,
              color: RivoColors.white.withValues(alpha: 0.4),
            ),
            const SizedBox(height: 16),
            Text(
              api.display,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            if (onRetry != null) ...<Widget>[
              const SizedBox(height: 20),
              OutlinedButton(onPressed: onRetry, child: const Text('إعادة المحاولة')),
            ],
          ],
        ),
      ),
    );
  }
}

class RivoEmptyView extends StatelessWidget {
  const RivoEmptyView({required this.title, this.hint, this.icon, this.action, super.key});

  final String title;
  final String? hint;
  final IconData? icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(icon ?? Icons.search_off_rounded, size: 44, color: RivoColors.white.withValues(alpha: 0.3)),
              const SizedBox(height: 16),
              Text(title, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
              if (hint != null) ...<Widget>[
                const SizedBox(height: 8),
                Text(hint!, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
              ],
              if (action != null) ...<Widget>[const SizedBox(height: 20), action!],
            ],
          ),
        ),
      );
}

class RivoLoading extends StatelessWidget {
  const RivoLoading({this.label, super.key});
  final String? label;

  @override
  Widget build(BuildContext context) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const SizedBox(
              width: 26,
              height: 26,
              child: CircularProgressIndicator(strokeWidth: 2.5),
            ),
            if (label != null) ...<Widget>[
              const SizedBox(height: 14),
              Text(label!, style: Theme.of(context).textTheme.bodySmall),
            ],
          ],
        ),
      );
}

/// Explains that a feature is off on this deployment because a credential is
/// missing, instead of showing a control that would fail (Master Plan §24).
class FeatureUnavailableView extends StatelessWidget {
  const FeatureUnavailableView({required this.feature, super.key});
  final String feature;

  @override
  Widget build(BuildContext context) => RivoEmptyView(
        icon: Icons.lock_outline_rounded,
        title: '$feature غير متاحة حالياً',
        hint: 'سيتم تفعيل هذه الميزة قريباً.',
      );
}
