# SadakYatra Backend

A Node.js/Express backend for the SadakYatra cab booking service.

## Stack
- Node.js + Express
- Supabase Postgres (bookings, partners, dispatch) via `pg`
- Supabase Auth (admin sign-in) and Storage (private partner documents)

## Database Setup (once per Supabase project)
In the Supabase SQL Editor, run in order:
1. `supabase/partner_schema.sql`
2. `supabase/bookings_schema.sql`

Both are safe to re-run.

## Run Locally
1. `cd backend`
2. Create `backend/.env` (git-ignored) with `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (see Environment below)
3. `npm install`
4. `npm run dev`

Server starts at `http://localhost:4000`.

## Deployment (Render)

The service runs at `https://sadakyatra.onrender.com`. Set the variables from Environment below under **Environment** in the Render dashboard. All data lives in Supabase, so redeploys and free-tier restarts lose nothing.

## Key Endpoints
- `GET /health`
- `POST /bookings` - Create booking
- `GET /bookings?phone=...` - List bookings by phone
- `GET /bookings/:id` - Get booking details
- `GET /app/config` - Get app configuration
- `GET /config` - Get app configuration alias for compatibility
- `GET /admin/bookings` - List bookings; requires the admin API key
- `PATCH /admin/bookings/:id/status` - Update a booking; requires the admin API key

## Admin API Security

Set `ADMIN_API_KEY` as a secret environment variable in the deployment service. Both admin endpoints require the same value in the `x-admin-api-key` request header. If the environment variable is missing, the admin endpoints return `503`; an absent or incorrect header returns `401`. Never commit the key or put it in a URL.

For a local check in PowerShell:

```powershell
$headers = @{ 'x-admin-api-key' = $env:ADMIN_API_KEY }
Invoke-RestMethod -Uri 'http://localhost:4000/admin/bookings' -Headers $headers
```

## Sample Booking Request
```bash
curl -X POST https://your-railway-url.up.railway.app/bookings \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "9304057169",
    "serviceType": "OUTSTATION",
    "pickup": "Muzaffarpur",
    "drop": "Patna",
    "tripDatetime": "2026-05-15T10:00:00.000Z",
    "carCategory": "sedan"
  }'
```

## Environment
- Node.js 24 or newer (required by `backend/package.json`)
- `DATABASE_URL` - Supabase **Transaction pooler** connection string (Connect button in the Supabase dashboard; IPv4-compatible, works from Render)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` - admin sign-in checks and private document storage
- Optional: `ADMIN_API_KEY`, `GPS_WEBHOOK_SECRET`, `OFFER_TIMEOUT_SECONDS` (default 60), `DATABASE_POOL_SIZE` (default 5)
