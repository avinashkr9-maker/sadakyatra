#!/usr/bin/env node
// =============================================================================
// Naya page banao — existing page ko template bana ke.
//
// Example (route page):
//   node scripts/new-page.mjs --slug muzaffarpur-to-gaya-cab \
//     --template muzaffarpur-to-darbhanga-cab \
//     --title "Muzaffarpur to Gaya Cab ₹4,030 | SadakYatra" \
//     --description "Muzaffarpur to Gaya cab at ₹4,030 one way. AC sedan & SUV..." \
//     --keywords "muzaffarpur to gaya cab, muzaffarpur gaya taxi" \
//     --replace "Darbhanga=>Gaya" --replace "darbhanga=>gaya" --replace "₹1,699=>₹4,030"
//
// Options:
//   --slug         naye page ka naam (URL: /<slug>.html) — sirf a-z, 0-9, "-"
//   --template     kis existing page ki copy banani hai (content/pages/ ka folder naam)
//   --title        SEO title (Google mein dikhta hai) — 60 characters ke andar rakho
//   --description  SEO description — 150-160 characters
//   --keywords     comma se alag keywords (optional)
//   --replace      "PURANA=>NAYA" text badlo (kai baar de sakte ho), page.html + schema mein
//   --priority     sitemap priority (default 0.8)
// =============================================================================
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PAGES_DIR = path.join(ROOT, 'content/pages');
const CONFIG = path.join(ROOT, 'content/site/pages.json');
const SITE = 'https://sadakyatra.co.in';

function args() {
  const out = { replace: [] };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i].replace(/^--/, '');
    const v = a[i + 1];
    if (!a[i].startsWith('--') || v === undefined) fail(`Galat option: ${a[i]}`);
    if (k === 'replace') out.replace.push(v); else out[k] = v;
    i++;
  }
  return out;
}
function fail(msg) { console.error(`\n✘ ${msg}\n`); process.exit(1); }

const o = args();
if (!o.slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(o.slug)) fail('--slug zaroori hai (sirf chhote a-z, 0-9 aur "-", jaise muzaffarpur-to-gaya-cab)');
if (!o.template) fail('--template zaroori hai (jaise muzaffarpur-to-darbhanga-cab)');
if (!o.title) fail('--title zaroori hai');
if (!o.description) fail('--description zaroori hai');

const src = path.join(PAGES_DIR, o.template);
const dst = path.join(PAGES_DIR, o.slug);
if (!fs.existsSync(src)) fail(`Template "${o.template}" nahi mila. Available: ${fs.readdirSync(PAGES_DIR).join(', ')}`);
if (fs.existsSync(dst)) fail(`Page "${o.slug}" pehle se hai.`);

const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
if (cfg.pages.some((p) => p.slug === o.slug)) fail(`"${o.slug}" pages.json mein pehle se hai.`);

const pairs = o.replace.map((r) => {
  const i = r.indexOf('=>');
  if (i < 1) fail(`--replace ka format "PURANA=>NAYA" hona chahiye, mila: ${r}`);
  return [r.slice(0, i), r.slice(i + 2)];
});
const applyReplace = (s) => pairs.reduce((acc, [a, b]) => acc.split(a).join(b), s);

// 1) page.html copy + replace; template ka URL naye URL se badlo
let html = fs.readFileSync(path.join(src, 'page.html'), 'utf8');
html = html.split(`/${o.template}.html`).join(`/${o.slug}.html`);
html = applyReplace(html);

// 2) meta.json
const meta = JSON.parse(fs.readFileSync(path.join(src, 'meta.json'), 'utf8'));
const url = `${SITE}/${o.slug}.html`;
meta.title = o.title;
meta.description = o.description;
if (o.keywords) meta.keywords = o.keywords; else delete meta.keywords;
meta.robots = 'index, follow';
meta._template = o.template; // check-page ko pata rahe kis page se copy hua
meta.canonical = url;
meta.og = { ...(meta.og || {}), title: o.title, description: o.description, url, type: 'website', locale: 'en_IN' };
if (meta.twitter) meta.twitter = { ...meta.twitter, title: o.title, description: o.description };

fs.mkdirSync(dst);
fs.writeFileSync(path.join(dst, 'page.html'), html);
fs.writeFileSync(path.join(dst, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

// 3) pages.json mein jodo (sitemap + URL ke liye)
cfg.pages.push({ slug: o.slug, htmlUrl: true, priority: Number(o.priority || 0.8), changefreq: 'weekly' });
fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');

console.log(`\n✔ Page bana: content/pages/${o.slug}/`);
console.log(`  URL (live hone ke baad): ${url}`);
console.log(`  Ab page.html mein content update karo, phir chalao:  node scripts/check-page.mjs ${o.slug}\n`);
