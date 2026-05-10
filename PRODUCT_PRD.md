# SadakYatra App - Product Requirements (MVP)

## 1. Vision
Build a mobile-first cab booking product for SadakYatra that converts today's WhatsApp-led manual process into a fast, trackable, reliable booking experience for customers, drivers, and operations team.

## 2. Goals
- Increase booking conversion rate from website/app traffic.
- Reduce manual back-and-forth on WhatsApp.
- Shorten booking confirmation time.
- Improve repeat bookings through account history and trust.

## 3. Core User Types
- Customer: Books local/outstation/airport/wedding rides.
- Operator/Admin: Reviews, confirms, assigns bookings.
- Driver: Accepts assigned trips and updates trip status.

## 4. MVP Scope
### Customer App
- Phone OTP login
- Create booking: pickup, drop, date/time, service type, car category
- Instant estimated fare
- Booking status timeline
- Past bookings + rebook
- Support actions: call/WhatsApp

### Admin Web Panel
- Booking queue (new, pending, confirmed, ongoing, completed, cancelled)
- Driver/vehicle assignment
- Final fare override + notes
- Status updates
- Basic dashboard (bookings/day, conversion, cancellations)

### Driver App (or lightweight driver mode)
- View assigned rides
- Accept/reject assignment
- Start trip / End trip
- Customer call shortcut

## 5. Non-MVP (Phase 2+)
- Live GPS tracking map for customers
- In-app payments and automated invoice/GST
- Surge/demand pricing engine
- Referral and loyalty program
- Subscription/corporate wallet

## 6. Booking Lifecycle
1. Customer submits booking request.
2. System computes estimate and creates booking in `PENDING`.
3. Admin confirms price/availability.
4. Driver assigned -> booking `CONFIRMED`.
5. Driver starts trip -> `ONGOING`.
6. Trip ends -> `COMPLETED` (or `CANCELLED`).

## 7. Functional Requirements
- Customer can create booking in <60 seconds.
- Admin can assign driver in <=3 clicks.
- Driver can start/end trip without typing.
- All status changes are timestamped and auditable.
- Booking changes trigger notifications (SMS/WhatsApp/push where available).

## 8. Quality & Reliability Targets
- P95 API response < 600ms for booking and status endpoints.
- Uptime target: 99.5% (MVP).
- OTP success rate > 97%.

## 9. Metrics (North-Star + Supporting)
- North-star: Confirmed bookings per day.
- Conversion: request -> confirmed.
- Median confirmation time.
- Cancellation rate (customer/admin/driver reason wise).
- Repeat booking rate at 30 days.

## 10. Risks
- Fare disputes if estimate and final fare differ too much.
- Driver no-shows / reassignment delays.
- Low connectivity usage in some areas.

## 11. Risk Mitigation
- Clear fare disclaimer + before-confirmation final fare.
- Backup driver assignment workflow.
- Offline-safe driver UI actions with retry queue.

## 12. Release Criteria (MVP Go-Live)
- End-to-end flow works for local + outstation + airport.
- Admin can process at least 100 bookings/day.
- Crash-free sessions >= 99% in pilot week.
- Team runbook and support scripts are ready.
