# Partner Operations Foundation

## Application and Review

The Fleet page in the website and mobile app submits owner, mobile, cab, driver, and operating-area details to `POST /partners/applications`. Applications are rate-limited in process memory and always start as `PENDING`; application submission does not verify a phone number or approve a cab.

Admin endpoints require `x-admin-api-key`:

- `GET /admin/partners/applications?status=PENDING` lists applications.
- `POST /admin/partners/applications/:id/approve` requires `phoneVerified: true` and private RC, DL, and insurance object keys.
- `PATCH /admin/partners/applications/:id` with `status: REJECTED` rejects a pending application.
- `GET /admin/partners` lists partner cabs, online state, and latest location.
- `PATCH /admin/partners/:id` pauses/resumes a partner. Pausing clears online state and GPS.
- `PATCH /admin/vehicles/:id` pauses/resumes an individual cab.
- `POST /admin/bookings/:id/assign` offers a pending booking to an online, available cab of the requested category.

Approval creates a unique partner, driver, and vehicle record. It returns the driver's random access token once; the server stores only a hash. Deliver that token to the driver over a private channel.

## Driver Operations

The Fleet page's Driver mode accepts the one-time token, runs in a mobile HTTPS browser, and supports online/offline, foreground GPS sharing, offer accept/reject, and ordered trip stages.

- `GET /driver/bookings`
- `PATCH /driver/presence` with `{ "online": true|false }`
- `POST /driver/location` with numeric `latitude` and `longitude`
- `PATCH /driver/bookings/:id/response` with `ACCEPT` or `REJECT`
- `PATCH /driver/bookings/:id/status` with the next stage: `GOING_TO_PICKUP`, `ARRIVED`, `TRIP_STARTED`, or `TRIP_COMPLETED`

The customer app receives a one-time tracking token when creating a booking. Live tracking requires that token in `x-booking-tracking-token`; the database hash is removed from all booking responses. The app currently keeps this token only for its active session.

## Hardware GPS Trackers (Option B)

A tracker's number alone gives no location; the tracker provider must push positions (directly via webhook, or through a small relay that polls the provider's API).

1. Set `GPS_WEBHOOK_SECRET` on the backend.
2. In Admin mode, enter the tracker's device ID on the cab and tap Save (`PATCH /admin/vehicles/:id` with `gpsDeviceId`).
3. The provider/relay calls `POST /integrations/gps/location` with header `x-gps-webhook-secret` and body `{ "deviceId", "latitude", "longitude" }`.

Customers only see the cab's position between driver acceptance and trip completion.

## Pricing

`fareConfig` in `src/server.js` is the single place to change per-km rates, minimum fares, driver allowance, toll/parking per km, and GST. The app downloads it from `/app/config`; keep the offline copy (`DEFAULT_FARE_CONFIG` in `app/App.js`) in sync.

## Required Production Work

- Real mobile OTP is not configured. Until then, an admin must independently verify the applicant's phone before setting `phoneVerified: true`.
- Document upload is not implemented. The approval guard checks `PARTNER_DOCUMENTS_PRIVATE=true`, `PARTNER_DOCUMENTS_BUCKET`, and object-key prefixes, but it does not upload files or verify that an object exists. Do not enable approval until a private object-storage adapter with authorization and existence checks is integrated.
- The admin key and driver token are entered in the Fleet page and are not persisted there. Driver tokens do not yet have expiry/rotation UX.
- Add OTP, then deploy the backend and website together. The browser forms currently target `https://sadakyatra.onrender.com`.
