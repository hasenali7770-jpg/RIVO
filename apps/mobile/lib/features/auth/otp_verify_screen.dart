import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/config/business_rules.dart';
import '../../core/providers/providers.dart';
import '../../core/theme/rivo_colors.dart';

class OtpVerifyScreen extends ConsumerStatefulWidget {
  const OtpVerifyScreen({
    required this.phone,
    required this.challengeToken,
    this.devCode,
    this.next,
    super.key,
  });

  final String phone;
  final String challengeToken;

  /// Present only when the server runs the development OTP provider. Used to
  /// prefill the field so the flow is testable without an SMS contract; the API
  /// refuses to boot that way in production, so it is never set there.
  final String? devCode;

  final String? next;

  @override
  ConsumerState<OtpVerifyScreen> createState() => _OtpVerifyScreenState();
}

class _OtpVerifyScreenState extends ConsumerState<OtpVerifyScreen> {
  final TextEditingController _controller = TextEditingController();
  String _challengeToken = '';
  bool _verifying = false;
  bool _resending = false;
  String? _error;
  int _secondsLeft = RivoRules.otpTtlSeconds;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _challengeToken = widget.challengeToken;
    if (widget.devCode != null) _controller.text = widget.devCode!;
    _startCountdown();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _startCountdown() {
    _timer?.cancel();
    setState(() => _secondsLeft = RivoRules.otpTtlSeconds);
    _timer = Timer.periodic(const Duration(seconds: 1), (Timer timer) {
      if (!mounted) return timer.cancel();
      setState(() => _secondsLeft = _secondsLeft > 0 ? _secondsLeft - 1 : 0);
      if (_secondsLeft == 0) timer.cancel();
    });
  }

  Future<void> _verify() async {
    if (_controller.text.length != RivoRules.otpCodeLength || _verifying) return;
    setState(() {
      _verifying = true;
      _error = null;
    });

    try {
      final user = await ref.read(authRepositoryProvider).verifyOtp(
            phone: widget.phone,
            challengeToken: _challengeToken,
            code: _controller.text,
            platform: Theme.of(context).platform == TargetPlatform.iOS ? 'ios' : 'android',
          );

      await ref.read(authProvider.notifier).completeSignIn(user);
      if (!mounted) return;

      context.go(widget.next != null && widget.next!.isNotEmpty
          ? Uri.decodeComponent(widget.next!)
          : '/maps',);
    } catch (error) {
      if (!mounted) return;
      final ApiException api = asApiException(error);
      setState(() {
        _error = api.display;
        // A wrong code is worth retyping; an expired or consumed one needs a
        // fresh challenge, so the field is cleared to make that obvious.
        if (api.code == 'OTP_EXPIRED' || api.code == 'OTP_INVALID') _controller.clear();
      });
    } finally {
      if (mounted) setState(() => _verifying = false);
    }
  }

  Future<void> _resend() async {
    if (_resending || _secondsLeft > 0) return;
    setState(() {
      _resending = true;
      _error = null;
    });

    try {
      final challenge = await ref.read(authRepositoryProvider).requestOtp(widget.phone);
      if (!mounted) return;
      setState(() {
        // The server invalidates the previous challenge, so the token must be
        // replaced or verification would fail against a dead code.
        _challengeToken = challenge.challengeToken;
        if (challenge.devCode != null) _controller.text = challenge.devCode!;
      });
      _startCountdown();
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = asApiException(error).display);
    } finally {
      if (mounted) setState(() => _resending = false);
    }
  }

  String get _countdownLabel {
    final int minutes = _secondsLeft ~/ 60;
    final int seconds = _secondsLeft % 60;
    return '$minutes:${seconds.toString().padLeft(2, '0')}';
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
              Text('رمز التحقق', style: Theme.of(context).textTheme.headlineLarge),
              const SizedBox(height: 8),
              Text.rich(
                TextSpan(
                  style: Theme.of(context).textTheme.bodyMedium,
                  children: <InlineSpan>[
                    const TextSpan(text: 'أرسلنا رمزاً من ٦ أرقام إلى '),
                    TextSpan(
                      text: widget.phone,
                      style: const TextStyle(fontWeight: FontWeight.w600, color: RivoColors.sand),
                    ),
                  ],
                ),
              ),

              if (widget.devCode != null) ...<Widget>[
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: RivoColors.sand.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: RivoColors.sand.withValues(alpha: 0.3)),
                  ),
                  child: const Text(
                    'وضع التطوير: لم تُرسل رسالة نصية فعلياً، وتم ملء الرمز تلقائياً.',
                    style: TextStyle(fontSize: 12, color: RivoColors.sand),
                  ),
                ),
              ],

              const SizedBox(height: 28),
              TextField(
                controller: _controller,
                keyboardType: TextInputType.number,
                textDirection: TextDirection.ltr,
                textAlign: TextAlign.center,
                autofocus: widget.devCode == null,
                maxLength: RivoRules.otpCodeLength,
                inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                onChanged: (String value) {
                  setState(() => _error = null);
                  // Submits itself on the sixth digit; making the user reach for
                  // a button after typing a code they just read is friction.
                  if (value.length == RivoRules.otpCodeLength) _verify();
                },
                decoration: const InputDecoration(counterText: '', hintText: '––––––'),
                style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w700, letterSpacing: 14),
              ),

              if (_error != null) ...<Widget>[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: RivoColors.signalRed.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    _error!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: RivoColors.signalRed, fontSize: 13),
                  ),
                ),
              ],

              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: _controller.text.length == RivoRules.otpCodeLength && !_verifying ? _verify : null,
                child: _verifying
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('تأكيد'),
              ),

              const SizedBox(height: 20),
              Center(
                child: _secondsLeft > 0
                    ? Text(
                        'يمكنك طلب رمز جديد بعد $_countdownLabel',
                        style: Theme.of(context).textTheme.bodySmall,
                      )
                    : TextButton(
                        onPressed: _resending ? null : _resend,
                        child: Text(_resending ? 'جارٍ الإرسال…' : 'إرسال رمز جديد'),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
