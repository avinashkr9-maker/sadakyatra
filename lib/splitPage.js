import { parse } from 'node-html-parser';

// Ek page ke HTML ko sections mein todta hai:
//  - head_html: JSON-LD schema + <style>
//  - sections: har top-level block (hero, fleet, FAQ...)
//  - script_html: page ke scripts (calculator, forms)
export function splitPageHtml(html) {
  const root = parse(html, { comment: true, lowerCaseTagName: false, blockTextElements: { script: true, style: true } });
  const head = [];
  const scripts = [];
  const sections = [];
  let pendingLabel = null;
  for (const node of root.childNodes) {
    if (node.nodeType === 8) { // comment
      const t = node.rawText.trim();
      if (t) pendingLabel = t;
      continue;
    }
    if (node.nodeType === 3) { // text
      if (node.rawText.trim()) sections.push({ label: 'Text', html: node.rawText.trim() });
      continue;
    }
    const tag = (node.rawTagName || '').toLowerCase();
    if (tag === 'style' || (tag === 'script' && node.getAttribute('type') === 'application/ld+json')) {
      head.push(node.outerHTML);
      continue;
    }
    if (tag === 'script') { scripts.push(node.outerHTML); continue; }
    sections.push({ label: labelFor(node, pendingLabel, sections.length), html: node.outerHTML });
    pendingLabel = null;
  }
  return { head_html: head.join('\n'), script_html: scripts.join('\n'), sections };
}

function labelFor(node, comment, index) {
  const clean = (s) => (s || '').replace(/[═─=\-]{2,}/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  const heading = node.querySelector('h1, h2, h3');
  const candidates = [comment, heading && heading.text, node.getAttribute('aria-label'), node.getAttribute('id')];
  for (const c of candidates) { const v = clean(c); if (v) return v; }
  return `Section ${index + 1}`;
}
