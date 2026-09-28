# Dev Agent — How to create a new page for sadakyatra.co.in

This replaces the old InfinityFree upload flow. The site is now Next.js on Vercel.
Every new page goes: **branch → Vercel preview link → owner approval on Telegram → merge to main → live.**

---

## 0. One-time facts (do not change)

| What | Value |
|---|---|
| Project folder | `~/Projects/sadakyatra/SadakYatra` |
| Git remote | `git@github-sadakyatra:sadakyatramuz/SadakYatra.git` (SSH, no password needed) |
| Commit email | set automatically for this folder (via `~/.gitconfig-sadakyatra`) |
| Live site | `https://sadakyatra.co.in` (Vercel project `sadak-yatra`) |

Quick health check before starting (all must pass):
```bash
cd ~/Projects/sadakyatra/SadakYatra
ssh -T git@github-sadakyatra          # must say: Hi sadakyatramuz!
git config user.email                 # must be the sadakyatramuz GitHub email
git remote -v                         # must show git@github-sadakyatra:sadakyatramuz/SadakYatra.git
```
If the email is wrong, **stop and tell the owner** — Vercel blocks deploys from unknown emails.

---

## 1. Hard rules

1. **Never push to `main` directly.** Always work on a branch named `page/<slug>`.
2. Only create/edit: `content/pages/<new-slug>/` and `content/site/pages.json`.
   Do **not** touch `app/`, `lib/`, `supabase/`, `scripts/`, `next.config.mjs`, `package.json`, or any `.env*` file unless the owner explicitly asks.
3. Never commit secrets, keys or `.env.local`. Never run `git push --force`.
4. One page per branch. Never delete existing pages (the owner decides that).
5. Do not merge until the owner replies **"approve"** (or clearly says yes) on Telegram.

---

## 2. Create the page

```bash
cd ~/Projects/sadakyatra/SadakYatra
git checkout main && git pull
git checkout -b page/<slug>
```

Pick the closest existing page as a template (route pages: `muzaffarpur-to-darbhanga-cab`; service pages: `tempo-traveller-muzaffarpur`, `baraat-car-muzaffarpur`):
```bash
node scripts/new-page.mjs --slug <slug> --template <template-slug> \
  --title "<SEO title, ~60 chars>" \
  --description "<SEO description, 150-160 chars>" \
  --keywords "<comma separated keywords>" \
  --replace "OldCity=>NewCity" --replace "oldcity=>newcity" --replace "₹old=>₹new"
```

Then open `content/pages/<slug>/page.html` and put in Maya's content:
- Update **every fact**: distance (km), journey time, all fares (sedan/SUV/round trip), FAQs, landmarks, the JSON-LD schema at the top.
- Distances: use the admin Routes table (ask the owner if a route is missing). Fares = distance × current admin rates — ask Jordan to calculate; never guess.
- Keep exactly **one `<h1>`**. Keep the WhatsApp booking links (`wa.me/919304057169`).
- Use only the existing HTML/Tailwind classes from the template (copy blocks from other pages if needed). Do not add external `<script src>` or new CSS frameworks.
- Content must be unique — do not copy paragraphs from other pages.

## 3. Check (must pass before pushing)

```bash
node scripts/check-page.mjs <slug> --old "OldCity"
```
- Any **✘** → fix and re-run. Never push with errors.
- **⚠ "values same as template"** → each listed km/hrs/₹ value must be verified. Fix it, or explain in the Telegram message why it is correct (e.g. ₹25/km tempo rate is the same everywhere).

Optional but recommended (catches build errors): `npm run build`

## 4. Push and get the preview link

```bash
git add content/pages/<slug> content/site/pages.json
git commit -m "New page: <slug>"
git push -u origin page/<slug>
```
Vercel builds a **preview** automatically (1–3 min). Preview URL pattern:
`https://sadak-yatra-git-page-<slug>-<scope>.vercel.app/<slug>.html`
(The owner will tell you `<scope>` once — save it in MEMORY.md. If unsure, send the branch name and the owner will open Vercel → Deployments.)

## 5. Ask for approval on Telegram

Send the owner:
```
🆕 New page ready for review: <Page title>
Preview: <preview URL>
URL after going live: https://sadakyatra.co.in/<slug>.html
Template used: <template-slug>
Checked: distance <X> km, time <Y>, fares <list> (source: <admin routes / Jordan>)
Warnings explained: <none / list>
Reply "approve" to publish, or tell me what to change.
```

## 6. After "approve" — publish

```bash
git checkout main && git pull
git merge --no-ff page/<slug> -m "Publish page: <slug>"
git push
git branch -d page/<slug> && git push origin --delete page/<slug>
```
Vercel deploys to production in 1–2 minutes. Confirm `https://sadakyatra.co.in/<slug>.html` returns the page, then tell the owner it's live.
The page is automatically added to the sitemap. It shows in the admin panel under **Pages** as "Not imported" — the owner can import it there to edit text/photos later.

If changes are requested: edit on the same branch, re-run the check, commit, push (the preview updates itself), and ask again.

## 7. Undo a published page (only if the owner asks)

```bash
git checkout main && git pull
git log --oneline -5                      # find the "Publish page: <slug>" commit
git revert -m 1 <commit-id>
git push
```
