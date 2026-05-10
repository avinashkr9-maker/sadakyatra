# SadakYatra App - Technical Architecture (MVP)

## 1. Suggested Stack
- Mobile App: React Native (single codebase for Android + iOS)
- Admin Panel: Next.js web app
- Backend API: Node.js (NestJS or Express)
- Database: PostgreSQL
- Auth: OTP via SMS provider
- Notifications: WhatsApp API + SMS fallback
- Hosting: AWS/GCP/Render (start simple, scale later)

## 2. Services
- Auth Service
- Booking Service
- Pricing Service
- Dispatch Service
- Notification Service
- Reporting Service

## 3. Core Data Model
- users
- drivers
- vehicles
- bookings
- booking_status_events
- fare_rules
- payments
- reviews

## 4. API Surface (High-level)
- POST /auth/send-otp
- POST /auth/verify-otp
- POST /bookings
- GET /bookings/:id
- PATCH /bookings/:id/status
- POST /bookings/:id/assign-driver
- GET /drivers/:id/bookings
- GET /admin/bookings
- POST /pricing/estimate

## 5. Security Baseline
- JWT auth
- Role-based authorization (customer/admin/driver)
- Rate limit OTP and booking endpoints
- Audit log for all admin actions
- PII encryption at rest where feasible

## 6. Observability
- Centralized logs
- Error tracking (Sentry)
- Booking funnel analytics
- Daily health report (failed OTP, unassigned bookings)
