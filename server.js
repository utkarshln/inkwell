const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── Storage ────────────────────────────────────────────────────────────────
// Uses Redis if REDIS_URL is set (Railway Redis plugin / Upstash),
// otherwise falls back to a local JSON file (great for Railway without Redis).

let store; // { get(key), set(key,val) }

if (process.env.REDIS_URL) {
  // Redis path — works with Railway Redis plugin or Upstash
  const { createClient } = require("redis");
  const client = createClient({ url: process.env.REDIS_URL });
  client.connect().then(() => console.log("✅ Redis connected"));
  client.on("error", (e) => console.error("Redis error:", e));
  store = {
    get: (k) => client.get(k),
    set: (k, v) => client.set(k, v, { EX: 60 * 60 * 24 * 90 }), // 90 days TTL
  };
} else {
  // File-based fallback — persists across restarts on Railway
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, "notes.json");
  const readDb = () => {
    try { return JSON.parse(fs.readFileSync(DB_PATH, "utf8")); }
    catch { return {}; }
  };
  const writeDb = (db) => fs.writeFileSync(DB_PATH, JSON.stringify(db));
  store = {
    get: (k) => Promise.resolve(readDb()[k] || null),
    set: (k, v) => { const db = readDb(); db[k] = v; writeDb(db); return Promise.resolve(); },
  };
  console.log("📁 Using file-based storage:", DB_PATH);
}

// ── ID generator ───────────────────────────────────────────────────────────
const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const genId = () => Array.from({ length: 8 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join("");

// ── API routes ─────────────────────────────────────────────────────────────
app.post("/api/save", async (req, res) => {
  try {
    const { title, content, id: existingId } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: "Content is required" });

    const id = existingId || genId();
    const note = {
      id,
      title: title?.trim() || "Untitled Note",
      content,
      savedAt: new Date().toLocaleString("en-IN", {
        dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
      }),
    };

    await store.set("ink:" + id, JSON.stringify(note));
    console.log(`💾 Saved note: ${id} ("${note.title}")`);
    res.json({ id, savedAt: note.savedAt });
  } catch (err) {
    console.error("Save error:", err);
    res.status(500).json({ error: "Failed to save note: " + err.message });
  }
});

app.get("/api/note/:id", async (req, res) => {
  try {
    const id = req.params.id.toUpperCase().trim();
    if (id.length !== 8) return res.status(400).json({ error: "Invalid code format" });

    const raw = await store.get("ink:" + id);
    if (!raw) return res.status(404).json({ error: "Note not found" });

    res.json(JSON.parse(raw));
  } catch (err) {
    console.error("Fetch error:", err);
    res.status(500).json({ error: "Failed to fetch note: " + err.message });
  }
});

// Health check for Railway/Vercel
app.get("/api/health", (_, res) => res.json({ status: "ok", ts: Date.now() }));

// SPA fallback
app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Inkwell running on http://localhost:${PORT}`));
