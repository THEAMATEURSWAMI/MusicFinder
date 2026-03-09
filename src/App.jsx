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
  "user-library-read",
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-top-read",
  "user-read-recently-played"
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
  const [parsedAlbums, setParsedAlbums] = useState([])
  const [sampleVault, setSampleVault] = useState(loadVault)
  const [vaultPulse, setVaultPulse] = useState(false)
  const [nowPlaying, setNowPlaying] = useState(null)
  const [topTrack, setTopTrack] = useState(null)
  const [recentlyPlayed, setRecentlyPlayed] = useState([])
  const [topArtists, setTopArtists] = useState([])
  const [artistNews, setArtistNews] = useState({})
  const [activeTab, setActiveTab] = useState('home')
  const [discoverAlbums, setDiscoverAlbums] = useState(
    JSON.parse(localStorage.getItem('discover_hydration_v1')) || defaultAlbums
  )

  // Firebase Cloud Global State
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [syncStatus, setSyncStatus] = useState("IDLE")

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u)
      if (u) {
        setSyncStatus("RETRIEVING_PROFILE...")
        console.log("🚀 Cloud Identity Verified:", u.displayName)
        // Fetch vault from cloud
        try {
          const docRef = doc(db, 'vaults', u.uid)
          const docSnap = await getDoc(docRef)
          if (docSnap.exists()) {
            const cloudVault = docSnap.data().items || []
            setSampleVault(prev => {
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

        // Fetch Profile Configuration
        try {
          const profileRef = doc(db, 'profiles', u.uid)
          const profileSnap = await getDoc(profileRef)
          if (profileSnap.exists()) {
            const data = profileSnap.data()
            if (data.clientId) {
              console.log("📌 Restoring Client ID from Cloud Vault")
              setClientId(data.clientId)
              window.localStorage.setItem("spotify_client_id", data.clientId)
            }
          }
        } catch (err) { console.error("Profile Fetch Error:", err) }

        setSyncStatus("PROTECTED")
      }
      setAuthLoading(false)
    })
    return () => unsubscribe()
  }, [])

  // Sync vault to cloud whenever it changes
  useEffect(() => {
    if (user && sampleVault.length > 0) {
      const syncToCloud = async () => {
        setSyncStatus("UPLOADING...")
        try {
          await setDoc(doc(db, 'vaults', user.uid), {
            items: sampleVault,
            lastUpdated: Date.now()
          })
          setSyncStatus("CLOUD_SYNC_VERIFIED")
          setTimeout(() => setSyncStatus("PROTECTED"), 3000)
        } catch (err) {
          console.error("Cloud Sync Error:", err)
          setSyncStatus("SYNC_ERROR")
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

  // Real-time Playback & Top Tracks Poll
  useEffect(() => {
    if (!token) return

    const fetchRealtime = async () => {
      try {
        // 1. Now Playing
        const currentRes = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (currentRes.status === 200) {
          const data = await currentRes.json()
          setNowPlaying(data.item)
        } else if (currentRes.status === 204) {
          setNowPlaying(null)
        }

        // 2. Top Track (Most Listened)
        const topRes = await fetch("https://api.spotify.com/v1/me/top/tracks?limit=1&time_range=short_term", {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (topRes.status === 200) {
          const data = await topRes.json()
          if (data.items?.length > 0) setTopTrack(data.items[0])
        }

        // 3. Recently Played (Latest 5 gems)
        const recentRes = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=5", {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (recentRes.status === 200) {
          const data = await recentRes.json()
          setRecentlyPlayed(data.items.map(i => i.track))
        }

        // 4. Top Artists & New Release Check
        const artistsRes = await fetch("https://api.spotify.com/v1/me/top/artists?limit=10&time_range=short_term", {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (artistsRes.status === 200) {
          const data = await artistsRes.json()
          setTopArtists(data.items)

          // Check for releases in the last 14 days
          const news = {}
          for (const artist of data.items) {
            const relRes = await fetch(`https://api.spotify.com/v1/artists/${artist.id}/albums?include_groups=album,single&limit=1`, {
              headers: { Authorization: `Bearer ${token}` }
            })
            if (relRes.status === 200) {
              const relData = await relRes.json()
              if (relData.items?.length > 0) {
                const latest = relData.items[0]
                const relDate = new Date(latest.release_date)
                const fourteenDaysAgo = new Date()
                fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
                if (relDate > fourteenDaysAgo) {
                  news[artist.id] = latest
                }
              }
            }
          }
          setArtistNews(news)
        }
      } catch (err) {
        console.log("Realtime fetch error:", err)
      }
    }

    fetchRealtime()
    const interval = setInterval(fetchRealtime, 5000) // Poll every 5s for "platform rate" response
    return () => clearInterval(interval)
  }, [token])

  // ---- Automated Discovery Hydration ----
  useEffect(() => {
    if (!token || discoverAlbums.some(a => a.image)) return

    const hydrateDiscover = async () => {
      console.log("🛠️ Hydrating Discovery Matrix...")
      const updated = [...discoverAlbums]
      let changed = false

      // Fetch in small batches to avoid rate limits
      for (let i = 0; i < updated.length; i++) {
        if (updated[i].image) continue
        try {
          const res = await fetch(
            `https://api.spotify.com/v1/search?q=album:${encodeURIComponent(updated[i].album)}%20artist:${encodeURIComponent(updated[i].artist)}&type=album&limit=1`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          const data = await res.json()
          if (data.albums?.items?.length > 0) {
            const hit = data.albums.items[0]
            updated[i] = {
              ...updated[i],
              image: hit.images[0]?.url,
              uri: hit.uri,
              spotifyUrl: hit.external_urls?.spotify
            }
            changed = true
          }
        } catch (e) { console.error("Hydration Error:", e) }

        // Update partial progress for UX
        if (i % 5 === 0 && i > 0) {
          setDiscoverAlbums([...updated])
          localStorage.setItem('discover_hydration_v1', JSON.stringify(updated))
        }
      }

      if (changed) {
        setDiscoverAlbums(updated)
        localStorage.setItem('discover_hydration_v1', JSON.stringify(updated))
        console.log("✅ Discovery Matrix Hydrated.")
      }
    }

    hydrateDiscover()
  }, [token])

  // ---- Deep Shuffle Algorithm ----
  const deepShuffle = (list, mode = 'true') => {
    const array = [...list]
    if (mode === 'true') {
      // Fisher-Yates (True Random)
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]]
      }
    } else {
      // Atmospheric Shuffle (Distributed)
      // Groups by artist and interleaves them to prevent artist clusters
      const byArtist = {}
      array.forEach(item => {
        const artist = item.artist || 'Unknown'
        if (!byArtist[artist]) byArtist[artist] = []
        byArtist[artist].push(item)
      })

      const shuffled = []
      const artists = Object.keys(byArtist)
      // Randomize artist order first
      for (let i = artists.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [artists[i], artists[j]] = [artists[j], artists[i]]
      }

      let maxLen = 0
      artists.forEach(a => { if (byArtist[a].length > maxLen) maxLen = byArtist[a].length })

      for (let i = 0; i < maxLen; i++) {
        artists.forEach(artist => {
          if (byArtist[artist][i]) shuffled.push(byArtist[artist][i])
        })
      }
      return shuffled
    }
    return array
  }

  const saveClientId = async (e) => {
    e.preventDefault()
    const id = e.target.clientId.value.trim()
    if (id) {
      setClientId(id)
      window.localStorage.setItem("spotify_client_id", id)
      if (user) {
        try {
          await setDoc(doc(db, 'profiles', user.uid), { clientId: id }, { merge: true })
        } catch (err) { console.error("Profile Save Error:", err) }
      }
    }
  }

  const logout = () => {
    setToken("")
    window.localStorage.removeItem("token")
    setSpotifyUser(null)
  }

  const resetConfig = async () => {
    if (!window.confirm("CRITICAL: This will permanently wipe your Spotify Client ID from both this device and the cloud. Proceed?")) return;

    logout()
    setClientId("")
    setPlaylistUrl("")
    window.localStorage.removeItem("spotify_client_id")
    if (user) {
      setSyncStatus("WIPING_CLOUD...")
      try {
        await setDoc(doc(db, 'profiles', user.uid), { clientId: "" }, { merge: true })
        setSyncStatus("CLOUD_WIPED")
      } catch (err) { }
    }
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
    { id: 'home', label: 'CORE', icon: '' },
    { id: 'discover', label: 'RADAR', icon: '' },
    { id: 'parse', label: 'PARSE', icon: '' },
    { id: 'lab', label: 'VAULT', icon: '', badge: sampleVault.length }
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
      <div className="setup-container">
        <div className="setup-header">
          <div className="setup-icon-minimal">[SYSTEM_INIT]</div>
          <h2>Authenticate Pipeline</h2>
          <p>Link your personal Spotify Developer application to enable real-time metadata synchronization and discovery hydration.</p>
        </div>

        <div className="setup-content">
          {!user ? (
            <div className="setup-auth-wall" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
              <h3 style={{ marginBottom: '1rem', color: 'var(--text-data)' }}>Cloud Identity Required</h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '0.9rem' }}>
                Please log in to your persistent cloud profile to securely store your configuration and sync your sample vault across devices and app updates.
              </p>
              <button onClick={loginWithGoogle} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                CONNECT_CLOUD_PROFILE
              </button>
            </div>
          ) : (
            <>
              <div className="setup-instructions">
                <h3>Configuration Sequence</h3>
                <ol>
                  <li>Log into the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-data)' }}>Spotify Developer Dashboard</a></li>
                  <li>Create an <strong>App</strong> with a Web API focus</li>
                  <li>Set Redirect URI exactly to: <code>{window.location.origin}</code></li>
                  <li>In the app settings, enable <strong>Implicit Grant</strong></li>
                </ol>
              </div>

              <form className="config-form" onSubmit={saveClientId}>
                <div className="setup-input-group">
                  <input
                    name="clientId"
                    placeholder="Enter Spotify Client ID..."
                    className="setup-input"
                    autoComplete="off"
                  />
                  <button type="submit" className="btn btn-primary">VERIFY_LINK</button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="matrix-app">
      {/* SIDE DATA BAR - MONITORING & AUTH */}
      <aside className="side-monitor">
        <div className="monitor-pane">
          <div className="monitor-header">SYSTEM_INTEGRITY_INDEX</div>
          <div className="playback-status">
            {nowPlaying ? (
              <div className="status-item active">
                <label>STREAMING_LIVE</label>
                <div className="val">{nowPlaying.item.name}</div>
                <div className="sub-val">{nowPlaying.item.artists[0].name}</div>
              </div>
            ) : (
              <div className="status-item idle">
                <label>DISCOVERY_ENGINE</label>
                <div className="val">
                  {discoverAlbums.filter(a => a.image).length}/50_ACTIVE
                </div>
                <div className="sub-val">SYSTEM_INIT_COMPLETE_V3.1</div>
              </div>
            )}
          </div>

          <div className="monitor-metrics">
            <div className="metric-row">
              <label>CLOUD_LINK</label>
              <div className={`val ${user ? 'active' : 'inactive'}`}>{user ? 'ESTABLISHED' : 'OFFLINE'}</div>
            </div>
            <div className="metric-row">
              <label>SYNC_STATUS</label>
              <div className="val">{syncStatus}</div>
            </div>
          </div>

          <div className="branding-node">
            <h1>UNLOCKED_PRIME</h1>
            <div className="sys-ver">OP_BUILD_v3.1_ULTRASYNC</div>
          </div>

          <div className="monitor-auth">
            {spotifyAuthSection}
          </div>
        </div>
      </aside>

      {/* OPERATIONS CORE */}
      <main className="ops-center">
        {authLoading ? (
          <div className="profile-splash">
            <div className="splash-glow"></div>
            <div className="splash-data">
              <div className="loader-init">[RETRIEVING_USER_PROFILE]</div>
              <div className="loader-sub">Decrypting cloud vault...</div>
            </div>
          </div>
        ) : !clientId ? (
          setupScreen
        ) : (
          <div className="flux-workspace">
            {/* TABS AS INDUSTRIAL DOCK */}
            <nav className="dock-nav">
              {TABS.map(t => (
                <button
                  key={t.id}
                  className={`dock-btn ${activeTab === t.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(t.id)}
                >
                  <span className="dock-label">{t.label}</span>
                  {t.badge > 0 && <span className="dock-badge">[{t.badge}]</span>}
                </button>
              ))}
              <div className="dock-util">
                <button onClick={resetConfig} title="RESET_SYSTEM">[RESET]</button>
              </div>
            </nav>

            <section className="view-matrix">
              {activeTab === 'home' && (
                <div className="home-layer">
                  <div className="matrix-intro">
                    <p>[STATUS: ONLINE] Welcome to <strong>CORE_INTELLIGENCE</strong>. Monitoring your primary artist collective and recent release activity.</p>
                  </div>

                  <div className="matrix-subtitle">TOP_ARTIST_RADAR</div>
                  <div className="artist-grid">
                    {topArtists.map((artist) => {
                      const hasNew = artistNews[artist.id]
                      return (
                        <div key={artist.id} className="artist-card-obsidian">
                          <img src={artist.images[0]?.url} alt="" className="artist-img" />
                          <div className="artist-info">
                            <div className="artist-name">{artist.name}</div>
                            <div className="artist-genre">{artist.genres?.[0] || 'GENRE_NULL'}</div>
                          </div>
                          {hasNew && (
                            <div className="new-release-alert pulse-glow">
                              <div className="alert-header">[NEW_RELEASE_DETECTED]</div>
                              <div className="alert-body">{hasNew.name}</div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {recentlyPlayed.length > 0 && (
                    <div className="gem-stream" style={{ marginTop: '3rem' }}>
                      <div className="matrix-subtitle">RECENTLY_OBSERVED_GEMS</div>
                      <div className="gem-grid">
                        {recentlyPlayed.map((track, idx) => (
                          <div key={`${track.id}-${idx}`} className="node-card">
                            <img src={track.album?.images[0]?.url} alt="" className="node-img" />
                            <div className="node-info">
                              <div className="node-name">{track.name}</div>
                              <div className="node-artist">{track.artists[0]?.name}</div>
                            </div>
                            <button
                              className="node-action"
                              onClick={() => addToSamples({
                                id: track.id,
                                name: track.name,
                                artist: track.artists[0]?.name,
                                album: track.album?.name,
                                image: track.album?.images[0]?.url,
                                spotifyUrl: track.external_urls?.spotify,
                                uri: track.uri,
                                addedAt: Date.now(),
                                source: 'History'
                              })}
                            >+</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'discover' && (
                <div className="discover-layer">
                  <div className="matrix-intro">
                    <p>Algorithmically derived from <strong>Spectrum Pulse's Top 50 Albums of 2025</strong>. Map tracks to Vault or translate to Spotify Playlist.</p>
                  </div>

                  {/* RECENT GEMS FEED */}
                  {recentlyPlayed.length > 0 && (
                    <div className="gem-stream">
                      <div className="matrix-subtitle">RECENTLY_OBSERVED</div>
                      <div className="gem-grid">
                        {recentlyPlayed.map((track, idx) => {
                          const isRare = (track.popularity || 0) < 40;
                          return (
                            <div key={`${track.id}-${idx}`} className="node-card">
                              <img src={track.album?.images[0]?.url} alt="" className="node-img" />
                              <div className="node-info">
                                <div className="node-name">{track.name}</div>
                                <div className="node-artist">{track.artists[0]?.name}</div>
                                <div className="node-meta">
                                  {isRare && <span className="meta-tag rare">[RARE]</span>}
                                  {(track.popularity || 0) > 75 && <span className="meta-tag trending">[TREND]</span>}
                                  {!isRare && <span className="meta-tag sample">[SAMPLE_POTENTIAL]</span>}
                                </div>
                              </div>
                              <button
                                className="node-action"
                                onClick={() => addToSamples({
                                  id: track.id,
                                  name: track.name,
                                  artist: track.artists[0]?.name,
                                  album: track.album?.name,
                                  image: track.album?.images[0]?.url,
                                  spotifyUrl: track.external_urls?.spotify,
                                  uri: track.uri,
                                  addedAt: Date.now(),
                                  source: 'History'
                                })}
                              >+</button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="album-matrix-grid">
                    {discoverAlbums.map((item) => (
                      <div key={item.rank} className="album-matrix-card">
                        <div className="album-rank">{item.rank}</div>
                        {item.image ? (
                          <img src={item.image} alt={item.album} />
                        ) : (
                          <div className="album-placeholder">
                            <span>[HYDRATING_DATA]</span>
                          </div>
                        )}
                        <div className="album-matrix-info">
                          <h3>{item.album}</h3>
                          <p>{item.artist}</p>
                          <div className="album-matrix-actions">
                            <button onClick={() => addToSamples({
                              id: item.uri || `rank_${item.rank}`,
                              name: item.album,
                              artist: item.artist,
                              album: item.album,
                              image: item.image,
                              spotifyUrl: item.spotifyUrl,
                              uri: item.uri,
                              addedAt: Date.now(),
                              source: 'Discover'
                            })} className="btn-matrix-small">
                              [SAVE_TO_VAULT]
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* PARSE TAB */}
              {activeTab === 'parse' && (
                <VideoParser
                  onAddTracks={(tracks) => tracks.forEach(addToSamples)}
                />
              )}

              {activeTab === 'lab' && (
                <SampleLab
                  sampleVault={sampleVault}
                  setSampleVault={setSampleVault}
                  token={token}
                />
              )}

              {/* MATRIX TAB */}
              {activeTab === 'hub' && (
                <div className="matrix-view">
                  <h2>OPERATIONAL_MATRIX</h2>
                  <div className="hub-data-grid">
                    <div className="data-node">
                      <span className="node-label">MOOD_MAPPING</span>
                      <p>Deconstruct tracks into emotional vectors for hyper-specific discovery.</p>
                    </div>
                    <div className="data-node">
                      <span className="node-label">SONIC_CONNECTIVITY</span>
                      <p>Visualize the thread between obscure samples and chart-topping hits.</p>
                    </div>
                    <div className="data-node">
                      <span className="node-label">TREND_ORACLE</span>
                      <p>Predict the next wave by analyzing underground sample frequency.</p>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {/* SYSTEM_OVERLAY */}
      {loading && (
        <div className="system-overlay">
          <div className="system-loader"></div>
          <div className="system-status">{status}</div>
          <div className="system-progress">
            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
