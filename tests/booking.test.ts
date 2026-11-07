// Run with: node --test --experimental-strip-types tests/
// Uses Node's built-in SQLite so it needs no installed packages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import * as b from "../server/booking.ts";

// Fixed "now": Tue 2026-11-10 10:00 in Chicago (UTC-6) = 16:00 UTC.
const NOW = Date.UTC(2026, 10, 10, 16, 0);
const admin: b.SessionUser = { role: "admin", barber_id: null, name: "Admin" };

function setup() {
  const db = new DatabaseSync(":memory:");
  b.initDb(db as any);
  return db as any;
}

function book(db: any, over: any = {}) {
  return b.createAppointment(db, {
    customer_name: "Sam", customer_phone: "(555) 123-4567",
    date: "2026-11-10", time: "14:00", barber_id: 1, ...over,
  }, NOW);
}

const expectHttp = (fn: () => unknown, status: number) =>
  assert.throws(fn, (e: any) => e instanceof b.HttpError && e.status === status);

test("shop time zone conversion, including DST", () => {
  assert.equal(b.appointmentStart("2026-11-10", "10:00", "America/Chicago"), NOW); // CST
  assert.equal(b.appointmentStart("2026-07-01", "10:00", "America/Chicago"), Date.UTC(2026, 6, 1, 15, 0)); // CDT
});

test("bookings must be at least 1 hour ahead", () => {
  const db = setup();
  expectHttp(() => book(db, { time: "10:00" }), 400); // starts now
  expectHttp(() => book(db, { date: "2026-11-09" }), 400); // past
  assert.equal(book(db, { time: "11:00" }).status, "pending"); // exactly 1h ahead
});

test("manual approval leaves bookings pending; auto confirms them", () => {
  const db = setup();
  assert.equal(book(db).status, "pending");
  b.updateSetting(db, admin, "approval_mode", "auto");
  assert.equal(book(db).status, "confirmed");
  expectHttp(() => b.updateSetting(db, admin, "approval_mode", "sometimes"), 400);
});

test("customer can look up and cancel with code + phone, only 2h+ before", () => {
  const db = setup();
  const late = book(db, { time: "11:00" });  // 1h away
  const early = book(db, { time: "13:00" }); // 3h away
  assert.equal(b.lookupAppointment(db, late.ref, "555-123-4567", NOW).can_cancel, false);
  expectHttp(() => b.lookupAppointment(db, late.ref, "555-000-0000", NOW), 404);
  expectHttp(() => b.cancelByCustomer(db, late.ref, "5551234567", NOW), 400);
  const cancelled = b.cancelByCustomer(db, early.ref.toLowerCase(), "5551234567", NOW);
  assert.equal(cancelled.status, "cancelled");
  expectHttp(() => b.cancelByCustomer(db, early.ref, "5551234567", NOW), 400);
});

test("barber login sees only own bookings and can only confirm/cancel", () => {
  const db = setup();
  b.updateBarber(db, admin, 1, { password: "marcus1" });
  expectHttp(() => b.login(db, { role: "barber", barber_id: 1, password: "nope" }), 401);
  expectHttp(() => b.login(db, { role: "barber", barber_id: 2, password: "marcus1" }), 401); // no password set
  const { token } = b.login(db, { role: "barber", barber_id: 1, password: "marcus1" }, NOW);
  const marcus = b.verifyToken(db, `Bearer ${token}`, NOW)!;
  assert.deepEqual(marcus, { role: "barber", barber_id: 1, name: "Marcus" });

  book(db, { barber_id: 1 });
  const devons = book(db, { barber_id: 2 });
  book(db, { barber_id: null });
  const mine = b.listAppointments(db, marcus);
  assert.equal(mine.length, 1);
  assert.equal(b.listAppointments(db, admin).length, 3);

  b.updateAppointment(db, marcus, mine[0].id, { status: "confirmed" });
  assert.equal(b.listAppointments(db, marcus)[0].status, "confirmed");
  const devonsId = b.listAppointments(db, admin).find((a: any) => a.ref === devons.ref).id;
  expectHttp(() => b.updateAppointment(db, marcus, devonsId, { status: "cancelled" }), 404);
  expectHttp(() => b.updateAppointment(db, marcus, mine[0].id, { barber_id: 2 }), 403);
  expectHttp(() => b.deleteAppointment(db, marcus, mine[0].id), 403);
  expectHttp(() => b.createBarber(db, marcus, { name: "X", specialty: "Y" }), 403);
  expectHttp(() => b.listAppointments(db, null), 401);
});

test("tokens: admin password, tampering and expiry", () => {
  const db = setup();
  expectHttp(() => b.login(db, { role: "admin", password: "wrong" }), 401);
  const { token } = b.login(db, { role: "admin", password: "admin" }, NOW);
  assert.equal(b.verifyToken(db, `Bearer ${token}`, NOW)?.role, "admin");
  assert.equal(b.verifyToken(db, `Bearer ${token}x`, NOW), null);
  assert.equal(b.verifyToken(db, `Bearer garbage.sig`, NOW), null);
  assert.equal(b.verifyToken(db, `Bearer ${token}`, NOW + 13 * 3_600_000), null);
});

test("admin reassigns a booking; removing a barber reassigns or cancels upcoming ones", () => {
  const db = setup();
  book(db, { barber_id: 1, time: "14:00" });
  book(db, { barber_id: 1, time: "15:00" });
  const id = b.listAppointments(db, admin)[0].id;
  b.updateAppointment(db, admin, id, { barber_id: 3 });
  assert.equal(b.listAppointments(db, admin).find((a: any) => a.id === id).barber_name, "Jay");

  expectHttp(() => b.deleteBarber(db, admin, 3, { action: "reassign", reassign_to: 3 }, NOW), 400);
  assert.deepEqual(b.deleteBarber(db, admin, 3, { action: "reassign", reassign_to: 2 }, NOW), { upcoming_affected: 1 });
  assert.equal(b.listAppointments(db, admin).find((a: any) => a.id === id).barber_name, "Devon");

  b.deleteBarber(db, admin, 1, { action: "cancel" }, NOW);
  const other = b.listAppointments(db, admin).find((a: any) => a.id !== id);
  assert.equal(other.status, "cancelled");
  assert.equal(other.barber_id, null);
  assert.equal(b.listBarbers(db, null).length, 1);
});

test("removed barber's session stops working; secret settings stay private", () => {
  const db = setup();
  b.updateBarber(db, admin, 2, { password: "devon" });
  const { token } = b.login(db, { role: "barber", barber_id: 2, password: "devon" }, NOW);
  b.deleteBarber(db, admin, 2, {}, NOW);
  assert.equal(b.verifyToken(db, `Bearer ${token}`, NOW), null);
  assert.equal("session_secret" in b.getPublicSettings(db), false);
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
  assert.match(b.listAppointments(old, admin)[0].ref, /^[A-Z2-9]{6}$/);
});
