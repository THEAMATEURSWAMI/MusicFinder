import { useState, useEffect } from 'react'
import albums from './data'
import './index.css'

const AUTH_ENDPOINT = "https://accounts.spotify.com/authorize"
const RESPONSE_TYPE = "token"
const SCOPES = ["playlist-modify-private", "playlist-modify-public"]

function App() {
  const [token, setToken] = useState("")
  const [clientId, setClientId] = useState(window.localStorage.getItem("spotify_client_id") || "")
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState("")

  useEffect(() => {
    const hash = window.location.hash
    let token = window.localStorage.getItem("token")

    if (!token && hash) {
      const tokenParam = hash.substring(1).split("&").find(elem => elem.startsWith("access_token"))
      if (tokenParam) {
        token = tokenParam.split("=")[1]
        window.location.hash = ""
        window.localStorage.setItem("token", token)
      }
    }

    setToken(token)
  }, [])

  const saveClientId = (e) => {
    e.preventDefault()
    const id = e.target.clientId.value.trim()
    if (id) {
      setClientId(id)
      window.localStorage.setItem("spotify_client_id", id)
    }
  }

  const logout = () => {
    setToken("")
    window.localStorage.removeItem("token")
  }

  const resetConfig = () => {
    logout()
    setClientId("")
    window.localStorage.removeItem("spotify_client_id")
  }

  const createPlaylist = async () => {
    if (!token) return
    setLoading(true)
    setProgress(0)
    setStatus("Fetching user data...")

    try {
      // 1. Get User ID
      const userRes = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${token}` }
      })
      const user = await userRes.json()

      // 2. Search for tracks
      const trackUris = []
      for (let i = 0; i < albums.length; i++) {
        const { artist, album, rank } = albums[i]
        setStatus(`Searching for Rank #${rank}: ${album} by ${artist}`)

        const searchRes = await fetch(`https://api.spotify.com/v1/search?q=album:${encodeURIComponent(album)}%20artist:${encodeURIComponent(artist)}&type=album&limit=1`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        const searchData = await searchRes.json()

        if (searchData.albums.items.length > 0) {
          const albumId = searchData.albums.items[0].id
          const tracksRes = await fetch(`https://api.spotify.com/v1/albums/${albumId}/tracks?limit=1`, {
            headers: { Authorization: `Bearer ${token}` }
          })
          const tracksData = await tracksRes.json()
          if (tracksData.items.length > 0) {
            trackUris.push(tracksData.items[0].uri)
          }
        }

        setProgress(((i + 1) / albums.length) * 80) // 80% for searching
      }

      // 3. Create Playlist
      setStatus("Creating playlist...")
      const playlistRes = await fetch(`https://api.spotify.com/v1/users/${user.id}/playlists`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: "Spectrum Pulse: Top 50 Albums of 2025",
          description: "Scraped from Spectrum Pulse. The first track of each album in order of rank. Created by MusicFinder.",
          public: false
        })
      })
      const playlist = await playlistRes.json()

      // 4. Add tracks (Spotify limit 100 per request, we have 50)
      setStatus("Adding tracks to playlist...")
      await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          uris: trackUris
        })
      })

      setProgress(100)
      setStatus("Playlist Created Successfully!")
      setTimeout(() => setLoading(false), 2000)
      alert(`Playlist created! Check your Spotify.`)

    } catch (err) {
      console.error(err)
      alert("Error creating playlist. Make sure your token is valid.")
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <header>
        <h1>Album Finder 2025</h1>
        <p className="subtitle">Parsed from Spectrum Pulse's Top 50 Albums of the Year</p>
      </header>

      <div className="actions">
        {!clientId ? (
          <form className="config-form" onSubmit={saveClientId}>
            <h3>Spotify Configuration</h3>
            <p>1. Go to <a href="https://developer.spotify.com/dashboard" target="_blank">Spotify Developer Dashboard</a></p>
            <p>2. Create an App and add <code>{window.location.origin}</code> to Redirect URIs</p>
            <p>3. Copy Client ID and paste below:</p>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <input name="clientId" placeholder="Enter Spotify Client ID" className="btn" style={{ background: 'var(--glass)', border: '1px solid var(--glass-border)', color: 'white', flex: 1 }} />
              <button type="submit" className="btn btn-primary">Save & Continue</button>
            </div>
          </form>
        ) : !token ? (
          <div style={{ textAlign: 'center' }}>
            <a
              href={`https://accounts.spotify.com/authorize?client_id=${clientId}&redirect_uri=${window.location.origin}&response_type=token&scope=${SCOPES.join("%20")}`}
              className="btn btn-spotify"
            >
              Login to Spotify
            </a>
            <button onClick={resetConfig} className="btn" style={{ marginTop: '1rem', background: 'transparent', color: 'var(--text-muted)' }}>Use different Client ID</button>
          </div>
        ) : (
          <>
            <button onClick={createPlaylist} className="btn btn-primary" disabled={loading}>
              Create Spotify Playlist
            </button>
            <button onClick={logout} className="btn">Logout</button>
            <button onClick={resetConfig} className="btn" style={{ background: 'transparent', color: 'var(--text-muted)' }}>Reset Config</button>
          </>
        )}
      </div>

      <div className="album-grid">
        {albums.map((item) => (
          <div key={item.rank} className="album-card">
            <div className="rank">{item.rank}</div>
            <div className="album-info">
              <div className="artist-name">{item.artist}</div>
              <h2 className="album-title">{item.album}</h2>
            </div>
          </div>
        ))}
      </div>

      {loading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <h2 style={{ marginTop: '2rem' }}>{status}</h2>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
