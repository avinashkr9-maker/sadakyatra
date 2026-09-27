'use client';
import { useEffect, useState } from 'react';
import cfg from '@/content/site/pages.json';
import { Card, Button, Notice } from './ui';
import { fetchSourcePage, revalidatePage, pageUrlFor, pageName } from './adminApi';
import PageEditor from './PageEditor';

const PAGES = cfg.pages;

export default function PagesPanel({ sb }) {
  const [status, setStatus] = useState({}); // slug -> section count (undefined = import nahi hua)
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [editing, setEditing] = useState(null);

  async function load() {
    setLoading(true);
    const [p, s] = await Promise.all([
      sb.from('web_pages').select('slug'),
      sb.from('web_sections').select('page_slug'),
    ]);
    if (p.error) { setMsg({ type: 'error', text: 'Could not load pages: ' + p.error.message + ' (did you run setup-2-pages.sql?)' }); setLoading(false); return; }
    const st = {};
    for (const r of p.data) st[r.slug] = 0;
    for (const r of s.data || []) if (st[r.page_slug] !== undefined) st[r.page_slug]++;
    setStatus(st);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function importPage(slug) {
    const src = await fetchSourcePage(sb, slug);
    const up = await sb.from('web_pages').upsert({ slug, title: src.title, meta: src.meta, head_html: src.head_html, script_html: src.script_html });
    if (up.error) throw up.error;
    const before = await sb.from('web_sections').select('id').eq('page_slug', slug);
    if (before.error) throw before.error;
    const ins = await sb.from('web_sections').insert(
      src.sections.map((s, i) => ({ page_slug: slug, position: (i + 1) * 10, label: s.label, html: s.html }))
    );
    if (ins.error) throw ins.error;
    const oldIds = (before.data || []).map((r) => r.id);
    if (oldIds.length) {
      const del = await sb.from('web_sections').delete().in('id', oldIds);
      if (del.error) throw del.error;
    }
    await revalidatePage(sb, slug);
    return src.sections.length;
  }

  async function importOne(slug) {
    if (status[slug] !== undefined && !confirm('This page is already imported. Re-importing will discard all changes made in the admin panel. Continue?')) return;
    setBusy(slug); setMsg(null);
    try { const n = await importPage(slug); setMsg({ type: 'success', text: `Imported: ${n} sections.` }); }
    catch (e) { setMsg({ type: 'error', text: 'Import failed: ' + (e.message || e) }); }
    setBusy(''); load();
  }

  async function importAll() {
    const todo = PAGES.filter((p) => status[p.slug] === undefined);
    setMsg(null);
    for (const p of todo) {
      setBusy(p.slug);
      try { await importPage(p.slug); }
      catch (e) { setMsg({ type: 'error', text: `"${p.slug}" import failed: ${e.message || e}` }); setBusy(''); load(); return; }
    }
    setBusy('');
    setMsg({ type: 'success', text: `${todo.length} pages imported. Click "Edit" on any page to start.` });
    load();
  }

  if (editing) {
    const page = PAGES.find((p) => p.slug === editing);
    return <PageEditor sb={sb} page={page} onBack={() => { setEditing(null); load(); }} />;
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;
  const missing = PAGES.filter((p) => status[p.slug] === undefined).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Pages</h1>
          <p className="text-gray-500 text-sm">Click "Edit" on a page to reorder, hide or duplicate sections, or change text and photos.</p>
        </div>
        {missing > 0 && (
          <Button variant="yellow" onClick={importAll} disabled={!!busy}>
            {busy ? `Importing: ${busy}...` : `Import all ${missing} pages`}
          </Button>
        )}
      </div>

      {missing > 0 && (
        <Notice type="info">
          First time: "Import" brings your current website pages into the admin panel. Nothing changes on the website — the design stays exactly the same.
        </Notice>
      )}
      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      <Card className="divide-y divide-brand-borderGray">
        {PAGES.map((p) => {
          const n = status[p.slug];
          const imported = n !== undefined;
          return (
            <div key={p.slug} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <p className="font-bold text-sm truncate">{pageName(p.slug)}</p>
                <p className="text-xs text-gray-500 truncate">
                  {pageUrlFor(p)} · {imported ? <span className="text-green-700 font-semibold">{n} sections</span> : <span className="text-yellow-700 font-semibold">Not imported</span>}
                </p>
              </div>
              <div className="flex gap-2">
                <a href={pageUrlFor(p)} target="_blank" className="inline-flex items-center px-3 py-2 rounded-xl text-sm font-semibold border border-brand-borderGray hover:bg-gray-50">View ↗</a>
                {imported ? (
                  <>
                    <Button variant="ghost" onClick={() => importOne(p.slug)} disabled={!!busy} title="Re-import from files">↺</Button>
                    <Button onClick={() => setEditing(p.slug)} disabled={!!busy}>Edit</Button>
                  </>
                ) : (
                  <Button variant="yellow" onClick={() => importOne(p.slug)} disabled={!!busy}>{busy === p.slug ? 'Importing...' : 'Import'}</Button>
                )}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
