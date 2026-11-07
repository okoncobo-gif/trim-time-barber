// Booking rules, access control, scheduled jobs and SMS for TrimTime.
//
// Everything here takes a SQLite database handle (better-sqlite3 in the app,
// node:sqlite in tests: both expose prepare().run/get/all and exec), so the
// rules can be tested without starting the web server.
//
// SMS: business logic only *queues* messages in the `messages` table.
// deliverQueued() sends them (Twilio when configured, otherwise they are
// logged as 'not_sent' so the admin can still see what would have gone out).

import crypto from "node:crypto";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Role = "admin" | "barber";
export interface SessionUser {
  role: Role;
  barber_id: number | null;
  name: string;
}

// Appointment slots offered to customers (shop-local time).
export const TIME_SLOTS = [
  "09:00", "10:00", "11:00", "12:00", "13:00",
  "14:00", "15:00", "16:00", "17:00", "18:00",
];

// Defaults for business-rule settings (stored in the settings table so they
// can be changed without a code change).
export const DEFAULT_SETTINGS: Record<string, string> = {
  opening_hours: "Tue — Sat, 9:00 AM - 7:00 PM",
  approval_mode: "manual",        // 'manual' = barber/admin approves; 'auto' = confirmed on booking
  cancel_cutoff_hours: "2",       // customers can cancel up to this many hours before
  min_lead_hours: "1",            // bookings must be made at least this many hours ahead
  approval_deadline_hours: "1",   // unapproved bookings are auto-approved this many hours before
  approval_warning_hours: "3",    // barber + admin are warned this many hours before if still unapproved
  attendance_window_hours: "24",  // customers confirm they're still coming within this window
  timezone: "America/Chicago",    // shop time zone; appointment date/time are in this zone
  admin_phone: "",                // where admin SMS warnings go (optional)
};

// Settings anyone may read.
const PUBLIC_SETTINGS = [
  "opening_hours", "approval_mode", "cancel_cutoff_hours", "min_lead_hours",
  "approval_deadline_hours", "approval_warning_hours", "attendance_window_hours", "timezone",
];
// Settings the admin may change from the UI.
const EDITABLE_SETTINGS = ["opening_hours", "approval_mode", "admin_phone"];

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin"; // TT-019: harden later
const SESSION_HOURS = 12;
const SHOP = "TrimTime";
const HOUR = 3_600_000;

type DB = {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): any;
    all(...params: unknown[]): any[];
  };
};

// ---------------------------------------------------------------- schema

export function initDb(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS barbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      specialty TEXT NOT NULL DEFAULT 'General'
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      barber_id INTEGER REFERENCES barbers(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      appointment_id INTEGER,
      kind TEXT NOT NULL,
      to_role TEXT NOT NULL,          -- 'customer' | 'barber' | 'admin'
      to_phone TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', -- queued | sent | not_sent | failed
      error TEXT
    );

    INSERT OR IGNORE INTO barbers (id, name, specialty) VALUES
      (1, 'Marcus', 'Fades & Tapers'),
      (2, 'Devon', 'Classic Cuts'),
      (3, 'Jay', 'Beard Grooming');
  `);

  // Columns added after the first release: add them to existing databases.
  addColumnIfMissing(db, "barbers", "password_hash", "TEXT");
  addColumnIfMissing(db, "barbers", "phone", "TEXT");
  addColumnIfMissing(db, "appointments", "ref", "TEXT");
  addColumnIfMissing(db, "appointments", "cancelled_by", "TEXT");
  addColumnIfMissing(db, "appointments", "approved_by", "TEXT");          // 'barber' | 'admin' | 'auto' | 'deadline'
  addColumnIfMissing(db, "appointments", "customer_confirmed_at", "TEXT"); // customer said they're still coming
  addColumnIfMissing(db, "appointments", "reminder_sent_at", "TEXT");      // attendance reminder SMS queued
  addColumnIfMissing(db, "appointments", "warning_sent_at", "TEXT");       // 'still unapproved' warning queued

  for (const row of db.prepare("SELECT id FROM appointments WHERE ref IS NULL").all()) {
    db.prepare("UPDATE appointments SET ref = ? WHERE id = ?").run(newRef(db), row.id);
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_ref ON appointments(ref)");

  const insert = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insert.run(key, value);
  insert.run("session_secret", crypto.randomBytes(32).toString("hex"));
}

function addColumnIfMissing(db: DB, table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c: any) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
function newRef(db: DB): string {
  for (;;) {
    let ref = "";
    for (let i = 0; i < 6; i++) ref += REF_ALPHABET[crypto.randomInt(REF_ALPHABET.length)];
    if (!db.prepare("SELECT 1 FROM appointments WHERE ref = ?").get(ref)) return ref;
  }
}

// ---------------------------------------------------------------- settings

function setting(db: DB, key: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : DEFAULT_SETTINGS[key];
}
const num = (db: DB, key: string) => Number(setting(db, key));

export function getPublicSettings(db: DB): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of PUBLIC_SETTINGS) out[key] = setting(db, key);
  return out;
}

export function getAdminSettings(db: DB, user: SessionUser | null): Record<string, string> {
  requireAdmin(user);
  return { ...getPublicSettings(db), admin_phone: setting(db, "admin_phone") };
}

export function updateSetting(db: DB, user: SessionUser | null, key: string, value: unknown) {
  requireAdmin(user);
  if (!EDITABLE_SETTINGS.includes(key)) throw new HttpError(400, `Setting '${key}' cannot be changed`);
  if (typeof value !== "string") throw new HttpError(400, "Value is required");
  let v = value.trim();
  if (key === "approval_mode" && !["auto", "manual"].includes(v)) {
    throw new HttpError(400, "approval_mode must be 'auto' or 'manual'");
  }
  if (key === "admin_phone") v = v ? cleanPhone(v) : "";
  else if (!v) throw new HttpError(400, "Value is required");
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, v);
}

// ---------------------------------------------------------------- time

// Converts a shop-local date ("2026-11-10") and time ("14:00") into a UTC
// timestamp (ms), using the shop's time zone. The server runs in UTC.
export function appointmentStart(date: string, time: string, timeZone: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  let ts = asUtc - tzOffset(asUtc, timeZone);
  ts = asUtc - tzOffset(ts, timeZone); // second pass handles DST changes
  return ts;
}

function tzOffset(ts: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ts));
  const p = (t: string) => Number(parts.find(x => x.type === t)!.value);
  const local = Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"), p("second"));
  return local - Math.floor(ts / 1000) * 1000;
}

const startOf = (db: DB, app: { date: string; time: string }) => appointmentStart(app.date, app.time, setting(db, "timezone"));
const hoursUntil = (db: DB, app: { date: string; time: string }, now: number) => (startOf(db, app) - now) / HOUR;

// "Tue Nov 10, 2:00 PM"
function when(app: { date: string; time: string }): string {
  const [y, m, d] = app.date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  const h = Number(app.time.slice(0, 2));
  return `${day}, ${h % 12 || 12}:${app.time.slice(3)} ${h < 12 ? "AM" : "PM"}`;
}

// ---------------------------------------------------------------- SMS

const digits = (s: string) => s.replace(/\D/g, "");

// US numbers by default: 10 digits → +1XXXXXXXXXX.
export function toE164(phone: string): string {
  const d = digits(phone);
  if (phone.trim().startsWith("+")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return `+${d}`;
}

const publicUrl = () => (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const lookupHint = (ref: string) => `${publicUrl() ? `${publicUrl()} → ` : ""}My Booking, code ${ref}`;

function queueSms(db: DB, appointmentId: number | null, kind: string, toRole: string, phone: string | null | undefined, body: string) {
  if (!phone) return;
  db.prepare("INSERT INTO messages (appointment_id, kind, to_role, to_phone, body) VALUES (?, ?, ?, ?, ?)")
    .run(appointmentId, kind, toRole, toE164(phone), body);
}

function barberOf(db: DB, id: number | null) {
  return id === null ? null : db.prepare("SELECT * FROM barbers WHERE id = ?").get(id);
}

export type SmsSender = (to: string, body: string) => Promise<void>;

// Sends queued messages. With no sender configured they're marked 'not_sent'
// (kept in the log so the admin can see them).
export async function deliverQueued(db: DB, sender: SmsSender | null) {
  const queued = db.prepare("SELECT * FROM messages WHERE status = 'queued' ORDER BY id LIMIT 50").all();
  for (const m of queued) {
    if (!sender) {
      db.prepare("UPDATE messages SET status = 'not_sent', error = 'SMS not configured' WHERE id = ?").run(m.id);
      continue;
    }
    try {
      await sender(m.to_phone, m.body);
      db.prepare("UPDATE messages SET status = 'sent', error = NULL WHERE id = ?").run(m.id);
    } catch (err) {
      db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(String((err as Error)?.message ?? err).slice(0, 300), m.id);
    }
  }
}

export function listMessages(db: DB, user: SessionUser | null) {
  requireAdmin(user);
  return db.prepare("SELECT * FROM messages ORDER BY id DESC LIMIT 100").all();
}

// ---------------------------------------------------------------- scheduled jobs

// Runs time-based rules. Safe to call as often as you like (each step only
// acts once per booking). Called every minute, on API traffic, and by
// POST /api/jobs/run (for Cloud Scheduler).
export function runDueJobs(db: DB, now = Date.now()) {
  const deadline = num(db, "approval_deadline_hours");
  const warnAt = num(db, "approval_warning_hours");
  const window = num(db, "attendance_window_hours");
  const adminPhone = setting(db, "admin_phone");
  const result = { warned: 0, auto_approved: 0, reminded: 0 };

  const active = db.prepare(`${SELECT_APPOINTMENTS} WHERE a.status != 'cancelled'`).all();
  for (const app of active) {
    const h = hoursUntil(db, app, now);

    if (app.status === "pending") {
      if (h <= deadline) {
        // Q6: nobody approved in time → approved by default.
        db.prepare("UPDATE appointments SET status = 'confirmed', approved_by = 'deadline' WHERE id = ?").run(app.id);
        result.auto_approved++;
        if (h > 0) {
          queueSms(db, app.id, "confirmed", "customer", app.customer_phone,
            `${SHOP}: Your appointment ${when(app)}${app.barber_name ? ` with ${app.barber_name}` : ""} is confirmed. See you soon!`);
        }
        continue;
      }
      if (h <= warnAt && !app.warning_sent_at) {
        const body = `${SHOP}: ${app.customer_name}'s booking ${when(app)}${app.barber_name ? ` with ${app.barber_name}` : ""} still needs approval. It will be auto-approved ${deadline}h before.`;
        queueSms(db, app.id, "approval_warning", "barber", barberOf(db, app.barber_id)?.phone, body);
        queueSms(db, app.id, "approval_warning", "admin", adminPhone, body);
        db.prepare("UPDATE appointments SET warning_sent_at = ? WHERE id = ?").run(new Date(now).toISOString(), app.id);
        result.warned++;
      }
    }

    if (app.status === "confirmed" && !app.customer_confirmed_at && !app.reminder_sent_at && h > 0 && h <= window) {
      // Q1: ask the customer to confirm they're still coming.
      queueSms(db, app.id, "attendance_reminder", "customer", app.customer_phone,
        `${SHOP}: Reminder — ${when(app)}${app.barber_name ? ` with ${app.barber_name}` : ""}. Please confirm you're still coming: ${lookupHint(app.ref)}.`);
      db.prepare("UPDATE appointments SET reminder_sent_at = ? WHERE id = ?").run(new Date(now).toISOString(), app.id);
      result.reminded++;
    }
  }
  return result;
}

// ---------------------------------------------------------------- auth

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString("hex")}`;
}

function checkPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

function sign(db: DB, payload: string): string {
  return crypto.createHmac("sha256", setting(db, "session_secret")).update(payload).digest("base64url");
}

export function login(db: DB, body: any, now = Date.now()): { token: string; user: SessionUser } {
  const password = typeof body?.password === "string" ? body.password : "";
  let user: SessionUser;
  if (body?.role === "admin") {
    if (password !== ADMIN_PASSWORD) throw new HttpError(401, "Incorrect password");
    user = { role: "admin", barber_id: null, name: "Admin" };
  } else if (body?.role === "barber") {
    const barber = db.prepare("SELECT * FROM barbers WHERE id = ?").get(Number(body.barber_id));
    if (!barber || !checkPassword(password, barber.password_hash)) {
      throw new HttpError(401, "Incorrect barber or password");
    }
    user = { role: "barber", barber_id: barber.id, name: barber.name };
  } else {
    throw new HttpError(400, "Choose admin or a barber to sign in");
  }
  const payload = Buffer.from(JSON.stringify({ ...user, exp: now + SESSION_HOURS * HOUR })).toString("base64url");
  return { token: `${payload}.${sign(db, payload)}`, user };
}

export function verifyToken(db: DB, header: string | undefined, now = Date.now()): SessionUser | null {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(db, payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data: any;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return null; }
  if (!data || typeof data.exp !== "number" || data.exp < now) return null;
  if (data.role === "barber") {
    // Barber removed since signing in: session no longer valid.
    const barber = db.prepare("SELECT id, name FROM barbers WHERE id = ?").get(data.barber_id);
    if (!barber) return null;
    return { role: "barber", barber_id: barber.id, name: barber.name };
  }
  return { role: "admin", barber_id: null, name: "Admin" };
}

function requireStaff(user: SessionUser | null): SessionUser {
  if (!user) throw new HttpError(401, "Please sign in");
  return user;
}

function requireAdmin(user: SessionUser | null): SessionUser {
  if (requireStaff(user).role !== "admin") throw new HttpError(403, "Admin access required");
  return user!;
}

// ---------------------------------------------------------------- validation

function cleanText(value: unknown, field: string, max = 100): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${field} is required`);
  if (value.trim().length > max) throw new HttpError(400, `${field} is too long`);
  return value.trim();
}

function cleanPhone(value: unknown): string {
  const phone = cleanText(value, "Phone number", 30);
  const n = digits(phone).length;
  if (n < 7 || n > 15) throw new HttpError(400, "Please enter a valid phone number");
  return phone;
}

function cleanOptionalPhone(value: unknown): string | null {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return null;
  return cleanPhone(value);
}

function cleanDateTime(date: unknown, time: unknown) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) {
    throw new HttpError(400, "Please choose a valid date");
  }
  if (typeof time !== "string" || !TIME_SLOTS.includes(time)) throw new HttpError(400, "Please choose a valid time");
  return { date, time };
}

// Q3: every booking must have a barber.
function requireBarberId(db: DB, value: unknown, message = "Please choose a barber"): number {
  if (value === null || value === undefined || value === "") throw new HttpError(400, message);
  const id = Number(value);
  if (!db.prepare("SELECT 1 FROM barbers WHERE id = ?").get(id)) throw new HttpError(400, "That barber doesn't exist");
  return id;
}

// ---------------------------------------------------------------- appointments

const SELECT_APPOINTMENTS = `
  SELECT a.*, b.name AS barber_name
  FROM appointments a LEFT JOIN barbers b ON a.barber_id = b.id
`;

// What a customer sees about their own booking.
function publicView(db: DB, app: any, now: number) {
  const h = hoursUntil(db, app, now);
  const window = num(db, "attendance_window_hours");
  return {
    ref: app.ref,
    customer_name: app.customer_name,
    date: app.date,
    time: app.time,
    status: app.status,
    barber_name: app.barber_name ?? null,
    can_cancel: app.status !== "cancelled" && h >= num(db, "cancel_cutoff_hours"),
    cancel_cutoff_hours: num(db, "cancel_cutoff_hours"),
    customer_confirmed: !!app.customer_confirmed_at,
    can_confirm_attendance: app.status !== "cancelled" && !app.customer_confirmed_at && h > 0 && h <= window,
    attendance_window_hours: window,
  };
}

const getApp = (db: DB, id: number) => db.prepare(`${SELECT_APPOINTMENTS} WHERE a.id = ?`).get(id);

export function createAppointment(db: DB, body: any, now = Date.now()) {
  const customer_name = cleanText(body?.customer_name, "Name");
  const customer_phone = cleanPhone(body?.customer_phone);
  const { date, time } = cleanDateTime(body?.date, body?.time);
  const barber_id = requireBarberId(db, body?.barber_id);

  const lead = num(db, "min_lead_hours");
  if (hoursUntil(db, { date, time }, now) < lead) {
    throw new HttpError(400, `Bookings must be made at least ${lead} hour${lead === 1 ? "" : "s"} in advance`);
  }

  const auto = setting(db, "approval_mode") === "auto";
  const info = db.prepare(
    "INSERT INTO appointments (customer_name, customer_phone, date, time, barber_id, status, ref, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(customer_name, customer_phone, date, time, barber_id, auto ? "confirmed" : "pending", newRef(db), auto ? "auto" : null);
  const app = getApp(db, Number(info.lastInsertRowid));

  queueSms(db, app.id, auto ? "confirmed" : "received", "customer", customer_phone, auto
    ? `${SHOP}: You're booked ${when(app)} with ${app.barber_name}. Code ${app.ref}. Cancel online up to ${num(db, "cancel_cutoff_hours")}h before.`
    : `${SHOP}: We got your request for ${when(app)} with ${app.barber_name}. We'll text you when it's confirmed. Code ${app.ref}.`);
  if (!auto) {
    queueSms(db, app.id, "new_request", "barber", barberOf(db, barber_id)?.phone,
      `${SHOP}: New booking request from ${customer_name}, ${when(app)}. Please approve in the staff dashboard.`);
  }
  // A booking made inside the warning/deadline window is handled right away.
  runDueJobs(db, now);
  return publicView(db, getApp(db, app.id), now);
}

function findByRefAndPhone(db: DB, ref: unknown, phone: unknown) {
  const app = typeof ref === "string"
    ? db.prepare(`${SELECT_APPOINTMENTS} WHERE a.ref = ?`).get(ref.trim().toUpperCase())
    : null;
  // Same message whether the code or the phone is wrong, so codes can't be probed.
  if (!app || typeof phone !== "string" || digits(app.customer_phone) !== digits(phone)) {
    throw new HttpError(404, "No booking found for that code and phone number");
  }
  return app;
}

export function lookupAppointment(db: DB, ref: unknown, phone: unknown, now = Date.now()) {
  return publicView(db, findByRefAndPhone(db, ref, phone), now);
}

export function cancelByCustomer(db: DB, ref: unknown, phone: unknown, now = Date.now()) {
  const app = findByRefAndPhone(db, ref, phone);
  if (app.status === "cancelled") throw new HttpError(400, "This booking is already cancelled");
  const cutoff = num(db, "cancel_cutoff_hours");
  if (hoursUntil(db, app, now) < cutoff) {
    throw new HttpError(400, `Bookings can only be cancelled online up to ${cutoff} hours before. Please call the shop.`);
  }
  db.prepare("UPDATE appointments SET status = 'cancelled', cancelled_by = 'customer' WHERE id = ?").run(app.id);
  queueSms(db, app.id, "cancelled", "barber", barberOf(db, app.barber_id)?.phone,
    `${SHOP}: ${app.customer_name} cancelled ${when(app)}.`);
  return lookupAppointment(db, ref, phone, now);
}

// Q1: customer confirms they're still coming (within the attendance window).
export function confirmAttendance(db: DB, ref: unknown, phone: unknown, now = Date.now()) {
  const app = findByRefAndPhone(db, ref, phone);
  const view = publicView(db, app, now);
  if (!view.can_confirm_attendance) {
    if (app.status === "cancelled") throw new HttpError(400, "This booking is cancelled");
    if (app.customer_confirmed_at) throw new HttpError(400, "You've already confirmed — see you soon!");
    throw new HttpError(400, `You can confirm within ${view.attendance_window_hours} hours of your appointment`);
  }
  db.prepare("UPDATE appointments SET customer_confirmed_at = ? WHERE id = ?").run(new Date(now).toISOString(), app.id);
  return lookupAppointment(db, ref, phone, now);
}

// Staff list. Adds computed fields used by the dashboard.
export function listAppointments(db: DB, user: SessionUser | null, now = Date.now()) {
  const u = requireStaff(user);
  runDueJobs(db, now);
  const rows = u.role === "admin"
    ? db.prepare(`${SELECT_APPOINTMENTS} ORDER BY a.date ASC, a.time ASC`).all()
    : db.prepare(`${SELECT_APPOINTMENTS} WHERE a.barber_id = ? ORDER BY a.date ASC, a.time ASC`).all(u.barber_id);
  const deadline = num(db, "approval_deadline_hours");
  const warnAt = num(db, "approval_warning_hours");
  return rows.map((a: any) => {
    const start = startOf(db, a);
    const h = (start - now) / HOUR;
    return {
      ...a,
      start_at: new Date(start).toISOString(),
      auto_approve_at: new Date(start - deadline * HOUR).toISOString(),
      needs_approval_soon: a.status === "pending" && h <= warnAt,
      is_past: h <= 0,
    };
  });
}

function getForStaff(db: DB, u: SessionUser, id: number) {
  const app = getApp(db, id);
  // Barbers get "not found" for other barbers' bookings, same as a missing one.
  if (!app || (u.role === "barber" && app.barber_id !== u.barber_id)) throw new HttpError(404, "Appointment not found");
  return app;
}

// Barbers (own bookings): approve, cancel, reschedule, move to another barber.
// Admin: all of that for every booking, plus edit customer details.
// Moving a booking to another barber puts it back to 'pending' for that barber
// (unless auto-approve is on) and texts the customer (Q5).
export function updateAppointment(db: DB, user: SessionUser | null, id: number, body: any, now = Date.now()) {
  const u = requireStaff(user);
  const app = getForStaff(db, u, id);

  if ((body?.customer_name !== undefined || body?.customer_phone !== undefined) && u.role !== "admin") {
    throw new HttpError(403, "Only the admin can edit customer details");
  }

  let { customer_name, customer_phone, date, time, barber_id, status, cancelled_by, approved_by,
    customer_confirmed_at, reminder_sent_at, warning_sent_at } = app;

  if (body?.customer_name !== undefined) customer_name = cleanText(body.customer_name, "Name");
  if (body?.customer_phone !== undefined) customer_phone = cleanPhone(body.customer_phone);

  const rescheduled = (body?.date !== undefined && body.date !== app.date) || (body?.time !== undefined && body.time !== app.time);
  if (rescheduled) {
    if (app.status === "cancelled") throw new HttpError(400, "Cancelled bookings can't be rescheduled");
    ({ date, time } = cleanDateTime(body.date ?? date, body.time ?? time));
    if (hoursUntil(db, { date, time }, now) <= 0) throw new HttpError(400, "Choose a time in the future");
    customer_confirmed_at = null; reminder_sent_at = null; warning_sent_at = null;
  }

  const moved = body?.barber_id !== undefined && Number(body.barber_id) !== app.barber_id;
  if (moved) {
    if (app.status === "cancelled") throw new HttpError(400, "Cancelled bookings can't be moved");
    barber_id = requireBarberId(db, body.barber_id, "Choose a barber to move this booking to");
    // The receiving barber has to approve it.
    if (setting(db, "approval_mode") === "auto") { status = "confirmed"; approved_by = "auto"; }
    else { status = "pending"; approved_by = null; }
    warning_sent_at = null;
  }

  if (body?.status !== undefined && body.status !== app.status) {
    if (!["pending", "confirmed", "cancelled"].includes(body.status)) throw new HttpError(400, "Invalid status");
    if (moved && body.status === "confirmed" && u.role !== "admin") {
      throw new HttpError(403, "The new barber has to confirm this booking");
    }
    status = body.status;
    cancelled_by = status === "cancelled" ? u.role : null;
    approved_by = status === "confirmed" ? u.role : approved_by;
  }

  db.prepare(`
    UPDATE appointments
    SET customer_name = ?, customer_phone = ?, date = ?, time = ?, barber_id = ?, status = ?,
        cancelled_by = ?, approved_by = ?, customer_confirmed_at = ?, reminder_sent_at = ?, warning_sent_at = ?
    WHERE id = ?
  `).run(customer_name, customer_phone, date, time, barber_id, status, cancelled_by, approved_by,
    customer_confirmed_at, reminder_sent_at, warning_sent_at, id);

  // Text the customer (and the receiving barber) about what changed.
  const updated = getApp(db, id);
  const phone = updated.customer_phone;
  if (status === "cancelled" && app.status !== "cancelled") {
    queueSms(db, id, "cancelled", "customer", phone,
      `${SHOP}: Sorry — your appointment ${when(app)} has been cancelled. Please book again or call the shop.`);
  } else if (moved || rescheduled) {
    const parts = [];
    if (moved) parts.push(`now with ${updated.barber_name}`);
    if (rescheduled) parts.push(`moved to ${when(updated)}`);
    const tail = updated.status === "pending" ? " We'll text you once it's confirmed." : "";
    queueSms(db, id, moved ? "reassigned" : "rescheduled", "customer", phone,
      `${SHOP}: Your appointment is ${parts.join(" and ")}.${tail} Code ${updated.ref}.`);
    if (moved && updated.status === "pending") {
      queueSms(db, id, "new_request", "barber", barberOf(db, barber_id)?.phone,
        `${SHOP}: ${updated.customer_name}'s booking ${when(updated)} was moved to you. Please approve it.`);
    }
  } else if (status === "confirmed" && app.status !== "confirmed") {
    queueSms(db, id, "confirmed", "customer", phone,
      `${SHOP}: Your appointment ${when(updated)} with ${updated.barber_name} is confirmed. See you soon!`);
  }
  runDueJobs(db, now);
}

export function deleteAppointment(db: DB, user: SessionUser | null, id: number) {
  requireAdmin(user);
  db.prepare("DELETE FROM appointments WHERE id = ?").run(id);
}

// ---------------------------------------------------------------- barbers

export function listBarbers(db: DB, user: SessionUser | null) {
  const rows = db.prepare("SELECT * FROM barbers ORDER BY name ASC").all();
  return rows.map((b: any) => {
    const out: any = { id: b.id, name: b.name, specialty: b.specialty };
    if (user?.role === "admin") { out.has_login = !!b.password_hash; out.phone = b.phone ?? null; }
    return out;
  });
}

function cleanPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 4) throw new HttpError(400, "Password must be at least 4 characters");
  return value;
}

export function createBarber(db: DB, user: SessionUser | null, body: any) {
  requireAdmin(user);
  const name = cleanText(body?.name, "Name");
  const specialty = cleanText(body?.specialty, "Specialty");
  const phone = cleanOptionalPhone(body?.phone);
  const hash = body?.password ? hashPassword(cleanPassword(body.password)) : null;
  const info = db.prepare("INSERT INTO barbers (name, specialty, password_hash, phone) VALUES (?, ?, ?, ?)").run(name, specialty, hash, phone);
  return { id: Number(info.lastInsertRowid) };
}

export function updateBarber(db: DB, user: SessionUser | null, id: number, body: any) {
  requireAdmin(user);
  const barber = barberOf(db, id);
  if (!barber) throw new HttpError(404, "Barber not found");
  const name = body?.name !== undefined ? cleanText(body.name, "Name") : barber.name;
  const specialty = body?.specialty !== undefined ? cleanText(body.specialty, "Specialty") : barber.specialty;
  const phone = body?.phone !== undefined ? cleanOptionalPhone(body.phone) : barber.phone;
  const hash = body?.password ? hashPassword(cleanPassword(body.password)) : barber.password_hash;
  db.prepare("UPDATE barbers SET name = ?, specialty = ?, password_hash = ?, phone = ? WHERE id = ?").run(name, specialty, hash, phone, id);
}

// Removes a barber. Their upcoming active bookings are either moved to another
// barber ('reassign': pending for the new barber, customer texted) or
// cancelled ('cancel': customer texted). Past/cancelled bookings are kept.
export function deleteBarber(db: DB, user: SessionUser | null, id: number, body: any, now = Date.now()) {
  const admin = requireAdmin(user);
  if (!barberOf(db, id)) throw new HttpError(404, "Barber not found");
  const upcoming = db.prepare("SELECT * FROM appointments WHERE barber_id = ? AND status != 'cancelled'").all(id)
    .filter((a: any) => hoursUntil(db, a, now) > 0);

  const action = body?.action ?? (upcoming.length ? undefined : "cancel");
  if (!["reassign", "cancel"].includes(action)) throw new HttpError(400, "Choose whether to move or cancel their upcoming bookings");
  let target: number | null = null;
  if (action === "reassign") {
    target = requireBarberId(db, body?.reassign_to, "Choose another barber to take over the bookings");
    if (target === id) throw new HttpError(400, "Choose another barber to take over the bookings");
  }

  for (const app of upcoming) {
    if (action === "reassign") updateAppointment(db, admin, app.id, { barber_id: target }, now);
    else updateAppointment(db, admin, app.id, { status: "cancelled" }, now);
  }
  db.prepare("UPDATE appointments SET barber_id = NULL WHERE barber_id = ?").run(id);
  db.prepare("DELETE FROM barbers WHERE id = ?").run(id);
  return { upcoming_affected: upcoming.length };
}
