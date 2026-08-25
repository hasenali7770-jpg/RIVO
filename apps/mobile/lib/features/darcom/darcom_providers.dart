import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/models/property.dart';
import '../../core/api/repositories/properties_repository.dart';
import '../../core/providers/providers.dart';

/// Current search filters. Held app-wide so switching between the list and the
/// map view keeps the same filters applied.
final StateProvider<PropertyFilters> propertyFiltersProvider =
    StateProvider<PropertyFilters>((Ref ref) => const PropertyFilters());

/// Darcom view mode: list or map.
enum DarcomView { list, map }

final StateProvider<DarcomView> darcomViewProvider =
    StateProvider<DarcomView>((Ref ref) => DarcomView.list);

class PropertySearchState {
  const PropertySearchState({
    this.items = const <PropertyListItem>[],
    this.page = 1,
    this.total = 0,
    this.hasMore = false,
    this.loading = false,
    this.loadingMore = false,
    this.error,
  });

  final List<PropertyListItem> items;
  final int page;
  final int total;
  final bool hasMore;
  final bool loading;
  final bool loadingMore;
  final Object? error;

  PropertySearchState copyWith({
    List<PropertyListItem>? items,
    int? page,
    int? total,
    bool? hasMore,
    bool? loading,
    bool? loadingMore,
    Object? error,
    bool clearError = false,
  }) =>
      PropertySearchState(
        items: items ?? this.items,
        page: page ?? this.page,
        total: total ?? this.total,
        hasMore: hasMore ?? this.hasMore,
        loading: loading ?? this.loading,
        loadingMore: loadingMore ?? this.loadingMore,
        error: clearError ? null : (error ?? this.error),
      );
}

class PropertySearchNotifier extends StateNotifier<PropertySearchState> {
  PropertySearchNotifier(this._repository, this._filters) : super(const PropertySearchState()) {
    load();
  }

  final PropertiesRepository _repository;
  final PropertyFilters _filters;

  Future<void> load() async {
    state = state.copyWith(loading: true, clearError: true);
    try {
      final PropertyPage page = await _repository.search(filters: _filters, page: 1);
      state = PropertySearchState(
        items: page.items,
        page: page.page,
        total: page.total,
        hasMore: page.page < page.totalPages,
      );
    } catch (error) {
      state = state.copyWith(loading: false, error: error);
    }
  }

  Future<void> loadMore() async {
    if (!state.hasMore || state.loadingMore || state.loading) return;
    state = state.copyWith(loadingMore: true);
    try {
      final PropertyPage page = await _repository.search(filters: _filters, page: state.page + 1);
      state = state.copyWith(
        // Appended rather than replaced so the user's scroll position survives.
        items: <PropertyListItem>[...state.items, ...page.items],
        page: page.page,
        hasMore: page.page < page.totalPages,
        loadingMore: false,
      );
    } catch (error) {
      state = state.copyWith(loadingMore: false, error: error);
    }
  }

  /// Optimistic favourite toggle: the heart responds immediately and rolls back
  /// if the request fails, rather than making the user wait on a round trip.
  Future<void> toggleFavorite(String propertyId) async {
    final int index = state.items.indexWhere((PropertyListItem p) => p.id == propertyId);
    if (index < 0) return;

    final PropertyListItem original = state.items[index];
    final bool next = !original.isFavorited;

    final List<PropertyListItem> updated = List<PropertyListItem>.from(state.items);
    updated[index] = original.copyWith(isFavorited: next);
    state = state.copyWith(items: updated);

    try {
      if (next) {
        await _repository.favorite(propertyId);
      } else {
        await _repository.unfavorite(propertyId);
      }
    } catch (_) {
      final List<PropertyListItem> reverted = List<PropertyListItem>.from(state.items);
      reverted[index] = original;
      state = state.copyWith(items: reverted);
      rethrow;
    }
  }
}

final StateNotifierProvider<PropertySearchNotifier, PropertySearchState> propertySearchProvider =
    StateNotifierProvider<PropertySearchNotifier, PropertySearchState>((Ref ref) {
  // Rebuilds whenever the filters change, which re-runs the search.
  final PropertyFilters filters = ref.watch(propertyFiltersProvider);
  return PropertySearchNotifier(ref.watch(propertiesRepositoryProvider), filters);
});

final FutureProviderFamily<PropertyDetail, String> propertyDetailProvider =
    FutureProvider.family<PropertyDetail, String>(
  (Ref ref, String id) => ref.watch(propertiesRepositoryProvider).detail(id),
);

final FutureProvider<PropertyPage> myListingsProvider = FutureProvider<PropertyPage>(
  (Ref ref) => ref.watch(propertiesRepositoryProvider).mine(),
);

final FutureProvider<PropertyPage> favoritesProvider = FutureProvider<PropertyPage>(
  (Ref ref) => ref.watch(propertiesRepositoryProvider).favorites(),
);
