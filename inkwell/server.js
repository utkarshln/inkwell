const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── Storage ────────────────────────────────────────────────────────────────
let store;

if (process.env.REDIS_URL) {
  const { createClient } = require("redis");
  const client = createClient({ url: process.env.REDIS_URL });
  client.connect().then(() => console.log("✅ Redis connected"));
  client.on("error", (e) => console.error("Redis error:", e));
  store = {
    get: (k) => client.get(k),
    set: (k, v) => client.set(k, v, { EX: 60 * 60 * 24 * 90 }),
    incr: async (k) => { const v = parseInt(await client.get(k) || "0") + 1; await client.set(k, String(v), { EX: 60 * 60 * 24 * 90 }); return v; },
  };
} else {
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, "notes.json");
  const readDb = () => { try { return JSON.parse(fs.readFileSync(DB_PATH, "utf8")); } catch { return {}; } };
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

const toIST = () => new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

// ── API routes ─────────────────────────────────────────────────────────────
app.post("/api/save", async (req, res) => {
  try {
    const { title, content, id: existingId } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: "Content is required" });

    const id = existingId || genId();

    // Preserve existing views if updating
    let views = 0;
    if (existingId) {
      const existing = await store.get("ink:" + id);
      if (existing) views = JSON.parse(existing).views || 0;
    }

    const note = {
      id,
      title: title?.trim() || "Untitled Note",
      content,
      views,
      savedAt: toIST(),
      lastViewedAt: null,
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

    const note = JSON.parse(raw);

    // Increment views unless owner is previewing (?preview=1)
    if (req.query.preview !== "1") {
      note.views = (note.views || 0) + 1;
      note.lastViewedAt = toIST();
      await store.set("ink:" + id, JSON.stringify(note));
      console.log(`👁  Note ${id} — view #${note.views}`);
    }

    res.json(note);
  } catch (err) {
    console.error("Fetch error:", err);
    res.status(500).json({ error: "Failed to fetch note: " + err.message });
  }
});

// Stats — owner polls this to see live view count
app.get("/api/stats/:id", async (req, res) => {
  try {
    const id = req.params.id.toUpperCase().trim();
    const raw = await store.get("ink:" + id);
    if (!raw) return res.status(404).json({ error: "Note not found" });
    const { title, views, savedAt, lastViewedAt } = JSON.parse(raw);
    res.json({ id, title, views: views || 0, savedAt, lastViewedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (_, res) => res.json({ status: "ok", ts: Date.now() }));
app.get("/note/:id", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Inkwell running on http://localhost:${PORT}`));
