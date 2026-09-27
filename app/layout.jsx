import './globals.css';
import { SITE_URL } from '@/lib/pages';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  icons: { icon: '/favicon.svg', apple: '/favicon.svg' },
};

// Sabse bahar ka layout — sirf <html> aur <body>.
// Website ka header/footer app/(site)/layout.jsx mein hai, admin panel ka app/admin mein.
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/remixicon@4.5.0/fonts/remixicon.css" />
      </head>
      <body className="bg-white text-brand-black antialiased">{children}</body>
    </html>
  );
}
