# SadakYatra Backend

A Node.js/Express backend for the SadakYatra cab booking service.

## Stack
- Node.js + Express
- SQLite (local file `data.sqlite`)

## Run Locally
1. `cd backend`
2. `npm install`
3. `npm run dev`

Server starts at `http://localhost:4000`.

## Deployment to Railway

1. Go to [Railway.app](https://railway.app) and sign up/login
2. Click "New Project" → "Deploy from GitHub repo"
3. Connect your GitHub repository
4. Railway will automatically detect it's a Node.js app and deploy it
5. The app will be available at the Railway-assigned URL

The database will be automatically initialized on first deployment.

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
- Uses better-sqlite3 for fast SQLite operations
