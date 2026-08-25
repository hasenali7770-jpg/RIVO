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
              "img-src 'self' data: blob: https:",
              "media-src 'self' blob: https:",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "connect-src 'self' https: http://localhost:3000",
              "frame-ancestors 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};
export default nextConfig;
