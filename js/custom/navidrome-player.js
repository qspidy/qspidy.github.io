(() => {
  'use strict'

  const config = window.NAVIDROME_PLAYER_CONFIG
  const container = document.getElementById('navidrome-player')

  if (!config?.enabled || !container || container.dataset.initialized === 'true') return

  const auth = {
    u: config.username,
    t: config.token,
    s: config.salt,
    v: config.apiVersion,
    c: config.clientName,
    f: 'json'
  }

  const apiUrl = (method, params = {}) => {
    const url = new URL(`${config.server}/rest/${method}.view`)
    Object.entries({ ...auth, ...params }).forEach(([key, value]) => {
      if (value !== '' && value !== undefined && value !== null) {
        url.searchParams.set(key, value)
      }
    })
    return url.toString()
  }

  const getSongs = async () => {
    const method = config.playlistId ? 'getPlaylist' : 'getRandomSongs'
    const params = config.playlistId
      ? { id: config.playlistId }
      : { size: config.songCount }
    const response = await fetch(apiUrl(method, params), { mode: 'cors' })

    if (!response.ok) throw new Error(`Navidrome returned HTTP ${response.status}`)

    const payload = await response.json()
    const subsonic = payload['subsonic-response']
    if (!subsonic || subsonic.status !== 'ok') {
      throw new Error(subsonic?.error?.message || 'Invalid Navidrome response')
    }

    return config.playlistId
      ? subsonic.playlist?.entry || []
      : subsonic.randomSongs?.song || []
  }

  const timestamp = milliseconds => {
    const totalSeconds = milliseconds / 1000
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = (totalSeconds % 60).toFixed(2).padStart(5, '0')
    return `[${String(minutes).padStart(2, '0')}:${seconds}]`
  }

  const getLyrics = async song => {
    if (!config.lyrics) return ''

    try {
      const response = await fetch(apiUrl('getLyricsBySongId', { id: song.id }), { mode: 'cors' })
      if (!response.ok) return ''

      const payload = await response.json()
      const subsonic = payload['subsonic-response']
      const structured = subsonic?.lyricsList?.structuredLyrics || []
      const candidates = Array.isArray(structured) ? structured : [structured]
      const lyrics = candidates.find(item => item.synced && item.line?.length)
      if (lyrics) {
        return lyrics.line
          .filter(line => Number.isFinite(Number(line.start)))
          .map(line => `${timestamp(Number(line.start))}${line.value || ''}`)
          .join('\n')
      }

      // Older Navidrome versions may only expose the legacy lyrics endpoint.
      const legacyResponse = await fetch(apiUrl('getLyrics', {
        artist: song.artist || song.albumArtist,
        title: song.title || song.name
      }), { mode: 'cors' })
      if (!legacyResponse.ok) return ''

      const legacyPayload = await legacyResponse.json()
      const value = legacyPayload['subsonic-response']?.lyrics?.value || ''
      return /\[\d{2}:\d{2}(?:\.\d{2,3})?]/.test(value) ? value : ''
    } catch (error) {
      console.debug(`[navidrome-player] Lyrics unavailable for ${song.title || song.id}`, error)
      return ''
    }
  }

  const toAudio = song => ({
    name: song.title || song.name || 'Unknown title',
    artist: song.artist || song.albumArtist || 'Unknown artist',
    url: apiUrl('stream', {
      id: song.id,
      format: config.format,
      maxBitRate: config.maxBitRate
    }),
    cover: song.coverArt
      ? apiUrl('getCoverArt', { id: song.coverArt, size: 300 })
      : '',
    lrc: '',
    type: 'auto'
  })

  const showError = error => {
    container.classList.add('navidrome-player-error')
    container.textContent = 'Music is temporarily unavailable.'
    console.error('[navidrome-player]', error)
  }

  const initialize = async () => {
    try {
      const songs = await getSongs()
      if (!songs.length) throw new Error('The Navidrome playlist contains no songs')
      if (typeof window.APlayer !== 'function') throw new Error('APlayer failed to load')

      container.dataset.initialized = 'true'
      container.hidden = false
      const player = new window.APlayer({
        container,
        fixed: true,
        mini: true,
        autoplay: false,
        theme: config.theme,
        loop: 'all',
        order: 'random',
        preload: 'none',
        volume: 0.7,
        mutex: true,
        lrcType: 1,
        listFolded: false,
        audio: songs.map(toAudio)
      })

      const lyricsLoaded = new Set()
      const loadLyrics = async index => {
        if (!config.lyrics || lyricsLoaded.has(index) || !songs[index]) return
        lyricsLoaded.add(index)

        const lyrics = await getLyrics(songs[index])
        player.list.audios[index].lrc = lyrics
        player.lrc.parsed[index] = undefined
        if (player.list.index === index) player.lrc.switch(index)
      }

      player.on('listswitch', event => loadLyrics(event.index))
      loadLyrics(player.list.index)

      window.aplayers = window.aplayers || []
      window.aplayers.push(player)
    } catch (error) {
      showError(error)
    }
  }

  initialize()
})()
