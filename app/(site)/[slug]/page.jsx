import { notFound } from 'next/navigation';
import { PAGES, getPageContent, toMetadata } from '@/lib/pages';
import PageBody from '../PageBody';

// true rakhna zaroori hai: warna admin se update ke baad .html URL 404 deta hai.
// Anjaan URL ke liye neeche notFound() already hai.
export const dynamicParams = true;

export function generateStaticParams() {
  return PAGES.filter((p) => p.slug !== 'index').map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const page = await getPageContent(slug);
  return page ? toMetadata(page.meta) : {};
}

export default async function Page({ params }) {
  const { slug } = await params;
  if (!PAGES.some((p) => p.slug === slug)) notFound();
  const page = await getPageContent(slug);
  if (!page) notFound();
  return <PageBody html={page.html} />;
}
