# LinkedIn Post — Inkwell

---

I built a shareable notebook app from scratch over a weekend. Here's what I learned shipping a full-stack product solo.

**The problem:** Every note-sharing tool I used had too much friction — accounts, apps, paywalls. I wanted something that works like a WhatsApp link. You write, you share, they read. Done.

**What I built — Inkwell:**

→ Write rich notes (text, images, formatting, colors)
→ Hit Save → get a direct link (yourapp.com/note/XXXXXXXX)
→ Anyone taps the link, note opens instantly — no login, no app install
→ QR code generation for in-person sharing
→ Notes self-destruct after 24h, 7 days, or 1 view
→ Auto-saves drafts to localStorage so you never lose work

The part that impressed me most to build: **analytics without any third-party SDK.**

Every note tracks:
- Total views vs unique visitors (SHA-256 fingerprint of IP + UA, never stored raw)
- Traffic source breakdown — WhatsApp, Twitter, Direct, Instagram etc. parsed from Referer header
- 14-day view sparkline built with pure SVG bars from daily bucketed data stored in JSON

No Google Analytics. No Mixpanel. Just Node.js crypto + a JSON object per note.

**Tech stack:**
- Node.js + Express (no framework overhead)
- Zero-dependency storage — JSON file locally, Redis (Upstash/Railway plugin) in prod
- Base64 image embedding — no S3, no separate file server
- Deployed on Railway in under 3 minutes — git push, done

**The interesting engineering tradeoffs:**

Images are stored as base64 inside the note JSON. Purists will cringe. But for a note tool where images are occasional and notes rarely exceed 2–3MB, it means zero infrastructure. No S3 bucket, no CDN, no signed URLs. One less thing to break.

Unique visitor tracking uses a short SHA-256 hash of IP + user agent. It's not perfect (VPNs, shared IPs) but it's private — no PII stored, no cookies, GDPR-friendly by design.

The expiry feature ("self-destructs after 1 view") was the most fun to build. The server flips a single field from `"1view"` to `"expired"` after the first fetch — atomic, no cron jobs needed.

**What's next:**
- Custom slugs (yourapp.com/note/my-trip-to-goa)
- Password-protected notes
- Account dashboard with all your notes + aggregate analytics
- Comments / reactions from readers

If you're a CTO or eng lead thinking about internal tooling — the same patterns here (ephemeral sharing, analytics without SDK bloat, zero-auth read access) apply to so many B2B use cases. Happy to talk.

---

Built with: Node.js · Express · Railway · Vanilla JS · zero npm bloat

#buildinpublic #nodejs #javascript #webdev #shipping #indiehacker #fullstack
