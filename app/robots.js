import { SITE_URL } from '@/lib/pages';

export default function robots() {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/api/', '/driver', '/bill/'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
