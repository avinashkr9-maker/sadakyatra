'use client';
import { useEffect, useState } from 'react';
import { Card, Button, Notice } from './ui';
import { revalidatePage, pageUrlFor, textSnippet, pageName } from './adminApi';
import SectionEditor from './SectionEditor';

export default function PageEditor({ sb, page, onBack }) {
  const [pageRow, setPageRow] = useState(null);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [editing, setEditing] = useState(null);

  async function load() {
    setLoading(true);
    const [p, s] = await Promise.all([
      sb.from('web_pages').select('slug,title,head_html').eq('slug', page.slug).maybeSingle(),
      sb.from('web_sections').select('id,position,label,html,hidden').eq('page_slug', page.slug).order('position').order('id'),
    ]);
    if (p.error || s.error) setMsg({ type: 'error', text: 'Could not load: ' + (p.error || s.error).message });
    setPageRow(p.data);
    setSections(s.data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [page.slug]);

  async function run(fn, okText) {
    setBusy(true); setMsg(null);
    try {
      await fn();
      const live = await revalidatePage(sb, page.slug);
      setMsg({ type: 'success', text: okText + (live ? ' The website has been updated.' : ' (The website may take a moment to update.)') });
    } catch (e) {
      setMsg({ type: 'error', text: 'Failed: ' + (e.message || e) });
    }
    setBusy(false);
    await load();
  }

  async function saveOrder(list) {
    for (let i = 0; i < list.length; i++) {
      const pos = (i + 1) * 10;
      if (list[i].position !== pos) {
        const { error } = await sb.from('web_sections').update({ position: pos }).eq('id', list[i].id);
        if (error) throw error;
      }
    }
  }

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const list = [...sections];
    [list[i], list[j]] = [list[j], list[i]];
    setSections(list);
    run(() => saveOrder(list), 'Order updated.');
  }

  function toggleHidden(s) {
    run(async () => {
      const { error } = await sb.from('web_sections').update({ hidden: !s.hidden }).eq('id', s.id);
      if (error) throw error;
    }, s.hidden ? 'Section is visible again.' : 'Section hidden from the website.');
  }

  function duplicate(i) {
    const s = sections[i];
    run(async () => {
      const { data, error } = await sb.from('web_sections')
        .insert({ page_slug: page.slug, position: s.position + 5, label: `${s.label} (copy)`, html: s.html, hidden: s.hidden })
        .select('id,position,label,html,hidden').single();
      if (error) throw error;
      const list = [...sections];
      list.splice(i + 1, 0, data);
      await saveOrder(list);
    }, 'Section duplicated (placed right below).');
  }

  function remove(s) {
    if (!confirm(`Delete the "${s.label}" section? This cannot be undone. (To only hide it, use "Hide".)`)) return;
    run(async () => {
      const { error } = await sb.from('web_sections').delete().eq('id', s.id);
      if (error) throw error;
    }, 'Section deleted.');
  }

  async function rename(s) {
    const label = prompt('Section name (only visible in the admin panel):', s.label);
    if (!label || label === s.label) return;
    const { error } = await sb.from('web_sections').update({ label }).eq('id', s.id);
    if (error) setMsg({ type: 'error', text: error.message });
    else setSections((l) => l.map((x) => (x.id === s.id ? { ...x, label } : x)));
  }

  if (editing) {
    return (
      <SectionEditor
        sb={sb}
        section={editing}
        headHtml={pageRow?.head_html || ''}
        pageName={pageName(page.slug)}
        onClose={async (saved) => {
          setEditing(null);
          if (saved) {
            const live = await revalidatePage(sb, page.slug);
            setMsg({ type: 'success', text: 'Section saved.' + (live ? ' The website has been updated.' : '') });
          }
          load();
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" onClick={onBack}>← Pages</Button>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold truncate">{pageName(page.slug)}</h1>
            <p className="text-xs text-gray-500">{pageUrlFor(page)} · {sections.length} sections</p>
          </div>
        </div>
        <a href={pageUrlFor(page)} target="_blank" className="inline-flex items-center px-4 py-2.5 rounded-xl text-sm font-semibold border border-brand-borderGray bg-white hover:bg-gray-50">View page ↗</a>
      </div>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}
      {loading ? <p className="text-gray-500">Loading...</p> : (
        <div className="space-y-3">
          {sections.map((s, i) => (
            <Card key={s.id} className={`p-4 ${s.hidden ? 'opacity-60 border-dashed' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="flex flex-col gap-1">
                    <button onClick={() => move(i, -1)} disabled={busy || i === 0} className="w-8 h-7 rounded-lg border border-brand-borderGray text-sm disabled:opacity-30 hover:bg-gray-50" title="Move up">▲</button>
                    <button onClick={() => move(i, 1)} disabled={busy || i === sections.length - 1} className="w-8 h-7 rounded-lg border border-brand-borderGray text-sm disabled:opacity-30 hover:bg-gray-50" title="Move down">▼</button>
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-sm">
                      <span className="text-gray-400 mr-1">{i + 1}.</span>{s.label}
                      {s.hidden && <span className="ml-2 text-[10px] font-bold bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded">HIDDEN</span>}
                      <button onClick={() => rename(s)} className="ml-2 text-xs text-gray-400 hover:text-brand-black font-normal">rename</button>
                    </p>
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{textSnippet(s.html)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="yellow" onClick={() => setEditing(s)} disabled={busy}>Edit</Button>
                  <Button variant="ghost" onClick={() => toggleHidden(s)} disabled={busy}>{s.hidden ? 'Show' : 'Hide'}</Button>
                  <Button variant="ghost" onClick={() => duplicate(i)} disabled={busy}>Duplicate</Button>
                  <Button variant="danger" onClick={() => remove(s)} disabled={busy}>Delete</Button>
                </div>
              </div>
            </Card>
          ))}
          {!sections.length && <Notice type="warn">This page has no sections.</Notice>}
        </div>
      )}
    </div>
  );
}
