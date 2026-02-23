# Project Foundation: SpotifyUnlocked

**Source of Truth** for all development standards, architectural patterns, and conventions.

---

## 🎵 App Vision
SpotifyUnlocked is a **music discovery & production pipeline** — the fastest way to go from "I just heard something amazing" to having that track in your Spotify library AND as an MP3 in your DAW.

### Feature Pillars
1. **Discover** — Curated album lists (Spectrum Pulse Top 50 etc.)
2. **Parse** — Paste any YouTube URL or webpage; extract every song/album mention, auto-search Spotify for artwork + previews
3. **Sample Lab** — A personal production vault. Save tracks → download as MP3 via `yt-dlp` → lookup who sampled them via WhoSampled

---

## 🛡️ Design DNA ("Dark Studio" Aesthetic)
- **Color palette**: Deep navy/black background (`#080810`), violet accent (`hsl(270,75%,55%)`), gold secondary (`hsl(48,100%,65%)`), Spotify green (`#1DB954`)
- **Glassmorphism cards**: `rgba(255,255,255,0.04)` backgrounds with `rgba(255,255,255,0.08)` borders
- **Ambient blobs**: Fixed radial gradient glows on `body::before` / `body::after`
- **Typography**: `Inter` (Google Fonts), bold section headers, muted helper text
- **Animations**: `float` keyframe on brand icon, `pulse-glow` on download buttons, `spin` on loading spinners
- **NO TailwindCSS** — Vanilla CSS with custom properties only

---

## 🚀 Tech Stack
| Layer | Tech |
|-------|------|
| Frontend | Vite 7 + React 19 + Vanilla CSS |
| Backend | Express 5 (Node.js, ESM) |
| Music extraction | `youtube-transcript` (YT captions) + custom regex NLP |
| MP3 downloads | `yt-dlp` (must be installed separately: `pip install yt-dlp`) |
| Spotify | OAuth Implicit Flow → tracks / playlists / search |
| Sampling data | WhoSampled via RapidAPI (`RAPIDAPI_KEY` env var) |

---

## 📐 App Layout
```
app-shell (flex row)
├── sidebar (fixed, 240px) — brand + nav tabs + user footer
└── main-panel (flex: 1, margin-left: 240px)
    ├── topbar (sticky 72px) — page title + Spotify auth
    └── panel-content — tab content
```

### Tab System
- `discover` — Top 50 album grid, "+ Sample" hover button per card
- `parse`    — URL input → transcript fetch → enriched track cards with art, Spotify preview, "+ Sample" 
- `lab`      — Sample Vault: view saved tracks, download MP3, WhoSampled lookup, metadata expand

---

## 📂 File Structure
```
SpotifyUnlocked/
├── server.js             — Express API (port 3001)
├── downloads/            — Downloaded MP3s (auto-created)
├── src/
│   ├── App.jsx           — Shell, tabs, vault state management
│   ├── VideoParser.jsx   — URL parser + Spotify enrichment
│   ├── SampleLab.jsx     — Vault, MP3 download, WhoSampled
│   ├── index.css         — Global design system
│   ├── VideoParser.css
│   ├── SampleLab.css
│   └── data.js           — Curated album seed data
├── package.json
└── vite.config.js        — Proxy: /api → localhost:3001
```

---

## ⚙️ Environment Variables
| Var | Purpose |
|-----|---------|
| `RAPIDAPI_KEY` | WhoSampled lookup via RapidAPI |

---

## 🛠️ Development Commands
```powershell
# Run both frontend (https://localhost:5173) AND backend (http://localhost:3001)
npm start

# Run only Vite (no API)
npm run dev

# Run only Express
npm run dev:server
```

> **PowerShell note**: Never use `&&` in run_command calls. Use separate commands or `npm start`.

---

## 🔧 API Routes
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/transcript?url=` | Extract music mentions from YouTube/URL |
| POST | `/api/download` | Download track as MP3 via yt-dlp |
| GET | `/api/whosampled?artist=&track=` | WhoSampled lookup |
| GET | `/api/ytdlp-status` | Check yt-dlp availability |
| GET | `/api/downloads` | List downloaded files |
| DELETE | `/api/downloads/:filename` | Delete a downloaded file |
| GET | `/downloads/:filename` | Serve the MP3 file directly |

---

## 📦 Sample Vault Persistence
- Stored in `localStorage` under key `spotify_unlocked_vault_v1`
- Each entry: `{ id, uri, name, artist, album, image, spotifyUrl, type, duration_ms, preview_url, addedAt }`

---

*Last Updated: 2026-02-23*
