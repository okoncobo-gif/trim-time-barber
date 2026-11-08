import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import * as booking from "./server/booking.ts";
import { HttpError } from "./server/booking.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize database (TT-001: move off container-local SQLite before launch)
const db = new Database("appointments.db");
booking.initDb(db);

// Wraps a route so thrown HttpErrors become JSON error responses.
const handle = (fn: (req: express.Request) => unknown, status = 200) =>
  (req: express.Request, res: express.Response) => {
    try {
      const result = fn(req);
      res.status(status).json(result ?? { success: true });
      deliver(); // send any SMS the request queued
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        console.error(err);
        res.status(500).json({ error: "Something went wrong" });
      }
    }
  };

// SMS delivery: Twilio when TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
// TWILIO_FROM are set; otherwise messages are only logged (status 'not_sent').
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM } = process.env;
const smsSender: booking.SmsSender | null = TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM
  ? async (to, body) => {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body }),
      });
      if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  : null;
console.log(smsSender ? "SMS: sending via Twilio" : "SMS: not configured, messages are logged only");

let delivering = false;
const deliver = () => {
  if (delivering) return;
  delivering = true;
  booking.deliverQueued(db, smsSender).catch(err => console.error("SMS delivery failed", err)).finally(() => { delivering = false; });
};

// Time-based rules (auto-approve at the deadline, warnings, attendance
// reminders). Cloud Run may pause idle instances, so they also run on API
// traffic and via POST /api/jobs/run (for Cloud Scheduler, see TT-027).
let lastJobRun = 0;
const runJobs = () => {
  lastJobRun = Date.now();
  try { booking.runDueJobs(db); } catch (err) { console.error("Scheduled jobs failed", err); }
  deliver();
};
setInterval(runJobs, 60_000).unref();

const userOf = (req: express.Request) => booking.verifyToken(db, req.headers.authorization);
const idOf = (req: express.Request) => Number(req.params.id);

async function startServer() {
  const app = express();

  // 🛠️ DYNAMIC PORT: Cloud Run will provide this via environment variable
  const PORT = process.env.PORT || 3000;

  app.use(express.json());
  app.use("/api", (req, res, next) => {
    if (Date.now() - lastJobRun > 60_000) runJobs();
    next();
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", env: process.env.NODE_ENV || "development" });
  });

  // Settings
  app.get("/api/settings", handle(() => booking.getPublicSettings(db)));
  app.get("/api/settings/admin", handle(req => booking.getAdminSettings(db, userOf(req))));
  app.post("/api/settings", handle(req => booking.updateSetting(db, userOf(req), req.body?.key, req.body?.value)));

  // Staff sign-in
  app.post("/api/auth/login", handle(req => booking.login(db, req.body)));
  app.get("/api/auth/me", handle(req => {
    const user = userOf(req);
    if (!user) throw new HttpError(401, "Please sign in");
    return user;
  }));

  // Customer booking (no sign-in; a booking is identified by its code + phone number)
  app.post("/api/appointments", handle(req => booking.createAppointment(db, req.body), 201));
  app.post("/api/bookings/lookup", handle(req => booking.lookupAppointment(db, req.body?.ref, req.body?.phone)));
  app.post("/api/bookings/cancel", handle(req => booking.cancelByCustomer(db, req.body?.ref, req.body?.phone)));
  app.post("/api/bookings/confirm", handle(req => booking.confirmAttendance(db, req.body?.ref, req.body?.phone)));

  // Staff appointment management (admin: all; barber: own only)
  app.get("/api/appointments", handle(req => booking.listAppointments(db, userOf(req))));
  app.patch("/api/appointments/:id", handle(req => booking.updateAppointment(db, userOf(req), idOf(req), req.body)));
  app.delete("/api/appointments/:id", handle(req => booking.deleteAppointment(db, userOf(req), idOf(req))));

  // Open slots for one barber on one date (customer booking form)
  app.get("/api/availability", handle(req => booking.getAvailability(db, req.query.barber_id, req.query.date)));

  // Barber availability (barber: own; admin: anyone)
  app.get("/api/barbers/:id/availability", handle(req => booking.getBarberAvailability(db, userOf(req), idOf(req))));
  app.put("/api/barbers/:id/availability", handle(req => booking.updateBarberAvailability(db, userOf(req), idOf(req), req.body)));
  app.post("/api/barbers/:id/time-off", handle(req => booking.addTimeOff(db, userOf(req), idOf(req), req.body), 201));
  app.delete("/api/barbers/:id/time-off/:timeOffId", handle(req =>
    booking.removeTimeOff(db, userOf(req), idOf(req), Number(req.params.timeOffId))));

  // Barbers (list is public for the booking form; changes are admin-only)
  app.get("/api/barbers", handle(req => booking.listBarbers(db, userOf(req))));
  app.post("/api/barbers", handle(req => booking.createBarber(db, userOf(req), req.body), 201));
  app.patch("/api/barbers/:id", handle(req => booking.updateBarber(db, userOf(req), idOf(req), req.body)));
  app.delete("/api/barbers/:id", handle(req => booking.deleteBarber(db, userOf(req), idOf(req), req.body)));

  // SMS log (admin)
  app.get("/api/messages", handle(req => booking.listMessages(db, userOf(req))));

  // For Cloud Scheduler: runs the time-based rules. Requires JOB_TOKEN.
  app.post("/api/jobs/run", (req, res) => {
    if (!process.env.JOB_TOKEN || req.headers["x-job-token"] !== process.env.JOB_TOKEN) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    runJobs();
    res.json({ success: true });
  });

  // Vite middleware for development / Static files for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production (Cloud Run), serve the built files from the 'dist' folder
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // 🛠️ BIND TO 0.0.0.0: Required for Cloud Run to route traffic to your container
  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`>>> Server is running on port ${PORT} <<<`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
});
