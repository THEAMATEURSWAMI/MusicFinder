import { useState } from 'react'
import './VideoParser.css'

export default function VideoParser({ onAlbumsFound, token }) {
    const [url, setUrl] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [result, setResult] = useState(null)
    const [creatingPlaylist, setCreatingPlaylist] = useState(false)
    const [playlistStatus, setPlaylistStatus] = useState('')

    const handleParse = async (e) => {
        e.preventDefault()
        if (!url.trim()) return
        setLoading(true)
        setError('')
        setResult(null)

        try {
            const res = await fetch(`/api/transcript?url=${encodeURIComponent(url)}`)
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Unknown error')
            setResult(data)
            if (data.albums?.length > 0) onAlbumsFound(data.albums)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const createPlaylist = async () => {
        if (!token || !result?.albums?.length) return
        setCreatingPlaylist(true)
        setPlaylistStatus('Fetching user profile...')

        try {
            const userRes = await fetch('https://api.spotify.com/v1/me', {
                headers: { Authorization: `Bearer ${token}` }
            })
            const user = await userRes.json()

            const trackUris = []
            for (let i = 0; i < result.albums.length; i++) {
                const { artist, album } = result.albums[i]
                setPlaylistStatus(`Searching Spotify: "${album}" by ${artist}`)

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
            const playlistSlug = new URL(url).hostname.replace('www.', '')
            const playlistRes = await fetch(`https://api.spotify.com/v1/users/${user.id}/playlists`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: `MusicFinder: Parsed from ${playlistSlug}`,
                    description: `Albums mentioned in ${url} — parsed by MusicFinder`,
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

            setPlaylistStatus(`✅ Done! Created playlist with ${trackUris.length} tracks.`)
        } catch (err) {
            setPlaylistStatus(`❌ Error: ${err.message}`)
        } finally {
            setCreatingPlaylist(false)
        }
    }

    return (
        <div className="video-parser">
            <div className="parser-header">
                <h2>Parse a Video or Page</h2>
                <p className="parser-subtitle">
                    Drop in a <strong>YouTube link</strong>, a review page, or any URL that mentions albums.
                    We'll extract the transcript or page text and pull out every album we find.
                </p>
            </div>

            <form className="url-form" onSubmit={handleParse}>
                <input
                    type="url"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    placeholder="https://youtube.com/watch?v=... or any URL"
                    className="url-input"
                    required
                />
                <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? (
                        <span className="btn-loading">
                            <span className="mini-spinner" />
                            Parsing...
                        </span>
                    ) : '🔍 Parse'}
                </button>
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
                        <span className="source-badge">{result.source === 'youtube' ? '▶ YouTube' : '🌐 Web Page'}</span>
                        <span className="found-count">{result.albums.length} albums found</span>
                    </div>

                    {result.albums.length === 0 ? (
                        <p className="no-albums">No album/artist mentions detected. Try a different URL, or a video with closed captions enabled.</p>
                    ) : (
                        <>
                            <div className="parsed-album-list">
                                {result.albums.map((a, i) => (
                                    <div key={i} className="parsed-album-card">
                                        <span className="parsed-rank">#{i + 1}</span>
                                        <div>
                                            <div className="parsed-artist">{a.artist}</div>
                                            <div className="parsed-album">{a.album}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {token ? (
                                <div className="playlist-action">
                                    <button
                                        className="btn btn-spotify"
                                        onClick={createPlaylist}
                                        disabled={creatingPlaylist}
                                    >
                                        {creatingPlaylist ? playlistStatus : `Create Spotify Playlist (${result.albums.length} albums)`}
                                    </button>
                                </div>
                            ) : (
                                <p className="login-hint">Login to Spotify above to create a playlist from these results.</p>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
