# Project Foundation: SpotifyUnlocked

**Source of Truth** for all development standards, architectural patterns, and conventions.

---

## 🎵 App Vision
SpotifyUnlocked is a **music discovery & production pipeline** — the fastest way to go from "I just heard something amazing" to having that track in your Spotify library AND as an MP3 in your DAW.

### Feature Pillars
1. **Discover** — Curated album lists (Spectrum Pulse Top 50 etc.)
2. **Parse** — Extract songs/albums via regex OR **AI Deep Scan** (Gemini 2.5 Flash).
3. **Sample Lab** — A personal production vault. Save tracks → download as MP3 via `yt-dlp` → lookup who sampled them via WhoSampled.
4. **Cloud Sync** — Authenticate with Google to sync your Sample Vault across desktop and mobile devices.

---

## 🛡️ Design DNA ("Dark Studio" Aesthetic)
- **Color palette**: Deep navy/black background (`#080810`), violet accent (`hsl(270,75%,55%)`), gold secondary (`hsl(48,100%,65%)`), Spotify green (`#1DB954`)
- **Glassmorphism cards**: `rgba(255,255,255,0.04)` backgrounds with `rgba(255,255,255,0.08)` borders
- **Ambient blobs**: Fixed radial gradient glows on `body::before` / `body::after`
- **Typography**: `Inter` (Google Fonts), bold section headers, muted helper text
- **Animations**: `float` keyframe on brand icon, `pulse-glow` on download buttons, `spin` on loading spinners
- **NO TailwindCSS** — Vanilla CSS with custom properties only

---

| Layer | Tech |
|-------|------|
| Frontend | Vite 7 + React 19 + Vanilla CSS |
| Backend | Express 5 (Node.js, ESM) |
| Music extraction | `youtube-transcript` + **Gemini 2.5 Flash** (Deep Scan) |
| MP3 downloads | `yt-dlp` (must be installed separately: `pip install yt-dlp`) |
| Sampling data | WhoSampled via RapidAPI (`RAPIDAPI_KEY` env var) |
| Backend | Express 5 (Node.js, ESM) |
| Cloud/Auth | **Firebase** (Auth + Firestore) |
| Mobile | **Capacitor** (Native Wrapper) |
| CI/CD | **GitHub Actions** (deploy.yml) |

---

## 📐 App Layout
```
app-shell (flex row)
├── sidebar (fixed, 240px) — brand + nav tabs + user footer (logout)
└── main-panel (flex: 1, margin-left: 240px)
    ├── topbar (sticky 72px) — page title + mini Spotify status
    └── panel-content — tab content OR **Onboarding Setup Screen** (if Spotify not connected)
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
| `GEMINI_API_KEY` | AI Deep Scan music extraction (Google AI Studio) |

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
| GET | `/api/transcript?url=` | Extract music mentions (regex-based) |
| GET | `/api/deep-scan?url=` | AI-powered music extraction (Gemini) |
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

## ☁️ Cloud Infrastructure (Firebase)
- **Auth**: Google Social Login (planned)
- **Firestore**: Cloud sync for `sampleVault` (replaces LocalStorage)
- **Config**: Root `src/firebase.js` (managed via env vars)

---

## 📱 Mobile App (Android/iOS)
- **Wrapper**: Capacitor 7
- **Plugins**: `@capacitor/splash-screen`, `@capacitor/status-bar`, `@capacitor/keyboard`
- **Setup**: `npx cap sync android`
- **Android Dev**: Open `/android` folder in **Android Studio**
- **iOS Testing (on Windows)**:
  - **Local**: Use Chrome DevTools (iPhone 14 Pro mode)
  - **Live**: Visit `https://[YOUR_PC_IP]:5173` on a physical iPhone on the same Wi-Fi
  - **Simulation**: Upload `.apk` to **Appetize.io** for Android testing

---

## 🏗️ CI/CD Pipeline
- **Automation**: GitHub Actions (`.github/workflows/deploy.yml`)
- **Triggers**: Push to `main`
- **Steps**: Lint → Build → Preview (planned)

---

*Last Updated: 2026-02-23*
