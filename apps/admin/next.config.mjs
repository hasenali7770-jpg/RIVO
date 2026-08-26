/**
 * The local API origin is plain HTTP, so a development build has to allow it
 * explicitly; a production build stays HTTPS-only. Photos come from R2 and
 * reels from Cloudflare Stream, both HTTPS, so nothing is lost by the
 * restriction — and a demonstration deployment that serves sample photos from
 * the API on localhost still works.
 */
const isDev = process.env.NODE_ENV !== 'production';
const localApi = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const devOrigin = isDev && localApi.startsWith('http://') ? ` ${localApi}` : '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The workspace packages ship TypeScript sources; Next must compile them
  // rather than expecting prebuilt CommonJS.
  transpilePackages: ['@rivo/config', '@rivo/contracts'],
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // The dashboard shows property photos from R2 and reels from
          // Cloudflare Stream, so those origins are allowed; nothing else is.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              `img-src 'self' data: blob: https:${devOrigin}`,
              `media-src 'self' blob: https:${devOrigin}`,
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              `connect-src 'self' https:${devOrigin}`,
              "frame-ancestors 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};
export default nextConfig;
