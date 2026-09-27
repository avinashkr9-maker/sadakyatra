export const metadata = {
  title: 'Admin | SadakYatra',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }) {
  return <div className="min-h-screen bg-brand-gray">{children}</div>;
}
