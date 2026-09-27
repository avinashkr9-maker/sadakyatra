// Page ka HTML content render karta hai (server pe, taaki Google ko pura content dikhe)
export default function PageBody({ html }) {
  return <main id="sy-main" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />;
}
