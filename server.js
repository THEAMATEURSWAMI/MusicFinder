import express from 'express'
import cors from 'cors'
import { YoutubeTranscript } from 'youtube-transcript'
import { execFile, exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { GoogleGenerativeAI } from '@google/generative-ai'
import dotenv from 'dotenv'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

const GEMINI_KEY = process.env.GEMINI_API_KEY
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY

// Initialize Gemini
const genAI = GEMINI_KEY ? new GoogleGenerativeAI(GEMINI_KEY) : null
const model = genAI ? genAI.getGenerativeModel({ model: "gemini-2.0-flash" }) : null

const app = express()
app.use(cors())
app.use(express.json())

const DOWNLOADS_DIR = path.join(__dirname, 'downloads')
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true })
app.use('/downloads', express.static(DOWNLOADS_DIR))

// ========================
// Helpers
// ========================

function extractVideoId(url) {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v')
    if (u.hostname === 'youtu.be') return u.pathname.slice(1)
  } catch { }
  return null
}

/**
 * Enhanced music mention parser — looks for tracks AND albums
 */
function parseMusicMentions(text) {
  const found = []
  const seen = new Set()

  const patterns = [
    // "Song/Album" by Artist
    /["""'']([^"""'']{3,80})["""'']\s+by\s+([A-Z][^\n,.:;!?]{2,60})/gi,
    // Artist - "Song/Album"
    /([A-Z][^\n,.:;!?]{2,50})\s*[-–—]\s*["""'']([^"""'']{3,80})["""'']/gi,
    // Artist's "Album" (possessive)
    /([A-Z][a-zA-Z ]{2,50})'s\s+["""'']([^"""'']{3,80})["""'']/gi,
    // "track" off Artist's album
    /["""'']([^"""'']{3,60})["""'']\s+(?:off|from|on)\s+(?:the\s+)?(?:album\s+)?([A-Z][^\n,.:;!?]{2,60})/gi,
  ]

  for (const pattern of patterns) {
    let match
    const src = pattern.source
    while ((match = pattern.exec(text)) !== null) {
      let title, artist
      if (src.startsWith('/["') || src.startsWith("/[\"\"\"")) {
        ;[, title, artist] = match
        // First pattern: "Title" by Artist
      } else if (src.includes("by\\s")) {
        ;[, title, artist] = match
      } else if (src.includes("'s\\s")) {
        ;[, artist, title] = match
      } else if (src.includes("off|from")) {
        ;[, title, artist] = match
      } else {
        ;[, artist, title] = match
      }

      title = title?.trim()
      artist = artist?.trim()
      if (!title || !artist) continue
      const key = `${artist.toLowerCase()}::${title.toLowerCase()}`
      if (!seen.has(key)) {
        seen.add(key)
        found.push({ artist, album: title })
      }
    }
  }

  return found
}

// Check if yt-dlp is available
async function checkYtDlp() {
  try {
    await execAsync('yt-dlp --version')
    return true
  } catch {
    return false
  }
}

// ========================
// Routes
// ========================

// GET /api/transcript?url=...
app.get('/api/transcript', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'Missing url param' })

  const videoId = extractVideoId(url)

  if (!videoId) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SpotifyUnlockedBot/2.0)' }
      })
      const html = await r.text()
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
      const albums = parseMusicMentions(text)
      return res.json({ source: 'webpage', transcript: text.slice(0, 600) + '...', albums })
    } catch (err) {
      return res.status(500).json({ error: `Could not fetch page: ${err.message}` })
    }
  }

  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId)
    const fullText = segments.map(s => s.text).join(' ')
    const albums = parseMusicMentions(fullText)
    return res.json({
      source: 'youtube',
      videoId,
      transcript: fullText.slice(0, 600) + '...',
      albums
    })
  } catch (err) {
    return res.status(500).json({
      error: `Could not fetch transcript: ${err.message}. The video may not have captions enabled.`
    })
  }
})

// GET /api/deep-scan?url=...
// Uses Gemini to intelligently extract music from transcript
app.get('/api/deep-scan', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'Missing url param' })
  if (!model) return res.status(503).json({ error: 'Gemini API key not configured in .env' })

  const videoId = extractVideoId(url)
  let fullText = ""

  try {
    if (videoId) {
      const segments = await YoutubeTranscript.fetchTranscript(videoId)
      fullText = segments.map(s => s.text).join(' ')
    } else {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      const html = await r.text()
      fullText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    }

    const prompt = `
      Extract a list of albums and songs mentioned in the following text. 
      Return ONLY a JSON array of objects with "artist" and "album" (or "track") keys.
      Ignore mentions that aren't specific music releases.
      
      Text: "${fullText.slice(0, 15000)}"
    `

    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text()

    // Clean JSON from response (Gemini sometimes returns markdown ```json ... ```)
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim()
    const albums = JSON.parse(cleanJson)

    res.json({
      source: videoId ? 'youtube-ai' : 'web-ai',
      albums: albums.map(a => ({ artist: a.artist, album: a.album || a.track })),
      transcriptSnippet: fullText.slice(0, 300) + '...'
    })
  } catch (err) {
    res.status(500).json({ error: `Deep Scan failed: ${err.message}` })
  }
})

// POST /api/download
// Body: { query: "artist - track name", trackId: "spotify_id", trackName: "...", artistName: "..." }
app.post('/api/download', async (req, res) => {
  const { query, trackId, trackName, artistName } = req.body
  if (!query) return res.status(400).json({ error: 'Missing query' })

  const hasYtDlp = await checkYtDlp()
  if (!hasYtDlp) {
    return res.status(503).json({
      error: 'yt-dlp is not installed on this server. Please install it: pip install yt-dlp',
      installCmd: 'pip install yt-dlp'
    })
  }

  // Sanitize filename
  const safeFilename = `${trackId || Date.now()}`
  const outputTemplate = path.join(DOWNLOADS_DIR, `${safeFilename}.%(ext)s`)
  const mp3Path = path.join(DOWNLOADS_DIR, `${safeFilename}.mp3`)

  // Check if already downloaded
  if (fs.existsSync(mp3Path)) {
    const stat = fs.statSync(mp3Path)
    return res.json({
      success: true,
      cached: true,
      filename: `${safeFilename}.mp3`,
      url: `/downloads/${safeFilename}.mp3`,
      size: stat.size,
      trackName,
      artistName
    })
  }

  try {
    // Search YouTube and download best audio, convert to mp3
    const ytSearchQuery = `ytsearch1:${query} audio`

    await execAsync(
      `yt-dlp --no-playlist -x --audio-format mp3 --audio-quality 0 --embed-metadata --embed-thumbnail -o "${outputTemplate}" "${ytSearchQuery}"`,
      { timeout: 120000 }
    )

    if (fs.existsSync(mp3Path)) {
      const stat = fs.statSync(mp3Path)
      return res.json({
        success: true,
        cached: false,
        filename: `${safeFilename}.mp3`,
        url: `/downloads/${safeFilename}.mp3`,
        size: stat.size,
        trackName,
        artistName
      })
    } else {
      // Check for other extensions fallback
      const files = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.startsWith(safeFilename))
      if (files.length > 0) {
        const f = files[0]
        const stat = fs.statSync(path.join(DOWNLOADS_DIR, f))
        return res.json({ success: true, filename: f, url: `/downloads/${f}`, size: stat.size, trackName, artistName })
      }
      return res.status(500).json({ error: 'Download failed — file not found after yt-dlp run.' })
    }
  } catch (err) {
    return res.status(500).json({ error: `Download error: ${err.message}` })
  }
})

// GET /api/whosampled?artist=...&track=...
// Uses RapidAPI WhoSampled (requires RAPIDAPI_KEY env var)
app.get('/api/whosampled', async (req, res) => {
  const { artist, track } = req.query
  if (!artist || !track) return res.status(400).json({ error: 'Missing artist or track' })

  if (!RAPIDAPI_KEY) {
    return res.json({
      mock: true,
      message: 'Set RAPIDAPI_KEY in .env for live WhoSampled data',
      samples: [
        { title: 'Funky Drummer', artist: 'James Brown', year: '1970', type: 'Drums' },
        { title: 'Impeach the President', artist: 'The Honey Drippers', year: '1973', type: 'Drums' }
      ]
    })
  }

  try {
    const r = await fetch(
      `https://who-sampled.p.rapidapi.com/v1.0/samples/?trackName=${encodeURIComponent(track)}&artistName=${encodeURIComponent(artist)}`,
      {
        headers: {
          'X-RapidAPI-Key': RAPIDAPI_KEY,
          'X-RapidAPI-Host': 'who-sampled.p.rapidapi.com'
        }
      }
    )
    const data = await r.json()
    // Most WhoSampled APIs return an object with a samples array
    return res.json(data)
  } catch (err) {
    return res.status(500).json({ error: `WhoSampled API error: ${err.message}` })
  }
})

// GET /api/ytdlp-status
app.get('/api/ytdlp-status', async (req, res) => {
  const available = await checkYtDlp()
  if (available) {
    const { stdout } = await execAsync('yt-dlp --version').catch(() => ({ stdout: 'unknown' }))
    return res.json({ available: true, version: stdout.trim() })
  }
  return res.json({ available: false })
})

// GET /api/downloads — list downloaded files
app.get('/api/downloads', (req, res) => {
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR)
      .filter(f => f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.opus'))
      .map(f => {
        const stat = fs.statSync(path.join(DOWNLOADS_DIR, f))
        return { filename: f, url: `/downloads/${f}`, size: stat.size, mtime: stat.mtime }
      })
      .sort((a, b) => new Date(b.mtime) - new Date(a.mtime))
    res.json(files)
  } catch {
    res.json([])
  }
})

// DELETE /api/downloads/:filename
app.delete('/api/downloads/:filename', (req, res) => {
  const { filename } = req.params
  // Security: only allow alphanumeric + dash + dot
  if (!/^[\w\-\.]+$/.test(filename)) return res.status(400).json({ error: 'Invalid filename' })
  const filePath = path.join(DOWNLOADS_DIR, filename)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
    res.json({ success: true })
  } else {
    res.status(404).json({ error: 'File not found' })
  }
})

const PORT = 3001
app.listen(PORT, () => console.log(`🎵 SpotifyUnlocked API running on http://localhost:${PORT}`))
