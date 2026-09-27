import { revalidatePath, revalidateTag } from 'next/cache';
import { PAGES } from '@/lib/pages';
import { isAdminRequest } from '@/lib/supabaseServer';

// Admin panel mein save hone ke baad us page ko dobara banata hai (turant live)
export async function POST(req) {
  if (!(await isAdminRequest(req))) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { slug } = await req.json().catch(() => ({}));
  const page = PAGES.find((p) => p.slug === slug);
  if (!page) return Response.json({ error: 'unknown_page' }, { status: 400 });
  revalidateTag(`page:${slug}`, { expire: 0 });
  revalidatePath(slug === 'index' ? '/' : `/${slug}`);
  return Response.json({ ok: true });
}
