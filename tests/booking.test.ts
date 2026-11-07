// Run with: npm test   (Node 22+; uses Node's built-in SQLite, no packages needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import * as b from "../server/booking.ts";

// Fixed "now": Tue 2026-11-10 10:00 in Chicago (UTC-6) = 16:00 UTC.
const NOW = Date.UTC(2026, 10, 10, 16, 0);
const H = 3_600_000;
const admin: b.SessionUser = { role: "admin", barber_id: null, name: "Admin" };
const marcus: b.SessionUser = { role: "barber", barber_id: 1, name: "Marcus" };
const devon: b.SessionUser = { role: "barber", barber_id: 2, name: "Devon" };

function setup() {
  const db = new DatabaseSync(":memory:");
  b.initDb(db as any);
  return db as any;
}

function book(db: any, over: any = {}, now = NOW) {
  return b.createAppointment(db, {
    customer_name: "Sam", customer_phone: "(555) 123-4567",
    date: "2026-11-11", time: "14:00", barber_id: 1, ...over,
  }, now);
}
const idOf = (db: any, ref: string) => b.listAppointments(db, admin, NOW).find((a: any) => a.ref === ref).id;
const msgs = (db: any, kind?: string) => b.listMessages(db, admin).filter((m: any) => !kind || m.kind === kind);

const expectHttp = (fn: () => unknown, status: number) =>
  assert.throws(fn, (e: any) => e instanceof b.HttpError && e.status === status);

test("shop time zone conversion, including DST", () => {
  assert.equal(b.appointmentStart("2026-11-10", "10:00", "America/Chicago"), NOW); // CST
  assert.equal(b.appointmentStart("2026-07-01", "10:00", "America/Chicago"), Date.UTC(2026, 6, 1, 15, 0)); // CDT
});

test("bookings: at least 1 hour ahead, barber required (Q3)", () => {
  const db = setup();
  expectHttp(() => book(db, { date: "2026-11-10", time: "10:00" }), 400);
  expectHttp(() => book(db, { date: "2026-11-09" }), 400);
  expectHttp(() => book(db, { barber_id: null }), 400);
  expectHttp(() => book(db, { barber_id: "" }), 400);
  assert.ok(book(db, { date: "2026-11-10", time: "11:00" })); // exactly 1h ahead is allowed
});

test("manual approval leaves bookings pending; auto confirms them; SMS queued", () => {
  const db = setup();
  assert.equal(book(db).status, "pending");
  assert.equal(msgs(db, "received").length, 1);
  b.updateSetting(db, admin, "approval_mode", "auto");
  assert.equal(book(db).status, "confirmed");
  assert.equal(msgs(db, "confirmed")[0].to_phone, "+15551234567");
  expectHttp(() => b.updateSetting(db, admin, "approval_mode", "sometimes"), 400);
});

test("customer can look up and cancel with code + phone, only 2h+ before", () => {
  const db = setup();
  const late = book(db, { date: "2026-11-10", time: "11:00" });
  const early = book(db, { date: "2026-11-10", time: "13:00" });
  assert.equal(b.lookupAppointment(db, late.ref, "555-123-4567", NOW).can_cancel, false);
  expectHttp(() => b.lookupAppointment(db, late.ref, "555-000-0000", NOW), 404);
  expectHttp(() => b.cancelByCustomer(db, late.ref, "5551234567", NOW), 400);
  assert.equal(b.cancelByCustomer(db, early.ref.toLowerCase(), "5551234567", NOW).status, "cancelled");
  expectHttp(() => b.cancelByCustomer(db, early.ref, "5551234567", NOW), 400);
});

test("Q6: warning 3h before, auto-approved 1h before if nobody approved", () => {
  const db = setup();
  b.updateBarber(db, admin, 1, { phone: "555-777-0001" });
  b.updateSetting(db, admin, "admin_phone", "555-999-0000");
  const app = book(db, { date: "2026-11-10", time: "18:00" }); // 8h away
  assert.equal(b.runDueJobs(db, NOW).warned, 0);

  const in2h59 = Date.UTC(2026, 10, 10, 21, 1); // 15:01 local, 2h59m before
  assert.equal(b.runDueJobs(db, in2h59).warned, 1);
  assert.equal(b.runDueJobs(db, in2h59).warned, 0); // only once
  const warnings = msgs(db, "approval_warning");
  assert.deepEqual(warnings.map((m: any) => m.to_role).sort(), ["admin", "barber"]);

  const listed = b.listAppointments(db, marcus, in2h59)[0];
  assert.equal(listed.needs_approval_soon, true);

  const in59 = Date.UTC(2026, 10, 10, 23, 1); // 59 min before
  assert.equal(b.runDueJobs(db, in59).auto_approved, 1);
  const after = b.lookupAppointment(db, app.ref, "5551234567", in59);
  assert.equal(after.status, "confirmed");
  assert.equal(b.listAppointments(db, admin, in59)[0].approved_by, "deadline");
});

test("Q1: customer confirms attendance within 24h; reminder SMS sent once", () => {
  const db = setup();
  const app = book(db, { date: "2026-11-12", time: "10:00" }); // 48h away
  b.updateAppointment(db, marcus, idOf(db, app.ref), { status: "confirmed" }, NOW);
  expectHttp(() => b.confirmAttendance(db, app.ref, "5551234567", NOW), 400); // too early
  assert.equal(b.lookupAppointment(db, app.ref, "5551234567", NOW).can_confirm_attendance, false);

  const dayBefore = NOW + 25 * H;
  assert.equal(b.runDueJobs(db, dayBefore).reminded, 1);
  assert.equal(b.runDueJobs(db, dayBefore).reminded, 0);
  assert.match(msgs(db, "attendance_reminder")[0].body, /confirm you're still coming/);
  const confirmed = b.confirmAttendance(db, app.ref, "555 123 4567", dayBefore);
  assert.equal(confirmed.customer_confirmed, true);
  expectHttp(() => b.confirmAttendance(db, app.ref, "5551234567", dayBefore), 400);
});

test("barber sees only own bookings, approves, reschedules; can't edit customer details", () => {
  const db = setup();
  b.updateBarber(db, admin, 1, { password: "marcus1" });
  const { token } = b.login(db, { role: "barber", barber_id: 1, password: "marcus1" }, NOW);
  assert.deepEqual(b.verifyToken(db, `Bearer ${token}`, NOW), marcus);

  const mine = book(db, { barber_id: 1 });
  const devons = book(db, { barber_id: 2 });
  assert.equal(b.listAppointments(db, marcus, NOW).length, 1);
  assert.equal(b.listAppointments(db, admin, NOW).length, 2);

  const id = idOf(db, mine.ref);
  b.updateAppointment(db, marcus, id, { status: "confirmed" }, NOW);
  assert.equal(msgs(db, "confirmed").length, 1);
  b.updateAppointment(db, marcus, id, { date: "2026-11-12", time: "09:00" }, NOW);
  const moved = b.lookupAppointment(db, mine.ref, "5551234567", NOW);
  assert.equal(moved.date, "2026-11-12");
  assert.equal(moved.status, "confirmed");
  assert.match(msgs(db, "rescheduled")[0].body, /Thu, Nov 12, 9:00 AM/);
  expectHttp(() => b.updateAppointment(db, marcus, id, { date: "2026-11-01" }, NOW), 400); // past
  expectHttp(() => b.updateAppointment(db, marcus, id, { customer_name: "X" }, NOW), 403);
  expectHttp(() => b.updateAppointment(db, marcus, idOf(db, devons.ref), { status: "cancelled" }, NOW), 404);
  expectHttp(() => b.deleteAppointment(db, marcus, id), 403);
  expectHttp(() => b.listAppointments(db, null, NOW), 401);
});

test("Q5: barber moves a booking to another barber; new barber must confirm; customer texted", () => {
  const db = setup();
  b.updateBarber(db, admin, 2, { phone: "555-777-0002" });
  const app = book(db, { barber_id: 1 });
  const id = idOf(db, app.ref);
  b.updateAppointment(db, marcus, id, { status: "confirmed" }, NOW);

  b.updateAppointment(db, marcus, id, { barber_id: 2 }, NOW);
  assert.equal(b.listAppointments(db, marcus, NOW).length, 0);
  const forDevon = b.listAppointments(db, devon, NOW)[0];
  assert.equal(forDevon.status, "pending");
  assert.match(msgs(db, "reassigned")[0].body, /now with Devon/);
  assert.equal(msgs(db, "new_request").find((m: any) => m.to_phone === "+15557770002") !== undefined, true);
  expectHttp(() => b.updateAppointment(db, marcus, id, { status: "confirmed" }, NOW), 404); // not Marcus's anymore
  expectHttp(() => b.updateAppointment(db, devon, id, { barber_id: null }, NOW), 400); // barber required

  b.updateAppointment(db, devon, id, { status: "confirmed" }, NOW);
  assert.equal(b.lookupAppointment(db, app.ref, "5551234567", NOW).barber_name, "Devon");
});

test("removing a barber moves (pending for new barber) or cancels upcoming bookings", () => {
  const db = setup();
  const a1 = book(db, { barber_id: 3, time: "14:00" });
  const a2 = book(db, { barber_id: 1, time: "15:00" });
  expectHttp(() => b.deleteBarber(db, admin, 3, {}, NOW), 400); // must choose
  expectHttp(() => b.deleteBarber(db, admin, 3, { action: "unassign" }, NOW), 400);
  expectHttp(() => b.deleteBarber(db, admin, 3, { action: "reassign", reassign_to: 3 }, NOW), 400);
  assert.deepEqual(b.deleteBarber(db, admin, 3, { action: "reassign", reassign_to: 2 }, NOW), { upcoming_affected: 1 });
  assert.equal(b.lookupAppointment(db, a1.ref, "5551234567", NOW).barber_name, "Devon");

  b.deleteBarber(db, admin, 1, { action: "cancel" }, NOW);
  assert.equal(b.lookupAppointment(db, a2.ref, "5551234567", NOW).status, "cancelled");
  assert.equal(b.listBarbers(db, null).length, 1);
  assert.equal(b.deleteBarber(db, admin, 2, { action: "cancel" }, NOW).upcoming_affected, 1);
});

test("SMS delivery: logged as not_sent without Twilio; sent/failed with a sender", async () => {
  const db = setup();
  book(db);
  await b.deliverQueued(db, null);
  assert.equal(msgs(db)[0].status, "not_sent");
  book(db);
  const sent: string[] = [];
  await b.deliverQueued(db, async (to) => { sent.push(to); });
  assert.deepEqual(sent, ["+15551234567"]);
  book(db);
  await b.deliverQueued(db, async () => { throw new Error("boom"); });
  assert.equal(msgs(db)[0].status, "failed");
  assert.equal(b.toE164("+44 20 7946 0958"), "+442079460958");
  expectHttp(() => b.listMessages(db, marcus), 403);
});

test("tokens, sessions of removed barbers, private settings", () => {
  const db = setup();
  expectHttp(() => b.login(db, { role: "admin", password: "wrong" }), 401);
  const { token } = b.login(db, { role: "admin", password: "admin" }, NOW);
  assert.equal(b.verifyToken(db, `Bearer ${token}`, NOW)?.role, "admin");
  assert.equal(b.verifyToken(db, `Bearer ${token}x`, NOW), null);
  assert.equal(b.verifyToken(db, `Bearer garbage.sig`, NOW), null);
  assert.equal(b.verifyToken(db, `Bearer ${token}`, NOW + 13 * H), null);

  b.updateBarber(db, admin, 2, { password: "devon" });
  const devonToken = b.login(db, { role: "barber", barber_id: 2, password: "devon" }, NOW).token;
  b.deleteBarber(db, admin, 2, {}, NOW);
  assert.equal(b.verifyToken(db, `Bearer ${devonToken}`, NOW), null);

  b.updateSetting(db, admin, "admin_phone", "555-999-0000");
  const pub = b.getPublicSettings(db);
  assert.equal("session_secret" in pub || "admin_phone" in pub, false);
  assert.equal(b.getAdminSettings(db, admin).admin_phone, "555-999-0000");
  expectHttp(() => b.updateSetting(db, admin, "session_secret", "x"), 400);
});

test("input validation and existing databases get new columns", () => {
  const db = setup();
  expectHttp(() => book(db, { customer_name: "  " }), 400);
  expectHttp(() => book(db, { customer_phone: "12" }), 400);
  expectHttp(() => book(db, { time: "14:30" }), 400);
  expectHttp(() => book(db, { barber_id: 99 }), 400);

  const old = new DatabaseSync(":memory:") as any;
  old.exec(`CREATE TABLE appointments (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, status TEXT DEFAULT 'pending',
    barber_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO appointments (customer_name, customer_phone, date, time) VALUES ('Old', '5551112222', '2026-12-01', '10:00');`);
  b.initDb(old);
  assert.match(b.listAppointments(old, admin, NOW)[0].ref, /^[A-Z2-9]{6}$/);
});
