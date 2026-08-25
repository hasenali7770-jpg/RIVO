/**
 * RIVO brand tokens — Master Plan §1.
 * Mirrored in apps/mobile/lib/core/theme/rivo_colors.dart and apps/admin/tailwind.config.ts.
 */
export const RIVO_BRAND = {
  name: 'RIVO',
  nameAr: 'ريفو',
  tagline: 'خرائط | داركم',
  colors: {
    /** Deep petroleum — app and map background (dark theme base). */
    petrol: '#071416',
    /** Raised surface / cards on the dark theme. */
    surface: '#102326',
    /** Warm sand — prices, premium highlights. */
    sand: '#D8C7A6',
    /** Signal red — fastest route, primary CTA, critical alerts. */
    signalRed: '#EF4B43',
    /** Muted green — verified badge, success states. */
    success: '#6E9D76',
    /** Off-white — primary text on dark, background on light. */
    white: '#F7F7F4',
  },
} as const;

/** Semantic role mapping, aligned with the presentation deck (docs/architecture/AUDIT.md §A.3). */
export const RIVO_SEMANTIC_COLORS = {
  fastestRoute: RIVO_BRAND.colors.signalRed,
  alternativeRoute: '#5B7C80',
  price: RIVO_BRAND.colors.sand,
  verified: RIVO_BRAND.colors.success,
  forSale: RIVO_BRAND.colors.signalRed,
  forRent: RIVO_BRAND.colors.sand,
  danger: RIVO_BRAND.colors.signalRed,
} as const;

export const SUPPORTED_LOCALES = ['ar', 'en', 'ku'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'ar';
/** Locales rendered right-to-left. */
export const RTL_LOCALES: readonly SupportedLocale[] = ['ar', 'ku'];
