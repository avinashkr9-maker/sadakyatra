'use client';

async function token(sb) {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || '';
}

// Page ko website pe turant update karo
export async function revalidatePage(sb, slug) {
  try {
    const res = await fetch('/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token(sb)}` },
      body: JSON.stringify({ slug }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchSourcePage(sb, slug) {
  const res = await fetch(`/api/admin/source?slug=${encodeURIComponent(slug)}`, {
    headers: { Authorization: `Bearer ${await token(sb)}` },
  });
  if (!res.ok) throw new Error(`Page file not found (${res.status})`);
  return res.json();
}

// Photo ko chhota karke (max 1600px, WebP) upload karo — storage bachta hai, site fast rehti hai
export async function uploadImage(sb, file) {
  const blob = await compressImage(file);
  const ext = blob.type === 'image/webp' ? 'webp' : (file.name.split('.').pop() || 'jpg');
  const path = `sections/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from('site-media').upload(path, blob, { contentType: blob.type, cacheControl: '31536000' });
  if (error) throw error;
  return sb.storage.from('site-media').getPublicUrl(path).data.publicUrl;
}

async function compressImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml' || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.82));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

export function pageUrlFor(p) {
  if (p.path) return p.path;
  return p.htmlUrl ? `/${p.slug}.html` : `/${p.slug}`;
}

export function textSnippet(html, n = 110) {
  const t = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

// "cab-service-muzaffarpur" → "Cab Service Muzaffarpur"
export function pageName(slug) {
  if (slug === 'index') return 'Home page';
  return slug.split('-').map((w) => (w === 'to' ? 'to' : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}
