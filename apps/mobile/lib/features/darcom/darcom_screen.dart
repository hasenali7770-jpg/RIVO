import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/models/property.dart';
import '../../core/api/repositories/properties_repository.dart';
import '../../core/providers/providers.dart';
import '../../core/theme/rivo_colors.dart';
import '../../shared/widgets/rivo_widgets.dart';
import 'darcom_providers.dart';
import 'filters_sheet.dart';
import 'property_card.dart';

/// Darcom — the real-estate marketplace inside RIVO (Master Plan §5).
class DarcomScreen extends ConsumerStatefulWidget {
  const DarcomScreen({super.key});

  @override
  ConsumerState<DarcomScreen> createState() => _DarcomScreenState();
}

class _DarcomScreenState extends ConsumerState<DarcomScreen> {
  final ScrollController _scroll = ScrollController();
  final TextEditingController _search = TextEditingController();

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scroll.removeListener(_onScroll);
    _scroll.dispose();
    _search.dispose();
    super.dispose();
  }

  void _onScroll() {
    // Prefetch a screen ahead so the next page is usually already there by the
    // time the user reaches the bottom.
    if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 600) {
      ref.read(propertySearchProvider.notifier).loadMore();
    }
  }

  void _applySearch(String value) {
    ref.read(propertyFiltersProvider.notifier).update(
          (PropertyFilters filters) => filters.copyWith(query: value.trim()),
        );
  }

  Future<void> _openFilters() async {
    final PropertyFilters? updated = await showModalBottomSheet<PropertyFilters>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext context) => FiltersSheet(initial: ref.read(propertyFiltersProvider)),
    );
    if (updated != null) {
      ref.read(propertyFiltersProvider.notifier).state = updated;
    }
  }

  @override
  Widget build(BuildContext context) {
    final PropertySearchState state = ref.watch(propertySearchProvider);
    final PropertyFilters filters = ref.watch(propertyFiltersProvider);
    final bool signedIn = ref.watch(isSignedInProvider);

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: TextField(
                      controller: _search,
                      textInputAction: TextInputAction.search,
                      onSubmitted: _applySearch,
                      decoration: InputDecoration(
                        hintText: 'ابحث عن منطقة أو عنوان…',
                        prefixIcon: const Icon(Icons.search_rounded),
                        suffixIcon: _search.text.isNotEmpty
                            ? IconButton(
                                icon: const Icon(Icons.close_rounded),
                                onPressed: () {
                                  _search.clear();
                                  _applySearch('');
                                },
                              )
                            : null,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Badge(
                    isLabelVisible: filters.activeCount > 0,
                    label: Text('${filters.activeCount}'),
                    backgroundColor: RivoColors.signalRed,
                    child: IconButton.filledTonal(
                      onPressed: _openFilters,
                      icon: const Icon(Icons.tune_rounded),
                      tooltip: 'الفلاتر',
                    ),
                  ),
                ],
              ),
            ),

            _QuickFilters(filters: filters),

            Expanded(child: _buildBody(state, signedIn)),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push(signedIn ? '/listing/new' : '/auth/phone?next=%2Flisting%2Fnew'),
        backgroundColor: RivoColors.signalRed,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_rounded),
        label: const Text('أضف عقارك'),
      ),
    );
  }

  Widget _buildBody(PropertySearchState state, bool signedIn) {
    if (state.loading && state.items.isEmpty) {
      return const RivoLoading(label: 'جارٍ تحميل العقارات…');
    }

    if (state.error != null && state.items.isEmpty) {
      return RivoErrorView(
        error: state.error!,
        onRetry: () => ref.read(propertySearchProvider.notifier).load(),
      );
    }

    if (state.items.isEmpty) {
      return RivoEmptyView(
        icon: Icons.home_work_outlined,
        title: 'لا توجد عقارات مطابقة',
        hint: ref.read(propertyFiltersProvider).isActive
            ? 'جرّب توسيع نطاق البحث أو إزالة بعض الفلاتر.'
            : 'كن أول من ينشر عقاراً في منطقتك.',
        action: ref.read(propertyFiltersProvider).isActive
            ? OutlinedButton(
                onPressed: () {
                  _search.clear();
                  ref.read(propertyFiltersProvider.notifier).state = const PropertyFilters();
                },
                child: const Text('مسح الفلاتر'),
              )
            : null,
      );
    }

    return RefreshIndicator(
      onRefresh: () => ref.read(propertySearchProvider.notifier).load(),
      color: RivoColors.signalRed,
      child: ListView.separated(
        controller: _scroll,
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 120),
        itemCount: state.items.length + (state.hasMore ? 1 : 0),
        separatorBuilder: (BuildContext context, int index) => const SizedBox(height: 14),
        itemBuilder: (BuildContext context, int index) {
          if (index >= state.items.length) {
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: RivoLoading(),
            );
          }

          final PropertyListItem property = state.items[index];
          return PropertyCard(
            property: property,
            onTap: () => context.push('/property/${property.id}'),
            onFavorite: signedIn
                ? () async {
                    try {
                      await ref.read(propertySearchProvider.notifier).toggleFavorite(property.id);
                    } catch (error) {
                      if (!context.mounted) return;
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(asApiException(error).display)),
                      );
                    }
                  }
                // Signed out, tapping the heart routes to sign-in rather than
                // silently doing nothing.
                : () => context.push('/auth/phone?next=%2Fdarcom'),
          );
        },
      ),
    );
  }
}

/// Sale / rent and property-type shortcuts, the two filters people reach for
/// first (Master Plan §5).
class _QuickFilters extends ConsumerWidget {
  const _QuickFilters({required this.filters});
  final PropertyFilters filters;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    void setPurpose(ListingPurpose? purpose) {
      ref.read(propertyFiltersProvider.notifier).update(
            (PropertyFilters f) => purpose == null
                ? f.copyWith(clearPurpose: true)
                : f.copyWith(purpose: purpose),
          );
    }

    void toggleType(PropertyType type) {
      final Set<PropertyType> next = Set<PropertyType>.from(filters.types);
      next.contains(type) ? next.remove(type) : next.add(type);
      ref.read(propertyFiltersProvider.notifier).update((PropertyFilters f) => f.copyWith(types: next));
    }

    return SizedBox(
      height: 42,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        children: <Widget>[
          ChoiceChip(
            label: const Text('الكل'),
            selected: filters.purpose == null,
            onSelected: (_) => setPurpose(null),
          ),
          const SizedBox(width: 8),
          ChoiceChip(
            label: const Text('للبيع'),
            selected: filters.purpose == ListingPurpose.sale,
            onSelected: (_) => setPurpose(ListingPurpose.sale),
          ),
          const SizedBox(width: 8),
          ChoiceChip(
            label: const Text('للإيجار'),
            selected: filters.purpose == ListingPurpose.rent,
            onSelected: (_) => setPurpose(ListingPurpose.rent),
          ),
          const SizedBox(width: 16),
          for (final PropertyType type in PropertyType.values) ...<Widget>[
            FilterChip(
              label: Text(type.labelAr),
              selected: filters.types.contains(type),
              onSelected: (_) => toggleType(type),
            ),
            const SizedBox(width: 8),
          ],
        ],
      ),
    );
  }
}
