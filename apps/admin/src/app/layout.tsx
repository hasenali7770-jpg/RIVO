import type { Metadata, Viewport } from 'next';
import { Cairo } from 'next/font/google';
import '../styles/globals.css';
import { Providers } from './providers';

/**
 * Loaded through `next/font` rather than a <link> in <head>: Next self-hosts the
 * files at build time, so there is no request to fonts.googleapis.com on every
 * page load and no layout shift while the font arrives. It also means the
 * dashboard works on a network that cannot reach Google.
 */
const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-cairo',
});

export const metadata: Metadata = {
  title: 'RIVO — لوحة الإدارة',
  description: 'لوحة إدارة RIVO | ريفو — خرائط | داركم',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#071416',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={cairo.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
