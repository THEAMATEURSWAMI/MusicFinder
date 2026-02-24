import { useState, useEffect } from 'react'
import defaultAlbums from './data'
import VideoParser from './VideoParser'
import SampleLab from './SampleLab'
import './index.css'
import { auth, googleProvider, db } from './firebase'
import { signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'

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

  // Firebase Cloud Global State
  const [user, setUser] = useState(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u)
      if (u) {
        console.log("🚀 Cloud Identity Verified:", u.displayName)
        // Fetch vault from cloud
        try {
          const docRef = doc(db, 'vaults', u.uid)
          const docSnap = await getDoc(docRef)
          if (docSnap.exists()) {
            const cloudVault = docSnap.data().items || []
            setSampleVault(prev => {
              // Merge: favor cloud content if different, but don't lose local new additions
              const merged = [...cloudVault]
              prev.forEach(localItem => {
                if (!merged.find(c => (c.id && c.id === localItem.id) || (c.uri && c.uri === localItem.uri))) {
                  merged.push(localItem)
                }
              })
              return merged
            })
          }
        } catch (err) {
          console.error("Cloud Fetch Error:", err)
        }
      }
    })
    return () => unsubscribe()
  }, [])

  // Sync vault to cloud whenever it changes
  useEffect(() => {
    if (user && sampleVault.length > 0) {
      const syncToCloud = async () => {
        try {
          await setDoc(doc(db, 'vaults', user.uid), {
            items: sampleVault,
            lastUpdated: Date.now()
          })
        } catch (err) {
          console.error("Cloud Sync Error:", err)
        }
      }
      const timer = setTimeout(syncToCloud, 2000) // Debounce sync
      return () => clearTimeout(timer)
    }
  }, [sampleVault, user])

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (err) {
      console.error("Auth Error:", err)
    }
  }

  const handleFirebaseLogout = () => signOut(auth)

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
      {clientId && !token ? (
        <a
          href={`https://accounts.spotify.com/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(window.location.origin)}&response_type=token&scope=${SCOPES.join("%20")}`}
          className="btn btn-spotify"
          style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}
        >
          🎵 Login
        </a>
      ) : token && (
        <div className="connected-bar">
          {spotifyUser?.avatar && (
            <img src={spotifyUser.avatar} alt="avatar" className="user-avatar" />
          )}
          <span className="connected-label">
            ✓ {spotifyUser ? spotifyUser.name : 'Spotify'}
          </span>
          <button onClick={logout} className="btn-icon" title="Logout">退出</button>
        </div>
      )}
    </div>
  )

  const setupScreen = (
    <div className="setup-wrapper">
      <form className="config-form" onSubmit={saveClientId}>
        <div className="setup-header">
          <div className="setup-icon">🚀</div>
          <h2>Initialize Your Pipeline</h2>
          <p>Connect your Spotify Developer App to enable playlist creation and deep track enrichment.</p>
        </div>

        <div className="setup-tabs">
          <div className="setup-option">
            <div className="setup-option-label">✨ New App</div>
            <ol className="setup-steps">
              <li>Open <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Dashboard</a></li>
              <li>Click <strong>"Create App"</strong></li>
              <li>Add Redirect URI: <code>{window.location.origin}</code></li>
              <li>Check <strong>"Web API"</strong> and save</li>
            </ol>
          </div>
          <div className="setup-divider">AND</div>
          <div className="setup-option">
            <div className="setup-option-label">📎 Get Key</div>
            <ol className="setup-steps">
              <li>Go to <strong>Settings</strong></li>
              <li>Copy <strong>Client ID</strong></li>
              <li>Required Redirect URI:</li>
              <li className="uri-copy" onClick={() => navigator.clipboard.writeText(window.location.origin)}>
                <code>{window.location.origin}</code>
                <span>📋</span>
              </li>
            </ol>
          </div>
        </div>

        <div className="setup-input-group">
          <input
            name="clientId"
            placeholder="Paste your Spotify Client ID here"
            className="setup-input"
          />
          <button type="submit" className="btn btn-primary">Connect Pipeline →</button>
        </div>

        <p className="setup-hint">
          💡 <strong>Security:</strong> Your Client ID is stored locally in your browser and never leaves this machine.
        </p>
      </form>
    </div>
  )

  return (
    <div className="app-shell">
      {/* Sidebar nav */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-icon">📟</div>
          <div>
            <div className="brand-name">Smart Calc</div>
            <div className="brand-tagline">Advanced Logic v2.1</div>
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
          {user ? (
            <div className="cloud-profile">
              <img src={user.photoURL} alt="pfp" className="user-avatar-sm" style={{ borderColor: 'var(--accent-secondary)' }} />
              <div className="profile-info">
                <span className="profile-name">{user.displayName}</span>
                <button onClick={handleFirebaseLogout} className="sidebar-logout">Cloud Sign Out</button>
              </div>
            </div>
          ) : (
            <button onClick={loginWithGoogle} className="btn-google">
              <span className="g-icon">G</span> Sync with Google
            </button>
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
          {!clientId ? setupScreen : (
            <>
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
            </>
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
