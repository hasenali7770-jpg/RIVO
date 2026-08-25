import type { Config } from 'tailwindcss';

/**
 * RIVO brand palette — Master Plan §1.
 * Mirrors packages/config/src/brand.ts and the Flutter theme.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        petrol: {
          DEFAULT: '#071416',
          50: '#E7ECED',
          800: '#0B1D20',
          900: '#071416',
        },
        surface: {
          DEFAULT: '#102326',
          light: '#163034',
          lighter: '#1D3D42',
        },
        sand: {
          DEFAULT: '#D8C7A6',
          dim: '#B5A688',
          bright: '#EBDFC6',
        },
        signal: {
          DEFAULT: '#EF4B43',
          dim: '#C93E37',
          soft: 'rgba(239, 75, 67, 0.12)',
        },
        success: {
          DEFAULT: '#6E9D76',
          soft: 'rgba(110, 157, 118, 0.14)',
        },
        paper: '#F7F7F4',
      },
      fontFamily: {
        // Cairo and Tajawal render Arabic well and carry a full Latin set, so
        // one stack serves both scripts without a visible switch.
        sans: ['Cairo', 'Tajawal', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.25rem' },
      boxShadow: {
        card: '0 1px 2px rgba(7,20,22,0.06), 0 8px 24px rgba(7,20,22,0.06)',
        'card-dark': '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.3)',
      },
    },
  },
  plugins: [],
};
export default config;
