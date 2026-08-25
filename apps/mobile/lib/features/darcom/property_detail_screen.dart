import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/models/property.dart';
import '../../core/providers/providers.dart';
import '../../core/theme/rivo_colors.dart';
import '../../core/theme/rivo_theme.dart';
import '../../shared/widgets/rivo_widgets.dart';
import 'darcom_providers.dart';

/// Property detail — Master Plan §5 "Property details".
///
/// Includes the `اذهب إلى العقار` action, which is the hinge between Darcom and
/// RIVO Maps: it hands the listing's coordinates to navigation and starts route
/// planning.
class PropertyDetailScreen extends ConsumerStatefulWidget {
  const PropertyDetailScreen({required this.propertyId, super.key});
  final String propertyId;

  @override
  ConsumerState<PropertyDetailScreen> createState() => _PropertyDetailScreenState();
}

class _PropertyDetailScreenState extends ConsumerState<PropertyDetailScreen> {
  final PageController _gallery = PageController();
  int _photoIndex = 0;
  bool _favoriting = false;

  @override
  void dispose() {
    _gallery.dispose();
    super.dispose();
  }

  Future<void> _toggleFavorite(PropertyDetail property) async {
    if (!ref.read(isSignedInProvider)) {
      unawaited(
        context.push('/auth/phone?next=${Uri.encodeComponent('/property/${widget.propertyId}')}'),
      );
      return;
    }
    setState(() => _favoriting = true);
    try {
      final repository = ref.read(propertiesRepositoryProvider);
      if (property.isFavorited) {
        await repository.unfavorite(property.id);
      } else {
        await repository.favorite(property.id);
      }
      ref.invalidate(propertyDetailProvider(widget.propertyId));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(asApiException(error).display)),
      );
    } finally {
      if (mounted) setState(() => _favoriting = false);
    }
  }

  Future<void> _call(String phone) async {
    final Uri uri = Uri.parse('tel:$phone');
    if (await canLaunchUrl(uri)) await launchUrl(uri);
  }

  Future<void> _whatsapp(String phone) async {
    final String digits = phone.replaceAll(RegExp(r'[^\d]'), '');
    final Uri uri = Uri.parse('https://wa.me/$digits');
    if (await canLaunchUrl(uri)) await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  Future<void> _report(PropertyDetail property) async {
    if (!ref.read(isSignedInProvider)) {
      unawaited(
        context.push('/auth/phone?next=${Uri.encodeComponent('/property/${widget.propertyId}')}'),
      );
      return;
    }

    const List<(String, String)> reasons = <(String, String)>[
      ('FAKE_LISTING', 'إعلان وهمي'),
      ('WRONG_PRICE', 'سعر مضلل'),
      ('SOLD_ALREADY', 'مُباع أو مؤجَّر مسبقاً'),
      ('WRONG_LOCATION', 'الموقع غير صحيح'),
      ('OFFENSIVE', 'محتوى مسيء'),
      ('DUPLICATE', 'إعلان مكرر'),
      ('OTHER', 'سبب آخر'),
    ];

    final String? reason = await showModalBottomSheet<String>(
      context: context,
      builder: (BuildContext context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text('الإبلاغ عن الإعلان', style: Theme.of(context).textTheme.titleLarge),
            ),
            for (final (String value, String label) in reasons)
              ListTile(title: Text(label), onTap: () => Navigator.pop(context, value)),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );

    if (reason == null || !mounted) return;
    try {
      await ref.read(propertiesRepositoryProvider).report(property.id, reason: reason);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('شكراً لك. سيقوم فريقنا بمراجعة هذا الإعلان.')),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(asApiException(error).display)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<PropertyDetail> async = ref.watch(propertyDetailProvider(widget.propertyId));

    return Scaffold(
      body: async.when(
        loading: () => const RivoLoading(),
        error: (Object error, StackTrace stack) => Scaffold(
          appBar: AppBar(leading: const BackButton()),
          body: RivoErrorView(
            error: error,
            onRetry: () => ref.invalidate(propertyDetailProvider(widget.propertyId)),
          ),
        ),
        data: (PropertyDetail property) => _buildContent(property),
      ),
      bottomNavigationBar: async.valueOrNull == null ? null : _buildActionBar(async.value!),
    );
  }

  Widget _buildContent(PropertyDetail property) {
    return CustomScrollView(
      slivers: <Widget>[
        SliverAppBar(
          expandedHeight: 300,
          pinned: true,
          leading: const BackButton(),
          actions: <Widget>[
            IconButton(
              icon: Icon(
                property.isFavorited ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                color: property.isFavorited ? RivoColors.signalRed : null,
              ),
              onPressed: _favoriting ? null : () => _toggleFavorite(property),
              tooltip: 'حفظ',
            ),
            IconButton(
              icon: const Icon(Icons.share_rounded),
              onPressed: () => Share.share(
                '${property.title}\n${formatIqd(property.priceIqd)}\nRIVO — داركم',
              ),
              tooltip: 'مشاركة',
            ),
            IconButton(
              icon: const Icon(Icons.flag_outlined),
              onPressed: () => _report(property),
              tooltip: 'إبلاغ',
            ),
          ],
          flexibleSpace: FlexibleSpaceBar(
            background: _buildGallery(property),
          ),
        ),

        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 140),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    PurposeChip(isSale: property.purpose == ListingPurpose.sale),
                    const SizedBox(width: 8),
                    if (property.seller.isVerified) const VerifiedChip(),
                    if (property.isDemo) ...<Widget>[const SizedBox(width: 8), const DemoChip()],
                  ],
                ),
                const SizedBox(height: 14),

                Text(
                  formatIqd(property.priceIqd),
                  style: const TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w700,
                    color: RivoColors.sand,
                  ),
                ),
                if (property.rentPeriod != null)
                  Text(
                    property.rentPeriod == 'MONTHLY' ? 'شهرياً' : 'سنوياً',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),

                const SizedBox(height: 12),
                Text(property.title, style: Theme.of(context).textTheme.headlineMedium),

                const SizedBox(height: 6),
                Row(
                  children: <Widget>[
                    const Icon(Icons.place_rounded, size: 15, color: Colors.white38),
                    const SizedBox(width: 5),
                    Expanded(
                      child: Text(
                        <String?>[property.district, property.city, property.governorate]
                            .whereType<String>()
                            .join('، '),
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 20),
                _buildFacts(property),

                if (property.description != null && property.description!.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 24),
                  Text('الوصف', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Text(property.description!, style: Theme.of(context).textTheme.bodyLarge),
                ],

                if (property.location != null) ...<Widget>[
                  const SizedBox(height: 24),
                  Text('الموقع', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  if (property.location!.isApproximate)
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: RivoColors.sand.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
                      ),
                      child: Row(
                        children: <Widget>[
                          const Icon(Icons.info_outline_rounded, size: 16, color: RivoColors.sand),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'الموقع تقريبي ضمن نطاق ${property.location!.approxRadiusM} متر.',
                              style: const TextStyle(fontSize: 12, color: RivoColors.sand),
                            ),
                          ),
                        ],
                      ),
                    )
                  else if (property.location!.placeLabel != null)
                    Text(property.location!.placeLabel!, style: Theme.of(context).textTheme.bodyMedium),
                ],

                const SizedBox(height: 24),
                Text('البائع', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 10),
                Row(
                  children: <Widget>[
                    CircleAvatar(
                      radius: 22,
                      backgroundColor: RivoColors.surfaceLighter,
                      child: Icon(
                        property.seller.sellerType == 'OFFICE'
                            ? Icons.business_rounded
                            : Icons.person_rounded,
                        color: RivoColors.sand,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            property.seller.officeName ??
                                property.seller.displayName ??
                                'بائع في ريفو',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          Text(
                            switch (property.seller.sellerType) {
                              'OFFICE' => 'مكتب عقاري',
                              'DEVELOPER' => 'شركة تطوير',
                              _ => 'مالك مباشر',
                            },
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    if (property.seller.isVerified) const VerifiedChip(),
                  ],
                ),

                const SizedBox(height: 24),
                Row(
                  children: <Widget>[
                    Text(
                      '${property.viewCount} مشاهدة · ${property.favoriteCount} حفظ',
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                    const Spacer(),
                    Text(
                      'رقم الإعلان ${property.reference}',
                      textDirection: TextDirection.ltr,
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildGallery(PropertyDetail property) {
    if (property.photos.isEmpty) {
      return Container(
        color: RivoColors.surfaceLighter,
        child: const Icon(Icons.home_rounded, size: 64, color: Colors.white24),
      );
    }

    return Stack(
      fit: StackFit.expand,
      children: <Widget>[
        PageView.builder(
          controller: _gallery,
          itemCount: property.photos.length,
          onPageChanged: (int index) => setState(() => _photoIndex = index),
          itemBuilder: (BuildContext context, int index) {
            final PropertyPhoto photo = property.photos[index];
            return photo.url == null
                ? Container(color: RivoColors.surfaceLighter)
                : CachedNetworkImage(
                    imageUrl: photo.url!,
                    fit: BoxFit.cover,
                    placeholder: (BuildContext c, String u) => Container(color: RivoColors.surfaceLighter),
                    errorWidget: (BuildContext c, String u, Object e) =>
                        Container(color: RivoColors.surfaceLighter),
                  );
          },
        ),

        Positioned(
          bottom: 12,
          left: 0,
          right: 0,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              for (int i = 0; i < property.photos.length; i += 1)
                AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  width: i == _photoIndex ? 18 : 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: i == _photoIndex ? RivoColors.sand : Colors.white38,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
            ],
          ),
        ),

        if (property.reel != null)
          Positioned(
            bottom: 28,
            right: 16,
            child: FilledButton.tonalIcon(
              onPressed: () => context.push('/reels'),
              icon: const Icon(Icons.play_arrow_rounded, size: 18),
              label: const Text('شاهد الريل'),
            ),
          ),
      ],
    );
  }

  Widget _buildFacts(PropertyDetail property) {
    final List<(IconData, String, String)> facts = <(IconData, String, String)>[
      (Icons.straighten_rounded, 'المساحة', '${property.areaSqm} م²'),
      (Icons.home_work_rounded, 'النوع', property.type.labelAr),
      if (property.bedrooms != null) (Icons.bed_rounded, 'غرف النوم', '${property.bedrooms}'),
      if (property.bathrooms != null) (Icons.bathtub_rounded, 'الحمامات', '${property.bathrooms}'),
      if (property.floors != null) (Icons.layers_rounded, 'الطوابق', '${property.floors}'),
      if (property.floorNumber != null) (Icons.stairs_rounded, 'الطابق', '${property.floorNumber}'),
      if (property.yearBuilt != null) (Icons.calendar_today_rounded, 'سنة البناء', '${property.yearBuilt}'),
      if (property.furnished != null)
        (Icons.chair_rounded, 'التأثيث', property.furnished! ? 'مفروش' : 'غير مفروش'),
    ];

    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: <Widget>[
        for (final (IconData icon, String label, String value) in facts)
          Container(
            width: (MediaQuery.of(context).size.width - 50) / 2,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: RivoColors.surface,
              borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
            ),
            child: Row(
              children: <Widget>[
                Icon(icon, size: 18, color: RivoColors.sand),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(label, style: Theme.of(context).textTheme.labelSmall),
                      Text(value, style: Theme.of(context).textTheme.titleMedium),
                    ],
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildActionBar(PropertyDetail property) {
    final String? phone = property.contactPhone;

    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        decoration: BoxDecoration(
          color: RivoColors.surface,
          border: Border(top: BorderSide(color: Colors.white.withValues(alpha: 0.06))),
        ),
        child: Row(
          children: <Widget>[
            // The Darcom → Maps hinge (Master Plan §5). Navigation resolves the
            // destination by property id on the server, so it always routes to
            // the coordinate the listing actually publishes.
            Expanded(
              flex: 3,
              child: ElevatedButton.icon(
                onPressed: property.location == null
                    ? null
                    : () => context.push(
                          '/navigate',
                          extra: <String, dynamic>{
                            'lat': property.location!.lat,
                            'lng': property.location!.lng,
                            'label': property.title,
                            'propertyId': property.id,
                          },
                        ),
                icon: const Icon(Icons.navigation_rounded, size: 20),
                label: const Text('اذهب إلى العقار'),
              ),
            ),
            if (phone != null && property.canCall) ...<Widget>[
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _call(phone),
                  child: const Icon(Icons.phone_rounded, size: 20),
                ),
              ),
            ],
            if (phone != null && property.canWhatsapp) ...<Widget>[
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _whatsapp(phone),
                  child: const Icon(Icons.chat_rounded, size: 20),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
