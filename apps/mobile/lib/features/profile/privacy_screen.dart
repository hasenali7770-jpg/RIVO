import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/config/business_rules.dart';
import '../../core/providers/providers.dart';
import '../../core/theme/rivo_colors.dart';
import '../../core/theme/rivo_theme.dart';

/// Privacy and traffic-data consent — Master Plan §4 and §13.
///
/// The plan requires explicit consent for telemetry, a working opt-out, and that
/// no user's raw track is ever exposed. This screen is where the user exercises
/// that control, and it states plainly what is and is not collected rather than
/// burying it in a policy document.
class PrivacyScreen extends ConsumerStatefulWidget {
  const PrivacyScreen({super.key});

  @override
  ConsumerState<PrivacyScreen> createState() => _PrivacyScreenState();
}

class _PrivacyScreenState extends ConsumerState<PrivacyScreen> {
  bool _saving = false;
  String? _error;

  Future<void> _setTelemetry(bool enabled) async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(authRepositoryProvider).setTelemetryConsent(enabled);
      await ref.read(authProvider.notifier).refreshProfile();

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            enabled
                ? 'شكراً لك. ستساهم بياناتك في تحسين دقة أوقات الوصول.'
                : 'تم إيقاف مشاركة بيانات الحركة، وسيتم حذف العينات المخزّنة.',
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = asApiException(error).display);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final RivoUser? user = ref.watch(currentUserProvider);

    return Scaffold(
      appBar: AppBar(
        leading: const BackButton(),
        title: const Text('الخصوصية'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        children: <Widget>[
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: RivoColors.surface,
              borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    const Icon(Icons.speed_rounded, size: 20, color: RivoColors.sand),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'المساهمة في بيانات الحركة',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                    if (_saving)
                      const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    else
                      Switch(
                        value: user?.telemetryOptIn ?? false,
                        activeThumbColor: RivoColors.success,
                        onChanged: _setTelemetry,
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  'عند التفعيل، يشارك التطبيق قياسات سرعة مجهولة أثناء القيادة '
                  'لتحسين تقديرات الازدحام وأوقات الوصول لجميع المستخدمين.',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ],
            ),
          ),

          if (_error != null) ...<Widget>[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: RivoColors.signalRed, fontSize: 13)),
          ],

          const SizedBox(height: 24),
          Text('ما الذي نجمعه؟', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),

          const _Point(
            icon: Icons.check_rounded,
            positive: true,
            text: 'السرعة والاتجاه والوقت، مرتبطة بمعرّف مؤقت عشوائي يتغيّر كل ١٢ ساعة.',
          ),
          const _Point(
            icon: Icons.check_rounded,
            positive: true,
            text: 'تُجمَّع القياسات مع قياسات سائقين آخرين قبل استخدامها، '
                'ولا تُستخدم أي مجموعة تقل عن ٥ جلسات مختلفة.',
          ),
          const _Point(
            icon: Icons.check_rounded,
            positive: true,
            text: 'تُحذف القياسات الخام نهائياً بعد ${RivoRules.telemetryRawRetentionDays} يوماً.',
          ),

          const SizedBox(height: 18),
          Text('ما الذي لا نجمعه؟', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),

          const _Point(
            icon: Icons.close_rounded,
            positive: false,
            text: 'لا نربط بيانات الحركة برقم هاتفك أو حسابك — لا يوجد معرّف حساب في السجل إطلاقاً.',
          ),
          const _Point(
            icon: Icons.close_rounded,
            positive: false,
            text: 'لا يستطيع أي موظف في ريفو الاطّلاع على مسار رحلاتك.',
          ),
          const _Point(
            icon: Icons.close_rounded,
            positive: false,
            text: 'لا نبيع بياناتك ولا نشاركها مع معلنين.',
          ),

          const SizedBox(height: 24),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: RivoColors.sand.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Icon(Icons.info_outline_rounded, size: 18, color: RivoColors.sand),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'إيقاف المشاركة يوقف الجمع فوراً، ويحذف ما هو مخزّن لديك من قياسات خام. '
                    'تبقى فقط المتوسطات المجمّعة التي لا يمكن ربطها بأي شخص.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),
          Text('أذونات الموقع', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(
            'يستخدم ريفو موقعك لعرض موقعك على الخريطة، حساب المسار، والإبلاغ عن حالة الطريق. '
            'يمكنك سحب الإذن في أي وقت من إعدادات الجهاز.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ],
      ),
    );
  }
}

class _Point extends StatelessWidget {
  const _Point({required this.icon, required this.positive, required this.text});

  final IconData icon;
  final bool positive;
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(
              icon,
              size: 16,
              color: positive ? RivoColors.success : RivoColors.signalRed,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(text, style: Theme.of(context).textTheme.bodyMedium),
            ),
          ],
        ),
      );
}
