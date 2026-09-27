import fs from 'fs';

const cfg = JSON.parse(fs.readFileSync('./content/site/pages.json', 'utf8'));
const htmlPages = cfg.pages.filter((p) => p.htmlUrl);

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,

  // Vercel pe server ko content files bhi chahiye (page import ke liye)
  outputFileTracingIncludes: {
    '/*': ['./content/**/*'],
    '/**/*': ['./content/**/*'],
  },

  // Purane URLs (.html wale) same rakhne ke liye:
  // /cab-service-muzaffarpur.html  →  andar se /cab-service-muzaffarpur page dikhata hai (URL nahi badalta)
  async rewrites() {
    return htmlPages.map((p) => ({ source: `/${p.slug}.html`, destination: `/${p.slug}` }));
  },

  async redirects() {
    return [
      // www.sadakyatra.co.in → sadakyatra.co.in
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.sadakyatra.co.in' }],
        destination: 'https://sadakyatra.co.in/:path*',
        permanent: true,
      },
      // bina .html wala URL → .html wala (duplicate page se bachne ke liye)
      ...htmlPages.map((p) => ({ source: `/${p.slug}`, destination: `/${p.slug}.html`, permanent: true })),
      // Hataye / merge kiye gaye pages
      ...cfg.redirects.map((r) => ({ source: r.from, destination: r.to, permanent: true })),
    ];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
