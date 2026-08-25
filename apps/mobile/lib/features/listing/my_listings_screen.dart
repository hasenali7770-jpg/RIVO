import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/models/property.dart';
import '../../core/api/repositories/properties_repository.dart';
import '../../core/config/business_rules.dart';
import '../../core/providers/providers.dart';
import '../../core/theme/rivo_colors.dart';
import '../../core/theme/rivo_theme.dart';
import '../../shared/widgets/rivo_widgets.dart';
import '../darcom/darcom_providers.dart';
import '../darcom/property_card.dart';

/// The seller's own listings and saved properties — Master Plan §8 user profile.
///
/// The important part is the status column: a seller whose listing was rejected
/// must see the reviewer's reason verbatim and be able to act on it, rather than
/// finding their listing silently absent (Master Plan §6 step 10).
class MyListingsScreen extends ConsumerStatefulWidget {
  const MyListingsScreen({super.key});

  @override
  ConsumerState<MyListingsScreen> createState() => _MyListingsScreenState();
}

class _MyListingsScreenState extends ConsumerState<MyListingsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 2, vsync: this);

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: const BackButton(),
        title: const Text('إعلاناتي'),
        bottom: TabBar(
          controller: _tabs,
          indicatorColor: RivoColors.signalRed,
          labelColor: RivoColors.signalRed,
          unselectedLabelColor: RivoColors.white,
          tabs: const <Widget>[
            Tab(text: 'إعلاناتي'),
            Tab(text: 'المحفوظة'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabs,
        children: const <Widget>[_MyListingsTab(), _FavoritesTab()],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/listing/new'),
        backgroundColor: RivoColors.signalRed,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_rounded),
        label: const Text('أضف عقاراً'),
      ),
    );
  }
}

class _MyListingsTab extends ConsumerWidget {
  const _MyListingsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<PropertyPage> async = ref.watch(myListingsProvider);

    return async.when(
      loading: () => const RivoLoading(),
      error: (Object error, StackTrace stack) => RivoErrorView(
        error: error,
        onRetry: () => ref.invalidate(myListingsProvider),
      ),
      data: (PropertyPage page) {
        if (page.items.isEmpty) {
          return RivoEmptyView(
            icon: Icons.home_work_outlined,
            title: 'لم تنشر أي عقار بعد',
            hint: 'انشر عقارك الأول ليصل إلى آلاف الباحثين.',
            action: ElevatedButton(
              onPressed: () => context.push('/listing/new'),
              child: const Text('أضف عقاراً'),
            ),
          );
        }

        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(myListingsProvider),
          color: RivoColors.signalRed,
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
            itemCount: page.items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (BuildContext context, int index) =>
                _OwnListingTile(property: page.items[index]),
          ),
        );
      },
    );
  }
}

class _OwnListingTile extends ConsumerWidget {
  const _OwnListingTile({required this.property});
  final PropertyListItem property;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return FutureBuilder<PropertyDetail>(
      future: ref.read(propertiesRepositoryProvider).ownerView(property.id),
      builder: (BuildContext context, AsyncSnapshot<PropertyDetail> snapshot) {
        final PropertyDetail? detail = snapshot.data;
        final PropertyStatus status = detail?.status ?? PropertyStatus.draft;

        final (Color color, IconData icon, String hint) = switch (status) {
          PropertyStatus.published => (RivoColors.success, Icons.check_circle_rounded, 'منشور ومرئي للجميع'),
          PropertyStatus.pendingReview => (RivoColors.sand, Icons.hourglass_top_rounded, 'قيد المراجعة'),
          PropertyStatus.awaitingPayment => (
              RivoColors.sand,
              Icons.payments_rounded,
              'بانتظار دفع ${RivoRules.listingFeeIqd} د.ع'
            ),
          PropertyStatus.changesRequested => (
              RivoColors.signalRed,
              Icons.edit_note_rounded,
              'مطلوب تعديل قبل النشر'
            ),
          PropertyStatus.rejected => (RivoColors.signalRed, Icons.cancel_rounded, 'لم يتم قبول الإعلان'),
          PropertyStatus.draft => (Colors.white38, Icons.edit_rounded, 'مسودة غير مكتملة'),
          _ => (Colors.white38, Icons.archive_rounded, status.labelAr),
        };

        return Container(
          decoration: BoxDecoration(
            color: RivoColors.surface,
            borderRadius: BorderRadius.circular(RivoTheme.radiusMd),
            border: Border.all(color: color.withValues(alpha: 0.25)),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: <Widget>[
              InkWell(
                onTap: status == PropertyStatus.published
                    ? () => context.push('/property/${property.id}')
                    : () => context.push('/listing/${property.id}/edit'),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: <Widget>[
                      ClipRRect(
                        borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
                        child: property.coverUrl != null
                            ? Image.network(
                                property.coverUrl!,
                                width: 76,
                                height: 60,
                                fit: BoxFit.cover,
                                errorBuilder: (_, __, ___) => Container(
                                  width: 76,
                                  height: 60,
                                  color: RivoColors.surfaceLighter,
                                ),
                              )
                            : Container(
                                width: 76,
                                height: 60,
                                color: RivoColors.surfaceLighter,
                                child: const Icon(Icons.home_rounded, color: Colors.white24),
                              ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              property.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            const SizedBox(height: 4),
                            Text(
                              formatIqd(property.priceIqd, compact: true),
                              style: const TextStyle(color: RivoColors.sand, fontWeight: FontWeight.w600),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '${property.photoCount} صورة · ${property.reference}',
                              textDirection: TextDirection.ltr,
                              style: Theme.of(context).textTheme.labelSmall,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                color: color.withValues(alpha: 0.1),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Icon(icon, size: 16, color: color),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            hint,
                            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: color),
                          ),
                          // The reviewer's reason, shown verbatim — the seller
                          // cannot fix what they are not told.
                          if (detail?.moderationReason != null) ...<Widget>[
                            const SizedBox(height: 4),
                            Text(
                              detail!.moderationReason!,
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (status.isEditable || status == PropertyStatus.awaitingPayment)
                      TextButton(
                        onPressed: () => context.push('/listing/${property.id}/edit'),
                        child: Text(
                          status == PropertyStatus.awaitingPayment ? 'إكمال الدفع' : 'تعديل',
                          style: const TextStyle(fontSize: 13),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _FavoritesTab extends ConsumerWidget {
  const _FavoritesTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<PropertyPage> async = ref.watch(favoritesProvider);

    return async.when(
      loading: () => const RivoLoading(),
      error: (Object error, StackTrace stack) => RivoErrorView(
        error: error,
        onRetry: () => ref.invalidate(favoritesProvider),
      ),
      data: (PropertyPage page) {
        if (page.items.isEmpty) {
          return const RivoEmptyView(
            icon: Icons.favorite_border_rounded,
            title: 'لا توجد عقارات محفوظة',
            hint: 'اضغط على القلب في أي إعلان لحفظه هنا.',
          );
        }

        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(favoritesProvider),
          color: RivoColors.signalRed,
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
            itemCount: page.items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 14),
            itemBuilder: (BuildContext context, int index) => PropertyCard(
              property: page.items[index],
              onTap: () => context.push('/property/${page.items[index].id}'),
            ),
          ),
        );
      },
    );
  }
}
