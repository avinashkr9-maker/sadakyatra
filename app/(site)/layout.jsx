import { readSiteFile } from '@/lib/pages';

const GA_ID = 'G-MCSCJLWD1W';

// Public website ka layout: header + page + footer (har page pe)
export default function SiteLayout({ children }) {
  const header = readSiteFile('header.html');
  const footer = readSiteFile('footer.html');
  const siteJs = readSiteFile('site.js');
  const gaInit = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`;
  return (
    <>
      <script async src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} />
      <script dangerouslySetInnerHTML={{ __html: gaInit }} />
      <div id="sy-header" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: header }} />
      {children}
      <div id="sy-footer" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: footer }} />
      <script dangerouslySetInnerHTML={{ __html: siteJs }} />
    </>
  );
}
