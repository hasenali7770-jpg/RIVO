import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/models/property.dart';
import '../../core/api/repositories/media_repository.dart';
import '../../core/config/business_rules.dart';
import '../../core/providers/providers.dart';
import '../../core/theme/rivo_colors.dart';
import '../../core/theme/rivo_theme.dart';
import '../../shared/widgets/rivo_widgets.dart';
import 'listing_draft.dart';
import 'steps/details_step.dart';
import 'steps/enhancement_step.dart';
import 'steps/location_step.dart';
import 'steps/payment_step.dart';
import 'steps/photos_step.dart';
import 'steps/preview_step.dart';
import 'steps/reel_step.dart';
import 'steps/type_purpose_step.dart';

/// The property listing flow — Master Plan §6.
///
/// Order matters and is not negotiable: details → photos (8–18) → AI enhancement
/// → optional reel → preview → payment → moderation. Payment sits after preview
/// deliberately, so the seller sees exactly what they are paying to publish
/// (deck p.8, "الدفع بعد المعاينة").
class ListingWizardScreen extends ConsumerStatefulWidget {
  const ListingWizardScreen({this.propertyId, super.key});

  /// Set when resuming a draft that was rejected or sent back for changes.
  final String? propertyId;

  @override
  ConsumerState<ListingWizardScreen> createState() => _ListingWizardScreenState();
}

class _ListingWizardScreenState extends ConsumerState<ListingWizardScreen> {
  ListingStep _step = ListingStep.typeAndPurpose;
  ListingDraft _draft = const ListingDraft();

  bool _busy = false;
  String? _error;
  UploadProgress? _uploadProgress;
  String? _paymentId;

  @override
  void initState() {
    super.initState();
    if (widget.propertyId != null) _loadExisting(widget.propertyId!);
  }

  Future<void> _loadExisting(String id) async {
    setState(() => _busy = true);
    try {
      final PropertyDetail property = await ref.read(propertiesRepositoryProvider).ownerView(id);
      if (!mounted) return;
      setState(() {
        _draft = ListingDraft(
          propertyId: property.id,
          type: property.type,
          purpose: property.purpose,
          rentPeriod: property.rentPeriod ?? 'MONTHLY',
          lat: property.location?.lat,
          lng: property.location?.lng,
          placeLabel: property.location?.placeLabel,
          title: property.title,
          description: property.description ?? '',
          priceIqd: property.priceIqd,
          areaSqm: double.tryParse(property.areaSqm),
          bedrooms: property.bedrooms,
          bathrooms: property.bathrooms,
          floors: property.floors,
          floorNumber: property.floorNumber,
          yearBuilt: property.yearBuilt,
          furnished: property.furnished,
          governorate: property.governorate,
          city: property.city ?? '',
          district: property.district ?? '',
          addressLine: property.addressLine ?? '',
          contactPreference: property.contactPreference ?? 'BOTH',
          contactPhone: property.contactPhone ?? '',
          uploadedPhotoCount: property.photos.where((PropertyPhoto p) => p.kind == 'ORIGINAL').length,
        );
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = asApiException(error).display);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _update(ListingDraft draft) => setState(() {
        _draft = draft;
        _error = null;
      });

  Future<void> _next() async {
    setState(() => _error = null);

    switch (_step) {
      case ListingStep.typeAndPurpose:
        if (!_draft.typeAndPurposeComplete) return;
        setState(() => _step = ListingStep.location);

      case ListingStep.location:
        if (!_draft.locationComplete) return;
        setState(() => _step = ListingStep.details);

      case ListingStep.details:
        if (!_draft.detailsComplete) return;
        await _saveDraft();

      case ListingStep.photos:
        // The client-side gate. The server enforces the same rule, and the
        // database enforces it again on publish.
        if (!_draft.photosComplete) return;
        await _uploadPhotos();

      case ListingStep.enhancement:
        setState(() => _step = ListingStep.reel);

      case ListingStep.reel:
        setState(() => _step = ListingStep.preview);

      case ListingStep.preview:
        await _submitForPayment();

      case ListingStep.payment:
      case ListingStep.submitted:
        break;
    }
  }

  void _back() {
    if (_step == ListingStep.typeAndPurpose) {
      context.pop();
      return;
    }
    setState(() {
      _error = null;
      _step = ListingStep.values[_step.index - 1];
    });
  }

  /// Creates or updates the draft on the server before photos are attached.
  Future<void> _saveDraft() async {
    setState(() => _busy = true);
    try {
      final repository = ref.read(propertiesRepositoryProvider);
      final Map<String, dynamic> result = _draft.propertyId == null
          ? await repository.create(_draft.toCreatePayload())
          : await repository.update(_draft.propertyId!, _draft.toCreatePayload());

      if (!mounted) return;
      setState(() {
        _draft = _draft.copyWith(propertyId: result['id'] as String);
        _step = ListingStep.photos;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = asApiException(error).display);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _uploadPhotos() async {
    if (_draft.localPhotos.isEmpty) {
      // Already uploaded on a previous pass through the wizard.
      setState(() => _step = ListingStep.enhancement);
      return;
    }

    setState(() {
      _busy = true;
      _uploadProgress = const UploadProgress(completed: 0, total: 1);
    });

    try {
      final List<String> ids = await ref.read(mediaRepositoryProvider).uploadPhotos(
            propertyId: _draft.propertyId!,
            files: _draft.localPhotos,
            onProgress: (UploadProgress progress) {
              if (mounted) setState(() => _uploadProgress = progress);
            },
          );

      if (!mounted) return;
      setState(() {
        _draft = _draft.copyWith(
          uploadedPhotoCount: _draft.uploadedPhotoCount + ids.length,
          localPhotos: const <File>[],
        );
        _step = ListingStep.enhancement;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = asApiException(error).display);
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _uploadProgress = null;
        });
      }
    }
  }

  /// Submits the listing.
  ///
  /// A first submission moves it to AWAITING_PAYMENT and needs the 3,000 IQD
  /// payment. A listing that was rejected, fixed and resubmitted goes straight
  /// back to review — its fee was settled the first time — and the server says
  /// so with `nextStep: REVIEW`. Asking for payment again would be refused with
  /// PAYMENT_ALREADY_PAID and would show the seller an error for a submission
  /// that actually succeeded.
  Future<void> _submitForPayment() async {
    setState(() => _busy = true);
    try {
      final Map<String, dynamic> submission =
          await ref.read(propertiesRepositoryProvider).submit(_draft.propertyId!);

      if (submission['nextStep'] == 'REVIEW') {
        if (!mounted) return;
        setState(() => _step = ListingStep.submitted);
        return;
      }

      final Map<String, dynamic> payment =
          await ref.read(paymentsRepositoryProvider).createListingPayment(_draft.propertyId!);

      if (!mounted) return;
      setState(() {
        _paymentId = payment['id'] as String;
        _step = ListingStep.payment;
      });
    } catch (error) {
      if (!mounted) return;
      final ApiException api = asApiException(error);
      setState(() {
        _error = api.display;
        // The server refused on photo count: send the seller back to fix it
        // rather than leaving them stuck on a screen they cannot act on.
        if (api.code == 'PHOTO_COUNT_TOO_LOW' || api.code == 'PHOTO_COUNT_TOO_HIGH') {
          _step = ListingStep.photos;
        }
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _step == ListingStep.typeAndPurpose || _step == ListingStep.submitted,
      onPopInvokedWithResult: (bool didPop, Object? result) {
        if (!didPop) _back();
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(icon: const Icon(Icons.arrow_forward_rounded), onPressed: _back),
          title: Text(_step.titleAr),
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(4),
            child: LinearProgressIndicator(
              value: (_step.index + 1) / ListingStep.values.length,
              backgroundColor: RivoColors.surfaceLighter,
              color: RivoColors.signalRed,
              minHeight: 3,
            ),
          ),
        ),

        body: Column(
          children: <Widget>[
            if (_error != null)
              Container(
                width: double.infinity,
                margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: RivoColors.signalRed.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
                  border: Border.all(color: RivoColors.signalRed.withValues(alpha: 0.3)),
                ),
                child: Row(
                  children: <Widget>[
                    const Icon(Icons.error_outline_rounded, size: 18, color: RivoColors.signalRed),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _error!,
                        style: const TextStyle(color: RivoColors.signalRed, fontSize: 13),
                      ),
                    ),
                  ],
                ),
              ),

            Expanded(child: _buildStep()),
          ],
        ),

        bottomNavigationBar: _step == ListingStep.payment || _step == ListingStep.submitted
            ? null
            : _buildFooter(),
      ),
    );
  }

  Widget _buildStep() {
    if (_busy && _uploadProgress == null && _step != ListingStep.photos) {
      return const RivoLoading(label: 'جارٍ الحفظ…');
    }

    return switch (_step) {
      ListingStep.typeAndPurpose => TypePurposeStep(draft: _draft, onChanged: _update),
      ListingStep.location => LocationStep(draft: _draft, onChanged: _update),
      ListingStep.details => DetailsStep(draft: _draft, onChanged: _update),
      ListingStep.photos => PhotosStep(
          draft: _draft,
          onChanged: _update,
          uploading: _busy,
          progress: _uploadProgress,
        ),
      ListingStep.enhancement => EnhancementStep(propertyId: _draft.propertyId!),
      ListingStep.reel => ReelStep(draft: _draft, onChanged: _update),
      ListingStep.preview => PreviewStep(draft: _draft),
      ListingStep.payment => PaymentStep(
          propertyId: _draft.propertyId!,
          paymentId: _paymentId!,
          onSubmitted: () => setState(() => _step = ListingStep.submitted),
        ),
      ListingStep.submitted => _buildSubmitted(),
    };
  }

  Widget _buildFooter() {
    final bool canContinue = switch (_step) {
      ListingStep.typeAndPurpose => _draft.typeAndPurposeComplete,
      ListingStep.location => _draft.locationComplete,
      ListingStep.details => _draft.detailsComplete,
      ListingStep.photos => _draft.photosComplete,
      _ => true,
    };

    // The photo step explains exactly why the button is disabled, rather than
    // leaving the seller to guess.
    final String? blockedReason = _step == ListingStep.photos && !_draft.photosComplete
        ? _draft.photoCount > RivoRules.photoMax
            ? 'الحد الأعلى ${RivoRules.photoMax} صورة. احذف ${_draft.photoCount - RivoRules.photoMax} صورة للمتابعة.'
            : 'تحتاج ${_draft.photosStillNeeded} صورة إضافية (الحد الأدنى ${RivoRules.photoMin}).'
        : null;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            if (blockedReason != null) ...<Widget>[
              Text(
                blockedReason,
                textAlign: TextAlign.center,
                style: const TextStyle(color: RivoColors.sand, fontSize: 13),
              ),
              const SizedBox(height: 10),
            ],
            ElevatedButton(
              onPressed: canContinue && !_busy ? _next : null,
              child: _busy
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : Text(_step == ListingStep.preview ? 'المتابعة إلى الدفع' : 'التالي'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSubmitted() => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Icon(Icons.hourglass_top_rounded, size: 64, color: RivoColors.sand),
              const SizedBox(height: 20),
              Text(
                'إعلانك قيد المراجعة',
                style: Theme.of(context).textTheme.headlineMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              Text(
                'سيقوم فريق ريفو بمراجعة الإعلان والصور قبل النشر. سنُعلمك فور صدور القرار.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 32),
              ElevatedButton(
                onPressed: () => context.go('/my-listings'),
                child: const Text('عرض إعلاناتي'),
              ),
              const SizedBox(height: 10),
              TextButton(
                onPressed: () => context.go('/darcom'),
                child: const Text('العودة إلى داركم'),
              ),
            ],
          ),
        ),
      );
}
