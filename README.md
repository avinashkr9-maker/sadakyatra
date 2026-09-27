# SadakYatra Website — Next.js (Phase 1)

Purani InfinityFree wali site ko Next.js mein convert kiya gaya hai. Design, content aur saare URLs **same** hain, taaki Google ranking na gire.

## Folder mein kya kahan hai

| Kya badalna hai | Kaunsi file |
|---|---|
| Header / menu (saare pages pe) | `content/site/header.html` |
| Footer + WhatsApp button (saare pages pe) | `content/site/footer.html` |
| Kisi page ka content | `content/pages/<page-naam>/page.html` |
| Kisi page ka title / description (SEO) | `content/pages/<page-naam>/meta.json` |
| Naya page add karna / redirect lagana | `content/site/pages.json` |
| Photos, logo, favicon | `public/` folder |
| Brand colours | `tailwind.config.js` |

Baaki files (`app/`, `lib/`, `next.config.mjs`) system ki hain, inhe chhedne ki zaroorat nahi.

> Fare rates aur routes ab admin panel (`/admin`) se badlo. Baaki cheezein (offers, sections, pages) agle phases mein admin panel mein aayengi.

## Apne Mac pe chalana (pehli baar)

```bash
cd sadakyatra-next
npm install
npm run dev
```
Phir browser mein kholo: http://localhost:3000

Note: Google reviews localhost pe nahi dikhenge (API key sirf sadakyatra.co.in ke liye locked hai). Fallback reviews dikhenge, ye normal hai.

## Slider (Home page)

Neeche ke buttons (Wedding Cars, Outstation Cab...) slider khud banata hai — har slide ke peele badge se. Admin mein slide copy karo, badge ka text badlo, Save — naya button apne aap aa jayega. Code: `content/site/site.js`.

## Kya-kya badla hai purani site se

- Header/footer ab ek hi jagah se aata hai aur page ke saath hi load hota hai (Google ko saare links dikhenge).
- Tailwind CDN hata ke proper build — site fast hogi.
- Bina use hue Google Fonts hataye.
- Sitemap aur robots.txt automatic (`/sitemap.xml`) — saare 21 pages include.
- `outstation-cab-muzaffarpur-patna.html` → `muzaffarpur-to-patna-cab.html` pe permanent redirect.
- `/index.html` → `/` redirect, www → non-www redirect, bina `.html` wale URL → `.html` wale pe redirect.
- Corporate aur One-way Delhi pages ko site ke design mein laaya (content same).
- Fare calculator ke fallback rates sheet ke hisaab se: Sedan ₹23/km, SUV ₹27/km, multiplier 1.75.
- Fare calculator ab **sirf Muzaffarpur se judi routes** use karta hai (sheet ki baaki distances galat thi). Wapas sab chahiye to `content/pages/index/page.html` mein `ONLY_MUZAFFARPUR_ROUTES: true` ko `false` karo.
- Test pages, purane backups aur bekaar files hata di gayi.
- Har page pe mobile menu theek kiya (kuch pages pe double-click wala bug tha).

---

# Admin Panel (Backend) — Setup Guide

Admin panel `sadakyatra.co.in/admin` pe milega. Isme 3 cheezein hain:
- **Pages:** WordPress jaisa — har page ke sections upar-niche karo, chhupao, copy, delete; kisi bhi text pe click karke likho; photo badlo; purane versions wapas lao
- **Fare Rates:** per km rate, round-trip multiplier, local fare, minimum fare
- **Routes:** kahan se kahan kitne km, verify karna, on/off karna, naya route add karna, bulk add

Yahan save karo → website ke fare calculator mein 1 minute ke andar dikhega.
Agar admin panel/database kabhi band ho, calculator apne aap purani Google Sheet pe chala jata hai.

## Step 1: Database banao (sirf ek baar, ~5 min)

1. supabase.com pe login karo aur apna **SadakYatra wala project** kholo.
   (Tables ke naam `web_` se shuru hote hain, to project mein jo bhi pehle se hai usse takraenge nahi.)
2. Left side menu → **SQL Editor** → **New query**.
3. Is folder ki file `supabase/setup.sql` kholo, **poora** copy karo, wahan paste karo → **Run**.
   Neeche "Success" aana chahiye.

**Phir `supabase/setup-2-pages.sql` bhi isi tarah chalao** (New query → paste → Run). Ye Pages, sections, version history aur photos ki storage banata hai.

## Step 2: Khud ko admin banao

1. Supabase → **Authentication** → **Users** → **Add user** → **Create new user**.
   Apna email + ek strong password daalo, **Auto Confirm User** tick karo → Create.
2. Wapas **SQL Editor** → New query → ye paste karo (apna email daal ke) → Run:

```sql
insert into public.web_admins (user_id, email)
select id, email from auth.users where email = 'APNA-EMAIL@gmail.com';
```

## Step 3: Website ko database se jodo

1. Supabase → **Project Settings** → **API** (ya "API Keys").
2. Do cheezein copy karo:
   - **Project URL** (jaise `https://abcd.supabase.co`)
   - **anon public** key (naye projects mein iska naam **publishable** key hota hai)
   - ⚠️ `service_role` / `secret` key **kabhi mat** use karna — wo poora database khol deti hai.
3. **Local (Mac) ke liye:** project folder mein `.env.example` ko copy karke naam `.env.local` rakho, values bhar do:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://abcd.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=yahan-anon-key
   ```
   Phir `npm run dev -- -p 3005` dobara chalao (pehle `Ctrl + C` se band karke).
4. **Vercel ke liye:** Project → **Settings** → **Environment Variables** → yahi do naam aur values add karo → phir **Deployments** mein jaake latest wale pe **Redeploy**.

`.env.local` file GitHub pe nahi jaati (`.gitignore` mein hai), ye sahi hai.

## Step 4: Use karo

`localhost:3005/admin` (ya live pe `sadakyatra.co.in/admin`) → login → Fare Rates / Routes.

**Routes ke baare mein zaroori:** Sheet se 39 Muzaffarpur routes daale gaye hain, sab "Verify baaki" mein hain.
Har ek ki distance Google Maps pe check karo, galat ho to sahi km daal ke Save, phir "Verified" tick.
Jo route website pe nahi dikhana, uska "Active" off kar do.

## Pages editor kaise use karein

1. **Pehli baar:** Admin → **Pages** → "Sab 21 pages import karo". Isse website ke abhi ke pages admin mein aa jaate hain. Website pe kuch nahi badalta.
2. Kisi page pe **Edit** → us page ke saare sections dikhenge:
   - **▲ ▼** = section upar/neeche
   - **Chhupao / Dikhao** = website se hatao bina delete kiye
   - **Copy** = section ki copy theek neeche
   - **Delete** = hamesha ke liye hatao
   - **naam badlo** = sirf admin mein dikhne wala naam
3. Section pe **Edit** → editor khulega:
   - Kisi bhi **text pe click** karke seedha likho
   - **Photo pe click** karo (ya upar "Is section ki photos" patti se chuno) → nayi photo upload karo. Photo apne aap chhoti (WebP) ho jaati hai. Description zaroor likho, Google ke liye.
   - **Desktop / Mobile** = dono view mein dekho
   - **History** = pichhle 20 versions, koi bhi wapas lao
   - **Save** dabate hi website pe update ho jata hai
4. **Zaroori:** Import ke baad pages ka content database se aata hai, `content/pages/` files se nahi. Kisi page pe "↺" (dobara import) dabane se files wala version wapas aa jayega aur admin ke saare badlav hat jayenge.
5. Pages ka JavaScript (slider, calculator, forms), styles aur SEO title/description hamesha code se aate hain, database se nahi — isliye code ke updates bina re-import ke live ho jaate hain.
6. Home page ke "Quick Fare Estimator" jaise sections ke peeche JavaScript chalta hai. Unka text badal sakte ho, lekin section delete ya chhupane se calculator kaam karna band kar dega.

---

# Drivers & Billing — Setup Guide

Owner admin panel se driver ke account banata hai. Driver phone pe `sadakyatra.co.in/driver` kholta hai, phone number + PIN se login karta hai, bill banata hai aur customer ko WhatsApp pe bhej deta hai. Customer bill ke link pe UPI QR scan karke pay karta hai.

## Step 1: Database (ek baar)
Supabase → SQL Editor → New query → `supabase/setup-3-billing.sql` paste → Run.

## Step 2: Secret key (driver accounts banane ke liye)
1. Supabase → Project Settings → API (ya "API Keys") → **service_role** (ya **secret**) key copy karo.
2. `.env.local` mein nayi line add karo:
   ```
   SUPABASE_SERVICE_ROLE_KEY=yahan-service-role-key
   ```
3. Vercel pe bhi: Settings → Environment Variables → `SUPABASE_SERVICE_ROLE_KEY` add karo → Redeploy.
4. ⚠️ Is key ke aage `NEXT_PUBLIC_` kabhi mat lagana, aur ye key kisi ko mat bhejna. Ye sirf server pe rehti hai.
5. `npm run dev` band karke dobara chalao.

## Step 3: Billing settings
Admin → **Settings** → apna **UPI ID** daalo (iske bina bill pe QR nahi aayega). GSTIN khaali chhodo agar GST registered nahi ho.

## Step 4: Driver banao
Admin → **Drivers** → **Add driver** → naam, phone number, PIN (apne aap banta hai) → **Create account** → "Send to driver on WhatsApp" dabao.

## Driver kya karega
1. `sadakyatra.co.in/driver` → phone + PIN → Sign in
2. **New bill** → customer, route, gaadi → fare apne aap → extras (toll, parking...) → advance → **Create bill**
3. **Send on WhatsApp** → customer ko bill ka link
4. Paisa mila to **Cash received** / **UPI received**

## Owner kya dekhega (Admin → Bills)
Mahine ke saare bills, total, pending payment, kis driver ke paas kitna cash, lal rang mein kam charge kiya gaya fare, Cash/UPI mark karna, galat bill Cancel karna (number series mein rehta hai), Excel (CSV) export.

Bill numbers: `SY-2026-0001`, `SY-2026-0002`… har saal naye se. Delete nahi hota, sirf Cancel.
