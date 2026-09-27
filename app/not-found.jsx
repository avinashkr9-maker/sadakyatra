import { readSiteFile } from '@/lib/pages';

export const metadata = { title: 'Page Not Found | SadakYatra', robots: 'noindex' };

export default function NotFound() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: readSiteFile('header.html') }} />
      <main className="pt-[68px] min-h-[70vh] bg-brand-black text-white flex items-center justify-center px-4">
        <div className="text-center py-24">
          <p className="text-brand-yellow text-7xl font-extrabold mb-4">404</p>
          <h1 className="text-3xl font-extrabold mb-4">Page not found</h1>
          <p className="text-gray-300 mb-8">The page you're looking for may have been moved or removed.</p>
          <div className="flex flex-wrap gap-3 justify-center">
            <a href="/" className="bg-brand-yellow text-brand-black font-bold px-6 py-3 rounded-xl">Home Page</a>
            <a href="https://wa.me/919304057169" className="bg-[#25D366] text-white font-bold px-6 py-3 rounded-xl">Book on WhatsApp</a>
          </div>
        </div>
      </main>
      <div dangerouslySetInnerHTML={{ __html: readSiteFile('footer.html') }} />
      <script dangerouslySetInnerHTML={{ __html: readSiteFile('site.js') }} />
    </>
  );
}
