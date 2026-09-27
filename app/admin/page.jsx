import AdminApp from './AdminApp';
import { publicSupabaseConfig } from '@/lib/supabaseConfig';

export const dynamic = 'force-dynamic';

export default function AdminPage() {
  return <AdminApp config={publicSupabaseConfig()} />;
}
