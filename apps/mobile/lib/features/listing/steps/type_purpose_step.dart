import 'package:flutter/material.dart';

import '../../../core/api/models/property.dart';
import '../../../core/theme/rivo_colors.dart';
import '../../../core/theme/rivo_theme.dart';
import '../listing_draft.dart';

/// Step 2 — property type and purpose (Master Plan §6).
class TypePurposeStep extends StatelessWidget {
  const TypePurposeStep({required this.draft, required this.onChanged, super.key});

  final ListingDraft draft;
  final ValueChanged<ListingDraft> onChanged;

  static const Map<PropertyType, IconData> _icons = <PropertyType, IconData>{
    PropertyType.house: Icons.house_rounded,
    PropertyType.apartment: Icons.apartment_rounded,
    PropertyType.shop: Icons.storefront_rounded,
    PropertyType.building: Icons.location_city_rounded,
    PropertyType.land: Icons.crop_landscape_rounded,
    PropertyType.commercial: Icons.business_center_rounded,
  };

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
      children: <Widget>[
        Text('ما نوع العقار؟', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 16),

        GridView.count(
          crossAxisCount: 3,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          childAspectRatio: 0.95,
          children: <Widget>[
            for (final PropertyType type in PropertyType.values)
              _SelectTile(
                icon: _icons[type]!,
                label: type.labelAr,
                selected: draft.type == type,
                onTap: () => onChanged(draft.copyWith(type: type)),
              ),
          ],
        ),

        const SizedBox(height: 32),
        Text('للبيع أم للإيجار؟', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 16),

        Row(
          children: <Widget>[
            Expanded(
              child: _SelectTile(
                icon: Icons.sell_rounded,
                label: 'للبيع',
                selected: draft.purpose == ListingPurpose.sale,
                onTap: () => onChanged(draft.copyWith(purpose: ListingPurpose.sale)),
                height: 92,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _SelectTile(
                icon: Icons.key_rounded,
                label: 'للإيجار',
                selected: draft.purpose == ListingPurpose.rent,
                onTap: () => onChanged(draft.copyWith(purpose: ListingPurpose.rent)),
                height: 92,
              ),
            ),
          ],
        ),

        // Only asked when it is meaningful.
        if (draft.purpose == ListingPurpose.rent) ...<Widget>[
          const SizedBox(height: 24),
          Text('دورية الإيجار', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 10),
          Row(
            children: <Widget>[
              Expanded(
                child: ChoiceChip(
                  label: const Center(child: Text('شهري')),
                  selected: draft.rentPeriod == 'MONTHLY',
                  onSelected: (_) => onChanged(draft.copyWith(rentPeriod: 'MONTHLY')),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: ChoiceChip(
                  label: const Center(child: Text('سنوي')),
                  selected: draft.rentPeriod == 'YEARLY',
                  onSelected: (_) => onChanged(draft.copyWith(rentPeriod: 'YEARLY')),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }
}

class _SelectTile extends StatelessWidget {
  const _SelectTile({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
    this.height,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final double? height;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          height: height,
          decoration: BoxDecoration(
            color: selected ? RivoColors.signalRed.withValues(alpha: 0.14) : RivoColors.surface,
            borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
            border: Border.all(
              color: selected ? RivoColors.signalRed : Colors.white.withValues(alpha: 0.08),
              width: selected ? 1.6 : 1,
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Icon(icon, size: 28, color: selected ? RivoColors.signalRed : RivoColors.sand),
              const SizedBox(height: 8),
              Text(
                label,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                  color: selected ? RivoColors.signalRed : RivoColors.white,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
