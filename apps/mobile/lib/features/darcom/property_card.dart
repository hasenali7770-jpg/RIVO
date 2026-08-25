import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../core/api/models/property.dart';
import '../../core/theme/rivo_colors.dart';
import '../../core/theme/rivo_theme.dart';
import '../../shared/widgets/rivo_widgets.dart';

/// Listing card used across search results and favourites.
class PropertyCard extends StatelessWidget {
  const PropertyCard({
    required this.property,
    required this.onTap,
    this.onFavorite,
    super.key,
  });

  final PropertyListItem property;
  final VoidCallback onTap;
  final VoidCallback? onFavorite;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(RivoTheme.radiusMd),
      child: Container(
        decoration: BoxDecoration(
          color: RivoColors.surface,
          borderRadius: BorderRadius.circular(RivoTheme.radiusMd),
          border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            AspectRatio(
              aspectRatio: 16 / 10,
              child: Stack(
                fit: StackFit.expand,
                children: <Widget>[
                  if (property.coverUrl != null)
                    CachedNetworkImage(
                      imageUrl: property.coverUrl!,
                      fit: BoxFit.cover,
                      placeholder: (BuildContext context, String url) =>
                          Container(color: RivoColors.surfaceLighter),
                      errorWidget: (BuildContext context, String url, Object error) => Container(
                        color: RivoColors.surfaceLighter,
                        child: const Icon(Icons.image_not_supported_rounded, color: Colors.white24),
                      ),
                    )
                  else
                    Container(
                      color: RivoColors.surfaceLighter,
                      child: const Icon(Icons.home_rounded, size: 40, color: Colors.white24),
                    ),

                  // Gradient so the price stays legible over any photo.
                  Positioned.fill(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.bottomCenter,
                          end: Alignment.center,
                          colors: <Color>[Colors.black.withValues(alpha: 0.75), Colors.transparent],
                        ),
                      ),
                    ),
                  ),

                  Positioned(
                    top: 10,
                    right: 10,
                    child: Row(
                      children: <Widget>[
                        PurposeChip(isSale: property.purpose == ListingPurpose.sale),
                        if (property.isDemo) ...<Widget>[
                          const SizedBox(width: 6),
                          const DemoChip(),
                        ],
                      ],
                    ),
                  ),

                  if (onFavorite != null)
                    Positioned(
                      top: 6,
                      left: 6,
                      child: Material(
                        color: Colors.black.withValues(alpha: 0.35),
                        shape: const CircleBorder(),
                        child: IconButton(
                          iconSize: 20,
                          icon: Icon(
                            property.isFavorited ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                            color: property.isFavorited ? RivoColors.signalRed : Colors.white,
                          ),
                          onPressed: onFavorite,
                          tooltip: property.isFavorited ? 'إزالة من المحفوظات' : 'حفظ',
                        ),
                      ),
                    ),

                  Positioned(
                    bottom: 10,
                    right: 12,
                    left: 12,
                    child: Row(
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            formatIqd(property.priceIqd, compact: true),
                            style: const TextStyle(
                              fontSize: 19,
                              fontWeight: FontWeight.w700,
                              color: RivoColors.sand,
                            ),
                          ),
                        ),
                        if (property.hasReel)
                          const Icon(Icons.play_circle_fill_rounded, size: 20, color: Colors.white70),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          property.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ),
                      if (property.isVerified) const VerifiedChip(),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: <Widget>[
                      _Fact(icon: Icons.straighten_rounded, label: '${property.areaSqm} م²'),
                      if (property.bedrooms != null) ...<Widget>[
                        const SizedBox(width: 12),
                        _Fact(icon: Icons.bed_rounded, label: '${property.bedrooms}'),
                      ],
                      if (property.bathrooms != null) ...<Widget>[
                        const SizedBox(width: 12),
                        _Fact(icon: Icons.bathtub_rounded, label: '${property.bathrooms}'),
                      ],
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: <Widget>[
                      const Icon(Icons.place_rounded, size: 13, color: Colors.white38),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          <String?>[property.district, property.city].whereType<String>().join('، '),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                      if (property.distanceM != null)
                        Text(
                          formatDistance(property.distanceM),
                          style: Theme.of(context).textTheme.labelSmall,
                        ),
                    ],
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

class _Fact extends StatelessWidget {
  const _Fact({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 13, color: Colors.white38),
          const SizedBox(width: 4),
          Text(label, style: Theme.of(context).textTheme.bodySmall),
        ],
      );
}
