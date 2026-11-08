# TrimTime — Requirements & Decisions Log

Working notes for the BRD. Ticket IDs refer to `TrimTime-Tracker.xlsx`. Last updated 2026-11-07.

## Product
Online booking for a barbershop: customers book a barber and time slot; barbers approve and manage their own bookings; the admin manages the whole shop.

- **Hosting:** Google Cloud Run, us-central1. Every merge to `main` in GitHub (`okoncobo-gif/trim-time-barber`) deploys automatically (TT-011).
- **Shop time zone:** America/Chicago (owner confirmed, Q4).

## Roles
| Role | Can do |
|---|---|
| Customer (no account) | Book (normal or premium); look up a booking with code + phone; cancel ≥2h before; confirm attendance within 24h of the appointment |
| Barber (own login) | See only their own bookings; approve, cancel, reschedule; move a booking to another barber; set their weekly hours, time off, booking window and premium opt-in |
| Admin | Everything a barber can do, for all bookings; edit customer details; delete bookings; add/remove barbers and set their passwords and mobiles; shop settings; SMS log |

Admin password is still `admin` by owner decision. Hardening is deferred (TT-019).

## Booking rules
| Rule | Value | Source |
|---|---|---|
| Earliest a booking can be made | at least 1 hour before the appointment | Owner (TT-013, Q1) |
| Barber selection | required; no "No preference" option | Owner Q3 (TT-024) |
| Customer cancellation | online up to 2 hours before; after that, call the shop | Owner (TT-012) |
| Approval | manual (default) or auto-approve, set by the admin | Owner (TT-015) |
| Unapproved bookings | approved automatically 1 hour before (not premium requests) | Owner Q6 (TT-026) |
| Approval warning | sent to the barber and the admin 3 hours before, if the booking is still unapproved | Owner Q6, Q8 |
| Attendance confirmation | customer confirms they're still coming within 24h of the appointment (SMS reminder) | Owner Q1, Q8 (TT-023) |
| Customer doesn't confirm attendance | nothing happens; staff see "customer not confirmed yet" | Owner Q7 |
| Moving a booking to another barber | the new barber must approve it; the customer is texted | Owner Q5 (TT-025) |
| Rescheduling by a barber | the new time stays confirmed; the customer is texted and can cancel and rebook if it doesn't suit them | Owner Q9 |
| Removing a barber | their upcoming bookings are moved to another barber (who approves them) or cancelled | Owner Q3 |
| Slots | hourly start times; normal = inside the barber's weekly hours | Owner (TT-030) |
| Barber weekly hours | set per barber; default Tue–Sat 9 AM–7 PM | Owner (TT-030) |
| Booking window | set per barber; default 30 days ahead | Owner (TT-031); default is an assumption (Q11) |
| Time off | set per barber; blocks new bookings; existing bookings are flagged, not cancelled | Assumption (TT-032, Q14) |
| Double-booking | a barber can't have two active bookings at the same time | TT-004 |
| Premium requests | early/late slots (7–9 AM, 7–9 PM) on working days, for barbers who opt in; flat fee set by the admin (default $25), paid at the shop; customer accepts the fee; never auto-approved | Owner (TT-033); window, fee and payment are assumptions (Q10, Q12, Q13, Q15) |
| Barber hasn't confirmed by 1h before | normal booking: auto-approved, customer asked to text the barber; premium request: stays pending, customer asked to text the barber | Owner (TT-034, Q6) |

## Notifications (SMS — owner Q2)
| Event | Customer | Barber | Admin |
|---|---|---|---|
| Booking request received (manual mode, or any premium request) | ✓ incl. barber mobile | ✓ new request | |
| Booking confirmed (by barber/admin, auto mode, or the deadline) | ✓ | | |
| Booking cancelled by staff | ✓ | | |
| Booking cancelled by customer | | ✓ | |
| Booking moved to another barber | ✓ | ✓ (new barber) | |
| Booking rescheduled | ✓ | | |
| Attendance reminder (within 24h) | ✓ | | |
| Still unapproved, 3h before | | ✓ | ✓ |
| Barber hasn't confirmed, 1h before ("text your barber") | ✓ | | |

- **Provider:** Twilio. Texts are logged but not sent until keys are configured (TT-027). US registration is also required (TT-029).
- **Barber and admin phones:** optional; with none set, no text is sent to that person.

## Open decisions
- **Q10:** premium hours window.
- **Q11:** default booking window.
- **Q12:** premium requests on days off?
- **Q13:** premium fee amount, and flat vs per barber.
- **Q14:** what to do with bookings that clash with time off.
- **Q15:** take the premium fee online?

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
| 2026-11-07 | Attendance confirmation; SMS; barber required; barber reschedule/move; auto-approve 1h before + 3h warnings | #3 |
| 2026-11-07 | Barber availability (hours, booking window, time off); open-slot booking; no double-booking; premium requests; text-your-barber reminder | #4 (in review) |
