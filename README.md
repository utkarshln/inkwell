# Inkwell — Online Notebook

Share notes with an 8-letter code. No login required.

---

## Deploy on Railway (Recommended — easiest, free tier available)

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "initial"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/inkwell.git
git push -u origin main
```

### Step 2 — Deploy on Railway
1. Go to https://railway.app and sign up (free)
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `inkwell` repo
4. Railway auto-detects Node.js and runs `npm start`
5. Go to **Settings → Networking → Generate Domain**
6. Your app is live at `https://inkwell-xxxx.railway.app` 🎉

### (Optional) Add Redis for better persistence
1. In your Railway project, click **+ New** → **Database** → **Add Redis**
2. Railway auto-sets `REDIS_URL` env var — the app picks it up automatically
3. Without Redis, notes persist in a JSON file on Railway's disk

---

## Deploy on Vercel

> ⚠️ Vercel has read-only filesystem — **you MUST add Redis (Upstash)**

### Step 1 — Set up Upstash Redis (free)
1. Go to https://upstash.com and sign up (free)
2. Create a Redis database → copy the **Redis URL** (`rediss://...`)

### Step 2 — Deploy
1. Go to https://vercel.com → **Add New Project** → import your GitHub repo
2. In **Environment Variables**, add:
   ```
   REDIS_URL = rediss://your-upstash-url-here
   ```
3. Click **Deploy** — done!

---

## Local development
```bash
npm install
npm start
# Open http://localhost:3000
```

---

## How it works
- **Save**: POST /api/save — stores note JSON with a random 8-char code
- **Read**: GET /api/note/:code — returns the note
- **Storage**: JSON file by default; Redis if REDIS_URL is set
- **Share**: Give anyone the 8-letter code — they can read on any device, no account needed
- **URL shortcut**: `yoursite.com?code=ABCD1234` auto-opens a note
