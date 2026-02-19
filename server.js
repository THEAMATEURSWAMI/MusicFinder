import express from 'express'
import cors from 'cors'
import { YoutubeTranscript } from 'youtube-transcript'

const app = express()
app.use(cors())
app.use(express.json())

// ---------- Helpers ----------

function extractVideoId(url) {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v')
    if (u.hostname === 'youtu.be') return u.pathname.slice(1)
  } catch {}
  return null
}

/**
 * Parse raw transcript/text for album & song mentions.
 * Looks for patterns like:
 *   "Album Name" by Artist Name
 *   'Album Name' by Artist Name
 *   Artist Name - Album Name
 *   Artist Name's "Album Name"
 */
function parseAlbumMentions(text) {
  const found = []
  const seen = new Set()

  const patterns = [
    // "Album" by Artist  or  'Album' by Artist
    /["']([^"']{3,60})["']\s+by\s+([A-Z][^\n,.:;!?]{2,50})/gi,
    // Artist - "Album"
    /([A-Z][^\n,.:;!?]{2,40})\s*[-–]\s*["']([^"']{3,60})["']/gi,
    // Artist's "Album"  (possessive)
    /([A-Z][a-zA-Z ]{2,40})'s\s+["']([^"']{3,60})["']/gi,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      let album, artist
      if (pattern.source.startsWith('/["\'](')) {
        ;[, album, artist] = match
      } else if (pattern.source.includes("'s\\s")) {
        ;[, artist, album] = match
      } else {
        ;[, artist, album] = match
      }

      album = album?.trim()
      artist = artist?.trim()

      if (!album || !artist) continue
      const key = `${artist.toLowerCase()}::${album.toLowerCase()}`
      if (!seen.has(key)) {
        seen.add(key)
        found.push({ artist, album })
      }
    }
  }

  return found
}

// ---------- Routes ----------

// GET /api/transcript?url=...
app.get('/api/transcript', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'Missing url param' })

  const videoId = extractVideoId(url)

  if (!videoId) {
    // Non-YouTube: try fetching the page text and parsing
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MusicFinderBot/1.0)' }
      })
      const html = await r.text()
      // Strip tags
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
      const albums = parseAlbumMentions(text)
      return res.json({ source: 'webpage', transcript: text.slice(0, 500) + '...', albums })
    } catch (err) {
      return res.status(500).json({ error: `Could not fetch page: ${err.message}` })
    }
  }

  // YouTube path
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId)
    const fullText = segments.map(s => s.text).join(' ')
    const albums = parseAlbumMentions(fullText)

    return res.json({
      source: 'youtube',
      videoId,
      transcript: fullText.slice(0, 500) + '...',
      albums
    })
  } catch (err) {
    return res.status(500).json({ error: `Could not fetch transcript: ${err.message}. The video may not have captions enabled.` })
  }
})

const PORT = 3001
app.listen(PORT, () => console.log(`MusicFinder API running on http://localhost:${PORT}`))
