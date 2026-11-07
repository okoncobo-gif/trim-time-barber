# TrimTime — Requirements & Decisions Log

Working notes for the BRD. Ticket IDs refer to `TrimTime-Tracker.xlsx`. Last updated 2026-11-07.

## Product
Online booking for a barbershop: customers book a barber and time slot; barbers approve and manage their own bookings; the admin manages the whole shop.

- **Hosting:** Google Cloud Run, us-central1. Every merge to `main` in GitHub (`okoncobo-gif/trim-time-barber`) deploys automatically (TT-011).
- **Shop time zone:** America/Chicago (owner confirmed, Q4).

## Roles
| Role | Can do |
|---|---|
| Customer (no account) | Book; look up a booking with code + phone; cancel ≥2h before; confirm attendance within 24h of the appointment |
| Barber (own login) | See only their own bookings; approve, cancel, reschedule; move a booking to another barber |
| Admin | Everything a barber can do, for all bookings; edit customer details; delete bookings; add/remove barbers and set their passwords and mobiles; shop settings; SMS log |

Admin password is still `admin` by owner decision. Hardening is deferred (TT-019).

## Booking rules
| Rule | Value | Source |
|---|---|---|
| Earliest a booking can be made | at least 1 hour before the appointment | Owner (TT-013, Q1) |
| Barber selection | required; no "No preference" option | Owner Q3 (TT-024) |
| Customer cancellation | online up to 2 hours before; after that, call the shop | Owner (TT-012) |
| Approval | manual (default) or auto-approve, set by the admin | Owner (TT-015) |
| Unapproved bookings | approved automatically 1 hour before | Owner Q6 (TT-026) |
| Approval warning | sent to the barber and the admin 3 hours before, if the booking is still unapproved | Owner Q6; 3h is an assumption (Q8) |
| Attendance confirmation | customer confirms they're still coming within 24h of the appointment (SMS reminder) | Owner Q1 (TT-023); 24h is an assumption (Q8) |
| Moving a booking to another barber | the new barber must approve it; the customer is texted | Owner Q5 (TT-025) |
| Rescheduling by a barber | the new time stays confirmed; the customer is texted | Assumption (Q9) |
| Removing a barber | their upcoming bookings are moved to another barber (who approves them) or cancelled | Owner Q3 |
| Slots | hourly, 9 AM–6 PM | Prototype |

## Notifications (SMS — owner Q2)
| Event | Customer | Barber | Admin |
|---|---|---|---|
| Booking request received (manual mode) | ✓ | ✓ new request | |
| Booking confirmed (by barber/admin, auto mode, or the deadline) | ✓ | | |
| Booking cancelled by staff | ✓ | | |
| Booking cancelled by customer | | ✓ | |
| Booking moved to another barber | ✓ | ✓ (new barber) | |
| Booking rescheduled | ✓ | | |
| Attendance reminder (within 24h) | ✓ | | |
| Still unapproved, 3h before | | ✓ | ✓ |

- **Provider:** Twilio. Texts are logged but not sent until keys are configured (TT-027). US registration is also required (TT-029).
- **Barber and admin phones:** optional; with none set, no text is sent to that person.

## Open decisions
- **Q7:** what happens if a customer doesn't confirm attendance?
- **Q8:** are the 24h and 3h lead times right?
- **Q9:** must the customer accept a time the barber rescheduled?
- **Double-booking rules:** TT-004.

## Known gaps before launch
- **TT-001:** bookings are stored inside the container and reset on every deploy. Move to Cloud SQL or Firestore.
- **TT-027 / TT-029:** Twilio account and US SMS registration.
- **TT-028:** a Cloud Scheduler job so warnings and reminders fire with no site traffic.
- **TT-019:** stronger admin login.

## Change history
| Date | Change | PR |
|---|---|---|
| 2026-11-07 | Auto-deploy from GitHub to Cloud Run | #1 |
| 2026-11-07 | Booking code + My Booking; cancel ≥2h; 1h lead time; approval mode; barber and admin roles; reassign; API access control | #2 |
| 2026-11-07 | Attendance confirmation; SMS; barber required; barber reschedule/move; auto-approve 1h before + 3h warnings | #3 (in review) |
