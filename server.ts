import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize database
const db = new Database("appointments.db");
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

  INSERT OR IGNORE INTO settings (key, value) VALUES ('opening_hours', 'Tue — Sat, 9:00 AM - 7:00 PM');

  INSERT OR IGNORE INTO barbers (id, name, specialty) VALUES
    (1, 'Marcus', 'Fades & Tapers'),
    (2, 'Devon', 'Classic Cuts'),
    (3, 'Jay', 'Beard Grooming');
`);

async function startServer() {
  const app = express();
  
  // 🛠️ DYNAMIC PORT: Cloud Run will provide this via environment variable
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", env: process.env.NODE_ENV || "development" });
  });

  app.get("/api/settings", (req, res) => {
    const settings = db.prepare("SELECT * FROM settings").all();
    const settingsMap = settings.reduce((acc: any, curr: any) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});
    res.json(settingsMap);
  });

  app.post("/api/settings", (req, res) => {
    const { key, value } = req.body;
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
    res.json({ success: true });
  });

  app.get("/api/appointments", (req, res) => {
    const appointments = db.prepare(`
      SELECT a.*, b.name as barber_name
      FROM appointments a
      LEFT JOIN barbers b ON a.barber_id = b.id
      ORDER BY a.date ASC, a.time ASC
    `).all();
    res.json(appointments);
  });

  app.post("/api/appointments", (req, res) => {
    const { customer_name, customer_phone, date, time, barber_id } = req.body;
    const info = db.prepare(
      "INSERT INTO appointments (customer_name, customer_phone, date, time, barber_id) VALUES (?, ?, ?, ?, ?)"
    ).run(customer_name, customer_phone, date, time, barber_id ?? null);
    res.status(201).json({ id: info.lastInsertRowid });
  });

  app.patch("/api/appointments/:id", (req, res) => {
    const { id } = req.params;
    const { status, customer_name, customer_phone, date, time, barber_id } = req.body;

    if (customer_name !== undefined || customer_phone !== undefined || date !== undefined || time !== undefined || barber_id !== undefined) {
      db.prepare(`
        UPDATE appointments
        SET customer_name = COALESCE(?, customer_name),
            customer_phone = COALESCE(?, customer_phone),
            date = COALESCE(?, date),
            time = COALESCE(?, time),
            status = COALESCE(?, status),
            barber_id = CASE WHEN ? IS NOT NULL THEN ? ELSE barber_id END
        WHERE id = ?
      `).run(customer_name ?? null, customer_phone ?? null, date ?? null, time ?? null, status ?? null, barber_id ?? null, barber_id ?? null, id);
    } else {
      db.prepare("UPDATE appointments SET status = ? WHERE id = ?").run(status, id);
    }

    res.json({ success: true });
  });

  app.delete("/api/appointments/:id", (req, res) => {
    db.prepare("DELETE FROM appointments WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Barber Routes
  app.get("/api/barbers", (req, res) => {
    const barbers = db.prepare("SELECT * FROM barbers ORDER BY name ASC").all();
    res.json(barbers);
  });

  app.post("/api/barbers", (req, res) => {
    const { name, specialty } = req.body;
    const info = db.prepare("INSERT INTO barbers (name, specialty) VALUES (?, ?)").run(name, specialty);
    res.status(201).json({ id: info.lastInsertRowid });
  });

  app.patch("/api/barbers/:id", (req, res) => {
    const { id } = req.params;
    const { name, specialty } = req.body;
    db.prepare(`
      UPDATE barbers
      SET name = COALESCE(?, name),
          specialty = COALESCE(?, specialty)
      WHERE id = ?
    `).run(name ?? null, specialty ?? null, id);
    res.json({ success: true });
  });

  app.delete("/api/barbers/:id", (req, res) => {
    db.prepare("DELETE FROM barbers WHERE id = ?").run(req.params.id);
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
