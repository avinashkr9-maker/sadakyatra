'use client';
import { useEffect, useRef, useState } from 'react';
import cfg from '@/content/site/pages.json';
import Icon from './icons';
import { uploadImage, pageUrlFor, pageName } from './adminApi';

// ---------------------------------------------------------------------------
// Section Editor — beech mein live preview, right side mein simple panel.
// ---------------------------------------------------------------------------

const CANVAS_STYLE = `
  html{scroll-behavior:auto}
  .reveal{opacity:1!important;transform:none!important}
  .anim-fade-up,.fade-up{animation:none!important;opacity:1!important}
  [data-sy-edit]{cursor:text;border-radius:3px}
  [data-sy-edit]:hover{outline:2px dashed rgba(255,204,0,.9);outline-offset:3px}
  [data-sy-edit]:focus{outline:2px solid #FFCC00;outline-offset:3px;background:rgba(255,204,0,.10)}
  img[data-sy-img]{cursor:pointer}
  img[data-sy-img]:hover{outline:4px solid #FFCC00;outline-offset:-4px}
  a,button,summary{cursor:pointer}
  .svc-slide.hidden{display:block!important;margin-top:10px;position:relative}
  .svc-slide.hidden::before{content:'';display:block;border-top:3px dashed rgba(255,204,0,.8);margin-bottom:10px}
  .svc-pill{pointer-events:none}
`;
const SKIP = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'I', 'SELECT', 'OPTION', 'INPUT', 'TEXTAREA', 'IMG', 'BR', 'VIDEO', 'IFRAME']);
const INLINE = new Set(['I', 'BR', 'SPAN', 'B', 'STRONG', 'EM', 'SVG', 'PATH', 'OPTION', 'SMALL', 'IMG', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL']);
const DEVICES = { desktop: { w: '100%', icon: 'desktop', label: 'Desktop' }, tablet: { w: '820px', icon: 'tablet', label: 'Tablet' }, mobile: { w: '390px', icon: 'mobile', label: 'Mobile' } };
const PAGES = cfg.pages;
const WA_DEFAULT = '919304057169';

// ---------- DOM helpers (iframe ke andar) ----------
// Do elements "ek jaise" hain agar tag same ho aur classes kaafi milti ho (hidden/active jaisi state classes chhod ke)
const STATE = new Set(['hidden', 'active', 'open', 'block', 'flex', 'opacity-40', 'scale-95', 'vis', 'bg-yellow-50', 'border-brand-yellow']);
const classSet = (el) => new Set([...el.classList].filter((c) => !STATE.has(c)));
function similar(a, b) {
  if (a === b) return true;
  if (a.tagName !== b.tagName) return false;
  const x = classSet(a), y = classSet(b);
  if (!x.size && !y.size) return true;
  let inter = 0;
  x.forEach((c) => { if (y.has(c)) inter++; });
  return inter / (x.size + y.size - inter) >= 0.6;
}
const sameKind = (el) => (el.parentElement ? [...el.parentElement.children].filter((c) => similar(c, el)) : [el]);
const clip = (s, n = 34) => { s = (s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

function groupInfo(el) {
  if (el.classList.contains('svc-slide')) return { many: 'Slides', one: 'Slide' };
  const t = el.tagName.toUpperCase();
  if (t === 'DETAILS') return { many: 'FAQ questions', one: 'Question' };
  if (t === 'LI') return { many: 'Points', one: 'Point' };
  if (t === 'TR') return { many: 'Table rows', one: 'Row' };
  return { many: 'Cards', one: 'Card' };
}
function itemLabel(el) {
  const pick = el.querySelector('[data-svc-title], summary, h1, h2, h3, h4, h5, strong, b, p, a, span');
  return clip((pick && pick.textContent) || el.textContent) || '(empty)';
}

export default function SectionEditor({ sb, section, headHtml, pageName, onClose }) {
  const frameRef = useRef(null);
  const docRef = useRef(null);
  const rootRef = useRef(null);
  const selRef = useRef({});
  const histRef = useRef({ states: [], idx: -1 });
  const snapTimer = useRef(null);
  const saveRef = useRef(null);
  const overlayRef = useRef({});
  const selKey = useRef(0); // naya selection = panel naya

  const [tick, setTick] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [device, setDevice] = useState('desktop');
  const [moreOpen, setMoreOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState('');
  const rerender = () => setTick((t) => t + 1);

  const pageStyles = (headHtml.match(/<style[\s\S]*?<\/style>/gi) || []).join('\n');

  function srcDoc(body) {
    const css = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => `<link rel="stylesheet" href="${l.href}">`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}${pageStyles}<style>${CANVAS_STYLE}</style></head>
      <body class="bg-white text-brand-black antialiased"><div id="sy-root">${body}</div></body></html>`;
  }

  // ---------- setup ----------
  function markEditable() {
    const root = rootRef.current;
    root.querySelectorAll('*').forEach((el) => {
      if (SKIP.has(el.tagName.toUpperCase()) || el.closest('[data-sy-edit]')) return;
      if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
        el.setAttribute('contenteditable', 'true');
        el.setAttribute('data-sy-edit', '');
        el.setAttribute('spellcheck', 'false');
      }
    });
    root.querySelectorAll('details:not([open])').forEach((d) => { d.open = true; d.setAttribute('data-sy-opened', ''); });
    root.querySelectorAll('img').forEach((img) => img.setAttribute('data-sy-img', ''));
  }

  // Home slider: editor mein bhi neeche ke buttons aur "1 / N" counter slides ke hisaab se turant update karo
  function syncSlider() {
    const sec = rootRef.current?.querySelector('#services-slider');
    if (!sec) return;
    const slides = [...sec.querySelectorAll('.svc-slide')];
    const pills = [...sec.querySelectorAll('.svc-pill')];
    if (!slides.length || !pills.length) return;
    const wrap = pills[0].parentElement;
    const onTpl = pills[0].cloneNode(false);
    const offTpl = (pills[1] || pills[0]).cloneNode(false);
    pills.forEach((p) => p.remove());
    const badge = (s) => s.querySelector('[data-svc-title]') || s.querySelector('span.rounded-full');
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    slides.forEach((s, i) => {
      const b = (i === 0 ? onTpl : offTpl).cloneNode(false);
      const t = badge(s);
      b.innerHTML = t ? t.innerHTML : `Slide ${i + 1}`;
      [b, ...b.querySelectorAll('*')].forEach((n) => { n.removeAttribute('contenteditable'); n.removeAttribute('data-sy-edit'); n.removeAttribute('spellcheck'); });
      b.setAttribute('data-svc', String(i));
      b.setAttribute('onclick', `svcGo(${i})`);
      wrap.appendChild(b);
    });
    const label = sec.querySelector('#svc-label');
    if (label) label.textContent = `1 / ${slides.length} \u2014 ${txt(badge(slides[0]))}`;
  }

  function cleanHtml() {
    const clone = rootRef.current.cloneNode(true);
    clone.querySelectorAll('[data-sy-edit]').forEach((el) => { el.removeAttribute('contenteditable'); el.removeAttribute('data-sy-edit'); el.removeAttribute('spellcheck'); });
    clone.querySelectorAll('[data-sy-img]').forEach((el) => el.removeAttribute('data-sy-img'));
    clone.querySelectorAll('[data-sy-opened]').forEach((el) => { el.removeAttribute('open'); el.removeAttribute('data-sy-opened'); });
    return clone.innerHTML.trim();
  }

  function isItem(el) {
    const root = rootRef.current;
    if (!el || el === root || !el.parentElement || !root.contains(el)) return false;
    if (INLINE.has(el.tagName.toUpperCase()) || el.parentElement.querySelector(':scope > .svc-pill') && el.classList.contains('svc-pill')) return false;
    if (docRef.current.defaultView.getComputedStyle(el).display === 'inline') return false;
    return sameKind(el).length >= 2;
  }
  function findItem(el) {
    let cur = el;
    while (cur && cur !== rootRef.current) { if (isItem(cur)) return cur; cur = cur.parentElement; }
    return null;
  }
  // Container ke seedhe groups (andar ke andar wale nahi)
  function groupsIn(container) {
    const out = [];
    const seen = new Set();
    container.querySelectorAll('*').forEach((el) => {
      if (!isItem(el) || el.classList.contains('svc-pill')) return;
      const p = el.parentElement;
      if (seen.has(p)) return;
      seen.add(p);
      for (let a = p; a && a !== container; a = a.parentElement) if (isItem(a)) return;
      const items = sameKind(el);
      out.push({ parent: p, items, ...groupInfo(el) });
    });
    return out;
  }

  function drawOverlay() {
    const { box, chip } = overlayRef.current;
    const item = selRef.current.item;
    const win = docRef.current?.defaultView;
    if (!box || !win) return;
    if (!item || !rootRef.current.contains(item)) { box.style.display = 'none'; chip.style.display = 'none'; return; }
    const r = item.getBoundingClientRect();
    const x = r.left + win.scrollX, y = r.top + win.scrollY;
    Object.assign(box.style, { display: 'block', left: x - 3 + 'px', top: y - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px' });
    const list = sameKind(item);
    chip.textContent = `${groupInfo(item).one} ${list.indexOf(item) + 1}/${list.length}`;
    Object.assign(chip.style, { display: 'block', left: x - 3 + 'px', top: Math.max(0, y - 25) + 'px' });
  }

  function select(sel, scroll = false) {
    selRef.current = sel || {};
    selKey.current += 1;
    if (scroll && sel?.item) sel.item.scrollIntoView({ block: 'center', behavior: 'smooth' });
    drawOverlay();
    setTimeout(drawOverlay, 400);
    rerender();
  }

  function snap() {
    const h = histRef.current;
    const html = cleanHtml();
    if (h.states[h.idx] === html) return;
    h.states = h.states.slice(0, h.idx + 1);
    h.states.push(html);
    if (h.states.length > 60) h.states.shift();
    h.idx = h.states.length - 1;
    rerender();
  }
  function applyHtml(html) {
    rootRef.current.innerHTML = html;
    syncSlider();
    markEditable();
    select({});
    setDirty(true);
  }
  function undo() {
    // Pehle abhi ki typing history mein daalo (warna ek step zyada peeche chala jaata)
    if (snapTimer.current) { clearTimeout(snapTimer.current); snapTimer.current = null; snap(); }
    const h = histRef.current;
    if (h.idx > 0) { h.idx--; applyHtml(h.states[h.idx]); }
  }
  function redo() { const h = histRef.current; if (h.idx < h.states.length - 1) { h.idx++; applyHtml(h.states[h.idx]); } }
  const changed = () => { syncSlider(); markEditable(); setDirty(true); snap(); drawOverlay(); rerender(); };

  function setup() {
    const doc = frameRef.current?.contentDocument;
    const root = doc?.getElementById('sy-root');
    if (!root) return;
    docRef.current = doc;
    rootRef.current = root;
    syncSlider();
    markEditable();

    const box = doc.createElement('div');
    box.style.cssText = 'position:absolute;pointer-events:none;border:2px solid #2563eb;border-radius:10px;z-index:2147483646;display:none;box-shadow:0 0 0 5px rgba(37,99,235,.15)';
    const chip = doc.createElement('div');
    chip.style.cssText = 'position:absolute;pointer-events:none;z-index:2147483647;display:none;background:#2563eb;color:#fff;font:700 11px system-ui,sans-serif;padding:4px 8px;border-radius:6px';
    doc.body.append(box, chip);
    overlayRef.current = { box, chip };
    doc.defaultView.addEventListener('scroll', drawOverlay);
    doc.defaultView.addEventListener('resize', drawOverlay);

    root.addEventListener('click', (e) => {
      if (e.target.closest('a, summary, button')) e.preventDefault();
      const img = e.target.closest('img');
      const text = e.target.closest('[data-sy-edit]');
      const link = e.target.closest('a') || e.target.closest('button');
      select({ item: findItem(e.target), text: img ? null : text, image: img, link: img ? null : link });
    }, true);
    root.addEventListener('submit', (e) => e.preventDefault(), true);
    doc.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); saveRef.current?.(); return; }
      if (e.key === 'Escape') { doc.activeElement?.blur(); select({}); return; }
      if (e.key === 'Enter' && e.target.closest?.('[data-sy-edit]')) {
        e.preventDefault();
        if (e.shiftKey) doc.execCommand('insertLineBreak');
      }
    });
    doc.addEventListener('paste', (e) => {
      if (!e.target.closest?.('[data-sy-edit]')) return;
      e.preventDefault();
      doc.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
    doc.addEventListener('input', (e) => {
      if (e.target.closest?.('.svc-slide')) syncSlider();
      setDirty(true);
      drawOverlay();
      clearTimeout(snapTimer.current);
      snapTimer.current = setTimeout(snap, 600);
    });

    histRef.current = { states: [cleanHtml()], idx: 0 };
    select({});
  }

  useEffect(() => { if (frameRef.current) frameRef.current.srcdoc = srcDoc(section.html); }, []);

  // ---------- item actions ----------
  function copyItem(el) {
    const clone = el.cloneNode(true);
    [clone, ...clone.querySelectorAll('[id]')].forEach((n) => { if (n.id) n.id = `${n.id}-${Date.now().toString(36).slice(-4)}`; });
    el.after(clone);
    changed();
    select({ item: clone }, true);
  }
  function moveItem(el, dir) {
    const list = sameKind(el);
    const i = list.indexOf(el);
    const other = list[i + dir];
    if (!other) return;
    if (dir < 0) other.before(el); else other.after(el);
    changed();
    select({ item: el }, true);
  }
  function deleteItem(el) {
    if (sameKind(el).length <= 1) { alert('At least one must remain.'); return; }
    if (!confirm(`Remove this ${groupInfo(el).one.toLowerCase()}? (You can bring it back with Undo.)`)) return;
    el.remove();
    changed();
    select({});
  }

  // ---------- save / close ----------
  async function save() {
    if (saving) return;
    setSaving(true); setError('');
    const html = showCode ? code : cleanHtml();
    const { error } = await sb.from('web_sections').update({ html }).eq('id', section.id);
    setSaving(false);
    if (error) { setError('Could not save: ' + error.message); return; }
    onClose(true);
  }
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveRef.current?.(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  function close() {
    if (dirty && !confirm('Your unsaved changes will be lost. Leave anyway?')) return;
    onClose(false);
  }
  function toggleCode() {
    setMoreOpen(false);
    if (!showCode) { setCode(cleanHtml()); setShowCode(true); }
    else { setShowCode(false); setTimeout(() => { if (frameRef.current) frameRef.current.srcdoc = srcDoc(code); }, 0); }
  }

  const ready = !!rootRef.current && !showCode;
  const sel = selRef.current;
  const h = histRef.current;

  return (
    <div className="fixed inset-0 z-50 bg-[#EEF0F3] flex flex-col w-screen max-w-[100vw] overflow-hidden text-brand-black">
      {/* ---------- Top bar ---------- */}
      <header className="h-16 shrink-0 bg-white border-b border-brand-borderGray flex items-center gap-3 px-3 sm:px-4">
        <button onClick={close} className="h-10 w-10 rounded-xl flex items-center justify-center hover:bg-gray-100" title="Back to sections"><Icon name="back" /></button>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-gray-500 truncate">{pageName || 'Page'} &rsaquo; Section</p>
          <p className="font-bold text-sm truncate flex items-center gap-2">
            {section.label}
            {dirty
              ? <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full shrink-0">Unsaved changes</span>
              : <span className="text-[10px] font-bold bg-green-100 text-green-800 px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1"><Icon name="check" size={11} strokeWidth={3} />Saved</span>}
          </p>
        </div>

        <div className="hidden md:flex bg-gray-100 rounded-xl p-1">
          {Object.entries(DEVICES).map(([k, d]) => (
            <button key={k} onClick={() => setDevice(k)} title={d.label}
              className={`h-8 px-3 rounded-lg flex items-center gap-1.5 text-xs font-semibold ${device === k ? 'bg-white shadow-sm text-brand-black' : 'text-gray-500 hover:text-brand-black'}`}>
              <Icon name={d.icon} size={16} /><span className="hidden xl:inline">{d.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button onClick={undo} disabled={showCode || (h.idx <= 0 && !dirty)} title="Undo" className="h-10 w-10 rounded-xl flex items-center justify-center hover:bg-gray-100 disabled:opacity-30"><Icon name="undo" /></button>
          <button onClick={redo} disabled={showCode || h.idx >= h.states.length - 1} title="Redo" className="h-10 w-10 rounded-xl flex items-center justify-center hover:bg-gray-100 disabled:opacity-30"><Icon name="redo" /></button>
          <div className="relative">
            <button onClick={() => setMoreOpen(!moreOpen)} title="More options" className="h-10 w-10 rounded-xl flex items-center justify-center hover:bg-gray-100"><Icon name="more" /></button>
            {moreOpen && (
              <div className="absolute right-0 top-12 w-60 bg-white rounded-xl shadow-xl border border-brand-borderGray p-1.5 z-10">
                <MenuItem icon="history" onClick={() => { setMoreOpen(false); setShowHistory(true); }}>Version history</MenuItem>
                <MenuItem icon="code" onClick={toggleCode}>{showCode ? 'Back to visual editor' : 'Edit HTML (advanced)'}</MenuItem>
              </div>
            )}
          </div>
        </div>
        <button onClick={save} disabled={saving}
          className="h-10 px-5 rounded-xl bg-brand-black text-white font-bold text-sm flex items-center gap-2 hover:bg-brand-charcoal disabled:opacity-60 shrink-0">
          {saving ? <><Icon name="spinner" size={16} />Save...</> : <><Icon name="check" size={16} strokeWidth={3} />Save</>}
        </button>
      </header>

      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-2 border-b border-red-200">{error}</div>}

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* ---------- Canvas ---------- */}
        <main className="flex-1 min-w-0 min-h-0 overflow-auto p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) select({}); }}>
          {showCode ? (
            <div className="h-full flex flex-col gap-2">
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Advanced mode: incorrect code can break this section. To return, use ⋯ → "Back to visual editor".</p>
              <textarea value={code} onChange={(e) => { setCode(e.target.value); setDirty(true); }} spellCheck={false}
                className="flex-1 min-h-[60vh] w-full font-mono text-xs border border-brand-borderGray rounded-xl p-3 bg-white" />
            </div>
          ) : (
            <div className="mx-auto bg-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,.10)] overflow-hidden transition-all duration-300" style={{ maxWidth: DEVICES[device].w }}>
              <iframe ref={frameRef} onLoad={setup} title="Section editor" className="w-full block" style={{ height: 'calc(100vh - 9rem)' }} />
            </div>
          )}
        </main>

        {/* ---------- Right panel ---------- */}
        <aside className="lg:w-[340px] shrink-0 bg-white border-t lg:border-t-0 lg:border-l border-brand-borderGray overflow-y-auto max-h-[45vh] lg:max-h-none">
          {ready && (
            <Panel key={selKey.current} tick={tick} sb={sb} sel={sel} root={rootRef.current}
              groupsIn={groupsIn} findItem={findItem} select={select}
              copyItem={copyItem} moveItem={moveItem} deleteItem={deleteItem}
              onChange={() => { setDirty(true); clearTimeout(snapTimer.current); snapTimer.current = setTimeout(snap, 500); drawOverlay(); }} />
          )}
          {showCode && <div className="p-5 text-sm text-gray-500">The panel is unavailable in HTML mode.</div>}
        </aside>
      </div>

      {showHistory && (
        <HistoryDialog sb={sb} sectionId={section.id} onClose={() => setShowHistory(false)}
          onRestore={(html) => { setShowHistory(false); if (showCode) { setCode(html); } else { applyHtml(html); snap(); } }} />
      )}
    </div>
  );
}

function MenuItem({ icon, children, onClick }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-100 text-left">
      <Icon name={icon} size={16} className="text-gray-500" />{children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Right panel — jo chuna hai uske hisaab se
// ---------------------------------------------------------------------------
function Panel({ sb, sel, root, groupsIn, findItem, select, copyItem, moveItem, deleteItem, onChange }) {
  const item = sel.item && root.contains(sel.item) ? sel.item : null;
  const nothing = !item && !sel.text && !sel.image;

  return (
    <div className="divide-y divide-brand-borderGray">
      {nothing && (
        <Block title="How to edit" icon="pointer">
          <ol className="space-y-3 text-sm text-gray-600">
            <Step n="1" icon="type"><b className="text-brand-black">Edit text:</b> click any text in the preview and start typing.</Step>
            <Step n="2" icon="image"><b className="text-brand-black">Change a photo:</b> click the photo, or pick it from the list below.</Step>
            <Step n="3" icon="copy"><b className="text-brand-black">Duplicate or remove a card, slide or FAQ:</b> use the buttons next to it in the list below.</Step>
          </ol>
        </Block>
      )}

      {sel.image && root.contains(sel.image) && <ImagePanel sb={sb} img={sel.image} onChange={onChange} />}
      {sel.text && root.contains(sel.text) && (
        <Block title="Text" icon="type">
          <p className="text-sm text-gray-600">Type directly in the preview. Press <b>Shift + Enter</b> for a new line.</p>
          <p className="text-xs text-gray-400 mt-2">Made a mistake? Click <b>Undo</b> at the top.</p>
        </Block>
      )}
      {sel.link && root.contains(sel.link) && <LinkPanel el={sel.link} onChange={onChange} />}

      {item && <ItemPanel item={item} findItem={findItem} select={select} copyItem={copyItem} moveItem={moveItem} deleteItem={deleteItem} />}

      {item
        ? groupsIn(item).map((g, i) => <GroupList key={i} g={g} title={`Inside: ${g.many}`} select={select} copyItem={copyItem} moveItem={moveItem} deleteItem={deleteItem} />)
        : groupsIn(root).map((g, i) => <GroupList key={i} g={g} title={`In this section: ${g.many}`} select={select} copyItem={copyItem} moveItem={moveItem} deleteItem={deleteItem} />)}

      {nothing && <PhotoGrid root={root} select={select} findItem={findItem} />}
      {!nothing && (
        <div className="p-4">
          <button onClick={() => select({})} className="w-full h-10 rounded-xl border border-brand-borderGray text-sm font-semibold hover:bg-gray-50">Clear selection (Esc)</button>
        </div>
      )}
    </div>
  );
}

function Block({ title, icon, children, right }) {
  return (
    <section className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-2"><Icon name={icon} size={15} />{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}
function Step({ n, icon, children }) {
  return (
    <li className="flex gap-3">
      <span className="w-7 h-7 rounded-lg bg-brand-yellow/20 text-amber-700 flex items-center justify-center shrink-0"><Icon name={icon} size={15} /></span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}
function IconBtn({ icon, title, onClick, disabled, danger }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} disabled={disabled} title={title} aria-label={title}
      className={`w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-25 ${danger ? 'text-gray-400 hover:text-red-600 hover:bg-red-50' : 'text-gray-500 hover:text-brand-black hover:bg-gray-100'}`}>
      <Icon name={icon} size={16} />
    </button>
  );
}

function ItemPanel({ item, findItem, select, copyItem, moveItem, deleteItem }) {
  const list = sameKind(item);
  const i = list.indexOf(item);
  const info = groupInfo(item);
  const parent = findItem(item.parentElement);
  return (
    <Block title={`Selected ${info.one.toLowerCase()}`} icon="layers">
      <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 mb-3">
        <p className="text-xs font-bold text-blue-700">{info.one} {i + 1} / {list.length}</p>
        <p className="font-semibold text-sm truncate">{itemLabel(item)}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ActionBtn icon="copy" onClick={() => copyItem(item)}>Duplicate</ActionBtn>
        <ActionBtn icon="trash" danger onClick={() => deleteItem(item)} disabled={list.length <= 1}>Remove</ActionBtn>
        <ActionBtn icon="up" onClick={() => moveItem(item, -1)} disabled={i === 0}>Move up</ActionBtn>
        <ActionBtn icon="down" onClick={() => moveItem(item, 1)} disabled={i === list.length - 1}>Move down</ActionBtn>
      </div>
      {parent && (
        <button onClick={() => select({ item: parent }, true)} className="mt-3 text-xs font-semibold text-blue-700 hover:underline">
          ↑ Select the whole {groupInfo(parent).one.toLowerCase()} ({itemLabel(parent)})
        </button>
      )}
    </Block>
  );
}
function ActionBtn({ icon, children, onClick, disabled, danger }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`h-10 rounded-xl border text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-30 ${danger ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-brand-borderGray hover:bg-gray-50'}`}>
      <Icon name={icon} size={16} />{children}
    </button>
  );
}

function GroupList({ g, title, select, copyItem, moveItem, deleteItem }) {
  return (
    <Block title={`${title} (${g.items.length})`} icon="layers">
      <ul className="space-y-1.5">
        {g.items.map((it, i) => (
          <li key={i} onClick={() => select({ item: it }, true)}
            className="group flex items-center gap-2 rounded-xl border border-brand-borderGray pl-3 pr-1 py-1 hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer">
            <span className="text-xs font-bold text-gray-400 w-4">{i + 1}</span>
            <span className="flex-1 min-w-0 text-sm font-medium truncate">{itemLabel(it)}</span>
            <IconBtn icon="copy" title="Duplicate" onClick={() => copyItem(it)} />
            <IconBtn icon="up" title="Move up" disabled={i === 0} onClick={() => moveItem(it, -1)} />
            <IconBtn icon="down" title="Move down" disabled={i === g.items.length - 1} onClick={() => moveItem(it, 1)} />
            <IconBtn icon="trash" title="Remove" danger disabled={g.items.length <= 1} onClick={() => deleteItem(it)} />
          </li>
        ))}
      </ul>
    </Block>
  );
}

function PhotoGrid({ root, select, findItem }) {
  const imgs = [...root.querySelectorAll('img')];
  if (!imgs.length) return null;
  return (
    <Block title={`Photos in this section (${imgs.length})`} icon="image">
      <div className="grid grid-cols-3 gap-2">
        {imgs.map((img, i) => (
          <button key={i} onClick={() => select({ image: img, item: findItem(img) }, true)} title={img.getAttribute('alt') || 'Change photo'}
            className="aspect-[4/3] rounded-lg overflow-hidden border-2 border-transparent hover:border-brand-yellow bg-gray-100">
            <img src={img.getAttribute('src')} alt="" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
    </Block>
  );
}

function ImagePanel({ sb, img, onChange }) {
  const [src, setSrc] = useState(img.getAttribute('src') || '');
  const [alt, setAlt] = useState(img.getAttribute('alt') || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  function applySrc(url) { img.setAttribute('src', url); img.removeAttribute('srcset'); setSrc(url); onChange(); }
  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr('');
    try { applySrc(await uploadImage(sb, file)); }
    catch (x) { setErr('Upload failed: ' + (x.message || x)); }
    setBusy(false);
    e.target.value = '';
  }
  return (
    <Block title="Photo" icon="image">
      <div className="rounded-xl overflow-hidden bg-gray-100 aspect-video mb-3">{src && <img src={src} alt="" className="w-full h-full object-cover" />}</div>
      <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
      <button onClick={() => fileRef.current?.click()} disabled={busy}
        className="w-full h-11 rounded-xl bg-brand-yellow font-bold text-sm flex items-center justify-center gap-2 hover:brightness-95 disabled:opacity-60">
        {busy ? <><Icon name="spinner" size={16} />Uploading...</> : <><Icon name="image" size={16} />Upload new photo</>}
      </button>
      <p className="text-[11px] text-gray-400 mt-1.5">Photos are compressed automatically to keep the site fast.</p>
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
      <Field label="Photo description (for Google)" hint='e.g. "Decorated wedding car Muzaffarpur"'>
        <input value={alt} onChange={(e) => { setAlt(e.target.value); img.setAttribute('alt', e.target.value); onChange(); }} className={inputCls} />
      </Field>
      <details className="mt-3">
        <summary className="text-xs text-gray-500 cursor-pointer">Use a photo URL (advanced)</summary>
        <input value={src} onChange={(e) => setSrc(e.target.value)} onBlur={() => src.trim() && applySrc(src.trim())} className={inputCls + ' mt-2'} />
      </details>
    </Block>
  );
}

const inputCls = 'w-full h-10 px-3 rounded-lg border border-brand-borderGray text-sm focus:outline-none focus:border-brand-black focus:ring-4 focus:ring-brand-yellow/30';
function Field({ label, hint, children }) {
  return (
    <label className="block mt-3">
      <span className="block text-xs font-semibold text-gray-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400 mt-1">{hint}</span>}
    </label>
  );
}

function parseHref(href) {
  const h = href || '';
  const wa = /^https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send)\/?(\d*)\??(.*)$/i.exec(h);
  if (wa) {
    const params = new URLSearchParams(wa[2]);
    return { mode: 'whatsapp', number: wa[1] || params.get('phone') || WA_DEFAULT, message: params.get('text') || '' };
  }
  if (/^tel:/i.test(h)) return { mode: 'call', phone: h.replace(/^tel:/i, '') };
  if (h.startsWith('/') || /^https?:\/\/(www\.)?sadakyatra\.co\.in/i.test(h)) {
    const path = h.replace(/^https?:\/\/(www\.)?sadakyatra\.co\.in/i, '') || '/';
    return { mode: 'page', path };
  }
  return { mode: 'custom', url: h };
}

function LinkPanel({ el, onChange }) {
  const isAnchor = el.tagName.toUpperCase() === 'A';
  const [v, setV] = useState(() => parseHref(el.getAttribute('href')));
  const [newTab, setNewTab] = useState(el.getAttribute('target') === '_blank');

  if (!isAnchor) {
    return (
      <Block title="Button" icon="link">
        <p className="text-sm text-gray-600">This button submits a form or controls the slider. Its action is fixed — you can only change its <b>text</b>.</p>
      </Block>
    );
  }

  function apply(next, tab = newTab) {
    setV(next);
    let href = '';
    if (next.mode === 'whatsapp') href = `https://wa.me/${(next.number || WA_DEFAULT).replace(/\D/g, '')}${next.message ? '?text=' + encodeURIComponent(next.message) : ''}`;
    if (next.mode === 'call') href = `tel:${(next.phone || '').replace(/[^\d+]/g, '')}`;
    if (next.mode === 'page') href = next.path || '/';
    if (next.mode === 'custom') href = next.url || '';
    el.setAttribute('href', href);
    if (tab) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
    else { el.removeAttribute('target'); }
    onChange();
  }
  const modes = [['whatsapp', 'whatsapp', 'WhatsApp'], ['call', 'phone', 'Call'], ['page', 'file', 'Page'], ['custom', 'link', 'Link']];

  return (
    <Block title="Where should this button go?" icon="link">
      <div className="grid grid-cols-4 gap-1 bg-gray-100 rounded-xl p-1">
        {modes.map(([m, ic, label]) => (
          <button key={m} onClick={() => apply({ mode: m, number: v.number || WA_DEFAULT, message: v.message || 'Hi SadakYatra! I want to book a cab.', phone: v.phone || '9304057169', path: v.path || '/', url: v.url || '' })}
            className={`h-12 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${v.mode === m ? 'bg-white shadow-sm text-brand-black' : 'text-gray-500'}`}>
            <Icon name={ic} size={16} />{label}
          </button>
        ))}
      </div>
      {v.mode === 'whatsapp' && (
        <>
          <Field label="WhatsApp number (with country code)"><input value={v.number} onChange={(e) => apply({ ...v, number: e.target.value })} className={inputCls} /></Field>
          <Field label="Pre-filled message" hint="This message will be typed in WhatsApp when the customer taps the button.">
            <textarea rows={4} value={v.message} onChange={(e) => apply({ ...v, message: e.target.value })} className={inputCls + ' h-auto py-2'} />
          </Field>
        </>
      )}
      {v.mode === 'call' && <Field label="Phone number"><input value={v.phone} onChange={(e) => apply({ ...v, phone: e.target.value })} className={inputCls} /></Field>}
      {v.mode === 'page' && (
        <Field label="Which page on the website">
          <select value={v.path} onChange={(e) => apply({ ...v, path: e.target.value })} className={inputCls}>
            {!PAGES.some((p) => pageUrlFor(p) === v.path) && <option value={v.path}>{v.path}</option>}
            {PAGES.map((p) => <option key={p.slug} value={pageUrlFor(p)}>{pageName(p.slug)}</option>)}
          </select>
        </Field>
      )}
      {v.mode === 'custom' && <Field label="Link (https://...)"><input value={v.url} onChange={(e) => apply({ ...v, url: e.target.value })} className={inputCls} /></Field>}
      <label className="flex items-center gap-2 mt-3 text-sm">
        <input type="checkbox" checked={newTab} onChange={(e) => { setNewTab(e.target.checked); apply(v, e.target.checked); }} className="w-4 h-4 accent-brand-black" />
        Open in a new tab
      </label>
    </Block>
  );
}

function HistoryDialog({ sb, sectionId, onClose, onRestore }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    sb.from('web_section_revisions').select('id,html,created_at').eq('section_id', sectionId).order('created_at', { ascending: false }).limit(20)
      .then(({ data }) => setRows(data || []));
  }, [sectionId]);
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-extrabold">Version history</h2>
          <button onClick={onClose} className="w-9 h-9 rounded-lg hover:bg-gray-100 flex items-center justify-center"><Icon name="x" /></button>
        </div>
        <p className="text-sm text-gray-500 mb-4">Every save keeps the previous version here. Pick one to load it into the editor, then click Save if you want to keep it.</p>
        {!rows ? <p className="text-gray-500 text-sm">Loading...</p> : !rows.length ? (
          <p className="text-gray-500 text-sm bg-gray-50 rounded-xl p-4">No previous versions yet.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 border border-brand-borderGray rounded-xl px-4 py-3">
                <span className="text-sm font-medium">{new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                <button onClick={() => onRestore(r.html)} className="h-9 px-3 rounded-lg border border-brand-borderGray text-sm font-semibold hover:bg-gray-50">Restore</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
