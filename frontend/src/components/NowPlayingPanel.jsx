import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import usePlayerContext from '../context/usePlayerContext';
import usePlayerProgressContext from '../context/usePlayerProgressContext';
import { cacheAPI, formatDuration, preferencesAPI } from '../services/api';

const escapeSelectorValue = (value) => {
  const text = String(value);
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(text);
  }
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
};

const NowPlayingPanel = () => {
  const player = usePlayerContext();
  const progress = usePlayerProgressContext();
  const navigate = useNavigate();
  const location = useLocation();
  const { currentTrack, currentContextPlaylist, openTrackInSpotify } = player || {};
  const remoteActive = progress?.remoteActive ?? false;
  const activeDeviceName = progress?.activeDeviceName ?? null;
  const [showDetails, setShowDetails] = useState(false);
  const [isContextNavigating, setIsContextNavigating] = useState(false);
  const [otherPlaylists, setOtherPlaylists] = useState(null);
  const [otherPlaylistsLoading, setOtherPlaylistsLoading] = useState(false);
  const [otherPlaylistsError, setOtherPlaylistsError] = useState(null);
  const [showOtherPlaylists, setShowOtherPlaylists] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const otherPlaylistsHoverTimer = useRef(null);

  const releaseDate = useMemo(() => {
    if (!currentTrack?.albumReleaseDate) return null;
    if (currentTrack?.albumReleasePrecision === 'year') {
      return currentTrack.albumReleaseDate.slice(0, 4);
    }
    if (currentTrack?.albumReleasePrecision === 'month') {
      return currentTrack.albumReleaseDate.slice(0, 7);
    }
    return currentTrack.albumReleaseDate;
  }, [currentTrack?.albumReleaseDate, currentTrack?.albumReleasePrecision]);

  const releaseType = currentTrack?.albumType
    ? currentTrack.albumType.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
    : null;
  const albumTrackCount = currentTrack?.albumTotalTracks ?? null;
  const popularity = typeof currentTrack?.popularity === 'number' ? `${currentTrack.popularity}/100` : null;
  const durationValue = currentTrack?.durationMs || 0;
  const durationLabel = durationValue ? formatDuration(durationValue) : null;
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
  const handleJumpToTrack = () => {
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
      const safeUri = escapeSelectorValue(targetUri);
      const target = document.querySelector(`[data-track-uri="${safeUri}"], [data-track-linked-uri="${safeUri}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
  };

  useEffect(() => {
    setIsContextNavigating(false);
  }, [location.pathname]);

  useEffect(() => {
    setOtherPlaylists(null);
    setOtherPlaylistsError(null);
    setShowOtherPlaylists(false);
  }, [currentTrack?.id, currentTrack?.linkedFromId]);

  useEffect(() => {
    return () => {
      if (otherPlaylistsHoverTimer.current) {
        clearTimeout(otherPlaylistsHoverTimer.current);
      }
    };
  }, []);

  const loadOtherPlaylists = async () => {
    const trackId = currentTrack?.linkedFromId || currentTrack?.id;
    if (!trackId || otherPlaylistsLoading || otherPlaylists) return;
    setOtherPlaylistsLoading(true);
    setOtherPlaylistsError(null);
    try {
      const data = await cacheAPI.getTrackPlaylists(trackId);
      setOtherPlaylists(Array.isArray(data?.playlists) ? data.playlists : []);
    } catch (err) {
      setOtherPlaylistsError(err.message || 'Unable to load playlists');
    } finally {
      setOtherPlaylistsLoading(false);
    }
  };

  useEffect(() => {
    if (!showDetails) {
      setShowOtherPlaylists(false);
      return;
    }
    loadOtherPlaylists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDetails, currentTrack?.id, currentTrack?.linkedFromId]);

  useEffect(() => {
    let active = true;
    const loadPreferences = async () => {
      try {
        const prefs = await preferencesAPI.getPreferences();
        if (!active) return;
        if (typeof prefs?.now_playing_details_open === 'boolean') {
          setShowDetails(prefs.now_playing_details_open);
        }
      } catch (err) {
        // ignore preferences load errors
      }
    };
    loadPreferences();
    return () => {
      active = false;
    };
  }, []);
  const handleToggleDetails = () => {
    setShowDetails((prev) => {
      const next = !prev;
      preferencesAPI.updatePreferences({ now_playing_details_open: next }).catch(() => {
        // ignore preferences update errors
      });
      return next;
    });
  };

  const otherPlaylistsList = useMemo(() => {
    if (!Array.isArray(otherPlaylists)) return [];
    return otherPlaylists.filter((pl) => pl?.id && pl.id !== currentContextPlaylist?.id);
  }, [currentContextPlaylist?.id, otherPlaylists]);

  const shouldShowOtherPlaylists = showDetails
    && (otherPlaylistsError || otherPlaylistsList.length > 0);

  const handleOtherPlaylistsEnter = () => {
    if (otherPlaylistsHoverTimer.current) {
      clearTimeout(otherPlaylistsHoverTimer.current);
    }
    setShowOtherPlaylists(true);
    loadOtherPlaylists();
  };

  const handleOtherPlaylistsLeave = () => {
    if (otherPlaylistsHoverTimer.current) {
      clearTimeout(otherPlaylistsHoverTimer.current);
    }
    otherPlaylistsHoverTimer.current = setTimeout(() => {
      setShowOtherPlaylists(false);
    }, 200);
  };

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const openContextMenu = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();

    const menuMinWidth = 288;
    const menuMaxHeight = 400;
    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Use exact click position
    let anchorX = event.clientX;
    let anchorY = event.clientY;

    // Horizontal positioning: try to place menu to the left of anchor point
    let x = anchorX - menuMinWidth - 8;

    // If menu goes off left edge, place to the right instead
    if (x < margin) {
      x = anchorX + 8;
    }

    // If still goes off right edge, clamp it
    if (x + menuMinWidth > viewportWidth - margin) {
      x = viewportWidth - menuMinWidth - margin;
    }

    // Vertical positioning: start at anchor point
    let y = anchorY;

    // If menu goes off bottom, shift it up
    if (y + menuMaxHeight > viewportHeight - margin) {
      y = viewportHeight - menuMaxHeight - margin;
    }

    // If menu goes off top, clamp to margin
    if (y < margin) {
      y = margin;
    }

    setContextMenu({ x, y });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };
    const handleClick = (event) => {
      if (!event.target.closest('[data-context-menu]')) {
        closeContextMenu();
      }
    };
    const handleScroll = () => closeContextMenu();
    window.addEventListener('keydown', handleKey);
    window.addEventListener('click', handleClick, true);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('click', handleClick, true);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [closeContextMenu, contextMenu]);

  if (!currentTrack) {
    return null;
  }

  return (
    <aside className="hidden xl:block">
      <div className="sticky top-24 bg-spotify-gray-dark/70 border border-spotify-gray-mid/60 rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          {remoteActive && activeDeviceName && (
            <div className="flex items-center gap-2 text-xs">
              <span className="icon text-sm text-spotify-green">cast</span>
              <div className="flex flex-col min-w-0">
                <span className="text-spotify-gray-light truncate">Playing on</span>
                <span className="text-white font-medium truncate">{activeDeviceName}</span>
              </div>
            </div>
          )}
          <div className={`relative group ${remoteActive ? '' : 'ml-auto'}`}>
            <button
              type="button"
              onClick={handleToggleDetails}
              className={`w-9 h-9 rounded-lg border ${
                showDetails
                  ? 'bg-spotify-green/20 text-spotify-green border-spotify-green/60'
                  : 'bg-spotify-gray-dark/40 text-spotify-gray-light border-spotify-gray-mid/60 hover:text-white'
              } flex items-center justify-center transition-colors`}
              aria-label={showDetails ? 'Hide track details' : 'Show track details'}
            >
              <span className="icon text-sm">library_music</span>
            </button>
            <div className="tooltip tooltip-up group-hover:tooltip-visible">
              {showDetails ? 'Hide details' : 'Show details'}
            </div>
          </div>
        </div>
        <div className="mt-4">
          <button
            type="button"
            onClick={handleJumpToTrack}
            onContextMenu={openContextMenu}
            className="aspect-square rounded-xl overflow-hidden bg-spotify-gray-mid/60 shadow-lg w-full"
            aria-label="Jump to current track in playlist"
          >
            {currentTrack.albumArt ? (
              <img
                src={currentTrack.albumArt}
                alt={currentTrack.albumName || currentTrack.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="icon text-5xl text-spotify-gray-light">music_note</span>
              </div>
            )}
          </button>
          <div className="mt-4">
            <button
              type="button"
              onClick={handleJumpToTrack}
              onContextMenu={openContextMenu}
              className="w-full text-left"
              aria-label="Jump to current track in playlist"
            >
              <div className="flex items-center gap-2 text-white font-semibold text-lg min-w-0">
                <span className="truncate" title={currentTrack.name || ''}>
                  {currentTrack.name}
                </span>
                {currentTrack.explicit && (
                  <div className="relative group flex-shrink-0">
                    <span className="text-[10px] font-semibold border border-spotify-gray-mid/60 text-spotify-gray-light w-5 h-5 rounded-full flex items-center justify-center">
                      E
                    </span>
                    <div className="tooltip tooltip-up group-hover:tooltip-visible">Explicit</div>
                  </div>
                )}
              </div>
            </button>
            <div className="text-spotify-gray-light text-sm truncate" onContextMenu={openContextMenu}>
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
                'Unknown artist'
              )}
            </div>
            {currentTrack.albumName && (
              <div className="text-spotify-gray-light text-xs mt-1 truncate" onContextMenu={openContextMenu}>
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
          </div>
          {showDetails && (
            <div className="mt-4 space-y-3">
              <div className="grid gap-2 text-xs text-spotify-gray-light">
                {releaseDate && (
                  <div className="flex items-center justify-between gap-3">
                    <span>Release date</span>
                    <span className="text-white">{releaseDate}</span>
                  </div>
                )}
                {releaseType && (
                  <div className="flex items-center justify-between gap-3">
                    <span>Release type</span>
                    <span className="text-white">{releaseType}</span>
                  </div>
                )}
                {albumTrackCount !== null && (
                  <div className="flex items-center justify-between gap-3">
                    <span>Album tracks</span>
                    <span className="text-white">{albumTrackCount}</span>
                  </div>
                )}
                {popularity && (
                  <div className="flex items-center justify-between gap-3">
                    <span>Popularity</span>
                    <span className="text-white">{popularity}</span>
                  </div>
                )}
                {durationLabel && (
                  <div className="flex items-center justify-between gap-3">
                    <span>Duration</span>
                    <span className="text-white">{durationLabel}</span>
                  </div>
                )}
              </div>
              {(currentContextPlaylist?.id || shouldShowOtherPlaylists) && (
                <div className="flex items-center gap-2">
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
                      className="text-spotify-gray-light text-xs truncate hover:text-white hover:underline text-left"
                      title={currentContextPlaylist.name}
                    >
                      {isContextNavigating ? 'Opening playlist…' : `From: ${currentContextPlaylist.name}`}
                    </button>
                  )}
                  {shouldShowOtherPlaylists && (
                    <div
                      className="relative"
                      onMouseEnter={handleOtherPlaylistsEnter}
                      onMouseLeave={handleOtherPlaylistsLeave}
                    >
                      <button
                        type="button"
                        className="text-[10px] text-spotify-gray-light border border-spotify-gray-mid/60 rounded-full px-2 py-0.5 hover:text-white hover:border-spotify-gray-light"
                        aria-label="Show other playlists containing this track"
                      >
                        Also in
                      </button>
                      {showOtherPlaylists && (
                        <div
                          className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-max max-w-[240px] bg-spotify-gray-dark/95 border border-spotify-gray-mid/60 rounded-lg p-3 shadow-xl text-xs text-spotify-gray-light z-40 break-words"
                          onMouseEnter={handleOtherPlaylistsEnter}
                          onMouseLeave={handleOtherPlaylistsLeave}
                        >
                          {otherPlaylistsLoading && 'Loading playlists…'}
                          {!otherPlaylistsLoading && otherPlaylistsError && otherPlaylistsError}
                          {!otherPlaylistsLoading && !otherPlaylistsError && (
                            otherPlaylistsList.length > 0
                              ? (
                                <div className="space-y-1">
                                  {otherPlaylistsList.slice(0, 6).map((pl) => (
                                    <button
                                      key={pl.id}
                                      type="button"
                                      onClick={() => navigate(`/playlist/${pl.id}`)}
                                      className="block w-full text-left text-xs text-white hover:underline"
                                      title={pl.name}
                                    >
                                      {pl.name}
                                    </button>
                                  ))}
                                </div>
                              )
                              : 'No other cached playlists'
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {openTrackInSpotify && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openTrackInSpotify?.(currentTrack)}
                    className="px-3 py-2 rounded-full border border-spotify-gray-mid/60 text-xs text-spotify-gray-light hover:text-white hover:border-spotify-gray-light transition-colors"
                  >
                    Open in Spotify
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {contextMenu && currentTrack && (
        <div className="fixed inset-0 z-[70] pointer-events-none">
          <div
            key={`${contextMenu.x}-${contextMenu.y}`}
            data-context-menu
            className="absolute w-72 max-h-[400px] overflow-y-auto bg-spotify-gray-dark border border-spotify-gray-mid/60 rounded-xl shadow-2xl p-2 text-sm text-spotify-gray-light pointer-events-auto animate-fade-in"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              onClick={() => {
                handleJumpToTrack();
                closeContextMenu();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-spotify-gray-mid/60 text-white"
            >
              <span className="icon text-base">my_location</span>
              Jump to track in playlist
            </button>
            <button
              type="button"
              onClick={() => {
                if (openTrackInSpotify) {
                  openTrackInSpotify();
                }
                closeContextMenu();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-spotify-gray-mid/60"
            >
              <span className="icon text-base">share</span>
              Share track
            </button>
          </div>
        </div>
      )}
    </aside>
  );
};

export default NowPlayingPanel;
