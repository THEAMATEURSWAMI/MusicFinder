import { useState } from 'react'
import './VideoParser.css'

export default function VideoParser({ onAlbumsFound, token, onAddToSamples }) {
    const [url, setUrl] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [result, setResult] = useState(null)
    const [creatingPlaylist, setCreatingPlaylist] = useState(false)
    const [playlistStatus, setPlaylistStatus] = useState('')
    const [playlistUrl, setPlaylistUrl] = useState('')
    // Track-level Spotify search results
    const [spotifyTracks, setSpotifyTracks] = useState({}) // key: "artist::album" -> track data
    const [searching, setSearching] = useState({})
    const [addedToVault, setAddedToVault] = useState({})

    const handleParse = async (e, isDeep = false) => {
        if (e) e.preventDefault()
        if (!url.trim()) return
        setLoading(true)
        setError('')
        setResult(null)
        setSpotifyTracks({})
        setAddedToVault({})

        try {
            const endpoint = isDeep ? '/api/deep-scan' : '/api/transcript'
            const res = await fetch(`${endpoint}?url=${encodeURIComponent(url)}`)
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Unknown error')
            setResult(data)
            if (data.albums?.length > 0) {
                onAlbumsFound(data.albums)
                // Auto-search Spotify if connected
                if (token) {
                    autoSearchSpotify(data.albums)
                }
            }
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const autoSearchSpotify = async (albums) => {
        for (const { artist, album } of albums) {
            const key = `${artist.toLowerCase()}::${album.toLowerCase()}`
            setSearching(prev => ({ ...prev, [key]: true }))
            try {
                // Search for the track directly
                const res = await fetch(
                    `https://api.spotify.com/v1/search?q=track:${encodeURIComponent(album)}%20artist:${encodeURIComponent(artist)}&type=track&limit=3`,
                    { headers: { Authorization: `Bearer ${token}` } }
                )
                const data = await res.json()
                const tracks = data.tracks?.items || []

                // Also search albums as fallback
                if (tracks.length === 0) {
                    const albumRes = await fetch(
                        `https://api.spotify.com/v1/search?q=album:${encodeURIComponent(album)}%20artist:${encodeURIComponent(artist)}&type=album&limit=1`,
                        { headers: { Authorization: `Bearer ${token}` } }
                    )
                    const albumData = await albumRes.json()
                    if (albumData.albums?.items?.length > 0) {
                        const spAlbum = albumData.albums.items[0]
                        setSpotifyTracks(prev => ({
                            ...prev,
                            [key]: {
                                type: 'album',
                                id: spAlbum.id,
                                name: spAlbum.name,
                                artist: spAlbum.artists[0]?.name,
                                image: spAlbum.images[1]?.url || spAlbum.images[0]?.url,
                                spotifyUrl: spAlbum.external_urls?.spotify,
                                uri: spAlbum.uri
                            }
                        }))
                    }
                } else {
                    const t = tracks[0]
                    setSpotifyTracks(prev => ({
                        ...prev,
                        [key]: {
                            type: 'track',
                            id: t.id,
                            uri: t.uri,
                            name: t.name,
                            artist: t.artists[0]?.name,
                            album: t.album?.name,
                            image: t.album?.images[1]?.url || t.album?.images[0]?.url,
                            spotifyUrl: t.external_urls?.spotify,
                            duration_ms: t.duration_ms,
                            preview_url: t.preview_url
                        }
                    }))
                }
            } catch { }
            setSearching(prev => ({ ...prev, [key]: false }))
        }
    }

    const createPlaylist = async () => {
        if (!token || !result?.albums?.length) return
        setCreatingPlaylist(true)
        setPlaylistStatus('Fetching user profile...')
        setPlaylistUrl('')

        try {
            const userRes = await fetch('https://api.spotify.com/v1/me', {
                headers: { Authorization: `Bearer ${token}` }
            })
            const user = await userRes.json()

            const trackUris = []
            for (let i = 0; i < result.albums.length; i++) {
                const { artist, album } = result.albums[i]
                const key = `${artist.toLowerCase()}::${album.toLowerCase()}`
                setPlaylistStatus(`Searching Spotify: "${album}" by ${artist}`)

                // Use cached result if available
                if (spotifyTracks[key]?.uri && spotifyTracks[key].type === 'track') {
                    trackUris.push(spotifyTracks[key].uri)
                    continue
                }

                const searchRes = await fetch(
                    `https://api.spotify.com/v1/search?q=album:${encodeURIComponent(album)}%20artist:${encodeURIComponent(artist)}&type=album&limit=1`,
                    { headers: { Authorization: `Bearer ${token}` } }
                )
                const searchData = await searchRes.json()

                if (searchData.albums?.items?.length > 0) {
                    const albumId = searchData.albums.items[0].id
                    const tracksRes = await fetch(
                        `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=1`,
                        { headers: { Authorization: `Bearer ${token}` } }
                    )
                    const tracksData = await tracksRes.json()
                    if (tracksData.items?.length > 0) {
                        trackUris.push(tracksData.items[0].uri)
                    }
                }
            }

            setPlaylistStatus('Creating playlist...')
            let playlistSlug
            try {
                playlistSlug = new URL(url).hostname.replace('www.', '')
            } catch {
                playlistSlug = 'parsed source'
            }

            const playlistRes = await fetch(`https://api.spotify.com/v1/users/${user.id}/playlists`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: `SpotifyUnlocked: ${playlistSlug}`,
                    description: `Parsed from ${url} — by SpotifyUnlocked`,
                    public: false
                })
            })
            const playlist = await playlistRes.json()

            if (trackUris.length > 0) {
                await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uris: trackUris })
                })
            }

            setPlaylistStatus(`✅ Created playlist with ${trackUris.length} tracks!`)
            setPlaylistUrl(playlist.external_urls?.spotify || `https://open.spotify.com/playlist/${playlist.id}`)
        } catch (err) {
            setPlaylistStatus(`❌ Error: ${err.message}`)
        } finally {
            setCreatingPlaylist(false)
        }
    }

    const handleAddToSamples = (item, key) => {
        const trackData = spotifyTracks[key]
        const sampleData = trackData
            ? { ...trackData, addedAt: Date.now() }
            : {
                name: item.album,
                artist: item.artist,
                addedAt: Date.now(),
                id: `manual_${Date.now()}`,
                uri: null,
                spotifyUrl: null
            }
        onAddToSamples(sampleData)
        setAddedToVault(prev => ({ ...prev, [key]: true }))
    }

    return (
        <div className="video-parser">
            <div className="parser-header">
                <h2>Parse a Video or Page</h2>
                <p className="parser-subtitle">
                    Drop in a <strong>YouTube link</strong>, album review, blog post, or any URL that
                    mentions music. We'll extract every track & album we find — then let you add them
                    directly to Spotify or your <strong>Sample Lab</strong>.
                </p>
            </div>

            <form className="url-form" onSubmit={(e) => handleParse(e, false)}>
                <input
                    type="url"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    placeholder="https://youtube.com/watch?v=... or any URL"
                    className="url-input"
                    required
                />
                <div className="parser-buttons">
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? 'Parsing...' : '🔍 Parse'}
                    </button>
                    <button
                        type="button"
                        className="btn btn-ai"
                        onClick={() => handleParse(null, true)}
                        disabled={loading}
                        title="Use Gemini 2.5 Flash for intelligent extraction"
                    >
                        {loading ? 'Thinking...' : '✨ AI Deep Scan'}
                    </button>
                </div>
            </form>

            {error && (
                <div className="parse-error">
                    <span>⚠️</span>
                    <span>{error}</span>
                </div>
            )}

            {result && (
                <div className="parse-result">
                    <div className="result-meta">
                        <span className="source-badge">
                            {result.source === 'youtube' ? '▶ YouTube' : '🌐 Web Page'}
                        </span>
                        <span className="found-count">{result.albums.length} mentions found</span>
                    </div>

                    {result.albums.length === 0 ? (
                        <p className="no-albums">
                            No album/track mentions detected. Try a different URL, or a video with closed captions enabled.
                        </p>
                    ) : (
                        <>
                            <div className="parsed-album-list">
                                {result.albums.map((a, i) => {
                                    const key = `${a.artist.toLowerCase()}::${a.album.toLowerCase()}`
                                    const track = spotifyTracks[key]
                                    const isSearching = searching[key]
                                    const alreadyAdded = addedToVault[key]

                                    return (
                                        <div key={i} className="parsed-album-card enriched">
                                            {/* Album art */}
                                            <div className="parsed-art">
                                                {track?.image ? (
                                                    <img src={track.image} alt={track.name} />
                                                ) : isSearching ? (
                                                    <div className="art-searching"><span className="mini-spinner" /></div>
                                                ) : (
                                                    <div className="art-placeholder">♪</div>
                                                )}
                                            </div>

                                            {/* Info */}
                                            <div className="parsed-text">
                                                <span className="parsed-rank">#{i + 1}</span>
                                                <div className="parsed-artist">{track?.artist || a.artist}</div>
                                                <div className="parsed-album">{track?.name || a.album}</div>
                                                {track?.album && track.type === 'track' && (
                                                    <div className="parsed-from-album">from "{track.album}"</div>
                                                )}
                                            </div>

                                            {/* Actions */}
                                            <div className="parsed-actions">
                                                {track?.spotifyUrl && (
                                                    <a
                                                        href={track.spotifyUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="parsed-btn btn-open-spotify"
                                                        title="Open in Spotify"
                                                    >
                                                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                                                            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.516 17.294c-.21.322-.54.47-.872.47-.168 0-.34-.043-.494-.134-1.856-1.114-4.16-1.37-6.9-.75-.312.07-.622-.128-.692-.44-.07-.31.128-.622.44-.692 2.994-.683 5.56-.39 7.644.872.395.237.524.754.287 1.15l-.413-.476zm1.473-3.47c-.266.407-.668.6-1.074.6-.207 0-.418-.054-.61-.166-2.14-1.29-5.4-1.664-7.93-.91-.366.11-.748-.096-.858-.46-.11-.366.096-.75.46-.86 2.89-.87 6.478-.448 8.928 1.046.504.305.666.958.36 1.46l-.276.29zm.128-3.611c-2.573-1.53-6.822-1.67-9.28-.924-.394.12-.808-.1-.928-.494-.12-.395.1-.81.494-.929 2.82-.856 7.51-.69 10.47 1.07.484.29.643.918.353 1.404-.29.484-.918.642-1.404.353l.295.52z" />
                                                        </svg>
                                                    </a>
                                                )}
                                                {track?.preview_url && (
                                                    <audio controls src={track.preview_url} style={{ height: 28, maxWidth: 140 }} />
                                                )}
                                                <button
                                                    className={`parsed-btn btn-add-sample ${alreadyAdded ? 'added' : ''}`}
                                                    onClick={() => handleAddToSamples(a, key)}
                                                    disabled={alreadyAdded}
                                                    title="Add to Sample Lab"
                                                >
                                                    {alreadyAdded ? '✓ In Vault' : '﹢ Sample'}
                                                </button>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>

                            {token ? (
                                <div className="playlist-action">
                                    <button
                                        className="btn btn-spotify"
                                        onClick={createPlaylist}
                                        disabled={creatingPlaylist}
                                    >
                                        {creatingPlaylist ? playlistStatus : `🎵 Create Spotify Playlist (${result.albums.length} tracks)`}
                                    </button>
                                    {playlistUrl && (
                                        <a href={playlistUrl} target="_blank" rel="noreferrer" className="btn btn-spotify" style={{ fontSize: '0.85rem', padding: '0.6rem 1.2rem' }}>
                                            🔗 Open Playlist
                                        </a>
                                    )}
                                </div>
                            ) : (
                                <p className="login-hint">Login to Spotify above to create a playlist or save tracks.</p>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
