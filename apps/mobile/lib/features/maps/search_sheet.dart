import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/models/route.dart';
import '../../core/providers/providers.dart';
import '../../core/theme/rivo_colors.dart';
import '../../shared/widgets/rivo_widgets.dart';

/// Destination search with saved Home/Work and recent destinations —
/// Master Plan §4 "Main map screen".
class SearchSheet extends ConsumerStatefulWidget {
  const SearchSheet({this.near, super.key});
  final LatLng? near;

  @override
  ConsumerState<SearchSheet> createState() => _SearchSheetState();
}

class _SearchSheetState extends ConsumerState<SearchSheet> {
  final TextEditingController _controller = TextEditingController();
  Timer? _debounce;
  List<PlaceResult> _results = <PlaceResult>[];
  List<Map<String, dynamic>> _savedPlaces = <Map<String, dynamic>>[];
  bool _searching = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_loadSavedPlaces());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _loadSavedPlaces() async {
    if (!ref.read(isSignedInProvider)) return;
    try {
      final List<dynamic> places =
          await ref.read(apiClientProvider).get<List<dynamic>>('/users/me/places');
      if (!mounted) return;
      setState(() => _savedPlaces = places.map((dynamic p) => Map<String, dynamic>.from(p as Map)).toList());
    } catch (_) {
      // Saved places are a convenience; search still works without them.
    }
  }

  void _onQueryChanged(String value) {
    _debounce?.cancel();
    if (value.trim().length < 2) {
      setState(() {
        _results = <PlaceResult>[];
        _error = null;
      });
      return;
    }
    // Debounced because each keystroke would otherwise cost a Mapbox geocoding
    // request, which is billed per call.
    _debounce = Timer(const Duration(milliseconds: 350), () => _search(value.trim()));
  }

  Future<void> _search(String query) async {
    setState(() {
      _searching = true;
      _error = null;
    });
    try {
      final List<PlaceResult> results =
          await ref.read(mapsRepositoryProvider).search(query, near: widget.near);
      if (!mounted) return;
      setState(() => _results = results);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = asApiException(error).display);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final double bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: DraggableScrollableSheet(
        initialChildSize: 0.85,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        expand: false,
        builder: (BuildContext context, ScrollController scrollController) => Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: TextField(
                controller: _controller,
                autofocus: true,
                onChanged: _onQueryChanged,
                decoration: InputDecoration(
                  hintText: 'ابحث عن عنوان أو منطقة…',
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: _searching
                      ? const Padding(
                          padding: EdgeInsets.all(14),
                          child: SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        )
                      : _controller.text.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.close_rounded),
                              onPressed: () {
                                _controller.clear();
                                _onQueryChanged('');
                              },
                            )
                          : null,
                ),
              ),
            ),

            Expanded(
              child: _error != null
                  ? RivoErrorView(
                      error: ApiException(code: 'SEARCH', message: _error!, messageAr: _error),
                      onRetry: () => _search(_controller.text.trim()),
                    )
                  : ListView(
                      controller: scrollController,
                      padding: const EdgeInsets.only(bottom: 24),
                      children: <Widget>[
                        if (_controller.text.isEmpty && _savedPlaces.isNotEmpty) ...<Widget>[
                          const _SectionLabel('الأماكن المحفوظة'),
                          for (final Map<String, dynamic> place in _savedPlaces)
                            ListTile(
                              leading: Icon(
                                place['kind'] == 'HOME'
                                    ? Icons.home_rounded
                                    : place['kind'] == 'WORK'
                                        ? Icons.work_rounded
                                        : Icons.bookmark_rounded,
                                color: RivoColors.sand,
                              ),
                              title: Text(place['label'] as String),
                              subtitle: place['address'] != null
                                  ? Text(
                                      place['address'] as String,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    )
                                  : null,
                              onTap: () => Navigator.pop(
                                context,
                                PlaceResult(
                                  id: place['id'] as String,
                                  name: place['label'] as String,
                                  address: (place['address'] as String?) ?? '',
                                  lat: (place['lat'] as num).toDouble(),
                                  lng: (place['lng'] as num).toDouble(),
                                ),
                              ),
                            ),
                        ],

                        if (_results.isNotEmpty) ...<Widget>[
                          const _SectionLabel('النتائج'),
                          for (final PlaceResult result in _results)
                            ListTile(
                              leading: const Icon(Icons.place_rounded, color: RivoColors.signalRed),
                              title: Text(result.name),
                              subtitle: Text(
                                result.address,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                              trailing: result.distanceM != null
                                  ? Text(
                                      formatDistance(result.distanceM),
                                      style: Theme.of(context).textTheme.labelSmall,
                                    )
                                  : null,
                              onTap: () => Navigator.pop(context, result),
                            ),
                        ],

                        if (_controller.text.length >= 2 && _results.isEmpty && !_searching)
                          const Padding(
                            padding: EdgeInsets.only(top: 60),
                            child: RivoEmptyView(
                              title: 'لا توجد نتائج',
                              hint: 'جرّب اسماً أو منطقة مختلفة.',
                            ),
                          ),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
        child: Text(text, style: Theme.of(context).textTheme.labelMedium),
      );
}
