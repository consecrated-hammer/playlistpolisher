import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PlayerContext from './playerContextBase';
import PlayerProgressContext from './playerProgressContextBase';
import { authAPI, playerAPI, playlistAPI } from '../services/api';

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
const REQUIRED_SCOPES = ['streaming', 'user-modify-playback-state'];
const DEFAULT_VOLUME = 0.75;
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

// Helper to log to backend instead of console
const logToBackend = (level, message, data) => {
  if (level === 'debug') return;
  playerAPI.log(level, message, data).catch(() => {
    // Silent fail
  });
};

const buildTrackUrl = (track) => {
  if (!track) return null;
  const directUrl = track.externalUrl || track.external_urls?.spotify;
  if (directUrl) return directUrl;
  if (track.uri && track.uri.startsWith('spotify:track:')) {
    return `https://open.spotify.com/track/${track.uri.replace('spotify:track:', '')}`;
  }
  if (track.id) return `https://open.spotify.com/track/${track.id}`;
  return null;
};

const normalizeArtists = (artists = []) => {
  const names = artists.map((artist) => (
    typeof artist === 'string' ? artist : artist.name
  )).filter(Boolean);
  const unique = Array.from(new Set(names.map((name) => name.trim()))).filter(Boolean);
  return unique.sort((a, b) => a.localeCompare(b));
};

const normalizeArtistItems = (artists = []) => {
  const items = artists.map((artist) => {
    if (typeof artist === 'string') {
      return { name: artist, url: null };
    }
    const name = artist?.name;
    const url = artist?.external_urls?.spotify
      || (artist?.uri && artist.uri.startsWith('spotify:artist:') ? `https://open.spotify.com/artist/${artist.uri.replace('spotify:artist:', '')}` : null)
      || (artist?.id ? `https://open.spotify.com/artist/${artist.id}` : null);
    return { name, url };
  }).filter((item) => item?.name);

  const normalizedNames = normalizeArtists(items.map((item) => item.name));
  const lookup = new Map();
  items.forEach((item) => {
    if (!lookup.has(item.name)) {
      lookup.set(item.name, item.url || null);
    }
  });

  return normalizedNames.map((name) => ({
    name,
    url: lookup.get(name) || null,
  }));
};

const normalizeTrack = (track) => {
  if (!track) return null;
  const album = track.album || {};
  const albumImages = album.images || track.albumImages || [];
  const artists = normalizeArtists(track.artists || []);
  const artistItems = normalizeArtistItems(track.artists || []);
  const linkedFrom = track.linked_from || {};

  return {
    id: track.id,
    uri: track.uri,
    linkedFromId: linkedFrom.id || null,
    linkedFromUri: linkedFrom.uri || null,
    playlistIndex: Number.isFinite(track.playlistIndex) ? track.playlistIndex : track.playlistIndex ?? null,
    selectionKey: track.selectionKey || null,
    name: track.name,
    artists,
    artistItems,
    albumName: album.name || track.albumName || '',
    albumUri: album.uri || track.albumUri || null,
    albumId: album.id || track.albumId || null,
    albumExternalUrl: album.external_urls?.spotify || track.albumExternalUrl || null,
    albumImages,
    albumArt: albumImages[0]?.url || track.albumArt || null,
    albumReleaseDate: album.release_date || track.albumReleaseDate || null,
    albumReleasePrecision: album.release_date_precision || track.albumReleasePrecision || null,
    albumType: album.album_type || track.albumType || null,
    albumTotalTracks: album.total_tracks ?? track.albumTotalTracks ?? null,
    explicit: Boolean(track.explicit),
    externalUrl: track.external_urls?.spotify || track.externalUrl || null,
    durationMs: track.duration_ms || track.duration || null,
    popularity: track.popularity ?? null,
  };
};

const arraysEqual = (a = [], b = []) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const mergeTrackStable = (prev, next) => {
  if (!next) return prev;
  if (!prev || (next.id && prev.id !== next.id)) {
    return next;
  }
  let changed = false;
  const merged = { ...prev };
  const assign = (key, value) => {
    if (value === undefined || value === null) return;
    if (merged[key] !== value) {
      merged[key] = value;
      changed = true;
    }
  };
  assign('name', next.name);
  assign('albumName', next.albumName);
  assign('albumArt', next.albumArt);
  assign('albumReleaseDate', next.albumReleaseDate);
  assign('albumReleasePrecision', next.albumReleasePrecision);
  assign('albumType', next.albumType);
  assign('albumUri', next.albumUri);
  assign('albumId', next.albumId);
  assign('albumExternalUrl', next.albumExternalUrl);
  assign('linkedFromId', next.linkedFromId);
  assign('linkedFromUri', next.linkedFromUri);
  assign('playlistIndex', next.playlistIndex);
  assign('selectionKey', next.selectionKey);
  if (next.albumTotalTracks !== null && next.albumTotalTracks !== undefined && merged.albumTotalTracks !== next.albumTotalTracks) {
    merged.albumTotalTracks = next.albumTotalTracks;
    changed = true;
  }
  if (typeof next.popularity === 'number' && merged.popularity !== next.popularity) {
    merged.popularity = next.popularity;
    changed = true;
  }
  if (typeof next.explicit === 'boolean' && merged.explicit !== next.explicit) {
    if (merged.explicit !== true) {
      merged.explicit = next.explicit;
      changed = true;
    }
  }
  if (typeof next.durationMs === 'number' && merged.durationMs !== next.durationMs) {
    merged.durationMs = next.durationMs;
    changed = true;
  }
  if (Array.isArray(next.artists)) {
    const sameArtists = arraysEqual(prev.artists || [], next.artists);
    if (!sameArtists) {
      const prevArtists = prev.artists || [];
      const nextArtists = next.artists || [];
      const nextHasMore = nextArtists.length > prevArtists.length;
      if (prevArtists.length === 0 || nextHasMore) {
        merged.artists = nextArtists;
        if (Array.isArray(next.artistItems)) {
          merged.artistItems = next.artistItems;
        }
        changed = true;
      }
    } else if ((!prev.artistItems || prev.artistItems.length === 0) && Array.isArray(next.artistItems) && next.artistItems.length > 0) {
      merged.artistItems = next.artistItems;
      changed = true;
    }
  }
  return changed ? merged : prev;
};

const PlayerProvider = ({ user, children }) => {
  const isPremium = user?.product === 'premium';
  const [isReady, setIsReady] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isPaused, setIsPaused] = useState(true);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(DEFAULT_VOLUME);
  const [deviceId, setDeviceId] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState('off');
  const [queue, setQueue] = useState([]);
  const [currentContextUri, setCurrentContextUri] = useState(null);
  const [currentContextPlaylist, setCurrentContextPlaylist] = useState(null);
  const [playlistNavPending, setPlaylistNavPending] = useState(null);
  const [remoteActive, setRemoteActive] = useState(false);
  const [activeDeviceName, setActiveDeviceName] = useState(null);
  const [hasPlaybackScope, setHasPlaybackScope] = useState(null);
  const [error, setError] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const playerRef = useRef(null);
  const tokenRef = useRef({ token: null, expiresAt: 0, scope: '' });
  const tokenPromiseRef = useRef(null);
  const pendingPlayRef = useRef(null);
  const pollRef = useRef(null);
  const activatedRef = useRef(false);
  const volumeRef = useRef(DEFAULT_VOLUME);
  const queuePollRef = useRef(null);
  const lastQueueTrackRef = useRef(null);
  const activeDeviceRef = useRef(null);
  const transferPlaybackRef = useRef(null);
  const startPlaybackRef = useRef(null);
  const updateFromStateRef = useRef(null);
  const getAccessTokenRef = useRef(null);
  const trackSwitchRef = useRef({ id: null, name: null, albumName: null, at: 0, lastProgress: 0 });
  const playbackLogRef = useRef(null);
  const requestedTrackRef = useRef(null);
  const currentContextPlaylistRef = useRef(null);

  const markPlaylistNavPending = useCallback((playlist) => {
    if (!playlist?.id) {
      setPlaylistNavPending(null);
      return;
    }
    setPlaylistNavPending({ id: playlist.id, name: playlist.name || null });
  }, []);

  const clearPlaylistNavPending = useCallback(() => {
    setPlaylistNavPending(null);
  }, []);

  const updateScope = useCallback((scopeString) => {
    const scopes = new Set((scopeString || '').split(' ').filter(Boolean));
    const hasRequired = REQUIRED_SCOPES.every((scope) => scopes.has(scope));
    setHasPlaybackScope(hasRequired);
    return hasRequired;
  }, []);

  const fetchPlaybackToken = useCallback(async () => {
    const data = await authAPI.getPlaybackToken();
    const expiresInMs = Math.max(0, (data.expires_in || 0) * 1000 - TOKEN_EXPIRY_BUFFER_MS);
    tokenRef.current = {
      token: data.access_token,
      expiresAt: Date.now() + expiresInMs,
      scope: data.scope || ''
    };
    updateScope(data.scope);
    return data.access_token;
  }, [updateScope]);

  const getAccessToken = useCallback(async () => {
    if (tokenRef.current.token && Date.now() < tokenRef.current.expiresAt) {
      return tokenRef.current.token;
    }
    if (!tokenPromiseRef.current) {
      tokenPromiseRef.current = fetchPlaybackToken().finally(() => {
        tokenPromiseRef.current = null;
      });
    }
    return tokenPromiseRef.current;
  }, [fetchPlaybackToken]);

  const shouldGuardTrackSwitch = useCallback((prev, next, progressMs) => {
    if (!prev || !next) return false;
    if (!prev.id || !next.id || prev.id === next.id) return false;
    if (next.linkedFromId && prev.id === next.linkedFromId) return true;
    if (next.linkedFromUri && prev.uri && prev.uri === next.linkedFromUri) return true;
    if (prev.linkedFromId && prev.linkedFromId === next.id) return true;
    if (prev.linkedFromUri && prev.linkedFromUri === next.uri) return true;
    const sameName = prev.name && next.name && prev.name === next.name;
    const sameAlbum = (prev.albumName || '') === (next.albumName || '');
    if (!sameName || !sameAlbum) return false;
    const progressReset = typeof progressMs === 'number'
      && progressMs < 2000
      && trackSwitchRef.current.lastProgress > 5000;
    return !progressReset;
  }, []);

  const stabilizeTrack = useCallback((prev, next, progressMs) => {
    if (!prev || !next) return next;
    const requested = requestedTrackRef.current;
    if (requested && Date.now() - requested.at < 10000) {
      const requestedTrack = requested.track;
      const sameName = requestedTrack?.name && next.name && requestedTrack.name === next.name;
      const requestedArtists = (requestedTrack?.artists || []).map((name) => name.toLowerCase());
      const nextArtists = (next.artists || []).map((name) => name.toLowerCase());
      const hasSharedArtist = requestedArtists.some((name) => nextArtists.includes(name));
      if (sameName && hasSharedArtist) {
        return requestedTrack;
      }
    }
    if (shouldGuardTrackSwitch(prev, next, progressMs)) {
      return prev;
    }
    return next;
  }, [shouldGuardTrackSwitch]);

  const noteTrackProgress = useCallback((progressMs) => {
    if (typeof progressMs === 'number') {
      trackSwitchRef.current.lastProgress = progressMs;
    }
  }, []);

  const noteTrackSwitch = useCallback((track, progressMs) => {
    if (!track) return;
    trackSwitchRef.current = {
      id: track.id || null,
      name: track.name || null,
      albumName: track.albumName || null,
      at: Date.now(),
      lastProgress: typeof progressMs === 'number' ? progressMs : trackSwitchRef.current.lastProgress,
    };
  }, []);

  const updateFromState = useCallback((state) => {
    if (!state) {
      setIsActive(false);
      return;
    }
    setIsActive(true);
    setIsPaused(state.paused);
    setPosition(state.position);
    setDuration(state.duration);
    if (state.context?.uri) {
      const nextContextUri = state.context.uri;
      setCurrentContextUri(nextContextUri);
      setCurrentContextPlaylist((prev) => {
        if (prev?.uri && prev.uri === nextContextUri) return prev;
        return prev ? null : prev;
      });
    }
    const normalized = normalizeTrack(state.track_window?.current_track);
    if (normalized) {
      setCurrentTrack((prev) => {
        const stabilized = stabilizeTrack(prev, normalized, state.position);
        const merged = mergeTrackStable(prev, stabilized);
        if (!prev || (merged && (merged.id !== prev.id || merged.name !== prev.name || merged.albumName !== prev.albumName))) {
          noteTrackSwitch(merged, state.position);
        } else {
          noteTrackProgress(state.position);
        }
        return merged;
      });
    }
  }, [noteTrackProgress, noteTrackSwitch, stabilizeTrack]);

  const callPlayerApi = useCallback(async (path, { method = 'PUT', params = {}, body = null } = {}) => {
    const token = await getAccessToken();
    const url = new URL(`https://api.spotify.com/v1/me/player${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    });
    const response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : null,
    });
    return response;
  }, [getAccessToken]);

  const transferPlayback = useCallback(async (targetDeviceId) => {
    if (!targetDeviceId) return false;
    if (activeDeviceRef.current === targetDeviceId) {
      return true;
    }
    try {
      const attemptTransfer = async () => {
        return callPlayerApi('', {
          method: 'PUT',
          body: { device_ids: [targetDeviceId], play: true },
        });
      };
      let response = await attemptTransfer();
      if (!response.ok && response.status === 404) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        response = await attemptTransfer();
      }
      if (!response.ok) {
        if (response.status === 403) {
          setHasPlaybackScope(false);
        }
        if (response.status === 404) {
          setError('Spotify device not ready. Try again.');
        }
        return false;
      }
      activeDeviceRef.current = targetDeviceId;
      return true;
    } catch (err) {
      setError('Unable to transfer playback to Playlist Polisher.');
      return false;
    }
  }, [callPlayerApi]);

  const activatePlayerElement = useCallback(async () => {
    if (!playerRef.current || activatedRef.current) {
      return true;
    }
    if (typeof playerRef.current.activateElement !== 'function') {
      activatedRef.current = true;
      return true;
    }
    try {
      await playerRef.current.activateElement();
      activatedRef.current = true;
      return true;
    } catch (err) {
      setError('Please click play again to enable audio output.');
      return false;
    }
  }, []);

  const startPlayback = useCallback(async ({ track, contextUri, offsetIndex, offsetUri, positionMs = 0, targetDeviceId, uris }) => {
    const resolvedDeviceId = targetDeviceId || deviceId;
    if (!resolvedDeviceId) {
      pendingPlayRef.current = { track, contextUri, offsetIndex, offsetUri, positionMs, uris };
      return false;
    }

    try {
      await activatePlayerElement();
      const transferred = await transferPlayback(resolvedDeviceId);
      if (!transferred) {
        setError('Playback device is still connecting. Try again.');
        return false;
      }
      const offset = offsetUri
        ? { uri: offsetUri }
        : Number.isInteger(offsetIndex) ? { position: offsetIndex } : undefined;
      const resolvedUris = Array.isArray(uris) && uris.length > 0 ? uris : (track?.uri ? [track.uri] : []);
      const body = contextUri
        ? {
          context_uri: contextUri,
          offset,
          position_ms: positionMs,
        }
        : {
          uris: resolvedUris,
          position_ms: positionMs,
        };

      const attemptPlay = async () => {
        return callPlayerApi('/play', {
          method: 'PUT',
          params: { device_id: resolvedDeviceId },
          body,
        });
      };

      let response = await attemptPlay();
      if (!response.ok && response.status === 404) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        response = await attemptPlay();
      }

      if (!response.ok) {
        if (response.status === 403) {
          setHasPlaybackScope(false);
        }
        const detail = await response.text();
        if (response.status !== 404) {
          setError(detail || 'Unable to start playback.');
        }
        return false;
      }
      setError(null);
      if (playerRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const state = await playerRef.current.getCurrentState();
        if (!state) {
          setError('Playback did not start. Try reconnecting.');
          return false;
        }
        if (state.paused) {
          await playerRef.current.resume();
        }
      }
      return true;
    } catch (err) {
      setError('Unable to start playback.');
      return false;
    }
  }, [activatePlayerElement, callPlayerApi, deviceId, transferPlayback]);

  useEffect(() => {
    transferPlaybackRef.current = transferPlayback;
  }, [transferPlayback]);

  useEffect(() => {
    startPlaybackRef.current = startPlayback;
  }, [startPlayback]);

  useEffect(() => {
    updateFromStateRef.current = updateFromState;
  }, [updateFromState]);

  useEffect(() => {
    getAccessTokenRef.current = getAccessToken;
  }, [getAccessToken]);

  useEffect(() => {
    currentContextPlaylistRef.current = currentContextPlaylist;
  }, [currentContextPlaylist]);

  const openTrackInSpotify = useCallback((track) => {
    const url = buildTrackUrl(track || currentTrack);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [currentTrack]);

  const playTrack = useCallback(async ({ track, contextUri, offsetIndex, offsetUri, contextMeta, shuffle }) => {
    if (!isPremium || hasPlaybackScope === false) {
      openTrackInSpotify(track);
      return false;
    }

    const normalized = normalizeTrack(track);
    if (normalized) {
      noteTrackSwitch(normalized, 0);
      setCurrentTrack(normalized);
      requestedTrackRef.current = { track: normalized, at: Date.now() };
    }
    if (contextMeta && contextMeta.id && contextMeta.name) {
      setCurrentContextPlaylist({
        id: contextMeta.id,
        name: contextMeta.name,
        uri: contextMeta.uri || contextUri || null,
        externalUrl: contextMeta.externalUrl || null,
      });
      if (contextMeta.uri) {
        setCurrentContextUri(contextMeta.uri);
      } else if (contextUri) {
        setCurrentContextUri(contextUri);
      }
    } else if (contextUri) {
      setCurrentContextUri(contextUri);
      setCurrentContextPlaylist((prev) => {
        if (!prev) return prev;
        if (prev.uri && prev.uri === contextUri) return prev;
        return null;
      });
    }

    if (!deviceId || !isReady) {
      pendingPlayRef.current = { track, contextUri, offsetIndex, offsetUri, positionMs: 0, shuffle };
      setIsConnecting(true);
      return false;
    }

    await activatePlayerElement();
    const started = await startPlayback({ track, contextUri, offsetIndex, offsetUri, positionMs: 0 });
    
    // Apply shuffle after playback has started
    if (started && shuffle !== undefined && shuffle !== null) {
      try {
        await callPlayerApi('/shuffle', { 
          method: 'PUT', 
          params: { state: Boolean(shuffle), device_id: deviceId } 
        });
        setShuffleEnabled(Boolean(shuffle));
      } catch (err) {
        // Shuffle setting failed, but playback started successfully
      }
    }
    
    return started;
  }, [activatePlayerElement, callPlayerApi, deviceId, hasPlaybackScope, isPremium, isReady, noteTrackSwitch, openTrackInSpotify, startPlayback]);

  const playTracks = useCallback(async ({ tracks, contextMeta }) => {
    const trackList = Array.isArray(tracks) ? tracks : [];
    const uris = trackList.map((item) => item?.uri).filter(Boolean);
    if (!uris.length) return false;
    if (!isPremium || hasPlaybackScope === false) {
      openTrackInSpotify(trackList[0]);
      return false;
    }
    const normalized = normalizeTrack(trackList[0]);
    if (normalized) {
      noteTrackSwitch(normalized, 0);
      setCurrentTrack(normalized);
      requestedTrackRef.current = { track: normalized, at: Date.now() };
    }
    if (contextMeta && contextMeta.id && contextMeta.name) {
      setCurrentContextPlaylist({
        id: contextMeta.id,
        name: contextMeta.name,
        uri: contextMeta.uri || null,
        externalUrl: contextMeta.externalUrl || null,
      });
      setCurrentContextUri(contextMeta.uri || null);
    } else {
      setCurrentContextPlaylist((prev) => prev || null);
      setCurrentContextUri(null);
    }

    if (!deviceId || !isReady) {
      pendingPlayRef.current = { uris, positionMs: 0 };
      setIsConnecting(true);
      return false;
    }
    await activatePlayerElement();
    return startPlayback({ uris, positionMs: 0 });
  }, [activatePlayerElement, deviceId, hasPlaybackScope, isPremium, isReady, noteTrackSwitch, openTrackInSpotify, startPlayback]);

  const togglePlay = useCallback(async () => {
    if (remoteActive) {
      await callPlayerApi(isPaused ? '/play' : '/pause', { method: 'PUT' });
      return;
    }
    if (playerRef.current) {
      await activatePlayerElement();
      playerRef.current.togglePlay();
    }
  }, [activatePlayerElement, callPlayerApi, isPaused, remoteActive]);

  const nextTrack = useCallback(async () => {
    if (remoteActive) {
      await callPlayerApi('/next', { method: 'POST' });
      return;
    }
    if (playerRef.current) {
      playerRef.current.nextTrack();
    }
  }, [callPlayerApi, remoteActive]);

  const previousTrack = useCallback(async () => {
    if (remoteActive) {
      await callPlayerApi('/previous', { method: 'POST' });
      return;
    }
    if (playerRef.current) {
      playerRef.current.previousTrack();
    }
  }, [callPlayerApi, remoteActive]);

  const seek = useCallback(async (nextPosition) => {
    if (remoteActive) {
      await callPlayerApi('/seek', { method: 'PUT', params: { position_ms: Math.floor(nextPosition) } });
      setPosition(nextPosition);
      return;
    }
    if (playerRef.current) {
      playerRef.current.seek(nextPosition);
      setPosition(nextPosition);
    }
  }, [callPlayerApi, remoteActive]);

  const setVolume = useCallback(async (nextVolume) => {
    const clamped = Math.min(1, Math.max(0, nextVolume));
    if (clamped > 0) {
      volumeRef.current = clamped;
    }
    setIsMuted(clamped === 0);
    if (remoteActive) {
      await callPlayerApi('/volume', { method: 'PUT', params: { volume_percent: Math.round(clamped * 100) } });
      setVolumeState(clamped);
      return;
    }
    if (playerRef.current) {
      playerRef.current.setVolume(clamped);
    }
    setVolumeState(clamped);
  }, [callPlayerApi, remoteActive]);

  const toggleMute = useCallback(async () => {
    if (isMuted) {
      await setVolume(volumeRef.current || DEFAULT_VOLUME);
    } else {
      await setVolume(0);
    }
  }, [isMuted, setVolume]);

  const setShuffle = useCallback(async (nextValue) => {
    if (!deviceId && !remoteActive) {
      return;
    }
    const params = { state: Boolean(nextValue) };
    // Only pass device_id if we're controlling the app player, not remote
    if (deviceId && !remoteActive) {
      params.device_id = deviceId;
    }
    await callPlayerApi('/shuffle', { method: 'PUT', params });
    setShuffleEnabled(Boolean(nextValue));
  }, [callPlayerApi, deviceId, remoteActive]);

  const setRepeat = useCallback(async (nextMode) => {
    const mode = nextMode || 'off';
    await callPlayerApi('/repeat', { method: 'PUT', params: { state: mode } });
    setRepeatMode(mode);
  }, [callPlayerApi]);

  const transferToApp = useCallback(async () => {
    if (!deviceId) return false;
    const transferred = await transferPlayback(deviceId);
    if (transferred && playerRef.current) {
      await playerRef.current.resume();
    }
    return transferred;
  }, [deviceId, transferPlayback]);

  const refreshQueue = useCallback(async () => {
    try {
      const response = await callPlayerApi('/queue', { method: 'GET' });
      if (!response.ok) return;
      const data = await response.json();
      const nextItems = (data?.queue || []).slice(0, 15);
      setQueue(nextItems);
    } catch (err) {
      // Ignore queue errors for now
    }
  }, [callPlayerApi]);

  // Cache for fetched playlist metadata to avoid repeated API calls
  const playlistMetadataCache = useRef(new Map());

  // Fetch playlist metadata from context URI
  const fetchPlaylistMetadata = useCallback(async (contextUri) => {
    if (!contextUri || !contextUri.startsWith('spotify:playlist:')) return null;
    const playlistId = contextUri.split(':')[2];
    if (!playlistId) return null;
    
    // Check cache first
    if (playlistMetadataCache.current.has(playlistId)) {
      return playlistMetadataCache.current.get(playlistId);
    }
    
    try {
      const data = await playlistAPI.getPlaylistSummary(playlistId);
      const metadata = {
        id: data.id,
        name: data.name,
        uri: data.uri || contextUri,
        externalUrl: data.external_url || data.externalUrl || null,
      };
      // Cache the result
      playlistMetadataCache.current.set(playlistId, metadata);
      return metadata;
    } catch (err) {
      logToBackend('warn', 'Failed to fetch playlist metadata', { playlistId, error: err.message || String(err) });
      return null;
    }
  }, []);

  const refreshPlayerState = useCallback(async () => {
    try {
      const response = await callPlayerApi('', { method: 'GET' });
      
      if (response.status === 204) {
        // No playback available - only clear remote flag, keep track visible
        setRemoteActive(false);
        return;
      }
      if (!response.ok) {
        logToBackend('warn', 'Response not OK', { status: response.status });
        return;
      }
      const data = await response.json();
      setShuffleEnabled(Boolean(data.shuffle_state));
      setRepeatMode(data.repeat_state || 'off');
      if (typeof data.device?.volume_percent === 'number') {
        const nextVolume = data.device.volume_percent / 100;
        setVolumeState(nextVolume);
        setIsMuted(nextVolume === 0);
        if (nextVolume > 0) {
          volumeRef.current = nextVolume;
        }
      }
      setActiveDeviceName(data.device?.name || null);
      
      // Detect remote playback: if there's an active device and it's not ours (or we don't have one yet)
      const hasActiveDevice = Boolean(data.device?.id && data.device.is_active);
      const isOurDevice = deviceId && data.device?.id === deviceId;
      const isRemote = hasActiveDevice && !isOurDevice;
      setRemoteActive(isRemote);
      if (!isRemote && data.device?.id === deviceId && data.device.is_active) {
        activeDeviceRef.current = deviceId;
      }
      setIsPaused(!data.is_playing);
      setPosition(data.progress_ms || 0);
      setDuration(data.item?.duration_ms || 0);
      if (data.context !== undefined && data.context?.uri) {
        const nextContextUri = data.context.uri;
        setCurrentContextUri(nextContextUri);
        setCurrentContextPlaylist((prev) => {
          if (prev?.uri && prev.uri === nextContextUri) return prev;
          return prev ? null : prev;
        });
        if (nextContextUri.startsWith('spotify:playlist:')) {
          const playlistId = nextContextUri.split(':')[2];
          const currentPlaylist = currentContextPlaylistRef.current;
          const cached = playlistId ? playlistMetadataCache.current.get(playlistId) : null;
          if (cached) {
            setCurrentContextPlaylist((prev) => {
              if (prev?.uri === nextContextUri && prev?.name) return prev;
              return cached;
            });
          } else if (!currentPlaylist || currentPlaylist.id !== playlistId || !currentPlaylist.name) {
            fetchPlaylistMetadata(nextContextUri).then((metadata) => {
              if (metadata) {
                setCurrentContextPlaylist((prev) => {
                  if (prev?.uri === nextContextUri && prev?.name) return prev;
                  return metadata;
                });
              }
            });
          }
        }
      }
      const normalized = normalizeTrack(data.item);
      
      if (normalized) {
        setCurrentTrack((prev) => {
          const stabilized = stabilizeTrack(prev, normalized, data.progress_ms);
          const merged = mergeTrackStable(prev, stabilized);
          if (!prev || (merged && (merged.id !== prev.id || merged.name !== prev.name || merged.albumName !== prev.albumName))) {
            noteTrackSwitch(merged, data.progress_ms);
          } else {
            noteTrackProgress(data.progress_ms);
          }
          return merged;
        });
      } else if (!data.item) {
        // Clear track if explicitly no item in response
        setCurrentTrack(null);
      }
    } catch (err) {
      logToBackend('error', 'refreshPlayerState error', { error: err.message });
      // ignore polling errors
    }
  }, [callPlayerApi, deviceId, fetchPlaylistMetadata, noteTrackProgress, noteTrackSwitch, stabilizeTrack]);

  useEffect(() => {
    if (!isPremium) {
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }
      tokenRef.current = { token: null, expiresAt: 0, scope: '' };
      tokenPromiseRef.current = null;
      pendingPlayRef.current = null;
      activatedRef.current = false;
      activeDeviceRef.current = null;
      volumeRef.current = DEFAULT_VOLUME;
      lastQueueTrackRef.current = null;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (queuePollRef.current) {
        clearInterval(queuePollRef.current);
        queuePollRef.current = null;
      }
      setIsReady(false);
      setIsActive(false);
      setIsPaused(true);
      setCurrentTrack(null);
      setPosition(0);
      setDuration(0);
      setDeviceId(null);
      setIsMuted(false);
      setShuffleEnabled(false);
      setRepeatMode('off');
      setQueue([]);
      setCurrentContextUri(null);
      setCurrentContextPlaylist(null);
      setRemoteActive(false);
      setActiveDeviceName(null);
      setHasPlaybackScope(null);
      setError(null);
      setIsConnecting(false);
      return;
    }

    let cancelled = false;

    const initialize = async () => {
      if (cancelled || playerRef.current || !window.Spotify) return;
      setIsConnecting(true);

      const player = new window.Spotify.Player({
        name: 'Playlist Polisher',
        volume: DEFAULT_VOLUME,
        getOAuthToken: async (cb) => {
          try {
            const token = await getAccessTokenRef.current?.();
            cb(token);
          } catch (err) {
            setError('Failed to fetch Spotify access token.');
            cb('');
          }
        },
      });

      playerRef.current = player;

      player.addListener('ready', async ({ device_id }) => {
        if (cancelled) return;
        setDeviceId(device_id);
        setIsReady(true);
        setIsConnecting(false);
        setError(null);
        const pending = pendingPlayRef.current;
        if (pending) {
          pendingPlayRef.current = null;
          await startPlaybackRef.current?.({ ...pending, targetDeviceId: device_id });
        }
        player.getVolume().then((nextVolume) => {
          if (!cancelled && typeof nextVolume === 'number') {
            setVolumeState(nextVolume);
          }
        });
      });

      player.addListener('not_ready', () => {
        setIsReady(false);
        activeDeviceRef.current = null;
      });

      player.addListener('player_state_changed', (state) => {
        if (!cancelled) {
          updateFromStateRef.current?.(state);
        }
      });

      player.addListener('initialization_error', ({ message }) => {
        setError(message || 'Player initialization failed.');
      });

      player.addListener('authentication_error', ({ message }) => {
        setError(message || 'Spotify authentication failed.');
        setHasPlaybackScope(false);
      });

      player.addListener('account_error', ({ message }) => {
        setError(message || 'Spotify account error.');
      });

      player.connect();
    };

    if (window.Spotify) {
      initialize();
    } else {
      window.onSpotifyWebPlaybackSDKReady = initialize;
      if (!document.getElementById('spotify-player-sdk')) {
        const script = document.createElement('script');
        script.id = 'spotify-player-sdk';
        script.src = SDK_URL;
        script.async = true;
        document.body.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (queuePollRef.current) {
        clearInterval(queuePollRef.current);
        queuePollRef.current = null;
      }
    };
  }, [isPremium]);

  useEffect(() => {
    if (!playerRef.current || !isReady) return;
    pollRef.current = setInterval(async () => {
      const state = await playerRef.current.getCurrentState();
      if (state) {
        updateFromState(state);
      }
    }, 1000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [isReady, updateFromState]);

  useEffect(() => {
    if (!isPremium) return;
    const interval = setInterval(() => {
      refreshPlayerState();
    }, 3000);
    refreshPlayerState();
    return () => clearInterval(interval);
  }, [isPremium, refreshPlayerState]);

  useEffect(() => {
    if (!isPremium) return;
    const interval = setInterval(() => {
      refreshQueue();
    }, 10000);
    refreshQueue();
    return () => clearInterval(interval);
  }, [isPremium, refreshQueue]);

  useEffect(() => {
    if (!currentTrack?.id) return;
    if (lastQueueTrackRef.current === currentTrack.id) return;
    lastQueueTrackRef.current = currentTrack.id;
    refreshQueue();
  }, [currentTrack?.id, refreshQueue]);

  useEffect(() => {
    if (!currentTrack) {
      playbackLogRef.current = null;
      return;
    }
    if (!isPremium || isPaused) return;
    const progressMs = position ?? 0;
    if (progressMs > 1500) return;
    const trackKey = currentTrack.id || currentTrack.uri;
    if (!trackKey || playbackLogRef.current === trackKey) return;
    playbackLogRef.current = trackKey;
    const payload = {
      event: 'playback_started',
      track_id: currentTrack.id || null,
      track_uri: currentTrack.uri || null,
      track_name: currentTrack.name || null,
      artists: currentTrack.artists || [],
      device_name: activeDeviceName || null,
      remote: remoteActive,
    };
    playerAPI.logEvent(payload).catch(() => {
      // Non-blocking, logging should not impact playback.
    });
  }, [activeDeviceName, currentTrack, isPaused, isPremium, position, remoteActive]);

  useEffect(() => {
    if (!currentTrack) {
      setCurrentContextPlaylist(null);
      setCurrentContextUri(null);
    }
  }, [currentTrack]);

  const contextValue = useMemo(() => {
    const canUseAppPlayer = isPremium && hasPlaybackScope !== false;
    return {
      isPremium,
      canUseAppPlayer,
      isReady,
      isActive,
      isPaused,
      currentTrack,
      currentContextUri,
      currentContextPlaylist,
      playlistNavPending,
      volume,
      isMuted,
      shuffleEnabled,
      repeatMode,
      deviceId,
      hasPlaybackScope,
      error,
      isConnecting,
      playTrack,
      playTracks,
      togglePlay,
      nextTrack,
      previousTrack,
      seek,
      setVolume,
      toggleMute,
      setShuffle,
      setRepeat,
      refreshQueue,
      transferToApp,
      openTrackInSpotify,
      markPlaylistNavPending,
      clearPlaylistNavPending,
    };
  }, [
    currentTrack,
    currentContextUri,
    currentContextPlaylist,
    playlistNavPending,
    deviceId,
    error,
    hasPlaybackScope,
    isActive,
    isConnecting,
    isPaused,
    isPremium,
    isReady,
    isMuted,
    shuffleEnabled,
    repeatMode,
    openTrackInSpotify,
    playTrack,
    playTracks,
    previousTrack,
    nextTrack,
    seek,
    setVolume,
    toggleMute,
    setShuffle,
    setRepeat,
    refreshQueue,
    transferToApp,
    togglePlay,
    volume,
    markPlaylistNavPending,
    clearPlaylistNavPending,
  ]);

  const progressValue = useMemo(() => ({
    position,
    duration,
    queue,
    remoteActive,
    activeDeviceName,
  }), [activeDeviceName, duration, position, queue, remoteActive]);

  return (
    <PlayerContext.Provider value={contextValue}>
      <PlayerProgressContext.Provider value={progressValue}>
        {children}
      </PlayerProgressContext.Provider>
    </PlayerContext.Provider>
  );
};

export default PlayerProvider;
