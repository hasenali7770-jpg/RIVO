import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/providers/providers.dart';
import '../../core/theme/rivo_colors.dart';

/// Phone entry — Master Plan §6 step 1.
///
/// Accepts the three ways Iraqi numbers are actually typed (07XXXXXXXXX,
/// 9647XXXXXXXXX, +9647XXXXXXXXX); normalisation happens on the server so the
/// client never has to be the authority on it.
class PhoneEntryScreen extends ConsumerStatefulWidget {
  const PhoneEntryScreen({this.next, super.key});
  final String? next;

  @override
  ConsumerState<PhoneEntryScreen> createState() => _PhoneEntryScreenState();
}

class _PhoneEntryScreenState extends ConsumerState<PhoneEntryScreen> {
  final TextEditingController _controller = TextEditingController();
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  bool get _looksValid {
    final String digits = _controller.text.replaceAll(RegExp(r'\D'), '');
    // 07XXXXXXXXX is 11 digits; 9647XXXXXXXXX is 13.
    return digits.length >= 10 && digits.length <= 15;
  }

  Future<void> _submit() async {
    if (!_looksValid || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });

    try {
      final challenge = await ref.read(authRepositoryProvider).requestOtp(_controller.text.trim());
      if (!mounted) return;

      unawaited(
        context.push(
          '/auth/verify${widget.next != null ? '?next=${Uri.encodeComponent(widget.next!)}' : ''}',
          extra: <String, dynamic>{
            'phone': _controller.text.trim(),
            'challengeToken': challenge.challengeToken,
            'devCode': challenge.devCode,
          },
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = asApiException(error).display);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(leading: const BackButton()),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const SizedBox(height: 8),
              Text('RIVO', style: Theme.of(context).textTheme.displayMedium),
              const SizedBox(height: 4),
              Text(
                'خرائط | داركم',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: RivoColors.sand),
              ),
              const SizedBox(height: 40),

              Text('رقم الهاتف', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              Text(
                'سنرسل لك رمز تحقق من ٦ أرقام عبر رسالة نصية.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 20),

              TextField(
                controller: _controller,
                keyboardType: TextInputType.phone,
                textDirection: TextDirection.ltr,
                textAlign: TextAlign.left,
                autofocus: true,
                inputFormatters: <TextInputFormatter>[
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]')),
                  LengthLimitingTextInputFormatter(20),
                ],
                onChanged: (_) => setState(() => _error = null),
                onSubmitted: (_) => _submit(),
                decoration: const InputDecoration(
                  hintText: '07XX XXX XXXX',
                  hintTextDirection: TextDirection.ltr,
                  prefixIcon: Icon(Icons.phone_rounded),
                ),
                style: const TextStyle(fontSize: 18, letterSpacing: 1.2),
              ),

              if (_error != null) ...<Widget>[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: RivoColors.signalRed.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: RivoColors.signalRed, fontSize: 13),
                  ),
                ),
              ],

              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: _looksValid && !_sending ? _submit : null,
                child: _sending
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('إرسال رمز التحقق'),
              ),

              const SizedBox(height: 16),
              Text(
                'بالمتابعة أنت توافق على شروط الاستخدام وسياسة الخصوصية.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.labelSmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
