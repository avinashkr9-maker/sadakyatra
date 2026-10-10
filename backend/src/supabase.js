import { createClient } from '@supabase/supabase-js';

let adminClient;

export function getSupabaseAdmin() {
  if (adminClient) return adminClient;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;

  adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return adminClient;
}

export function getPartnerDocumentsBucket() {
  return process.env.SUPABASE_PARTNER_DOCUMENTS_BUCKET || 'partner-documents';
}
