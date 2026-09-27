import DriverApp from './DriverApp';
import { publicSupabaseConfig } from '@/lib/supabaseConfig';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Driver | SadakYatra', robots: { index: false, follow: false } };

export default function DriverPage() {
  return <DriverApp config={publicSupabaseConfig()} />;
}
