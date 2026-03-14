const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "20mb" }));
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
    del: (k) => client.del(k),
  };
} else {
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, "notes.json");
  const readDb = () => { try { return JSON.parse(fs.readFileSync(DB_PATH, "utf8")); } catch { return {}; } };
  const writeDb = (db) => fs.writeFileSync(DB_PATH, JSON.stringify(db));
  store = {
    get: (k) => Promise.resolve(readDb()[k] || null),
    set: (k, v) => { const db = readDb(); db[k] = v; writeDb(db); return Promise.resolve(); },
    del: (k) => { const db = readDb(); delete db[k]; writeDb(db); return Promise.resolve(); },
  };
  console.log("📁 File-based storage:", DB_PATH);
}

// ── Helpers ────────────────────────────────────────────────────────────────
const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const genId = () => Array.from({ length: 8 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join("");
const toIST = () => new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
const todayKey = () => new Date().toISOString().slice(0, 10);

function hashVisitor(req) {
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
  const ua = req.headers["user-agent"] || "";
  return crypto.createHash("sha256").update(ip + ua).digest("hex").slice(0, 16);
}

function parseReferrer(ref) {
  if (!ref) return "Direct";
  try {
    const host = new URL(ref).hostname.toLowerCase().replace("www.", "");
    if (host.includes("whatsapp") || host.includes("wa.me")) return "WhatsApp";
    if (host.includes("twitter") || host.includes("t.co") || host.includes("x.com")) return "Twitter/X";
    if (host.includes("instagram")) return "Instagram";
    if (host.includes("linkedin")) return "LinkedIn";
    if (host.includes("facebook") || host.includes("fb.me") || host.includes("fb.com")) return "Facebook";
    if (host.includes("google")) return "Google";
    if (host.includes("telegram") || host.includes("t.me")) return "Telegram";
    return host.split(".")[0].charAt(0).toUpperCase() + host.split(".")[0].slice(1);
  } catch { return "Direct"; }
}

// ── Save ───────────────────────────────────────────────────────────────────
app.post("/api/save", async (req, res) => {
  try {
    const { title, content, id: existingId, expiry } = req.body;
    if (!content) return res.status(400).json({ error: "Content is required" });

    const id = existingId || genId();
    let existing = {};
    if (existingId) {
      const raw = await store.get("ink:" + id);
      if (raw) existing = JSON.parse(raw);
    }

    let expiresAt = null;
    if (expiry === "1d") expiresAt = Date.now() + 86400000;
    else if (expiry === "7d") expiresAt = Date.now() + 7 * 86400000;
    else if (expiry === "1view") expiresAt = "1view";

    const note = {
      id,
      title: title?.trim() || "Untitled Note",
      content,
      views: existing.views || 0,
      uniqueVisitors: existing.uniqueVisitors || [],
      referrers: existing.referrers || {},
      dailyViews: existing.dailyViews || {},
      savedAt: existing.savedAt || toIST(),
      updatedAt: existingId ? toIST() : null,
      lastViewedAt: existing.lastViewedAt || null,
      expiry: expiry || "none",
      expiresAt,
    };

    await store.set("ink:" + id, JSON.stringify(note));
    console.log(`💾 ${existingId ? "Updated" : "Saved"} note: ${id} ("${note.title}")`);
    res.json({ id, savedAt: note.savedAt, updatedAt: note.updatedAt });
  } catch (err) {
    console.error("Save error:", err);
    res.status(500).json({ error: "Failed to save: " + err.message });
  }
});

// ── Get note (public — no analytics data leaked) ───────────────────────────
app.get("/api/note/:id", async (req, res) => {
  try {
    const id = req.params.id.toUpperCase().trim();
    if (id.length !== 8) return res.status(400).json({ error: "Invalid code" });

    const raw = await store.get("ink:" + id);
    if (!raw) return res.status(404).json({ error: "Note not found" });

    const note = JSON.parse(raw);

    // Check timestamp-based expiry
    if (note.expiresAt && note.expiresAt !== "1view" && note.expiresAt !== "expired" && Date.now() > note.expiresAt) {
      return res.status(410).json({ error: "This note has expired and is no longer available." });
    }
    // Check 1-view expiry (already consumed)
    if (note.expiresAt === "expired") {
      return res.status(410).json({ error: "This note was set to self-destruct after 1 view and has already been read." });
    }

    if (req.query.preview !== "1") {
      const visitor = hashVisitor(req);
      const ref = parseReferrer(req.headers["referer"] || req.headers["referrer"] || "");

      note.views = (note.views || 0) + 1;
      note.lastViewedAt = toIST();

      if (!Array.isArray(note.uniqueVisitors)) note.uniqueVisitors = [];
      if (!note.uniqueVisitors.includes(visitor)) note.uniqueVisitors.push(visitor);

      note.referrers = note.referrers || {};
      note.referrers[ref] = (note.referrers[ref] || 0) + 1;

      note.dailyViews = note.dailyViews || {};
      const d = todayKey();
      note.dailyViews[d] = (note.dailyViews[d] || 0) + 1;
      // Prune > 30 days
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      Object.keys(note.dailyViews).forEach(k => { if (k < cutoff) delete note.dailyViews[k]; });

      // Mark 1-view as expired after this read
      if (note.expiresAt === "1view") note.expiresAt = "expired";

      await store.set("ink:" + id, JSON.stringify(note));
      console.log(`👁  Note ${id} — view #${note.views} from ${ref}`);
    }

    // Strip analytics from public response
    const { uniqueVisitors, referrers, dailyViews, expiresAt, expiry, ...pub } = note;
    res.json(pub);
  } catch (err) {
    console.error("Fetch error:", err);
    res.status(500).json({ error: "Failed to fetch note: " + err.message });
  }
});

// ── Stats (owner only) ─────────────────────────────────────────────────────
app.get("/api/stats/:id", async (req, res) => {
  try {
    const id = req.params.id.toUpperCase().trim();
    const raw = await store.get("ink:" + id);
    if (!raw) return res.status(404).json({ error: "Note not found" });
    const n = JSON.parse(raw);
    res.json({
      id, title: n.title,
      views: n.views || 0,
      uniqueViews: (n.uniqueVisitors || []).length,
      referrers: n.referrers || {},
      dailyViews: n.dailyViews || {},
      savedAt: n.savedAt,
      updatedAt: n.updatedAt,
      lastViewedAt: n.lastViewedAt,
      expiry: n.expiry || "none",
      expiresAt: n.expiresAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (_, res) => res.json({ status: "ok", ts: Date.now() }));
app.get("/note/:id", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Inkwell on http://localhost:${PORT}`));
