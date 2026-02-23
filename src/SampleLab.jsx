import { useState, useEffect, useRef } from 'react'
import './SampleLab.css'

const formatBytes = (bytes) => {
    if (!bytes) return '—'
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function SampleLab({ token, sampleVault, onRemoveSample }) {
    const [ytdlpStatus, setYtdlpStatus] = useState(null)
    const [downloads, setDownloads] = useState([])
    const [downloading, setDownloading] = useState({})
    const [whoSampledData, setWhoSampledData] = useState({})
    const [whoSampledLoading, setWhoSampledLoading] = useState({})
    const [expandedSample, setExpandedSample] = useState(null)
    const [activeFilter, setActiveFilter] = useState('all')
    const audioRefs = useRef({})

    useEffect(() => {
        // Check yt-dlp availability
        fetch('/api/ytdlp-status')
            .then(r => r.json())
            .then(data => setYtdlpStatus(data))
            .catch(() => setYtdlpStatus({ available: false }))

        // Load existing downloads
        loadDownloads()
    }, [])

    const loadDownloads = () => {
        fetch('/api/downloads')
            .then(r => r.json())
            .then(data => setDownloads(data))
            .catch(() => setDownloads([]))
    }

    const downloadTrack = async (sample) => {
        const key = sample.id || sample.uri
        setDownloading(prev => ({ ...prev, [key]: 'starting' }))

        try {
            const query = `${sample.artist} ${sample.name}`
            const res = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query,
                    trackId: sample.id,
                    trackName: sample.name,
                    artistName: sample.artist
                })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)

            setDownloading(prev => ({ ...prev, [key]: 'done' }))
            loadDownloads()

            // Auto-clear after 3s
            setTimeout(() => {
                setDownloading(prev => {
                    const next = { ...prev }
                    delete next[key]
                    return next
                })
            }, 3000)
        } catch (err) {
            setDownloading(prev => ({ ...prev, [key]: `error: ${err.message}` }))
            setTimeout(() => {
                setDownloading(prev => {
                    const next = { ...prev }
                    delete next[key]
                    return next
                })
            }, 5000)
        }
    }

    const fetchWhoSampled = async (sample) => {
        const key = sample.id || sample.uri
        if (whoSampledData[key]) {
            // Toggle off
            setWhoSampledData(prev => { const n = { ...prev }; delete n[key]; return n })
            return
        }
        setWhoSampledLoading(prev => ({ ...prev, [key]: true }))
        try {
            const res = await fetch(
                `/api/whosampled?artist=${encodeURIComponent(sample.artist)}&track=${encodeURIComponent(sample.name)}`
            )
            const data = await res.json()
            setWhoSampledData(prev => ({ ...prev, [key]: data }))
        } catch (err) {
            setWhoSampledData(prev => ({ ...prev, [key]: { error: err.message } }))
        } finally {
            setWhoSampledLoading(prev => ({ ...prev, [key]: false }))
        }
    }

    const deleteDownload = async (filename) => {
        await fetch(`/api/downloads/${filename}`, { method: 'DELETE' })
        loadDownloads()
    }

    const getDownloadForTrack = (sample) => {
        return downloads.find(d => d.filename.startsWith(sample.id))
    }

    const filteredSamples = sampleVault.filter(s => {
        if (activeFilter === 'all') return true
        if (activeFilter === 'downloaded') return !!getDownloadForTrack(s)
        if (activeFilter === 'pending') return !getDownloadForTrack(s)
        return true
    })

    const totalDownloaded = downloads.length
    const totalSize = downloads.reduce((acc, d) => acc + (d.size || 0), 0)

    return (
        <div className="sample-lab">
            {/* Header */}
            <div className="lab-header">
                <div className="lab-title-block">
                    <div className="lab-icon">🎛️</div>
                    <div>
                        <h2 className="lab-title">Sample Lab</h2>
                        <p className="lab-subtitle">Your music production archive — save, download & sample</p>
                    </div>
                </div>

                {/* Status pills */}
                <div className="lab-stats">
                    <div className="stat-pill">
                        <span className="stat-num">{sampleVault.length}</span>
                        <span className="stat-label">Saved</span>
                    </div>
                    <div className="stat-pill">
                        <span className="stat-num">{totalDownloaded}</span>
                        <span className="stat-label">Downloaded</span>
                    </div>
                    <div className="stat-pill">
                        <span className="stat-num">{formatBytes(totalSize)}</span>
                        <span className="stat-label">Total Size</span>
                    </div>
                </div>
            </div>

            {/* yt-dlp status banner */}
            {ytdlpStatus !== null && (
                <div className={`ytdlp-banner ${ytdlpStatus.available ? 'ytdlp-ok' : 'ytdlp-missing'}`}>
                    {ytdlpStatus.available ? (
                        <>✅ <strong>yt-dlp {ytdlpStatus.version}</strong> — MP3 downloads ready</>
                    ) : (
                        <>
                            ⚠️ <strong>yt-dlp not found.</strong> Install it to enable downloads:{' '}
                            <code>pip install yt-dlp</code> or <code>winget install yt-dlp</code>
                        </>
                    )}
                </div>
            )}

            {/* Filter tabs */}
            {sampleVault.length > 0 && (
                <div className="lab-filters">
                    {['all', 'downloaded', 'pending'].map(f => (
                        <button
                            key={f}
                            className={`filter-pill ${activeFilter === f ? 'active' : ''}`}
                            onClick={() => setActiveFilter(f)}
                        >
                            {f === 'all' ? `All (${sampleVault.length})` :
                                f === 'downloaded' ? `Downloaded (${downloads.length})` :
                                    `Pending (${sampleVault.length - downloads.length})`}
                        </button>
                    ))}
                </div>
            )}

            {/* Empty state */}
            {sampleVault.length === 0 ? (
                <div className="lab-empty">
                    <div className="empty-icon">🎚️</div>
                    <h3>Your Sample Vault is Empty</h3>
                    <p>
                        When you find a track that inspires you, click <strong>﹢ Add to Samples</strong> on any
                        track card. It'll appear here, ready to download as an MP3 for your DAW.
                    </p>
                </div>
            ) : (
                <div className="vault-list">
                    {filteredSamples.map((sample, i) => {
                        const key = sample.id || sample.uri
                        const dlStatus = downloading[key]
                        const existingDownload = getDownloadForTrack(sample)
                        const wsData = whoSampledData[key]
                        const wsLoading = whoSampledLoading[key]
                        const isExpanded = expandedSample === key

                        return (
                            <div key={key} className={`vault-card ${isExpanded ? 'expanded' : ''}`}>
                                {/* Album art / placeholder */}
                                <div className="vault-art" style={{ background: sample.color || 'var(--accent-primary)' }}>
                                    {sample.image ? (
                                        <img src={sample.image} alt={sample.name} />
                                    ) : (
                                        <span className="art-emoji">🎵</span>
                                    )}
                                </div>

                                {/* Track info */}
                                <div className="vault-info">
                                    <div className="vault-track">{sample.name}</div>
                                    <div className="vault-artist">{sample.artist}</div>
                                    {sample.album && <div className="vault-album">{sample.album}</div>}
                                    {sample.addedAt && (
                                        <div className="vault-date">
                                            Added {new Date(sample.addedAt).toLocaleDateString()}
                                        </div>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="vault-actions">
                                    {/* Spotify link */}
                                    {sample.spotifyUrl && (
                                        <a
                                            href={sample.spotifyUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="vault-btn btn-spotify-small"
                                            title="Open in Spotify"
                                        >
                                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.516 17.294c-.21.322-.54.47-.872.47-.168 0-.34-.043-.494-.134-1.856-1.114-4.16-1.37-6.9-.75-.312.07-.622-.128-.692-.44-.07-.31.128-.622.44-.692 2.994-.683 5.56-.39 7.644.872.395.237.524.754.287 1.15l-.413-.476zm1.473-3.47c-.266.407-.668.6-1.074.6-.207 0-.418-.054-.61-.166-2.14-1.29-5.4-1.664-7.93-.91-.366.11-.748-.096-.858-.46-.11-.366.096-.75.46-.86 2.89-.87 6.478-.448 8.928 1.046.504.305.666.958.36 1.46l-.276.29zm.128-3.611c-2.573-1.53-6.822-1.67-9.28-.924-.394.12-.808-.1-.928-.494-.12-.395.1-.81.494-.929 2.82-.856 7.51-.69 10.47 1.07.484.29.643.918.353 1.404-.29.484-.918.642-1.404.353l.295.52z" />
                                            </svg>
                                        </a>
                                    )}

                                    {/* Download / Play button */}
                                    {existingDownload ? (
                                        <div className="download-ready">
                                            <audio
                                                ref={el => audioRefs.current[key] = el}
                                                src={existingDownload.url}
                                                preload="none"
                                            />
                                            <button
                                                className="vault-btn btn-play"
                                                onClick={() => {
                                                    const audio = audioRefs.current[key]
                                                    if (audio.paused) audio.play()
                                                    else audio.pause()
                                                }}
                                                title="Preview"
                                            >▶</button>
                                            <a
                                                href={existingDownload.url}
                                                download
                                                className="vault-btn btn-download-ready"
                                                title={`Download (${formatBytes(existingDownload.size)})`}
                                            >
                                                ⬇ {formatBytes(existingDownload.size)}
                                            </a>
                                            <button
                                                className="vault-btn btn-delete-dl"
                                                onClick={() => deleteDownload(existingDownload.filename)}
                                                title="Delete MP3"
                                            >🗑</button>
                                        </div>
                                    ) : (
                                        <button
                                            className={`vault-btn btn-download ${dlStatus ? 'loading' : ''}`}
                                            onClick={() => downloadTrack(sample)}
                                            disabled={!!dlStatus || !ytdlpStatus?.available}
                                            title={ytdlpStatus?.available ? 'Download as MP3' : 'yt-dlp not installed'}
                                        >
                                            {dlStatus === 'starting' ? '⏳ Searching...' :
                                                dlStatus === 'done' ? '✅ Done!' :
                                                    dlStatus?.startsWith('error') ? '❌ Failed' :
                                                        '⬇ Get MP3'}
                                        </button>
                                    )}

                                    {/* WhoSampled button */}
                                    <button
                                        className={`vault-btn btn-whosampled ${wsData ? 'active' : ''}`}
                                        onClick={() => fetchWhoSampled(sample)}
                                        disabled={wsLoading}
                                        title="Who Sampled This?"
                                    >
                                        {wsLoading ? '⏳' : '🔬 Samples'}
                                    </button>

                                    {/* Toggle expand */}
                                    <button
                                        className="vault-btn btn-expand"
                                        onClick={() => setExpandedSample(isExpanded ? null : key)}
                                        title="Details"
                                    >
                                        {isExpanded ? '▲' : '▼'}
                                    </button>

                                    {/* Remove from vault */}
                                    <button
                                        className="vault-btn btn-remove"
                                        onClick={() => onRemoveSample(sample)}
                                        title="Remove from Vault"
                                    >✕</button>
                                </div>

                                {/* Expanded: WhoSampled + track metadata */}
                                {isExpanded && (
                                    <div className="vault-expanded">
                                        <div className="expanded-meta">
                                            {sample.uri && (
                                                <div className="meta-row">
                                                    <span className="meta-label">Spotify URI</span>
                                                    <code className="meta-val">{sample.uri}</code>
                                                </div>
                                            )}
                                            {sample.id && (
                                                <div className="meta-row">
                                                    <span className="meta-label">Track ID</span>
                                                    <code className="meta-val">{sample.id}</code>
                                                </div>
                                            )}
                                            {sample.duration_ms && (
                                                <div className="meta-row">
                                                    <span className="meta-label">Duration</span>
                                                    <span className="meta-val">
                                                        {Math.floor(sample.duration_ms / 60000)}:{String(Math.floor((sample.duration_ms % 60000) / 1000)).padStart(2, '0')}
                                                    </span>
                                                </div>
                                            )}
                                        </div>

                                        {/* WhoSampled results */}
                                        {wsData && (
                                            <div className="whosampled-results">
                                                <div className="ws-header">
                                                    🔬 WhoSampled
                                                    {wsData.mock && <span className="ws-mock-badge">Demo Data</span>}
                                                    {wsData.error && <span className="ws-error-badge">Error</span>}
                                                </div>
                                                {wsData.error ? (
                                                    <p className="ws-error">{wsData.error}</p>
                                                ) : wsData.samples?.length === 0 ? (
                                                    <p className="ws-none">No samples found for this track.</p>
                                                ) : (
                                                    <div className="ws-list">
                                                        {(wsData.samples || []).map((s, idx) => (
                                                            <div key={idx} className="ws-item">
                                                                <div className="ws-type-badge">{s.type || 'sample'}</div>
                                                                <div className="ws-item-info">
                                                                    <div className="ws-item-title">"{s.title}"</div>
                                                                    <div className="ws-item-artist">by {s.artist} {s.year ? `(${s.year})` : ''}</div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {wsData.mock && (
                                                    <p className="ws-mock-note">
                                                        💡 Set <code>RAPIDAPI_KEY</code> in your environment for live WhoSampled data.
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Downloaded files section */}
            {downloads.length > 0 && (
                <div className="downloads-section">
                    <h3 className="section-title">📁 Downloaded Files</h3>
                    <div className="downloads-list">
                        {downloads.map(d => (
                            <div key={d.filename} className="download-file-card">
                                <div className="dl-icon">🎵</div>
                                <div className="dl-info">
                                    <div className="dl-name">{d.filename}</div>
                                    <div className="dl-size">{formatBytes(d.size)}</div>
                                </div>
                                <div className="dl-actions">
                                    <a href={d.url} download className="vault-btn btn-download-ready">⬇</a>
                                    <button className="vault-btn btn-delete-dl" onClick={() => deleteDownload(d.filename)}>🗑</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
