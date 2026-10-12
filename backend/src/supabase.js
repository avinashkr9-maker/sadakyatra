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

export const WEDDING_CARS_BUCKET = 'wedding-cars';
const UPLOAD_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export class UploadError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Decodes a base64 upload from the app and checks its type and size; returns { buffer, contentType, extension }.
export function readUpload(data, contentType) {
  const extension = UPLOAD_TYPES[contentType];
  if (!extension) throw new UploadError(400, 'Upload a JPG, PNG, WEBP photo or a PDF');
  if (typeof data !== 'string' || !data) throw new UploadError(400, 'The file is empty');
  const buffer = Buffer.from(data.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!buffer.length) throw new UploadError(400, 'The file is empty');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new UploadError(413, 'The file is larger than 5 MB');
  return { buffer, contentType, extension };
}

export async function uploadObject(bucket, key, { buffer, contentType }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new UploadError(503, 'File storage is not configured on the server');
  const { error } = await supabase.storage.from(bucket).upload(key, buffer, { contentType, upsert: true });
  if (error) throw new UploadError(502, `Could not store the file: ${error.message}`);
  return key;
}

export function publicUrl(bucket, key) {
  return getSupabaseAdmin()?.storage.from(bucket).getPublicUrl(key).data.publicUrl || null;
}

// Short-lived link to a private file, for admins viewing partner documents.
export async function signedUrl(bucket, key, seconds = 600) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(key, seconds);
  return error ? null : data.signedUrl;
}

export function removeObject(bucket, key) {
  return getSupabaseAdmin()?.storage.from(bucket).remove([key]);
}
