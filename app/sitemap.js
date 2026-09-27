import { PAGES, SITE_URL, pageUrl } from '@/lib/pages';

export default function sitemap() {
  const now = new Date();
  return PAGES.map((p) => ({
    url: SITE_URL + pageUrl(p),
    lastModified: now,
    changeFrequency: p.changefreq,
    priority: p.priority,
  }));
}
