#!/usr/bin/env node
// Page check — push se pehle zaroor chalao:  node scripts/check-page.mjs <slug> [--old "Darbhanga"]
// --old: template ka koi shabd jo naye page mein bacha nahi hona chahiye (kai baar de sakte ho)
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const argv = process.argv.slice(2);
const slug = argv[0];
const olds = [];
for (let i = 1; i < argv.length; i++) if (argv[i] === '--old' && argv[i + 1]) olds.push(argv[++i]);
if (!slug) { console.error('Use: node scripts/check-page.mjs <slug> [--old "Darbhanga"]'); process.exit(1); }

const dir = path.join(ROOT, 'content/pages', slug);
const errors = [], warnings = [];
const err = (m) => errors.push(m), warn = (m) => warnings.push(m);

if (!fs.existsSync(dir)) { console.error(`✘ content/pages/${slug} nahi mila`); process.exit(1); }
const html = fs.readFileSync(path.join(dir, 'page.html'), 'utf8');
let meta = {};
try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { err('meta.json sahi JSON nahi hai'); }
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/site/pages.json'), 'utf8'));
const entry = cfg.pages.find((p) => p.slug === slug);

// SEO
if (!entry) err('pages.json mein entry nahi hai');
if (!meta.title) err('title khaali hai'); else if (meta.title.length > 65) warn(`title ${meta.title.length} characters ka hai (60 ke aas-paas rakho)`);
if (!meta.description) err('description khaali hai'); else if (meta.description.length < 110 || meta.description.length > 170) warn(`description ${meta.description.length} characters (150-160 best)`);
const url = entry?.path ? `https://sadakyatra.co.in${entry.path === '/' ? '' : entry.path}` : `https://sadakyatra.co.in/${slug}${entry && !entry.htmlUrl ? '' : '.html'}`;
if (String(meta.canonical || '').replace(/\/$/, '') !== url.replace(/\/$/, '')) err(`canonical galat hai: ${meta.canonical} (hona chahiye ${url})`);
if (meta.og && meta.og.url && String(meta.og.url).replace(/\/$/, '') !== url.replace(/\/$/, '')) err('og.url canonical se match nahi karta');

// Content
const h1 = (html.match(/<h1[\s>]/g) || []).length;
if (h1 !== 1) err(`page mein ${h1} <h1> hain (exactly 1 hona chahiye)`);
for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
  try { JSON.parse(m[1]); } catch { err('JSON-LD schema (application/ld+json) toota hua hai'); }
}
const opens = (html.match(/<(section|div|main|article)[\s>]/g) || []).length;
const closes = (html.match(/<\/(section|div|main|article)>/g) || []).length;
if (opens !== closes) err(`HTML tags adhoore hain: ${opens} khule, ${closes} band (section/div)`);
if (/<script\s+src=/i.test(html)) err('bahar ki <script src> mat daalo (site ka design/JS already hai)');
if (/\b(localStorage|document\.write)\b/.test(html)) warn('localStorage / document.write use mat karo');
for (const o of olds) if (html.includes(o) || JSON.stringify(meta).includes(o)) err(`template ka shabd "${o}" abhi bhi page mein bacha hai`);
if (/lorem ipsum/i.test(html) || /\bTODO\b|\[\[[^\]]*\]\]/.test(html)) err('placeholder text (lorem ipsum / TODO / [[...]]) bacha hai');
if (!/wa\.me\/919304057169/.test(html)) warn('page pe WhatsApp booking link (wa.me/919304057169) nahi mila');

// Template se aaye numbers (km, hrs, ₹) — naye route ke liye galat ho sakte hain
if (meta._template && fs.existsSync(path.join(ROOT, 'content/pages', meta._template, 'page.html'))) {
  const strip = (s) => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  const facts = (s) => new Set((strip(s).match(/₹\s?[\d,]+|~?\d+(?:\.\d+)?\s?(?:km|hrs?|hours?|minutes?|mins?)\b/gi) || []).map((x) => x.replace(/\s+/g, ' ').trim()));
  const tpl = facts(fs.readFileSync(path.join(ROOT, 'content/pages', meta._template, 'page.html'), 'utf8'));
  const same = [...facts(html)].filter((f) => tpl.has(f));
  if (same.length) warn(`Ye values "${meta._template}" template jaisi hi hain — naye route ke liye sahi hain? ${same.join(', ')}`);
}

// Duplicate content (dusre pages se copy?)
for (const other of fs.readdirSync(path.join(ROOT, 'content/pages'))) {
  if (other === slug) continue;
  const t = fs.readFileSync(path.join(ROOT, 'content/pages', other, 'meta.json'), 'utf8');
  try { if (JSON.parse(t).title === meta.title) err(`title "${other}" page jaisa hi hai (har page ka alag title chahiye)`); } catch {}
}

console.log(`\nPage check: ${slug}`);
warnings.forEach((w) => console.log(`  ⚠ ${w}`));
errors.forEach((e) => console.log(`  ✘ ${e}`));
if (errors.length) { console.log(`\n✘ ${errors.length} problem(s) — theek karke dobara chalao. Push MAT karo.\n`); process.exit(1); }
console.log(`\n✔ Sab theek${warnings.length ? ` (${warnings.length} warning)` : ''} — push kar sakte ho.\n`);
