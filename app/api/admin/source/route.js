import { getPage } from '@/lib/pages';
import { splitPageHtml } from '@/lib/splitPage';
import { isAdminRequest } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

// Website files se ek page ko sections mein tod ke deta hai (Import ke liye)
export async function GET(req) {
  if (!(await isAdminRequest(req))) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const slug = new URL(req.url).searchParams.get('slug');
  const page = slug && getPage(slug);
  if (!page) return Response.json({ error: 'not_found' }, { status: 404 });
  const split = splitPageHtml(page.html);
  return Response.json({ slug, title: page.meta.title || slug, meta: page.meta, ...split });
}
