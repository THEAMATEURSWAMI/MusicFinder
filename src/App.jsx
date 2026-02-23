import { useState, useEffect } from 'react'
import defaultAlbums from './data'
import VideoParser from './VideoParser'
import SampleLab from './SampleLab'
import './index.css'

const SCOPES = [
  "playlist-modify-private",
  "playlist-modify-public",
  "user-library-modify",
  "user-library-read"
]

// Persist sample vault in localStorage
const VAULT_KEY = 'spotify_unlocked_vault_v1'
const loadVault = () => {
  try { return JSON.parse(localStorage.getItem(VAULT_KEY)) || [] } catch { return [] }
}
const saveVault = (v) => localStorage.setItem(VAULT_KEY, JSON.stringify(v))

function App() {
  const [token, setToken] = useState("")
  const [clientId, setClientId] = useState(window.localStorage.getItem("spotify_client_id") || "")
  const [spotifyUser, setSpotifyUser] = useState(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState("")
  const [playlistUrl, setPlaylistUrl] = useState("")
  const [activeTab, setActiveTab] = useState('discover')
  const [parsedAlbums, setParsedAlbums] = useState([])
  const [sampleVault, setSampleVault] = useState(loadVault)
  const [vaultPulse, setVaultPulse] = useState(false)

  useEffect(() => {
    const hash = window.location.hash
    let storedToken = window.localStorage.getItem("token")

    if (!storedToken && hash) {
      const tokenParam = hash.substring(1).split("&").find(elem => elem.startsWith("access_token"))
      if (tokenParam) {
        storedToken = tokenParam.split("=")[1]
        window.location.hash = ""
        window.localStorage.setItem("token", storedToken)
      }
    }

    if (storedToken) {
      setToken(storedToken)
      verifyToken(storedToken)
    }
  }, [])

  const verifyToken = async (t) => {
    try {
      const res = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${t}` }
      })
      if (res.status === 401) {
        setToken("")
        window.localStorage.removeItem("token")
        setSpotifyUser(null)
        return
      }
      const data = await res.json()
      setSpotifyUser({
        name: data.display_name || data.id,
        id: data.id,
        url: data.external_urls?.spotify,
        avatar: data.images?.[0]?.url
      })
    } catch { }
  }

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
    setSpotifyUser(null)
  }

  const resetConfig = () => {
    logout()
    setClientId("")
    setPlaylistUrl("")
    window.localStorage.removeItem("spotify_client_id")
  }

  // ---- Sample Vault Management ----
  const addToSamples = (track) => {
    setSampleVault(prev => {
      // Avoid duplicates by id or uri
      const exists = prev.some(s => (track.id && s.id === track.id) || (track.uri && s.uri === track.uri))
      if (exists) return prev
      const next = [track, ...prev]
      saveVault(next)
      return next
    })
    // Pulse the tab badge
    setVaultPulse(true)
    setTimeout(() => setVaultPulse(false), 1500)
  }

  const removeFromSamples = (track) => {
    setSampleVault(prev => {
      const next = prev.filter(s => s.id !== track.id && s.uri !== track.uri)
      saveVault(next)
      return next
    })
  }

  // Add to samples from the Top 50 list
  const addAlbumToSamples = async (item) => {
    if (!token) return
    try {
      const res = await fetch(
        `https://api.spotify.com/v1/search?q=album:${encodeURIComponent(item.album)}%20artist:${encodeURIComponent(item.artist)}&type=album&limit=1`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await res.json()
      if (data.albums?.items?.length > 0) {
        const a = data.albums.items[0]
        addToSamples({
          id: a.id,
          uri: a.uri,
          name: a.name,
          artist: a.artists[0]?.name,
          album: a.name,
          image: a.images[1]?.url || a.images[0]?.url,
          spotifyUrl: a.external_urls?.spotify,
          type: 'album',
          addedAt: Date.now()
        })
      } else {
        addToSamples({
          id: `manual_${item.artist}_${item.album}`,
          uri: null,
          name: item.album,
          artist: item.artist,
          addedAt: Date.now()
        })
      }
    } catch {
      addToSamples({
        id: `manual_${item.artist}_${item.album}`,
        uri: null,
        name: item.album,
        artist: item.artist,
        addedAt: Date.now()
      })
    }
  }

  // ---- Create Playlist ----
  const createPlaylist = async (albumList, playlistName = "SpotifyUnlocked: Top 50") => {
    if (!token) return
    setLoading(true)
    setProgress(0)
    setPlaylistUrl("")
    setStatus("Verifying Spotify connection...")

    try {
      const meRes = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (meRes.status === 401) {
        setToken("")
        window.localStorage.removeItem("token")
        setLoading(false)
        alert("Your Spotify session has expired. Please log in again.")
        return
      }
      const user = await meRes.json()
      const trackUris = []
      const notFound = []

      for (let i = 0; i < albumList.length; i++) {
        const { artist, album } = albumList[i]
        setStatus(`[${i + 1}/${albumList.length}] Searching: "${album}" by ${artist}`)

        const searchRes = await fetch(
          `https://api.spotify.com/v1/search?q=album:${encodeURIComponent(album)}%20artist:${encodeURIComponent(artist)}&type=album&limit=1`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const searchData = await searchRes.json()

        if (searchData.albums?.items?.length > 0) {
          const albumId = searchData.albums.items[0].id
          const tracksRes = await fetch(`https://api.spotify.com/v1/albums/${albumId}/tracks?limit=1`, {
            headers: { Authorization: `Bearer ${token}` }
          })
          const tracksData = await tracksRes.json()
          if (tracksData.items?.length > 0) trackUris.push(tracksData.items[0].uri)
        } else {
          notFound.push(`${artist} — ${album}`)
        }

        setProgress(((i + 1) / albumList.length) * 80)
      }

      setStatus("Creating playlist on your account...")
      const playlistRes = await fetch(`https://api.spotify.com/v1/users/${user.id}/playlists`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: playlistName,
          description: `Generated by SpotifyUnlocked — ${trackUris.length} tracks`,
          public: false
        })
      })
      const playlist = await playlistRes.json()
      if (!playlist.id) throw new Error("Playlist creation failed. Check your Spotify app permissions.")

      setStatus(`Adding ${trackUris.length} tracks...`)
      await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ uris: trackUris })
      })

      setProgress(100)
      setStatus(`✅ Done! ${trackUris.length} tracks added.${notFound.length > 0 ? ` (${notFound.length} not found)` : ''}`)
      setPlaylistUrl(playlist.external_urls?.spotify || `https://open.spotify.com/playlist/${playlist.id}`)
      setTimeout(() => setLoading(false), 3000)
    } catch (err) {
      setStatus(`❌ Error: ${err.message}`)
      setTimeout(() => setLoading(false), 3000)
    }
  }

  const TABS = [
    { id: 'discover', label: '🎵 Discover', desc: 'Curated top albums' },
    { id: 'parse', label: '🔍 Parse', desc: 'URL / video parser' },
    { id: 'lab', label: '🎛️ Sample Lab', desc: 'MP3 downloads', badge: sampleVault.length }
  ]

  const spotifyAuthSection = (
    <div className="auth-section">
      {!clientId ? (
        <form className="config-form" onSubmit={saveClientId}>
          <h3>🎵 Connect to Spotify</h3>
          <div className="setup-tabs">
            <div className="setup-option">
              <div className="setup-option-label">✨ New App</div>
              <ol className="setup-steps">
                <li>Go to <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Spotify Developer Dashboard</a></li>
                <li>Click <strong>"Create App"</strong></li>
                <li>Fill in any name/description</li>
                <li>Under <strong>Redirect URIs</strong>, add: <code>{window.location.origin}</code></li>
                <li>Check <strong>"Web API"</strong> and save</li>
                <li>Copy your <strong>Client ID</strong> and paste below</li>
              </ol>
            </div>
            <div className="setup-divider">— or —</div>
            <div className="setup-option">
              <div className="setup-option-label">✏️ Edit Existing App</div>
              <ol className="setup-steps">
                <li>Go to <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Spotify Developer Dashboard</a></li>
                <li>Click your app → <strong>"Edit Settings"</strong></li>
                <li>Add: <code>{window.location.origin}</code></li>
                <li>Save, then copy your <strong>Client ID</strong></li>
              </ol>
            </div>
          </div>
          <div className="setup-note">
            💡 <strong>Tip:</strong> Your redirect URI must match exactly (including http/https).
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
            <input
              name="clientId"
              placeholder="Paste your Spotify Client ID here"
              className="btn"
              style={{ background: 'var(--glass)', border: '1px solid var(--glass-border)', color: 'white', flex: 1, fontFamily: 'monospace' }}
            />
            <button type="submit" className="btn btn-primary">Connect →</button>
          </div>
        </form>
      ) : !token ? (
        <div style={{ textAlign: 'center', maxWidth: 520, margin: '0 auto' }}>
          <div className="redirect-debug">
            <div className="redirect-debug-label">🔗 Redirect URI being sent to Spotify:</div>
            <div className="redirect-debug-uri">
              <code>{window.location.origin}</code>
              <button className="copy-btn" onClick={() => navigator.clipboard.writeText(window.location.origin)}>📋 Copy</button>
            </div>
            <div className="redirect-debug-hint">
              This must match <strong>exactly</strong> what's saved in your Spotify App's Redirect URIs.
            </div>
          </div>
          <a
            href={`https://accounts.spotify.com/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(window.location.origin)}&response_type=token&scope=${SCOPES.join("%20")}`}
            className="btn btn-spotify"
            style={{ display: 'inline-flex', margin: '1rem auto 0.5rem' }}
          >
            🎵 Login to Spotify
          </a>
          <div>
            <button onClick={resetConfig} className="btn" style={{ background: 'transparent', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Use different Client ID
            </button>
          </div>
        </div>
      ) : (
        <div className="connected-bar">
          {spotifyUser?.avatar && (
            <img src={spotifyUser.avatar} alt="avatar" className="user-avatar" />
          )}
          <span className="connected-label">
            ✓ {spotifyUser ? spotifyUser.name : 'Connected to Spotify'}
          </span>
          {playlistUrl && (
            <a href={playlistUrl} target="_blank" rel="noreferrer" className="btn btn-spotify" style={{ fontSize: '0.82rem', padding: '0.45rem 1rem' }}>
              🎵 Last Playlist
            </a>
          )}
          <button onClick={logout} className="btn">Logout</button>
          <button onClick={resetConfig} className="btn" style={{ background: 'transparent', color: 'var(--text-muted)' }}>Reset</button>
        </div>
      )}
    </div>
  )

  return (
    <div className="app-shell">
      {/* Sidebar nav */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-icon">🎵</div>
          <div>
            <div className="brand-name">SpotifyUnlocked</div>
            <div className="brand-tagline">Your music pipeline</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`nav-item ${activeTab === tab.id ? 'active' : ''} ${tab.id === 'lab' && vaultPulse ? 'pulsing' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="nav-label">{tab.label}</span>
              {tab.badge > 0 && (
                <span className="nav-badge">{tab.badge}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          {token && spotifyUser ? (
            <div className="sidebar-user">
              {spotifyUser.avatar && <img src={spotifyUser.avatar} alt="" className="user-avatar-sm" />}
              <div>
                <div className="sidebar-username">{spotifyUser.name}</div>
                <button onClick={logout} className="sidebar-logout">Logout</button>
              </div>
            </div>
          ) : (
            <div className="sidebar-connect-hint">Connect Spotify →</div>
          )}
        </div>
      </aside>

      {/* Main panel */}
      <main className="main-panel">
        {/* Top bar */}
        <div className="topbar">
          <div className="topbar-title">
            {TABS.find(t => t.id === activeTab)?.label}
          </div>
          <div className="topbar-auth">
            {spotifyAuthSection}
          </div>
        </div>

        <div className="panel-content">
          {/* DISCOVER TAB */}
          {activeTab === 'discover' && (
            <div>
              <div className="section-intro">
                <p>Curated from <strong>Spectrum Pulse's Top 50 Albums of 2025</strong>. Click any card to save to your Sample Vault, or create a full Spotify playlist.</p>
                {token && (
                  <button onClick={() => createPlaylist(defaultAlbums)} className="btn btn-primary">
                    🚀 Create Full Playlist
                  </button>
                )}
              </div>

              <div className="album-grid">
                {defaultAlbums.map((item) => (
                  <div key={item.rank} className="album-card">
                    <div className="rank">#{item.rank}</div>
                    <div className="album-info">
                      <div className="artist-name">{item.artist}</div>
                      <h2 className="album-title">{item.album}</h2>
                    </div>
                    {token && (
                      <button
                        className="add-sample-btn"
                        onClick={() => addAlbumToSamples(item)}
                        title="Add to Sample Lab"
                      >
                        ﹢
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PARSE TAB */}
          {activeTab === 'parse' && (
            <VideoParser
              token={token}
              onAlbumsFound={(found) => setParsedAlbums(found)}
              onAddToSamples={addToSamples}
            />
          )}

          {/* SAMPLE LAB TAB */}
          {activeTab === 'lab' && (
            <SampleLab
              token={token}
              sampleVault={sampleVault}
              onRemoveSample={removeFromSamples}
            />
          )}
        </div>
      </main>

      {/* Loading overlay */}
      {loading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <h2 style={{ marginTop: '2rem', textAlign: 'center', padding: '0 2rem' }}>{status}</h2>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
