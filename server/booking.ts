// Booking rules, access control and data access for TrimTime.
//
// Everything here takes a SQLite database handle (better-sqlite3 in the app,
// node:sqlite in tests: both expose prepare().run/get/all and exec), so the
// rules can be tested without starting the web server.

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
  approval_mode: "manual",      // 'manual' = barber/admin approves; 'auto' = confirmed on booking
  cancel_cutoff_hours: "2",     // customers can cancel up to this many hours before
  min_lead_hours: "1",          // bookings must be made at least this many hours ahead
  timezone: "America/Chicago",  // shop time zone; appointment date/time are in this zone
};

// Settings anyone may read. Everything else (e.g. session_secret) stays server-side.
const PUBLIC_SETTINGS = Object.keys(DEFAULT_SETTINGS);
// Settings the admin may change from the UI.
const EDITABLE_SETTINGS = ["opening_hours", "approval_mode"];

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin"; // TT-019: harden later
const SESSION_HOURS = 12;

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

    INSERT OR IGNORE INTO barbers (id, name, specialty) VALUES
      (1, 'Marcus', 'Fades & Tapers'),
      (2, 'Devon', 'Classic Cuts'),
      (3, 'Jay', 'Beard Grooming');
  `);

  // Columns added after the first release: add them to existing databases.
  addColumnIfMissing(db, "barbers", "password_hash", "TEXT");
  addColumnIfMissing(db, "appointments", "ref", "TEXT");
  addColumnIfMissing(db, "appointments", "cancelled_by", "TEXT");

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

export function getPublicSettings(db: DB): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of PUBLIC_SETTINGS) out[key] = setting(db, key);
  return out;
}

export function updateSetting(db: DB, user: SessionUser | null, key: string, value: unknown) {
  requireAdmin(user);
  if (!EDITABLE_SETTINGS.includes(key)) throw new HttpError(400, `Setting '${key}' cannot be changed`);
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, "Value is required");
  if (key === "approval_mode" && !["auto", "manual"].includes(value)) {
    throw new HttpError(400, "approval_mode must be 'auto' or 'manual'");
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value.trim());
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

function hoursUntil(app: { date: string; time: string }, db: DB, now: number): number {
  return (appointmentStart(app.date, app.time, setting(db, "timezone")) - now) / 3_600_000;
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
  const payload = Buffer.from(JSON.stringify({ ...user, exp: now + SESSION_HOURS * 3_600_000 })).toString("base64url");
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

const digits = (s: string) => s.replace(/\D/g, "");

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

function cleanDateTime(date: unknown, time: unknown) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) {
    throw new HttpError(400, "Please choose a valid date");
  }
  if (typeof time !== "string" || !TIME_SLOTS.includes(time)) throw new HttpError(400, "Please choose a valid time");
  return { date, time };
}

function cleanBarberId(db: DB, value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
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
  return {
    ref: app.ref,
    customer_name: app.customer_name,
    date: app.date,
    time: app.time,
    status: app.status,
    barber_name: app.barber_name ?? null,
    can_cancel: app.status !== "cancelled" && hoursUntil(app, db, now) >= Number(setting(db, "cancel_cutoff_hours")),
    cancel_cutoff_hours: Number(setting(db, "cancel_cutoff_hours")),
  };
}

export function createAppointment(db: DB, body: any, now = Date.now()) {
  const customer_name = cleanText(body?.customer_name, "Name");
  const customer_phone = cleanPhone(body?.customer_phone);
  const { date, time } = cleanDateTime(body?.date, body?.time);
  const barber_id = cleanBarberId(db, body?.barber_id);

  const lead = Number(setting(db, "min_lead_hours"));
  if (hoursUntil({ date, time }, db, now) < lead) {
    throw new HttpError(400, `Bookings must be made at least ${lead} hour${lead === 1 ? "" : "s"} in advance`);
  }

  const status = setting(db, "approval_mode") === "auto" ? "confirmed" : "pending";
  const ref = newRef(db);
  const info = db.prepare(
    "INSERT INTO appointments (customer_name, customer_phone, date, time, barber_id, status, ref) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(customer_name, customer_phone, date, time, barber_id, status, ref);
  const app = db.prepare(`${SELECT_APPOINTMENTS} WHERE a.id = ?`).get(Number(info.lastInsertRowid));
  return publicView(db, app, now);
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
  const cutoff = Number(setting(db, "cancel_cutoff_hours"));
  if (hoursUntil(app, db, now) < cutoff) {
    throw new HttpError(400, `Bookings can only be cancelled online up to ${cutoff} hours before. Please call the shop.`);
  }
  db.prepare("UPDATE appointments SET status = 'cancelled', cancelled_by = 'customer' WHERE id = ?").run(app.id);
  return lookupAppointment(db, ref, phone, now);
}

export function listAppointments(db: DB, user: SessionUser | null) {
  const u = requireStaff(user);
  if (u.role === "admin") return db.prepare(`${SELECT_APPOINTMENTS} ORDER BY a.date ASC, a.time ASC`).all();
  return db.prepare(`${SELECT_APPOINTMENTS} WHERE a.barber_id = ? ORDER BY a.date ASC, a.time ASC`).all(u.barber_id);
}

function getForStaff(db: DB, u: SessionUser, id: number) {
  const app = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id);
  // Barbers get "not found" for other barbers' bookings, same as a missing one.
  if (!app || (u.role === "barber" && app.barber_id !== u.barber_id)) throw new HttpError(404, "Appointment not found");
  return app;
}

// Barbers: confirm or cancel their own bookings.
// Admin: everything barbers can do, plus edit details and reassign.
export function updateAppointment(db: DB, user: SessionUser | null, id: number, body: any) {
  const u = requireStaff(user);
  const app = getForStaff(db, u, id);

  const editsDetails = ["customer_name", "customer_phone", "date", "time", "barber_id"].some(k => body?.[k] !== undefined);
  if (editsDetails && u.role !== "admin") throw new HttpError(403, "Only the admin can edit or reassign bookings");

  let status = app.status;
  let cancelled_by = app.cancelled_by;
  if (body?.status !== undefined) {
    if (!["pending", "confirmed", "cancelled"].includes(body.status)) throw new HttpError(400, "Invalid status");
    status = body.status;
    cancelled_by = status === "cancelled" ? u.role : null;
  }

  let { customer_name, customer_phone, date, time, barber_id } = app;
  if (editsDetails) {
    if (body.customer_name !== undefined) customer_name = cleanText(body.customer_name, "Name");
    if (body.customer_phone !== undefined) customer_phone = cleanPhone(body.customer_phone);
    if (body.date !== undefined || body.time !== undefined) {
      ({ date, time } = cleanDateTime(body.date ?? date, body.time ?? time));
    }
    if (body.barber_id !== undefined) barber_id = cleanBarberId(db, body.barber_id);
  }

  db.prepare(`
    UPDATE appointments
    SET customer_name = ?, customer_phone = ?, date = ?, time = ?, barber_id = ?, status = ?, cancelled_by = ?
    WHERE id = ?
  `).run(customer_name, customer_phone, date, time, barber_id, status, cancelled_by, id);
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
    if (user?.role === "admin") out.has_login = !!b.password_hash;
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
  const hash = body?.password ? hashPassword(cleanPassword(body.password)) : null;
  const info = db.prepare("INSERT INTO barbers (name, specialty, password_hash) VALUES (?, ?, ?)").run(name, specialty, hash);
  return { id: Number(info.lastInsertRowid) };
}

export function updateBarber(db: DB, user: SessionUser | null, id: number, body: any) {
  requireAdmin(user);
  const barber = db.prepare("SELECT * FROM barbers WHERE id = ?").get(id);
  if (!barber) throw new HttpError(404, "Barber not found");
  const name = body?.name !== undefined ? cleanText(body.name, "Name") : barber.name;
  const specialty = body?.specialty !== undefined ? cleanText(body.specialty, "Specialty") : barber.specialty;
  const hash = body?.password ? hashPassword(cleanPassword(body.password)) : barber.password_hash;
  db.prepare("UPDATE barbers SET name = ?, specialty = ?, password_hash = ? WHERE id = ?").run(name, specialty, hash, id);
}

// Removes a barber. Their upcoming active bookings are handled per `action`:
//   'reassign' → moved to `reassign_to`; 'unassign' → left without a barber; 'cancel' → cancelled.
// Past and already-cancelled bookings are kept, without a barber.
export function deleteBarber(db: DB, user: SessionUser | null, id: number, body: any, now = Date.now()) {
  requireAdmin(user);
  if (!db.prepare("SELECT 1 FROM barbers WHERE id = ?").get(id)) throw new HttpError(404, "Barber not found");
  const action = body?.action ?? "unassign";
  if (!["reassign", "unassign", "cancel"].includes(action)) throw new HttpError(400, "Invalid action");
  let target: number | null = null;
  if (action === "reassign") {
    target = cleanBarberId(db, body?.reassign_to);
    if (target === null || target === id) throw new HttpError(400, "Choose another barber to take over the bookings");
  }

  const apps = db.prepare("SELECT * FROM appointments WHERE barber_id = ?").all(id);
  let moved = 0;
  for (const app of apps) {
    const upcoming = app.status !== "cancelled" && hoursUntil(app, db, now) > 0;
    if (upcoming && action === "reassign") {
      db.prepare("UPDATE appointments SET barber_id = ? WHERE id = ?").run(target, app.id);
    } else if (upcoming && action === "cancel") {
      db.prepare("UPDATE appointments SET barber_id = NULL, status = 'cancelled', cancelled_by = 'admin' WHERE id = ?").run(app.id);
    } else {
      db.prepare("UPDATE appointments SET barber_id = NULL WHERE id = ?").run(app.id);
    }
    if (upcoming) moved++;
  }
  db.prepare("DELETE FROM barbers WHERE id = ?").run(id);
  return { upcoming_affected: moved };
}
