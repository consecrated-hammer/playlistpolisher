import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import usePlayerContext from '../context/usePlayerContext';
import usePlayerProgressContext from '../context/usePlayerProgressContext';
import { API_BASE_URL, formatDuration, preferencesAPI } from '../services/api';

const PlayerBar = () => {
  const player = usePlayerContext();
  const navigate = useNavigate();
  const location = useLocation();
  const progress = usePlayerProgressContext();
  const {
    isPremium,
    canUseAppPlayer,
    isReady,
    isPaused,
    currentTrack,
    currentContextUri,
    currentContextPlaylist,
    volume,
    isMuted,
    shuffleEnabled,
    repeatMode,
    hasPlaybackScope,
    error,
    isConnecting,
    togglePlay,
    nextTrack,
    previousTrack,
    seek,
    setVolume,
    toggleMute,
    setShuffle,
    setRepeat,
  } = player || {};

  const [seekValue, setSeekValue] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [volumeValue, setVolumeValue] = useState(volume ?? 0.75);
  const [showQueue, setShowQueue] = useState(false);
  const [queueDrag, setQueueDrag] = useState({ x: 0, y: -300 });
  const [queueHeight, setQueueHeight] = useState(420);
  const [queueDragging, setQueueDragging] = useState(false);
  const queueDragRef = useRef(null);
  const queueModalRef = useRef(null);
  const [isContextNavigating, setIsContextNavigating] = useState(false);
  const [trackActionMenu, setTrackActionMenu] = useState(null);
  const position = progress?.position ?? 0;
  const duration = progress?.duration ?? 0;
  const remoteActive = progress?.remoteActive ?? false;
  const activeDeviceName = progress?.activeDeviceName ?? null;
  const queue = progress?.queue ?? [];

  const hasTrack = Boolean(currentTrack?.name);
  const controlsDisabled = !canUseAppPlayer || (!isReady && !remoteActive) || !hasTrack;

  useEffect(() => {
    if (!seeking) {
      setSeekValue(position || 0);
    }
  }, [position, seeking]);

  useEffect(() => {
    setVolumeValue(volume ?? 0.75);
  }, [volume]);

  const statusMessage = useMemo(() => {
    if (!isPremium) return null;
    if (hasPlaybackScope === false) {
      return 'Playback needs Spotify permissions. Reconnect to enable the in-app player.';
    }
    if (error) return error;
    if (!isReady && isConnecting) return 'Connecting to Spotify...';
    return null;
  }, [error, hasPlaybackScope, isConnecting, isPremium, isReady]);

  useEffect(() => {
    setIsContextNavigating(false);
  }, [location.pathname]);

  const closeTrackActionMenu = useCallback(() => {
    setTrackActionMenu(null);
  }, []);

  useEffect(() => {
    if (!trackActionMenu) return;
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        closeTrackActionMenu();
      }
    };
    const handleScroll = () => closeTrackActionMenu();
    window.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleScroll);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', handleScroll);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [closeTrackActionMenu, trackActionMenu]);

  const artistItems = useMemo(() => {
    if (Array.isArray(currentTrack?.artistItems) && currentTrack.artistItems.length > 0) {
      return currentTrack.artistItems;
    }
    if (Array.isArray(currentTrack?.artists) && currentTrack.artists.length > 0) {
      return currentTrack.artists.map((name) => ({ name, url: null }));
    }
    return [];
  }, [currentTrack]);

  const albumUrl = currentTrack?.albumExternalUrl
    || (currentTrack?.albumUri && currentTrack.albumUri.startsWith('spotify:album:')
      ? `https://open.spotify.com/album/${currentTrack.albumUri.replace('spotify:album:', '')}`
      : null)
    || (currentTrack?.albumId ? `https://open.spotify.com/album/${currentTrack.albumId}` : null);

  const canTrackAction = Boolean(currentContextPlaylist?.id && (currentTrack?.uri || currentTrack?.id));

  const openTrackActionMenu = useCallback((event) => {
    if (!currentTrack) return;
    event.preventDefault();
    const menuWidth = 220;
    const menuHeight = 160;
    const margin = 12;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
    const playerBar = typeof document !== 'undefined' ? document.querySelector('[data-player-bar]') : null;
    const playerBarHeight = playerBar ? playerBar.getBoundingClientRect().height : 0;
    const safeBottom = viewportHeight ? viewportHeight - playerBarHeight - margin : viewportHeight;
    const maxX = viewportWidth ? Math.max(margin, viewportWidth - menuWidth - margin) : event.clientX;
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const openDown = event.clientY + menuHeight + margin <= safeBottom;
    const x = viewportWidth ? clamp(event.clientX, margin, maxX) : event.clientX;
    const y = viewportHeight
      ? (openDown
        ? Math.min(event.clientY + margin, safeBottom - menuHeight)
        : Math.max(margin, event.clientY - menuHeight - margin))
      : event.clientY;
    setTrackActionMenu({ x, y });
  }, [currentTrack]);

  const openPlayerBarTrackAction = useCallback((mode) => {
    if (!canTrackAction) return;
    const targetPath = `/playlist/${currentContextPlaylist.id}`;
    if (location.pathname !== targetPath) {
      player?.markPlaylistNavPending?.(currentContextPlaylist);
      setIsContextNavigating(true);
    } else {
      setIsContextNavigating(false);
    }
    navigate(targetPath, {
      state: {
        trackAction: {
          mode,
          trackId: currentTrack?.id || null,
          trackUri: currentTrack?.uri || null,
        },
      },
    });
    closeTrackActionMenu();
  }, [canTrackAction, closeTrackActionMenu, currentContextPlaylist, currentTrack, location.pathname, navigate, player]);

  const openCurrentTrackInSpotify = useCallback(() => {
    if (!currentTrack) return;
    player?.openTrackInSpotify?.(currentTrack);
    closeTrackActionMenu();
  }, [closeTrackActionMenu, currentTrack, player]);

  const handleJumpToTrack = () => {
    // If we have playlist context, navigate to the playlist page
    if (currentContextPlaylist?.id) {
      const targetPath = `/playlist/${currentContextPlaylist.id}`;
      const isSameRoute = location.pathname === targetPath;
      if (!isSameRoute) {
        player?.markPlaylistNavPending?.(currentContextPlaylist);
        setIsContextNavigating(true);
        navigate(targetPath);
        return;
      }
    }
    
    // Otherwise try to scroll to track on current page
    if (typeof document === 'undefined') return;
    const targetIds = [currentTrack?.id, currentTrack?.linkedFromId].filter(Boolean);
    for (const targetId of targetIds) {
      const target = document.querySelector(`[data-track-id="${targetId}"], [data-track-linked-id="${targetId}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    const targetUris = [currentTrack?.uri, currentTrack?.linkedFromUri].filter(Boolean);
    for (const targetUri of targetUris) {
      const safeUri = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(targetUri) : targetUri.replace(/"/g, '\\"');
      const target = document.querySelector(`[data-track-uri="${safeUri}"], [data-track-linked-uri="${safeUri}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
  };

  useEffect(() => {
    let active = true;
    const loadQueuePrefs = async () => {
      try {
        const prefs = await preferencesAPI.getPreferences();
        if (!active) return;
        const modal = prefs?.queue_modal;
        if (modal && typeof modal === 'object') {
          if (Number.isFinite(modal.x) && Number.isFinite(modal.y)) {
            setQueueDrag({ x: modal.x, y: modal.y });
          }
          if (Number.isFinite(modal.height)) {
            setQueueHeight(modal.height);
          }
        }
      } catch (err) {
        // ignore preferences load errors
      } finally {
        // no-op
      }
    };
    loadQueuePrefs();
    return () => {
      active = false;
    };
  }, []);

  const persistQueuePrefs = useCallback((nextPosition, nextHeight) => {
    preferencesAPI.updatePreferences({
      queue_modal: {
        x: nextPosition.x,
        y: nextPosition.y,
        height: nextHeight,
      },
    }).catch(() => {
      // ignore preferences update errors
    });
  }, []);

  const handleQueuePointerDown = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('[data-no-drag]')) return;
    queueDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: queueDrag.x,
      originY: queueDrag.y,
    };
    setQueueDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleQueuePointerMove = (event) => {
    if (!queueDragRef.current) return;
    const { startX, startY, originX, originY } = queueDragRef.current;
    const nextX = originX + (event.clientX - startX);
    const nextY = originY + (event.clientY - startY);
    setQueueDrag({ x: nextX, y: nextY });
  };

  const handleQueuePointerUp = (event) => {
    if (!queueDragRef.current) return;
    queueDragRef.current = null;
    setQueueDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    persistQueuePrefs(queueDrag, queueHeight);
  };

  const handleQueueResizeEnd = () => {
    if (!queueModalRef.current) return;
    const nextHeight = queueModalRef.current.offsetHeight;
    if (Number.isFinite(nextHeight) && nextHeight !== queueHeight) {
      setQueueHeight(nextHeight);
      persistQueuePrefs(queueDrag, nextHeight);
    }
  };

  if (!isPremium) {
    return null;
  }

  const handleSeekChange = (event) => {
    const nextValue = Number(event.target.value);
    setSeekValue(nextValue);
  };

  const handleSeekStart = () => {
    setSeeking(true);
  };

  const handleSeekEnd = () => {
    setSeeking(false);
    seek(seekValue);
  };

  const handleVolumeChange = (event) => {
    const nextValue = Number(event.target.value);
    setVolumeValue(nextValue);
    setVolume(nextValue);
  };

  const handleReconnect = () => {
    window.location.href = `${API_BASE_URL}/auth/login?show_dialog=true`;
  };

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 bg-spotify-black/90 backdrop-blur-lg border-t border-spotify-gray-mid/60"
      data-player-bar
    >
      <div className="container mx-auto px-4 py-3 flex items-center gap-4">
        <div className="flex items-center gap-3 min-w-0 w-[32%]" onContextMenu={openTrackActionMenu}>
          <button
            type="button"
            onClick={handleJumpToTrack}
            className="w-14 h-14 rounded-md bg-spotify-gray-mid/60 overflow-hidden flex items-center justify-center flex-shrink-0"
            aria-label="Jump to current track in playlist"
          >
            {currentTrack?.albumArt ? (
              <img
                src={currentTrack.albumArt}
                alt={currentTrack.albumName || currentTrack.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="icon text-3xl text-spotify-gray-light">music_note</span>
            )}
          </button>
          <div className="min-w-0">
            <button
              type="button"
              onClick={handleJumpToTrack}
              className="flex items-center gap-2 text-sm text-white truncate text-left w-full"
              aria-label="Jump to current track in playlist"
            >
              <span className="truncate" title={currentTrack?.name || ''}>{currentTrack?.name || 'Nothing playing'}</span>
              {currentTrack?.explicit && (
                <div className="relative group flex-shrink-0">
                  <span className="text-[10px] font-semibold border border-spotify-gray-mid/60 text-spotify-gray-light w-5 h-5 rounded-full flex items-center justify-center">
                    E
                  </span>
                  <div className="tooltip tooltip-up group-hover:tooltip-visible">Explicit</div>
                </div>
              )}
            </button>
            <div className="text-xs text-spotify-gray-light truncate">
              {artistItems.length > 0 ? (
                artistItems.map((artist, index) => (
                  <span key={`${artist.name}-${index}`}>
                    {artist.url ? (
                      <a
                        href={artist.url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-white hover:underline"
                        onClick={(event) => event.stopPropagation()}
                        title={artist.name}
                      >
                        {artist.name}
                      </a>
                    ) : (
                      <span>{artist.name}</span>
                    )}
                    {index < artistItems.length - 1 ? ', ' : ''}
                  </span>
                ))
              ) : (
                'Pick a track to start playback'
              )}
            </div>
            {currentTrack?.albumName && (
              <div className="text-[11px] text-spotify-gray-light truncate">
                {albumUrl ? (
                  <a
                    href={albumUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-white hover:underline"
                    onClick={(event) => event.stopPropagation()}
                    title={currentTrack.albumName}
                  >
                    {currentTrack.albumName}
                  </a>
                ) : (
                  currentTrack.albumName
                )}
              </div>
            )}
            {currentContextPlaylist?.id && currentContextPlaylist?.name && (
              <button
                type="button"
                onClick={() => {
                  const targetPath = `/playlist/${currentContextPlaylist.id}`;
                  const isSameRoute = location.pathname === targetPath;
                  if (!isSameRoute) {
                    player?.markPlaylistNavPending?.(currentContextPlaylist);
                    setIsContextNavigating(true);
                  } else {
                    setIsContextNavigating(false);
                  }
                  navigate(targetPath);
                }}
                className="text-[11px] text-spotify-gray-light hover:text-white hover:underline text-left truncate"
                title={currentContextPlaylist.name}
              >
                {isContextNavigating ? 'Opening playlist…' : `From: ${currentContextPlaylist.name}`}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center flex-1 gap-2">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <button
                type="button"
                onClick={() => setShuffle?.(!shuffleEnabled)}
                disabled={!canUseAppPlayer}
                className={`text-spotify-gray-light hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
                  shuffleEnabled ? 'text-spotify-green' : ''
                }`}
                aria-label={shuffleEnabled ? 'Disable shuffle' : 'Enable shuffle'}
              >
                <span className="icon text-xl">shuffle</span>
              </button>
              <div className="tooltip tooltip-up group-hover:tooltip-visible">
                {shuffleEnabled ? 'Shuffle on' : 'Shuffle off'}
              </div>
            </div>
            <div className="relative group">
              <button
                type="button"
                onClick={previousTrack}
                disabled={controlsDisabled}
                className="text-spotify-gray-light hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Previous track"
              >
                <span className="icon text-2xl">skip_previous</span>
              </button>
              <div className="tooltip tooltip-up group-hover:tooltip-visible">Previous</div>
            </div>
            <div className="relative group">
              <button
                type="button"
                onClick={togglePlay}
                disabled={!canUseAppPlayer || (!isReady && !remoteActive) || !hasTrack}
                className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed transition-transform"
                aria-label={isPaused ? 'Play' : 'Pause'}
              >
                <span className="icon text-2xl">{isPaused ? 'play_arrow' : 'pause'}</span>
              </button>
              <div className="tooltip tooltip-up group-hover:tooltip-visible">{isPaused ? 'Play' : 'Pause'}</div>
            </div>
            <div className="relative group">
              <button
                type="button"
                onClick={nextTrack}
                disabled={controlsDisabled}
                className="text-spotify-gray-light hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Next track"
              >
                <span className="icon text-2xl">skip_next</span>
              </button>
              <div className="tooltip tooltip-up group-hover:tooltip-visible">Next</div>
            </div>
            <div className="relative group">
              <button
                type="button"
                onClick={() => {
                  const nextMode = repeatMode === 'off' ? 'context' : repeatMode === 'context' ? 'track' : 'off';
                  setRepeat?.(nextMode);
                }}
                disabled={!canUseAppPlayer}
                className={`text-spotify-gray-light hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
                  repeatMode !== 'off' ? 'text-spotify-green' : ''
                }`}
                aria-label="Repeat mode"
              >
                <span className="icon text-xl">{repeatMode === 'track' ? 'repeat_one' : 'repeat'}</span>
              </button>
              <div className="tooltip tooltip-up group-hover:tooltip-visible">
                {repeatMode === 'off' ? 'Repeat off' : repeatMode === 'context' ? 'Repeat all' : 'Repeat one'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full max-w-lg text-xs text-spotify-gray-light">
            <span className="w-10 text-right">{formatDuration(seekValue || 0)}</span>
            <input
              type="range"
              min="0"
              max={duration || 0}
              value={duration ? Math.min(seekValue, duration) : 0}
              onChange={handleSeekChange}
              onMouseDown={handleSeekStart}
              onMouseUp={handleSeekEnd}
              onTouchStart={handleSeekStart}
              onTouchEnd={handleSeekEnd}
              disabled={controlsDisabled || duration === 0}
              className="flex-1 accent-spotify-green h-1.5 cursor-pointer disabled:cursor-not-allowed"
              aria-label="Seek position"
            />
            <span className="w-10">{formatDuration(duration || 0)}</span>
          </div>
        </div>

        <div className="hidden md:flex items-center justify-end gap-3 w-[28%]">
          <div className="relative group">
            <button
              type="button"
              onClick={() => setShowQueue(true)}
              className="text-spotify-gray-light hover:text-white transition-colors"
              aria-label="Show queue"
            >
              <span className="icon text-xl">queue_music</span>
            </button>
            <div className="tooltip tooltip-up group-hover:tooltip-visible">Queue</div>
          </div>
          <div className="relative group">
            <button
              type="button"
              onClick={toggleMute}
              disabled={!canUseAppPlayer || (!isReady && !remoteActive)}
              className="text-spotify-gray-light hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              <span className="icon text-xl text-spotify-gray-light">
                {isMuted ? 'volume_off' : 'volume_up'}
              </span>
            </button>
            <div className="tooltip tooltip-up group-hover:tooltip-visible">{isMuted ? 'Unmute' : 'Mute'}</div>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volumeValue}
            onChange={handleVolumeChange}
            disabled={!canUseAppPlayer || (!isReady && !remoteActive)}
            className="accent-spotify-green h-1.5 w-28 cursor-pointer disabled:cursor-not-allowed"
            aria-label="Volume"
          />
          <div className="relative group">
            {remoteActive ? (
              <button
                type="button"
                onClick={() => player?.transferToApp?.()}
                className="text-[11px] text-spotify-green border border-spotify-green/60 rounded-full px-2 py-1 hover:bg-spotify-green/10 transition-colors"
              >
                Play here
              </button>
            ) : (
              <span className="text-[11px] text-spotify-gray-light border border-spotify-gray-mid/60 rounded-full px-2 py-1">
                This app
              </span>
            )}
            <div className="tooltip tooltip-up group-hover:tooltip-visible">
              {remoteActive && activeDeviceName ? `Playing on ${activeDeviceName}` : 'Playing in Playlist Polisher'}
            </div>
          </div>
        </div>
      </div>

      {statusMessage && (
        <div className="border-t border-spotify-gray-mid/50 bg-spotify-black/70">
          <div className="container mx-auto px-4 py-2 text-xs text-spotify-gray-light flex items-center justify-between">
            <span>{statusMessage}</span>
            {hasPlaybackScope === false && (
              <button
                type="button"
                onClick={handleReconnect}
                className="px-3 py-1 rounded-full bg-spotify-green text-black font-semibold hover:bg-spotify-green-dark transition-colors"
              >
                Reconnect
              </button>
            )}
          </div>
        </div>
      )}

      {trackActionMenu && (
        <div className="fixed inset-0 z-[70]" onClick={closeTrackActionMenu}>
          <div
            key={`${trackActionMenu.x}-${trackActionMenu.y}`}
            data-context-menu
            className="absolute w-72 max-h-[400px] overflow-y-auto bg-spotify-gray-dark border border-spotify-gray-mid/60 rounded-xl shadow-2xl p-2 text-sm text-spotify-gray-light animate-fade-in"
            style={{ top: trackActionMenu.y, left: trackActionMenu.x }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              onClick={() => {
                if (togglePlay) togglePlay();
                closeTrackActionMenu();
              }}
              disabled={!canUseAppPlayer || (!isReady && !remoteActive) || !hasTrack}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-spotify-gray-mid/60 text-white ${
                !canUseAppPlayer || (!isReady && !remoteActive) || !hasTrack ? 'opacity-40 cursor-not-allowed' : ''
              }`}
            >
              <span className="icon text-base">play_arrow</span>
              Play selection
            </button>
            <button
              type="button"
              onClick={() => openPlayerBarTrackAction('add')}
              disabled={!canTrackAction}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-spotify-gray-mid/60 ${
                !canTrackAction ? 'opacity-40 cursor-not-allowed' : ''
              }`}
            >
              <span className="icon text-base">playlist_add</span>
              Add to playlist
            </button>
            <button
              type="button"
              onClick={() => openPlayerBarTrackAction('move')}
              disabled={!canTrackAction}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-spotify-gray-mid/60 ${
                !canTrackAction ? 'opacity-40 cursor-not-allowed' : ''
              }`}
            >
              <span className="icon text-base">drive_file_move</span>
              Move to playlist
            </button>
            <button
              type="button"
              onClick={() => openPlayerBarTrackAction('remove')}
              disabled={!canTrackAction}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-spotify-gray-mid/60 text-red-300 ${
                !canTrackAction ? 'opacity-40 cursor-not-allowed' : ''
              }`}
            >
              <span className="icon text-base">delete</span>
              Remove from this playlist
            </button>
            <button
              type="button"
              onClick={openCurrentTrackInSpotify}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-spotify-gray-mid/60"
            >
              <span className="icon text-base">share</span>
              Share track
            </button>
          </div>
        </div>
      )}

      {showQueue && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm px-4">
          <div
            ref={queueModalRef}
            className="fixed top-1/2 left-1/2 bg-spotify-gray-dark rounded-2xl shadow-2xl max-w-lg w-full border border-spotify-gray-mid/60 flex flex-col overflow-hidden relative"
            style={{
              transform: `translate(-50%, -50%) translate(${queueDrag.x}px, ${queueDrag.y}px)`,
              resize: 'vertical',
              height: `${queueHeight}px`,
              minHeight: '420px',
              maxHeight: '80vh',
            }}
            onMouseUp={handleQueueResizeEnd}
            onPointerUp={handleQueueResizeEnd}
          >
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-12 h-1 rounded-full bg-spotify-gray-mid/60" />
            <div
              className={`flex items-center justify-between p-5 border-b border-spotify-gray-mid/60 ${
                queueDragging ? 'cursor-grabbing' : 'cursor-grab'
              }`}
              onPointerDown={handleQueuePointerDown}
              onPointerMove={handleQueuePointerMove}
              onPointerUp={handleQueuePointerUp}
              onPointerCancel={handleQueuePointerUp}
            >
              <div>
                <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Queue</p>
                <h3 className="text-xl font-semibold text-white">Up next</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowQueue(false)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-spotify-gray-light hover:text-white hover:bg-spotify-gray-mid/60"
                data-no-drag
              >
                <span className="icon text-lg">close</span>
              </button>
            </div>
            <div className="p-5 overflow-y-auto scrollbar-thin flex-1 min-h-[320px] space-y-2">
              {queue.length === 0 ? (
                <div className="text-sm text-spotify-gray-light">Queue is empty.</div>
              ) : (
                queue.map((item, idx) => (
                  <button
                    key={`${item.id || item.uri}-${idx}`}
                    type="button"
                    onClick={() => {
                      if (currentContextUri && item?.uri) {
                        player?.playTrack?.({ track: item, contextUri: currentContextUri, offsetUri: item.uri });
                      } else {
                        player?.playTrack?.({ track: item });
                      }
                      setShowQueue(false);
                    }}
                    className="w-full flex items-center gap-3 text-left rounded-xl px-2 py-2 hover:bg-spotify-gray-mid/40 transition-colors group"
                  >
                    <div className="w-12 h-12 rounded-md bg-spotify-gray-mid/60 overflow-hidden flex-shrink-0 relative">
                      {item.album?.images?.[0]?.url ? (
                        <img
                          src={item.album.images[0].url}
                          alt={item.album?.name || item.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="icon text-lg text-spotify-gray-light">music_note</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="icon text-white text-lg">play_arrow</span>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate" title={item.name || ''}>{item.name}</p>
                      <p className="text-xs text-spotify-gray-light truncate">
                        {(item.artists || []).map((artist) => artist.name).filter(Boolean).join(', ') || 'Unknown artist'}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlayerBar;
