import fs from 'fs';
import path from 'path';
import { sbConfigured } from './supabaseConfig';
import { sbRest } from './supabaseServer';
import { splitPageHtml } from './splitPage';

const ROOT = process.cwd();
export const SITE_URL = 'https://sadakyatra.co.in';

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/site/pages.json'), 'utf8'));
export const PAGES = config.pages;
export const REDIRECTS = config.redirects;

export function pageUrl(p) {
  if (p.path) return p.path;
  return p.htmlUrl ? `/${p.slug}.html` : `/${p.slug}`;
}

export function readSiteFile(name) {
  return fs.readFileSync(path.join(ROOT, 'content/site', name), 'utf8');
}

export function getPage(slug) {
  const dir = path.join(ROOT, 'content/pages', slug);
  if (!fs.existsSync(dir)) return null;
  return {
    html: fs.readFileSync(path.join(dir, 'page.html'), 'utf8'),
    meta: JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')),
  };
}

// meta.json ko Next.js metadata format mein badalta hai
export function toMetadata(meta) {
  const m = {
    title: { absolute: meta.title },
    description: meta.description,
    keywords: meta.keywords,
    robots: meta.robots || 'index, follow',
    alternates: meta.canonical ? { canonical: meta.canonical } : undefined,
    other: meta.other,
  };
  if (meta.og) {
    m.openGraph = {
      title: meta.og.title,
      description: meta.og.description,
      url: meta.og.url,
      type: meta.og.type || 'website',
      locale: meta.og.locale,
      siteName: meta.og.site_name,
      images: meta.og.image ? [meta.og.image] : undefined,
    };
  }
  if (meta.twitter) {
    m.twitter = {
      card: meta.twitter.card,
      title: meta.twitter.title,
      description: meta.twitter.description,
      images: meta.twitter.image ? [meta.twitter.image] : undefined,
    };
  }
  return m;
}

// Page ka content:
//  - Sections (text, photos, order) → admin panel (database) se
//  - Scripts, styles, schema, SEO meta → hamesha code (content/pages) se,
//    taaki code ke updates (slider, calculator fixes) bina re-import ke live ho jaayein
export async function getPageContent(slug) {
  const file = getPage(slug);
  const fileParts = file ? splitPageHtml(file.html) : null;
  if (sbConfigured()) {
    try {
      const s = encodeURIComponent(slug);
      const opts = { cache: 'force-cache', next: { tags: [`page:${slug}`] } };
      const [pRes, sRes] = await Promise.all([
        sbRest(`/rest/v1/web_pages?slug=eq.${s}&select=title,meta,head_html,script_html`, opts),
        sbRest(`/rest/v1/web_sections?page_slug=eq.${s}&select=id,html&order=position.asc,id.asc`, opts),
      ]);
      if (pRes.ok && sRes.ok) {
        const [page] = await pRes.json();
        const sections = await sRes.json();
        if (page) {
          const dbLooksStale = file?.meta?.title && page.title && page.title !== file.meta.title;
          if (dbLooksStale && file) {
            return { ...file, html: stripLegacy(file.html), source: 'file-stale-db' };
          }
          const head = fileParts ? fileParts.head_html : page.head_html;
          const scripts = stripLegacy(fileParts ? fileParts.script_html : page.script_html);
          const meta = file?.meta || page.meta || {};
          const html = [head, ...sections.map((x) => x.html), scripts].filter(Boolean).join('\n\n');
          return { meta, html, source: 'db' };
        }
      }
    } catch (e) {
      console.warn(`[pages] DB se "${slug}" nahi mila, file use kar rahe hain:`, e.message);
    }
  }
  if (!file) return null;
  return { ...file, html: stripLegacy(file.html), source: 'file' };
}

// Slider ab content/site/site.js mein hai — purana page-level slider script hatao
function stripLegacy(html) {
  return (html || '').replace(/<script>(?:(?!<\/script>)[\s\S])*svc-slide(?:(?!<\/script>)[\s\S])*<\/script>/g, '');
}
