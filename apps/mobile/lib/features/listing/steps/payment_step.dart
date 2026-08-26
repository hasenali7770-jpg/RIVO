import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/api/api_exception.dart';
import '../../../core/config/business_rules.dart';
import '../../../core/providers/providers.dart';
import '../../../core/theme/rivo_colors.dart';
import '../../../core/theme/rivo_theme.dart';
import '../../../shared/widgets/rivo_widgets.dart';

/// Step 9 — the 3,000 IQD listing fee (Master Plan §6 step 9).
///
/// The single most important property of this screen: it NEVER decides that a
/// payment succeeded. Returning from the gateway proves nothing — the app polls
/// `/payments/:id/status`, which reflects only what the signature-verified
/// webhook reported. There is no code path here that marks a listing paid.
class PaymentStep extends ConsumerStatefulWidget {
  const PaymentStep({
    required this.propertyId,
    required this.paymentId,
    required this.onSubmitted,
    super.key,
  });

  final String propertyId;
  final String paymentId;

  /// Called once the server confirms the listing has entered moderation.
  final VoidCallback onSubmitted;

  @override
  ConsumerState<PaymentStep> createState() => _PaymentStepState();
}

class _PaymentStepState extends ConsumerState<PaymentStep> {
  Map<String, dynamic>? _payment;
  bool _loading = true;
  bool _openedGateway = false;
  String? _error;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    unawaited(_refresh());
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final Map<String, dynamic> payment =
          await ref.read(paymentsRepositoryProvider).status(widget.paymentId);

      if (!mounted) return;
      setState(() {
        _payment = payment;
        _loading = false;
        _error = null;
      });

      final String status = payment['status'] as String? ?? 'PENDING';
      if (status == 'PAID') {
        _poll?.cancel();
        // The server has already moved the listing into moderation; the app just
        // reflects that.
        widget.onSubmitted();
      } else if (status == 'FAILED' || status == 'EXPIRED' || status == 'CANCELLED') {
        _poll?.cancel();
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = asApiException(error).display;
      });
    }
  }

  void _startPolling() {
    _poll?.cancel();
    // Polls while the user is at the gateway. Stops on a terminal state or when
    // the screen goes away.
    _poll = Timer.periodic(const Duration(seconds: 4), (Timer timer) {
      if (timer.tick > 150) timer.cancel();
      unawaited(_refresh());
    });
  }

  Future<void> _openGateway(String url) async {
    final Uri uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      setState(() => _openedGateway = true);
      _startPolling();
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else {
      setState(() => _error = 'تعذّر فتح صفحة الدفع.');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const RivoLoading(label: 'جارٍ تجهيز عملية الدفع…');

    final Map<String, dynamic>? payment = _payment;
    if (payment == null) {
      return RivoErrorView(
        error: ApiException(
          code: 'PAYMENT',
          message: _error ?? 'Payment not found',
          messageAr: _error ?? 'تعذّر تحميل بيانات الدفع.',
        ),
        onRetry: _refresh,
      );
    }

    final String status = payment['status'] as String? ?? 'PENDING';
    final String? checkoutUrl = payment['checkoutUrl'] as String?;
    final bool requiresOnline = payment['requiresOnlineCheckout'] as bool? ?? false;
    final int amount = payment['amountIqd'] as int? ?? RivoRules.listingFeeIqd;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
      children: <Widget>[
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: RivoColors.surface,
            borderRadius: BorderRadius.circular(RivoTheme.radiusMd),
          ),
          child: Column(
            children: <Widget>[
              Text('رسوم نشر الإعلان', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 10),
              Text(
                formatIqd('$amount'),
                style: const TextStyle(
                  fontSize: 34,
                  fontWeight: FontWeight.w700,
                  color: RivoColors.sand,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'رقم المرجع: ${payment['merchantRef']}',
                textDirection: TextDirection.ltr,
                style: Theme.of(context).textTheme.labelSmall,
              ),
            ],
          ),
        ),

        const SizedBox(height: 20),
        _StatusBanner(status: status),

        if (_error != null) ...<Widget>[
          const SizedBox(height: 14),
          Text(
            _error!,
            style: const TextStyle(color: RivoColors.signalRed, fontSize: 13),
          ),
        ],

        const SizedBox(height: 20),

        if (status == 'PAID')
          const SizedBox.shrink()
        else if (requiresOnline && checkoutUrl != null) ...<Widget>[
          ElevatedButton.icon(
            onPressed: () => _openGateway(checkoutUrl),
            icon: const Icon(Icons.open_in_new_rounded, size: 18),
            label: Text(_openedGateway ? 'إعادة فتح صفحة الدفع' : 'المتابعة إلى الدفع'),
          ),
          if (_openedGateway) ...<Widget>[
            const SizedBox(height: 14),
            const Center(child: RivoLoading(label: 'بانتظار تأكيد الدفع…')),
            const SizedBox(height: 10),
            Text(
              'بعد إتمام الدفع، عُد إلى التطبيق وسيتم التأكيد تلقائياً.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ] else ...<Widget>[
          // Offline settlement: the honest description of how the business
          // actually takes 3,000 IQD before an online gateway exists.
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
                    const Icon(Icons.info_outline_rounded, size: 18, color: RivoColors.sand),
                    const SizedBox(width: 8),
                    Text(
                      'الدفع عبر فريق ريفو',
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(color: RivoColors.sand),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  (payment['instructionsAr'] as String?) ??
                      'سيتواصل معك فريق ريفو لاستلام رسوم النشر. '
                          'سيُرسل الإعلان إلى المراجعة فور تأكيد الدفع.',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: _refresh,
            icon: const Icon(Icons.refresh_rounded, size: 18),
            label: const Text('تحديث حالة الدفع'),
          ),
        ],

        const SizedBox(height: 24),
        Text(
          'لا يتم نشر الإعلان إلا بعد تأكيد الدفع من الخادم ثم موافقة فريق المراجعة.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.labelSmall,
        ),
      ],
    );
  }
}

class _StatusBanner extends StatelessWidget {
  const _StatusBanner({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final (Color color, IconData icon, String label) = switch (status) {
      'PAID' => (RivoColors.success, Icons.check_circle_rounded, 'تم تأكيد الدفع'),
      'PROCESSING' => (RivoColors.sand, Icons.sync_rounded, 'جارٍ معالجة الدفع'),
      'FAILED' => (RivoColors.signalRed, Icons.error_rounded, 'فشل الدفع. يمكنك المحاولة مرة أخرى.'),
      'EXPIRED' => (RivoColors.signalRed, Icons.timer_off_rounded, 'انتهت مهلة الدفع.'),
      'CANCELLED' => (RivoColors.signalRed, Icons.cancel_rounded, 'تم إلغاء الدفع.'),
      _ => (RivoColors.sand, Icons.schedule_rounded, 'بانتظار الدفع'),
    };

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
      ),
      child: Row(
        children: <Widget>[
          Icon(icon, size: 20, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: color),
            ),
          ),
        ],
      ),
    );
  }
}
