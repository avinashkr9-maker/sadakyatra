import { getPageContent, toMetadata } from '@/lib/pages';
import PageBody from './PageBody';

export async function generateMetadata() {
  const page = await getPageContent('index');
  return toMetadata(page.meta);
}

export default async function Home() {
  const page = await getPageContent('index');
  return <PageBody html={page.html} />;
}
