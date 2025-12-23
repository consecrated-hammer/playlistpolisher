/**
 * Playlist View Component
 * 
 * Displays detailed playlist information and all tracks.
 * Shows playlist metadata, cover art, and a table of tracks.
 * Supports client-side sorting by clicking column headers.
 * 
 * Props:
 *   - playlist: Detailed playlist object with tracks
 *   - onBack: Handler to return to playlist list
 */

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import * as Tooltip from '@radix-ui/react-tooltip';
import { getBestImage, formatDuration, sortAPI, playlistAPI, ignoreAPI, preferencesAPI, cacheAPI, playerAPI } from '../services/api';
import LoadingSpinner from './LoadingSpinner';
import usePlayerContext from '../context/usePlayerContext';
import useInfiniteScroll from '../hooks/useInfiniteScroll';
import { PLAYLIST_PAGE_SIZE } from '../config';

const PlaylistView = ({ playlist, onBack, globalJob, setGlobalJob, globalJobStatus, setGlobalJobStatus, onDedupeStatusChange }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const player = usePlayerContext();
  const [currentPlaylist, setCurrentPlaylist] = useState(playlist);
  const [sortBy, setSortBy] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');
  const [showSortModal, setShowSortModal] = useState(false);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);
  const [sortForm, setSortForm] = useState({
    sort_by: 'date_added',
    direction: 'desc',
    method: 'preserve',
  });
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({
    name: playlist?.name || '',
    description: playlist?.description || ''
  });
  const [analysis, setAnalysis] = useState(null);
  const [duplicates, setDuplicates] = useState(null);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [duplicatesError, setDuplicatesError] = useState(null);
  const [duplicatesSelection, setDuplicatesSelection] = useState({});
  const [duplicatesMode, setDuplicatesMode] = useState('options'); // options | review
  const [optionsDirty, setOptionsDirty] = useState(false);
  const [showOptionsPanel, setShowOptionsPanel] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [detailsOpen, setDetailsOpen] = useState({});
  const [showAlbumMeta, setShowAlbumMeta] = useState(false);
  const [showIgnoreModal, setShowIgnoreModal] = useState(false);
  const [ignoreTarget, setIgnoreTarget] = useState(null);
  const [ignoringPair, setIgnoringPair] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef(null);
  const trackActionPendingRef = useRef(null);
  const [selectedTrackKeys, setSelectedTrackKeys] = useState([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [trackActionMode, setTrackActionMode] = useState(null);
  const [trackActionOpen, setTrackActionOpen] = useState(false);
  const [trackActionLoading, setTrackActionLoading] = useState(false);
  const [trackActionError, setTrackActionError] = useState(null);
  const [targetPlaylists, setTargetPlaylists] = useState([]);
  const [targetPlaylistsLoading, setTargetPlaylistsLoading] = useState(false);
  const [targetPlaylistsError, setTargetPlaylistsError] = useState(null);
  const [playlistMatchSummaries, setPlaylistMatchSummaries] = useState({});
  const [playlistMatchSummariesLoading, setPlaylistMatchSummariesLoading] = useState(false);
  const [playlistMatchSummariesError, setPlaylistMatchSummariesError] = useState(null);
  const [targetPlaylistFacts, setTargetPlaylistFacts] = useState({});
  const [targetPlaylistFactsSummary, setTargetPlaylistFactsSummary] = useState({ facts_count: 0, coverage_ratio: 0 });
  const [targetPlaylistSortOption, setTargetPlaylistSortOption] = useState('default');
  const [targetPlaylistSortSpinner, setTargetPlaylistSortSpinner] = useState(false);
  const [targetPlaylistId, setTargetPlaylistId] = useState('');
  const [targetPlaylistQuery, setTargetPlaylistQuery] = useState('');
  const [targetPlaylistMatch, setTargetPlaylistMatch] = useState(null);
  const [targetPlaylistMatchLoading, setTargetPlaylistMatchLoading] = useState(false);
  const [targetPlaylistMatchError, setTargetPlaylistMatchError] = useState(null);
  const [skipExistingTracks, setSkipExistingTracks] = useState(true);
  const [showMatchDetails, setShowMatchDetails] = useState(false);
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false);
  const [createPlaylistName, setCreatePlaylistName] = useState('');
  const [createPlaylistDescription, setCreatePlaylistDescription] = useState('');
  const [createPlaylistPublic, setCreatePlaylistPublic] = useState(true);

  // Infinite scroll pagination state
  const [allTracks, setAllTracks] = useState([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreTracks, setHasMoreTracks] = useState(false);
  const [totalTrackCount, setTotalTrackCount] = useState(0);
  const [cacheStats, setCacheStats] = useState({ user_tracks: 0, user_expired: 0, total_tracks: 0 });

  const Tip = ({ label, side = 'top', align = 'center', children }) => (
    <Tooltip.Root delayDuration={100}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} align={align} className="radix-tooltip" sideOffset={8}>
          {label}
          <Tooltip.Arrow className="fill-[#1b1b1b]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
  const [removingDuplicates, setRemovingDuplicates] = useState(false);
  const [includeSimilar, setIncludeSimilar] = useState(false);
  const [keepStrategy, setKeepStrategy] = useState('earliest'); // earliest | latest
  const [preferAlbumRelease, setPreferAlbumRelease] = useState(false);
  const [albumReleaseBias, setAlbumReleaseBias] = useState('earliest'); // earliest | latest
  const selectedCount = useMemo(() => {
    let total = 0;
    Object.values(duplicatesSelection || {}).forEach((sel) => {
      total += (sel.removePositions || []).length;
    });
    return total;
  }, [duplicatesSelection]);
  // Use global job state if it matches this playlist, otherwise use local
  const job = globalJob?.playlist_id === playlist.id ? globalJob : null;
  const setJob = (newJob) => {
    if (newJob) {
      setGlobalJob({ ...newJob, playlist_id: playlist.id, playlist_name: currentPlaylist.name });
    } else {
      setGlobalJob(null);
    }
  };
  const jobStatus = globalJobStatus?.playlist_id === playlist.id ? globalJobStatus : null;
  const setJobStatus = (newStatus) => {
    if (newStatus) {
      setGlobalJobStatus({ ...newStatus, playlist_id: playlist.id, playlist_name: currentPlaylist.name });
    } else if (globalJobStatus?.playlist_id === playlist.id) {
      setGlobalJobStatus(null);
    }
  };
  const [jobError, setJobError] = useState(null);
  const [editMessage, setEditMessage] = useState(null);
  const [editError, setEditError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [startingSort, setStartingSort] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [history, setHistory] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [schedulesOpen, setSchedulesOpen] = useState(false);
  const schedulesHoverTimer = useRef(null);
  const sortSpinnerTimer = useRef(null);

  useEffect(() => {
    const active = duplicatesLoading || removingDuplicates;
    const detail = duplicatesLoading ? 'Analyzing duplicates' : removingDuplicates ? 'Removing duplicates' : null;
    if (onDedupeStatusChange) {
      onDedupeStatusChange({ active, detail });
    }
    return () => {
      if (onDedupeStatusChange) {
        onDedupeStatusChange({ active: false, detail: null });
      }
    };
  }, [duplicatesLoading, removingDuplicates, onDedupeStatusChange]);

  useEffect(() => {
    if (showDuplicatesModal) {
      setDuplicatesMode('options');
      setOptionsDirty(false);
      setShowOptionsPanel(false);
      setCollapsedGroups({});
      setDetailsOpen({});
      setDuplicates(null);
      setDuplicatesSelection({});
      setDuplicatesError(null);
    }
  }, [showDuplicatesModal]);

  const fetchHistory = async (playlistId) => {
    if (!playlistId) return;
    try {
      const res = await playlistAPI.getHistory(playlistId);
      setHistory(res.history || []);
    } catch (e) {
      // non-blocking; just log to console in dev
      if (import.meta.env.DEV) {
        console.error('History fetch failed', e);
      }
    }
  };

  const fetchSchedules = async (playlistId) => {
    if (!playlistId) return;
    try {
      const res = await playlistAPI.listPlaylistSchedules(playlistId);
      setSchedules(Array.isArray(res) ? res : []);
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error('Schedule fetch failed', e);
      }
      // Even on error, keep any previously loaded schedules
    }
  };

  useEffect(() => {
    setCurrentPlaylist(playlist);
    setEditForm({
      name: playlist?.name || '',
      description: playlist?.description || ''
    });
    // Initialize tracks from the initial playlist load
    if (playlist?.tracks) {
      console.log('[Infinite Scroll] Initial playlist load:', {
        tracksReceived: playlist.tracks.length,
        totalTracks: playlist.total_tracks,
        willLoadMore: playlist.tracks.length >= PLAYLIST_PAGE_SIZE
      });
      
      setAllTracks(playlist.tracks);
      setTotalTrackCount(playlist.total_tracks || playlist.tracks.length);
      // Check if we need to load more (if initial load has exactly the page size, there might be more)
      const shouldLoadMore = playlist.total_tracks 
        ? playlist.tracks.length < playlist.total_tracks
        : playlist.tracks.length >= PLAYLIST_PAGE_SIZE;
      setHasMoreTracks(shouldLoadMore);
    }
    // fetch history for this playlist
    fetchHistory(playlist?.id);
    fetchSchedules(playlist?.id);
  }, [playlist]);

  useEffect(() => {
    let active = true;
    const loadPrefs = async () => {
      try {
        const prefs = await preferencesAPI.getPreferences();
        if (!active) return;
        if (typeof prefs?.playlist_action_details_open === 'boolean') {
          setShowMatchDetails(prefs.playlist_action_details_open);
        }
        if (typeof prefs?.playlist_album_details_open === 'boolean') {
          setShowAlbumMeta(prefs.playlist_album_details_open);
        }
      } catch (err) {
        // ignore preference load errors
      }
    };
    loadPrefs();
    return () => {
      active = false;
    };
  }, []);

  const updateAlbumDetailsPreference = useCallback((next) => {
    setShowAlbumMeta(next);
    preferencesAPI.updatePreferences({ playlist_album_details_open: next }).catch(() => {
      // ignore preference update errors
    });
  }, []);

  useEffect(() => {
    setSelectedTrackKeys([]);
    setLastSelectedIndex(null);
  }, [currentPlaylist?.id]);

  useEffect(() => {
    setCreatePlaylistName(currentPlaylist?.name ? `${currentPlaylist.name} (selection)` : 'New playlist');
    setCreatePlaylistDescription('');
    setCreatePlaylistPublic(currentPlaylist?.public ?? true);
  }, [currentPlaylist?.id, currentPlaylist?.name, currentPlaylist?.public]);

  // Fetch cache stats on mount and when playlist changes
  useEffect(() => {
    const fetchCacheStats = async () => {
      if (!currentPlaylist?.id) {
        setCacheStats({ user_tracks: 0, user_expired: 0, total_tracks: 0 });
        return;
      }
      
      try {
        const stats = await cacheAPI.getPlaylistCacheStats(currentPlaylist.id);
        setCacheStats({
          user_tracks: stats.user_cached_tracks || 0,
          user_expired: stats.user_expired_tracks || 0,
          total_tracks: stats.total_cached_tracks || 0
        });
      } catch (err) {
        // Silently fail - cache stats are non-critical
        console.warn('Failed to fetch playlist cache stats:', err);
      }
    };
    fetchCacheStats();
  }, [currentPlaylist?.id]);

  // Load more tracks for infinite scroll
  const loadMoreTracks = useCallback(async () => {
    if (loadingMore || !hasMoreTracks || !currentPlaylist?.id) return;

    console.log('[Infinite Scroll] Loading more tracks...', {
      currentCount: allTracks.length,
      hasMore: hasMoreTracks,
      playlistId: currentPlaylist?.id
    });

    setLoadingMore(true);
    try {
      const offset = allTracks.length;
      const response = await playlistAPI.getPlaylistTracksPaginated(
        currentPlaylist.id,
        offset,
        PLAYLIST_PAGE_SIZE
      );

      console.log('[Infinite Scroll] Loaded tracks:', {
        received: response.tracks.length,
        offset: response.offset,
        total: response.total,
        hasMore: response.has_more,
        cacheStats: response.cache_info
      });

      if (response.tracks && response.tracks.length > 0) {
        setAllTracks(prev => {
          // Deduplicate by track ID + position to prevent duplicates from rapid scrolling
          const existingIds = new Set(prev.map((t, idx) => `${t.id}-${idx}`));
          const newTracks = response.tracks.filter((t, idx) => {
            const key = `${t.id}-${offset + idx}`;
            return !existingIds.has(key);
          });
          return [...prev, ...newTracks];
        });
        setHasMoreTracks(response.has_more);
        setTotalTrackCount(response.total);
      } else {
        setHasMoreTracks(false);
      }
    } catch (err) {
      console.error('[Infinite Scroll] Failed to load more tracks:', err);
      setHasMoreTracks(false);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMoreTracks, currentPlaylist?.id, allTracks.length]);

  // Set up infinite scroll - trigger at 20% from bottom (80% scrolled)
  useInfiniteScroll(loadMoreTracks, hasMoreTracks, loadingMore, 0.2);

  // Format date and time for display
  const formatDateTime = (isoString) => {
    if (!isoString) return 'Unknown';
    const date = new Date(isoString);
    const dateStr = date.toLocaleDateString('en-AU', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
    const timeStr = date.toLocaleTimeString('en-AU', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true
    });
    return `${dateStr}, ${timeStr}`;
  };

  const formatReleaseDate = (dateString, precision) => {
    if (!dateString) return '—';
    const prec = (precision || '').toLowerCase();
    if (prec === 'year') return dateString.slice(0, 4);
    if (prec === 'month') return dateString.slice(0, 7);
    const parsed = new Date(`${dateString}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return dateString;
    return parsed.toLocaleDateString('en-AU', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Handle column header click for sorting
  const handleSort = (column) => {
    if (sortBy === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to ascending
      setSortBy(column);
      setSortDirection('asc');
    }
  };

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    return () => {
      if (sortSpinnerTimer.current) {
        clearTimeout(sortSpinnerTimer.current);
      }
    };
  }, []);

  // Sort tracks based on current sort state
  const tracksSource = useMemo(() => {
    return allTracks.map((track, index) => ({
      ...track,
      playlistIndex: index,
      selectionKey: `${track.id || track.uri || 'track'}-${index}`,
    }));
  }, [allTracks]);

  const filteredTracks = useMemo(() => {
    if (!searchQuery) return tracksSource;
    const query = searchQuery.toLowerCase();
    return tracksSource.filter((track) => {
      const nameMatch = track.name?.toLowerCase().includes(query);
      const albumMatch = track.album?.name?.toLowerCase().includes(query);
      const artistMatch = (track.artists || []).some((artist) => artist.name?.toLowerCase().includes(query));
      return nameMatch || albumMatch || artistMatch;
    });
  }, [searchQuery, tracksSource]);

  const sortedTracks = useMemo(() => {
    if (!sortBy) return filteredTracks;

    const tracks = [...filteredTracks];
    
    tracks.sort((a, b) => {
      let aVal, bVal;

      switch (sortBy) {
        case 'title':
          aVal = a.name?.toLowerCase() || '';
          bVal = b.name?.toLowerCase() || '';
          break;
        case 'artist':
          aVal = a.artists?.[0]?.name?.toLowerCase() || '';
          bVal = b.artists?.[0]?.name?.toLowerCase() || '';
          break;
        case 'album':
          aVal = a.album?.name?.toLowerCase() || '';
          bVal = b.album?.name?.toLowerCase() || '';
          break;
        case 'release_date':
          aVal = a.album?.release_date || '';
          bVal = b.album?.release_date || '';
          break;
        case 'date_added':
          aVal = a.added_at || '';
          bVal = b.added_at || '';
          break;
        case 'duration':
          aVal = a.duration_ms || 0;
          bVal = b.duration_ms || 0;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return tracks;
  }, [filteredTracks, sortBy, sortDirection]);

  const trackKeyLookup = useMemo(() => {
    const map = new Map();
    tracksSource.forEach((track) => {
      map.set(track.selectionKey, track);
    });
    return map;
  }, [tracksSource]);

  const selectedTrackSet = useMemo(() => new Set(selectedTrackKeys), [selectedTrackKeys]);

  const selectedTracks = useMemo(
    () => selectedTrackKeys.map((key) => trackKeyLookup.get(key)).filter(Boolean),
    [selectedTrackKeys, trackKeyLookup]
  );

  const selectedTracksSorted = useMemo(() => {
    return [...selectedTracks].sort((a, b) => {
      const aIndex = Number.isFinite(a?.playlistIndex) ? a.playlistIndex : 0;
      const bIndex = Number.isFinite(b?.playlistIndex) ? b.playlistIndex : 0;
      return aIndex - bIndex;
    });
  }, [selectedTracks]);

  const selectedTrackCount = selectedTracks.length;


  const playlistTrackLookup = useMemo(() => {
    const ids = new Set();
    const uris = new Set();
    allTracks.forEach((track) => {
      if (track.id) ids.add(track.id);
      if (track.uri) uris.add(track.uri);
    });
    return { ids, uris };
  }, [allTracks]);

  const isPlaylistActive = Boolean(
    player?.currentTrack
    && (
      (player.currentTrack.id && playlistTrackLookup.ids.has(player.currentTrack.id))
      || (player.currentTrack.uri && playlistTrackLookup.uris.has(player.currentTrack.uri))
      || (player.currentTrack.linkedFromId && playlistTrackLookup.ids.has(player.currentTrack.linkedFromId))
      || (player.currentTrack.linkedFromUri && playlistTrackLookup.uris.has(player.currentTrack.linkedFromUri))
    )
  );
  const isPlaylistPlaying = isPlaylistActive && !player?.isPaused;

  const isSamePlaylistEntry = useCallback((track) => {
    const current = player?.currentTrack;
    if (!current || !track) return false;
    if (current.selectionKey && track.selectionKey) {
      return current.selectionKey === track.selectionKey;
    }
    if (Number.isFinite(current.playlistIndex) && Number.isFinite(track.playlistIndex)) {
      return current.playlistIndex === track.playlistIndex;
    }
    const currentTrackId = current.id;
    const currentTrackUri = current.uri;
    const currentLinkedId = current.linkedFromId;
    const currentLinkedUri = current.linkedFromUri;
    const trackLinkedId = track.linked_from?.id;
    const trackLinkedUri = track.linked_from?.uri;
    return (currentTrackUri && track.uri && currentTrackUri === track.uri)
      || (currentTrackId && track.id && currentTrackId === track.id)
      || (currentLinkedUri && track.uri && currentLinkedUri === track.uri)
      || (currentLinkedId && track.id && currentLinkedId === track.id)
      || (trackLinkedUri && currentTrackUri && trackLinkedUri === currentTrackUri)
      || (trackLinkedId && currentTrackId && trackLinkedId === currentTrackId)
      || (trackLinkedUri && currentLinkedUri && trackLinkedUri === currentLinkedUri)
      || (trackLinkedId && currentLinkedId && trackLinkedId === currentLinkedId);
  }, [player?.currentTrack]);

  // Sort indicator component
  const SortIndicator = ({ column }) => {
    if (sortBy !== column) {
      return (
        <svg className="w-4 h-4 opacity-0 group-hover:opacity-30 transition-opacity" fill="currentColor" viewBox="0 0 20 20">
          <path d="M5 10l5-5 5 5H5z" />
        </svg>
      );
    }
    return (
      <svg 
        className={`w-4 h-4 transition-transform ${sortDirection === 'desc' ? 'rotate-180' : ''}`} 
        fill="currentColor" 
        viewBox="0 0 20 20"
      >
        <path d="M5 10l5-5 5 5H5z" />
      </svg>
    );
  };

  const totalDurationMs = tracksSource.reduce((sum, track) => sum + track.duration_ms, 0);
  const totalMinutes = Math.floor(totalDurationMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  // Use real cache stats from API
  const userCachedTracks = cacheStats.user_tracks;
  const userExpiredTracks = cacheStats.user_expired;
  const totalCachedTracks = cacheStats.total_tracks;
  const playlistDescription = useMemo(() => {
    const desc = currentPlaylist?.description;
    if (!desc || desc === 'null') return '';
    return desc;
  }, [currentPlaylist?.description]);
  const hasEdits = useMemo(() => {
    const baseName = playlist?.name || '';
    const baseDescription = playlist?.description || '';
    return (
      editForm.name !== baseName ||
      (editForm.description || '') !== baseDescription
    );
  }, [editForm, playlist]);

  // Poll job status if a job is active
  useEffect(() => {
    if (!job?.job_id) return;
    let pollCount = 0;
    
    // Calculate timeouts based on playlist size
    const trackCount = currentPlaylist?.tracks?.length || currentPlaylist?.total_tracks || 0;
    const pendingTimeoutPolls = trackCount < 100 ? 60 :    // 2 min
                                 trackCount < 500 ? 150 :   // 5 min
                                 trackCount < 1000 ? 300 :  // 10 min
                                 450;                       // 15 min
    const maxPolls = trackCount < 100 ? 300 :     // 10 min
                     trackCount < 500 ? 600 :     // 20 min
                     trackCount < 1000 ? 900 :    // 30 min
                     1800;                        // 60 min
    
    const interval = setInterval(async () => {
      pollCount++;
      try {
        const status = await sortAPI.status(playlist.id, job.job_id);
        setJobStatus(status);
        
        // Timeout detection: if still pending for too long, mark as stuck
        if (status.status === 'pending' && pollCount > pendingTimeoutPolls) {
          clearInterval(interval);
          setJobError('Job appears to be stuck. This may be due to a server restart or error. Please try again.');
          setJobStatus({ ...status, status: 'failed', error: 'Timeout: job did not start' });
          return;
        }
        
        // Max timeout: stop polling after reasonable time for playlist size
        if (pollCount >= maxPolls) {
          clearInterval(interval);
          setJobError('Job timed out. Please try again or check your connection.');
          return;
        }
        
        if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
          setRefreshing(true);
          Promise.all([
            playlistAPI.getPlaylistDetails(playlist.id)
              .then((updated) => setCurrentPlaylist(updated))
              .catch(() => {/* ignore refresh errors */}),
            fetchHistory(playlist.id)
          ]).finally(() => setRefreshing(false));
          clearInterval(interval);
        }
      } catch (err) {
        setJobError(err.message || 'Failed to check job status');
        clearInterval(interval);
      }
    }, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, playlist.id, currentPlaylist?.tracks?.length, currentPlaylist?.total_tracks]);

  const handleAnalyzeSort = async () => {
    setJobError(null);
    setAnalyzing(true);
    try {
      const res = await sortAPI.analyze(playlist.id, sortForm);
      setAnalysis(res);
    } catch (err) {
      setAnalysis(null);
      setJobError(err.message || 'Failed to analyze sort');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleStartSort = async () => {
    setJobError(null);
    setStartingSort(true);
    try {
      const res = await sortAPI.start(playlist.id, sortForm);
      setJob(res);
      setJobStatus({ status: res.status, job_id: res.job_id });
    } catch (err) {
      // Handle 429 rate limit / job limit errors with user-friendly message
      if (err.statusCode === 429) {
        setJobError(err.message || 'You have too many jobs in progress. Please wait for them to complete.');
      } else {
        setJobError(err.message || 'Failed to start sort');
      }
    } finally {
      setStartingSort(false);
    }
  };

  const sortOccurrences = (occurrences) => {
    const useAlbumPref = preferAlbumRelease && includeSimilar;
    const hasAlbumCandidate = useAlbumPref && (occurrences || []).some((occ) => {
      const type = (occ.album_type || '').toLowerCase();
      const tracks = occ.album_total_tracks || 0;
      const albumName = (occ.album || '').trim().toLowerCase();
      const trackName = (occ.name || '').trim().toLowerCase();
      const selfTitled = albumName && trackName && albumName === trackName;
      const inferredAlbum = type === 'album' || (type !== 'compilation' && tracks >= 8 && !selfTitled);
      return inferredAlbum;
    });

    const albumScore = (occ) => {
      if (!useAlbumPref || !hasAlbumCandidate) return { score: 0, albumPreferred: false };
      const type = (occ.album_type || '').toLowerCase();
      const tracks = occ.album_total_tracks || 0;
      const albumName = (occ.album || '').trim().toLowerCase();
      const trackName = (occ.name || '').trim().toLowerCase();
      const selfTitled = albumName && trackName && albumName === trackName;
      const inferredAlbum = type === 'album' || (type !== 'compilation' && tracks >= 8 && !selfTitled);
      const base = inferredAlbum ? 4 : type === 'compilation' ? 1 : 2; // album > single/other > compilation
      const score = base * 1000 + tracks;
      return { score, albumPreferred: inferredAlbum };
    };

    const releaseDate = (occ) => {
      if (!occ.album_release_date) return null;
      const raw = String(occ.album_release_date).trim();
      if (!raw) return null;

      // Spotify can return release dates with varying precision:
      // - year:  "2011"
      // - month: "2011-09"
      // - day:   "2011-09-23"
      // Some browsers parse "2011" inconsistently, so normalize to an ISO date first.
      const precision = (occ.album_release_date_precision || '').toLowerCase();
      const inferred =
        precision ||
        (raw.length === 4 ? 'year' : raw.length === 7 ? 'month' : raw.length === 10 ? 'day' : '');

      let normalized = raw;
      if (inferred === 'year' && /^\d{4}$/.test(raw)) normalized = `${raw}-01-01`;
      if (inferred === 'month' && /^\d{4}-\d{2}$/.test(raw)) normalized = `${raw}-01`;

      const d = new Date(`${normalized}T00:00:00Z`);
      return Number.isNaN(d.getTime()) ? null : d.getTime();
    };

    return [...occurrences].sort((a, b) => {
      const aAlbum = albumScore(a);
      const bAlbum = albumScore(b);
      const aRel = releaseDate(a);
      const bRel = releaseDate(b);
      const prefersLatest = albumReleaseBias === 'latest';

      if (useAlbumPref) {
        // Album vs non-album
        if (aAlbum.albumPreferred !== bAlbum.albumPreferred) {
          return aAlbum.albumPreferred ? -1 : 1;
        }
        // Both album candidates: apply release-date bias first
        if (aAlbum.albumPreferred && bAlbum.albumPreferred) {
          if (aRel !== bRel) {
            if (aRel === null) return 1;
            if (bRel === null) return -1;
            return prefersLatest ? bRel - aRel : aRel - bRel;
          }
          // Tie or missing release date: fallback to album score (tracks) then added_at
          if (aAlbum.score !== bAlbum.score) return bAlbum.score - aAlbum.score;
        }
      }

      // Default tie-breaks (when album pref off or no album candidates)
      if (aAlbum.score !== bAlbum.score) return bAlbum.score - aAlbum.score;
      if (aRel !== bRel) {
        if (aRel === null) return 1;
        if (bRel === null) return -1;
        return prefersLatest ? bRel - aRel : aRel - bRel;
      }
      const aDate = a.added_at ? new Date(a.added_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bDate = b.added_at ? new Date(b.added_at).getTime() : Number.MAX_SAFE_INTEGER;
      if (aDate !== bDate) return aDate - bDate;
      return (a.position ?? 0) - (b.position ?? 0);
    });
  };

  const buildSelection = (groups, strategy) => {
    const selection = {};
    (groups || []).forEach((group) => {
      const sortedOcc = sortOccurrences(group.occurrences || []);
      const keepIndex = strategy === 'latest' ? sortedOcc.length - 1 : 0;
      selection[group.track_id] = {
        removePositions: sortedOcc.filter((_, idx) => idx !== keepIndex).map((occ) => ({ uri: occ.uri, position: occ.position }))
      };
    });
    return selection;
  };

  const handleAnalyzeDuplicates = async (options = {}) => {
    const includeSimilarOption = options.includeSimilar ?? includeSimilar;
    const preferAlbumOption = options.preferAlbumRelease ?? preferAlbumRelease;
    const strategyOption = options.keepStrategy ?? keepStrategy;
    setDuplicatesError(null);
    setDuplicatesLoading(true);
    try {
      const res = await playlistAPI.analyzeDuplicates(playlist.id, includeSimilarOption, preferAlbumOption);
      
      // Enrich duplicate data with full track metadata from current playlist
      const trackMap = {};
      (currentPlaylist?.tracks || []).forEach(track => {
        if (track.id) {
          trackMap[track.id] = track;
        }
      });
      
      // Enrich each group with artist/album IDs from the full track data
      (res.groups || []).forEach(group => {
        const fullTrack = trackMap[group.track_id];
        if (fullTrack) {
          group.artist_ids = fullTrack.artists?.map(a => a.id) || [];
          group.artist_uris = fullTrack.artists?.map(a => a.uri) || [];
          group.artist_external_urls = fullTrack.artists?.map(a => a.external_urls?.spotify) || [];
          group.album_id = fullTrack.album?.id;
          group.album_uri = fullTrack.album?.uri;
          group.album_external_url = fullTrack.album?.external_urls?.spotify;
        }
        
        // Also enrich each occurrence
        (group.occurrences || []).forEach(occ => {
          const occTrack = trackMap[occ.track_id];
          if (occTrack) {
            occ.artist_ids = occTrack.artists?.map(a => a.id) || [];
            occ.artist_uris = occTrack.artists?.map(a => a.uri) || [];
            occ.artist_external_urls = occTrack.artists?.map(a => a.external_urls?.spotify) || [];
            occ.album_id = occTrack.album?.id;
            occ.album_uri = occTrack.album?.uri;
            occ.album_external_url = occTrack.album?.external_urls?.spotify;
          }
        });
      });
      
      setDuplicates(res);
      setDuplicatesSelection(buildSelection(res.groups, strategyOption));
      setDuplicatesMode('review');
      setOptionsDirty(false);
      setShowOptionsPanel(false);
      setDetailsOpen({});
      const initialCollapsed = {};
      (res.groups || []).forEach((g, idx) => {
        initialCollapsed[g.track_id] = idx === 0 ? false : true;
      });
      setCollapsedGroups(initialCollapsed);
    } catch (err) {
      setDuplicates(null);
      setDuplicatesSelection({});
      setDuplicatesError(err.message || 'Failed to analyze duplicates');
      setDuplicatesMode('options');
    } finally {
      setDuplicatesLoading(false);
    }
  };

  const handleKeepChoice = (option) => {
    setKeepStrategy(option);
    if (duplicatesMode === 'review') {
      setOptionsDirty(true);
    } else if (duplicates) {
      setDuplicatesSelection(buildSelection(duplicates.groups, option));
    }
  };

  const handleIncludeSimilarToggle = () => {
    const nextVal = !includeSimilar;
    setIncludeSimilar(nextVal);
    if (!nextVal) {
      setPreferAlbumRelease(false);
      setAlbumReleaseBias('earliest');
    }
    if (duplicatesMode === 'review') {
      setOptionsDirty(true);
    }
  };

  const handlePreferAlbumToggle = () => {
    const nextVal = !preferAlbumRelease;
    setPreferAlbumRelease(nextVal);
    if (!nextVal) {
      setAlbumReleaseBias('earliest');
    }
    if (duplicatesMode === 'review') {
      setOptionsDirty(true);
    }
  };

  const handleAlbumReleaseBiasChange = (value) => {
    setAlbumReleaseBias(value);
    if (duplicatesMode === 'review') {
      setOptionsDirty(true);
    }
  };

  const toggleGroupCollapse = (trackId) => {
    setCollapsedGroups((prev) => ({ ...prev, [trackId]: !prev[trackId] }));
  };

  const setAllCollapsed = (collapse) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev };
      (duplicates?.groups || []).forEach((g) => {
        next[g.track_id] = collapse;
      });
      return next;
    });
  };

  const groupsList = duplicates?.groups || [];
  const anyCollapsed = groupsList.some((g) => collapsedGroups[g.track_id] !== false);

  const trackUrlFromUri = (uri, fallbackId) => {
    if (uri && uri.startsWith('spotify:track:')) {
      return `https://open.spotify.com/track/${uri.replace('spotify:track:', '')}`;
    }
    if (fallbackId) return `https://open.spotify.com/track/${fallbackId}`;
    return null;
  };

  const handleTrackPlay = (track, index) => {
    const trackUrl = (track.external_urls && track.external_urls.spotify) || trackUrlFromUri(track.uri, track.id);
    if (player?.canUseAppPlayer) {
      const contextMeta = currentPlaylist ? {
        id: currentPlaylist.id,
        name: currentPlaylist.name,
        uri: currentPlaylist.uri,
        externalUrl: currentPlaylist.external_urls?.spotify,
      } : null;
      const isCurrentTrack = isSamePlaylistEntry(track);

      if (isCurrentTrack) {
        player.togglePlay();
      } else {
        const playlistIndex = Number.isFinite(track.playlistIndex) ? track.playlistIndex : index;
        if (Number.isInteger(playlistIndex)) {
          player.playTrack({ track, contextUri: currentPlaylist?.uri, offsetIndex: playlistIndex, contextMeta });
        } else if (track.uri) {
          player.playTrack({ track, contextUri: currentPlaylist?.uri, offsetUri: track.uri, contextMeta });
        } else {
          player.playTrack({ track, contextUri: currentPlaylist?.uri, contextMeta });
        }
      }
      return;
    }
    if (trackUrl) {
      window.open(trackUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const refreshPlaylistDetails = async ({ resetSort = false } = {}) => {
    if (resetSort) {
      setSortBy(null);
      setSortDirection('asc');
    }
    setRefreshing(true);
    try {
      const updated = await playlistAPI.getPlaylistDetails(playlist.id);
      setCurrentPlaylist(updated);
    } catch (err) {
      // non-blocking; leave UI state unchanged
    } finally {
      setRefreshing(false);
    }
  };

  const isInteractiveTarget = (event) => {
    return Boolean(event.target.closest('a, button, input, textarea, select, [data-no-select]'));
  };

  const handleTrackRowSelect = (event, track, visibleIndex) => {
    if (event.button !== 0) return;
    if (isInteractiveTarget(event)) return;
    setTrackActionError(null);
    const isRange = event.shiftKey && lastSelectedIndex !== null;
    const isToggle = event.metaKey || event.ctrlKey;

    if (isRange) {
      const start = Math.min(lastSelectedIndex, visibleIndex);
      const end = Math.max(lastSelectedIndex, visibleIndex);
      const rangeKeys = sortedTracks.slice(start, end + 1).map((row) => row.selectionKey);
      setSelectedTrackKeys((prev) => {
        const next = isToggle ? new Set(prev) : new Set();
        rangeKeys.forEach((key) => next.add(key));
        return Array.from(next);
      });
      setLastSelectedIndex(visibleIndex);
      return;
    }

    if (isToggle) {
      setSelectedTrackKeys((prev) => {
        const next = new Set(prev);
        if (next.has(track.selectionKey)) {
          next.delete(track.selectionKey);
        } else {
          next.add(track.selectionKey);
        }
        return Array.from(next);
      });
      setLastSelectedIndex(visibleIndex);
      return;
    }

    setSelectedTrackKeys([track.selectionKey]);
    setLastSelectedIndex(visibleIndex);
  };

  const handleTrackToggleSelect = (event, track, visibleIndex) => {
    event.stopPropagation();
    setTrackActionError(null);
    if (event.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, visibleIndex);
      const end = Math.max(lastSelectedIndex, visibleIndex);
      const rangeKeys = sortedTracks.slice(start, end + 1).map((row) => row.selectionKey);
      setSelectedTrackKeys((prev) => {
        const next = new Set(prev);
        rangeKeys.forEach((key) => next.add(key));
        return Array.from(next);
      });
      setLastSelectedIndex(visibleIndex);
      return;
    }
    setSelectedTrackKeys((prev) => {
      const next = new Set(prev);
      if (next.has(track.selectionKey)) {
        next.delete(track.selectionKey);
      } else {
        next.add(track.selectionKey);
      }
      return Array.from(next);
    });
    setLastSelectedIndex(visibleIndex);
  };

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };
    const handleClickOutside = (event) => {
      // Close menu on any click outside the menu
      const menuElement = document.querySelector('[data-context-menu]');
      if (menuElement && !menuElement.contains(event.target)) {
        closeContextMenu();
      }
    };
    const handleScroll = () => closeContextMenu();
    window.addEventListener('keydown', handleKey);
    window.addEventListener('click', handleClickOutside, true);
    window.addEventListener('resize', handleScroll);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('click', handleClickOutside, true);
      window.removeEventListener('resize', handleScroll);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [closeContextMenu, contextMenu]);

  const openContextMenu = (event, track, visibleIndex, anchorEl = null) => {
    event.preventDefault();
    event.stopPropagation();
    
    if (!selectedTrackSet.has(track.selectionKey)) {
      setSelectedTrackKeys([track.selectionKey]);
      setLastSelectedIndex(visibleIndex);
    }
    
    // Calculate menu dimensions (will grow dynamically based on content)
    const menuMinWidth = 288;
    const menuMaxHeight = 400; // Max height for menu with scrolling
    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const playerBar = document.querySelector('[data-player-bar]');
    const playerBarHeight = playerBar ? playerBar.getBoundingClientRect().height : 0;
    const safeBottom = viewportHeight - playerBarHeight - margin;
    
    let x, y;
    
    // Get the actual position we want to anchor to
    let anchorX, anchorY;
    
    if (anchorEl) {
      // For button clicks, use the button's position
      const anchorRect = anchorEl.getBoundingClientRect();
      anchorX = anchorRect.left; // Left edge of button
      anchorY = anchorRect.top + (anchorRect.height / 2); // Vertically centered on button
    } else {
      // For right-clicks, use the exact click position
      anchorX = event.clientX;
      anchorY = event.clientY;
    }
    
    // Horizontal positioning: try to place menu to the left of anchor point
    x = anchorX - menuMinWidth - 8;
    
    // If menu goes off left edge, place to the right instead
    if (x < margin) {
      x = anchorX + 8;
    }
    
    // If still goes off right edge, clamp it
    if (x + menuMinWidth > viewportWidth - margin) {
      x = viewportWidth - menuMinWidth - margin;
    }
    
    // Vertical positioning: start at anchor point
    y = anchorY;
    
    // If menu goes off bottom, shift it up
    if (y + menuMaxHeight > safeBottom) {
      y = safeBottom - menuMaxHeight;
    }
    
    // If menu goes off top, clamp to margin
    if (y < margin) {
      y = margin;
    }
    
    setContextMenu({ x, y });
  };

  const handlePlaySelection = () => {
    if (!selectedTracksSorted.length) return;
    const firstTrack = selectedTracksSorted[0];
    if (selectedTracksSorted.length === 1) {
      handleTrackPlay(firstTrack, Number.isFinite(firstTrack.playlistIndex) ? firstTrack.playlistIndex : 0);
      closeContextMenu();
      return;
    }
    if (player?.playTracks) {
      const contextMeta = currentPlaylist ? {
        id: currentPlaylist.id,
        name: currentPlaylist.name,
        uri: currentPlaylist.uri,
        externalUrl: currentPlaylist.external_urls?.spotify,
      } : null;
      player.playTracks({ tracks: selectedTracksSorted, contextMeta });
    } else {
      handleTrackPlay(firstTrack, Number.isFinite(firstTrack.playlistIndex) ? firstTrack.playlistIndex : 0);
    }
    closeContextMenu();
  };

  const handleShareSelection = async () => {
    if (selectedTracksSorted.length !== 1) return;
    const track = selectedTracksSorted[0];
    const url = trackUrlFromUri(track.uri, track.id);
    if (!url) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    closeContextMenu();
  };

  const loadTargetPlaylists = useCallback(async () => {
    setTargetPlaylistsLoading(true);
    setTargetPlaylistsError(null);
    try {
      const playlists = await playlistAPI.getPlaylists();
      setTargetPlaylists(playlists || []);
    } catch (err) {
      setTargetPlaylistsError(err.message || 'Failed to load playlists');
    } finally {
      setTargetPlaylistsLoading(false);
    }
  }, []);

  const filteredTargetPlaylists = useMemo(() => {
    const query = targetPlaylistQuery.trim().toLowerCase();
    return (targetPlaylists || []).filter((pl) => {
      if (!pl?.id || pl.id === currentPlaylist?.id) return false;
      if (!query) return true;
      const name = pl.name?.toLowerCase() || '';
      const owner = pl.owner?.display_name?.toLowerCase() || pl.owner?.id?.toLowerCase() || '';
      return name.includes(query) || owner.includes(query);
    });
  }, [currentPlaylist?.id, targetPlaylistQuery, targetPlaylists]);

  useEffect(() => {
    if (
      !trackActionOpen
      || (trackActionMode !== 'add' && trackActionMode !== 'move')
      || !selectedTracksSorted.length
      || !targetPlaylists.length
    ) {
      setPlaylistMatchSummaries({});
      setPlaylistMatchSummariesLoading(false);
      setPlaylistMatchSummariesError(null);
      return;
    }
    const playlistIds = targetPlaylists
      .map((pl) => pl.id)
      .filter((id) => id && id !== currentPlaylist?.id);
    if (!playlistIds.length) {
      setPlaylistMatchSummaries({});
      return;
    }
    let active = true;
    const loadMatchSummaries = async () => {
      setPlaylistMatchSummariesLoading(true);
      setPlaylistMatchSummariesError(null);
      try {
        const payload = {
          playlist_ids: playlistIds,
          tracks: selectedTracksSorted.map((track) => ({
            client_key: track.selectionKey,
            track_id: track.id || null,
            name: track.name || null,
            artists: (track.artists || []).map((artist) => artist.name).filter(Boolean),
            duration_ms: track.duration_ms ?? null,
          })),
        };
        const res = await playlistAPI.getPlaylistCacheMatchesBatch(payload);
        if (!active) return;
        const next = {};
        (res?.results || []).forEach((entry) => {
          if (entry?.playlist_id) {
            next[entry.playlist_id] = entry;
          }
        });
        setPlaylistMatchSummaries(next);
      } catch (err) {
        if (!active) return;
        setPlaylistMatchSummariesError(err.message || 'Failed to check cache');
      } finally {
        if (active) {
          setPlaylistMatchSummariesLoading(false);
        }
      }
    };
    loadMatchSummaries();
    return () => {
      active = false;
    };
  }, [currentPlaylist?.id, selectedTracksSorted, targetPlaylists, trackActionMode, trackActionOpen]);

  useEffect(() => {
    if (!trackActionOpen || !targetPlaylists.length) {
      setTargetPlaylistFacts({});
      setTargetPlaylistFactsSummary({ facts_count: 0, coverage_ratio: 0 });
      return;
    }
    const playlistIds = targetPlaylists
      .map((pl) => pl.id)
      .filter((id) => id && id !== currentPlaylist?.id);
    if (!playlistIds.length) {
      setTargetPlaylistFacts({});
      setTargetPlaylistFactsSummary({ facts_count: 0, coverage_ratio: 0 });
      return;
    }
    let active = true;
    const loadFacts = async () => {
      try {
        const res = await cacheAPI.getPlaylistFacts(playlistIds);
        if (!active) return;
        const factsMap = {};
        (res?.facts || []).forEach((fact) => {
          if (fact?.playlist_id) {
            factsMap[fact.playlist_id] = fact;
          }
        });
        setTargetPlaylistFacts(factsMap);
        setTargetPlaylistFactsSummary(res?.summary || { facts_count: 0, coverage_ratio: 0 });
      } catch (err) {
        if (!active) return;
        setTargetPlaylistFacts({});
        setTargetPlaylistFactsSummary({ facts_count: 0, coverage_ratio: 0 });
      } finally {
        // no-op
      }
    };
    loadFacts();
    return () => {
      active = false;
    };
  }, [currentPlaylist?.id, targetPlaylists, trackActionOpen]);

  useEffect(() => {
    if (
      !trackActionOpen
      || !targetPlaylistId
      || !selectedTracksSorted.length
      || (trackActionMode !== 'add' && trackActionMode !== 'move')
    ) {
      setTargetPlaylistMatch(null);
      setTargetPlaylistMatchError(null);
      setTargetPlaylistMatchLoading(false);
      return;
    }
    let active = true;
    const loadTargetMatches = async () => {
      setTargetPlaylistMatchLoading(true);
      setTargetPlaylistMatchError(null);
      try {
        const payload = {
          tracks: selectedTracksSorted.map((track) => ({
            client_key: track.selectionKey,
            track_id: track.id || null,
            name: track.name || null,
            artists: (track.artists || []).map((artist) => artist.name).filter(Boolean),
            duration_ms: track.duration_ms ?? null,
          })),
        };
        const res = await playlistAPI.getPlaylistCacheMatches(targetPlaylistId, payload);
        if (!active) return;
        setTargetPlaylistMatch(res || null);
      } catch (err) {
        if (!active) return;
        setTargetPlaylistMatchError(err.message || 'Failed to check cached playlist');
      } finally {
        if (active) {
          setTargetPlaylistMatchLoading(false);
        }
      }
    };
    loadTargetMatches();
    return () => {
      active = false;
    };
  }, [selectedTracksSorted, targetPlaylistId, trackActionMode, trackActionOpen]);

  const targetPlaylistMatchMap = useMemo(() => {
    const map = new Map();
    (targetPlaylistMatch?.matches || []).forEach((entry) => {
      if (entry?.client_key) {
        map.set(entry.client_key, entry.status || null);
      }
    });
    return map;
  }, [targetPlaylistMatch]);

  const targetPlaylistMatchSummary = useMemo(() => {
    const total = targetPlaylistMatch?.total ?? selectedTrackCount;
    const exact = targetPlaylistMatch?.exact_count ?? 0;
    const similar = targetPlaylistMatch?.similar_count ?? 0;
    const fresh = Math.max(total - exact - similar, 0);
    return { total, exact, similar, fresh };
  }, [selectedTrackCount, targetPlaylistMatch]);

  const targetCacheSortEnabled = targetPlaylistFactsSummary.coverage_ratio >= 0.8
    && targetPlaylistFactsSummary.facts_count > 0;

  useEffect(() => {
    if (targetPlaylistSortOption === 'recently-updated-estimated' && !targetCacheSortEnabled) {
      setTargetPlaylistSortOption('default');
    }
  }, [targetCacheSortEnabled, targetPlaylistSortOption]);

  const targetPlaylistFactsMap = useMemo(() => {
    const map = {};
    Object.values(targetPlaylistFacts || {}).forEach((fact) => {
      if (fact?.playlist_id) {
        map[fact.playlist_id] = fact;
      }
    });
    return map;
  }, [targetPlaylistFacts]);

  const sortedTargetPlaylists = useMemo(() => {
    const applySort = (list) => {
      const copy = [...list];
      switch (targetPlaylistSortOption) {
        case 'recently-updated-estimated':
          return copy.sort((a, b) => {
            const aFact = targetPlaylistFactsMap[a.id];
            const bFact = targetPlaylistFactsMap[b.id];
            const aDate = aFact?.last_track_added_at_utc ? new Date(aFact.last_track_added_at_utc) : null;
            const bDate = bFact?.last_track_added_at_utc ? new Date(bFact.last_track_added_at_utc) : null;
            const aTime = aDate && !Number.isNaN(aDate.getTime()) ? aDate.getTime() : null;
            const bTime = bDate && !Number.isNaN(bDate.getTime()) ? bDate.getTime() : null;
            if (aTime && bTime) return bTime - aTime;
            if (aTime && !bTime) return -1;
            if (!aTime && bTime) return 1;
            return a.name.localeCompare(b.name);
          });
        case 'name-asc':
          return copy.sort((a, b) => a.name.localeCompare(b.name));
        case 'name-desc':
          return copy.sort((a, b) => b.name.localeCompare(a.name));
        case 'tracks-asc':
          return copy.sort((a, b) => (a.tracks?.total || 0) - (b.tracks?.total || 0));
        case 'tracks-desc':
          return copy.sort((a, b) => (b.tracks?.total || 0) - (a.tracks?.total || 0));
        case 'owner-asc':
          return copy.sort((a, b) =>
            (a.owner?.display_name || a.owner?.id || '').localeCompare(b.owner?.display_name || b.owner?.id || '')
          );
        case 'owner-desc':
          return copy.sort((a, b) =>
            (b.owner?.display_name || b.owner?.id || '').localeCompare(a.owner?.display_name || a.owner?.id || '')
          );
        default:
          return copy;
      }
    };

    const matches = [];
    const rest = [];
    filteredTargetPlaylists.forEach((pl) => {
      const summary = playlistMatchSummaries[pl.id];
      const matchCount = summary?.cached ? (summary.exact_count + summary.similar_count) : 0;
      if (matchCount > 0) {
        matches.push(pl);
      } else {
        rest.push(pl);
      }
    });
    return {
      matches: applySort(matches),
      rest: applySort(rest),
    };
  }, [filteredTargetPlaylists, playlistMatchSummaries, targetPlaylistFactsMap, targetPlaylistSortOption]);

  const renderPlaylistMatchIndicators = (playlistId) => {
    if (playlistMatchSummariesLoading) {
      return (
        <span className="icon text-lg text-spotify-gray-light animate-spin">autorenew</span>
      );
    }
    if (playlistMatchSummariesError) {
      return (
        <Tip label="Cache check failed" side="top" align="end">
          <span className="icon text-lg text-red-400">error</span>
        </Tip>
      );
    }
    const summary = playlistMatchSummaries[playlistId];
    if (!summary) return null;
    if (!summary.cached) {
      return (
        <Tip label="Cache not ready" side="top" align="end">
          <span className="icon text-lg text-spotify-gray-light">cloud_off</span>
        </Tip>
      );
    }
    const items = [];
    const total = summary.total ?? selectedTrackCount;
    const matchCount = (summary.exact_count || 0) + (summary.similar_count || 0);
    const isPartial = total > 1 && matchCount > 0 && matchCount < total;

    if (isPartial) {
      items.push({
        key: 'partial',
        icon: 'indeterminate_check_box',
        color: 'text-sky-300',
        label: `Some matches (${matchCount}/${total})`,
      });
    }
    if (summary.exact_count > 0) {
      items.push({
        key: 'exact',
        icon: 'check_circle',
        color: 'text-spotify-green',
        label: `Exact matches: ${summary.exact_count}`,
        count: summary.exact_count,
      });
    }
    if (summary.similar_count > 0) {
      items.push({
        key: 'similar',
        icon: 'difference',
        color: 'text-amber-300',
        label: `Similar matches: ${summary.similar_count}`,
        count: summary.similar_count,
      });
    }
    if (!items.length) {
      items.push({
        key: 'new',
        icon: 'add_circle',
        color: 'text-spotify-gray-light',
        label: 'No cached matches',
      });
    }
    return (
      <div className="flex items-center gap-2">
        {items.map((item) => (
          <Tip key={item.key} label={item.label} side="top" align="end">
            <span className={`flex items-center gap-1 text-xs ${item.color}`}>
              <span className="icon text-lg">{item.icon}</span>
              {item.count && item.count > 1 ? (
                <span className="text-[11px] font-semibold">{item.count}</span>
              ) : null}
            </span>
          </Tip>
        ))}
      </div>
    );
  };

  const renderTargetPlaylistButton = (pl) => (
    <button
      key={pl.id}
      type="button"
      onClick={() => setTargetPlaylistId(pl.id)}
      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
        targetPlaylistId === pl.id
          ? 'border-spotify-green text-white bg-spotify-green/10'
          : 'border-spotify-gray-mid/60 text-spotify-gray-light hover:text-white hover:border-spotify-gray-light'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{pl.name}</div>
          <div className="text-xs text-spotify-gray-light truncate">
            {pl.owner?.display_name || pl.owner?.id || 'Unknown owner'}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {renderPlaylistMatchIndicators(pl.id)}
        </div>
      </div>
    </button>
  );

  const handleTargetPlaylistSortChange = (value) => {
    setTargetPlaylistSortOption(value);
    setTargetPlaylistSortSpinner(true);
    if (sortSpinnerTimer.current) {
      clearTimeout(sortSpinnerTimer.current);
    }
    sortSpinnerTimer.current = setTimeout(() => {
      setTargetPlaylistSortSpinner(false);
    }, 600);
  };

  const handleToggleMatchDetails = () => {
    const next = !showMatchDetails;
    setShowMatchDetails(next);
    preferencesAPI.updatePreferences({ playlist_action_details_open: next }).catch(() => {
      // ignore preference update errors
    });
  };

  const openTrackActionModal = useCallback(async (mode) => {
    closeContextMenu();
    setTrackActionMode(mode);
    setTrackActionOpen(true);
    setTrackActionError(null);
    setTargetPlaylistId('');
    setTargetPlaylistQuery('');
    setTargetPlaylistMatch(null);
    setTargetPlaylistMatchError(null);
    setPlaylistMatchSummaries({});
    setPlaylistMatchSummariesError(null);
    setPlaylistMatchSummariesLoading(false);
    setSkipExistingTracks(true);
    await loadTargetPlaylists();
  }, [closeContextMenu, loadTargetPlaylists]);

  useEffect(() => {
    const pending = location.state?.trackAction;
    if (!pending) {
      trackActionPendingRef.current = null;
      return;
    }
    if (!tracksSource.length) return;
    if (!currentPlaylist?.id) return;
    if (pending.mode !== 'add' && pending.mode !== 'move') return;
    const actionKey = `${pending.mode}:${pending.trackId || pending.trackUri || ''}`;
    if (trackActionPendingRef.current === actionKey) return;
    const match = tracksSource.find((track) => (
      (pending.trackId && track.id === pending.trackId)
      || (pending.trackUri && track.uri === pending.trackUri)
      || (pending.trackId && track.linked_from?.id === pending.trackId)
      || (pending.trackUri && track.linked_from?.uri === pending.trackUri)
    ));
    if (!match) return;
    trackActionPendingRef.current = actionKey;
    setSelectedTrackKeys([match.selectionKey]);
    setLastSelectedIndex(Number.isFinite(match.playlistIndex) ? match.playlistIndex : null);
    openTrackActionModal(pending.mode);
    navigate(location.pathname, { replace: true });
  }, [currentPlaylist?.id, location.pathname, location.state, navigate, openTrackActionModal, tracksSource]);

  const closeTrackActionModal = () => {
    if (trackActionLoading) return;
    setTrackActionOpen(false);
    setTrackActionMode(null);
    setTrackActionError(null);
    setTargetPlaylistMatch(null);
    setTargetPlaylistMatchError(null);
    setPlaylistMatchSummaries({});
    setPlaylistMatchSummariesError(null);
    setPlaylistMatchSummariesLoading(false);
  };

  const handleConfirmTrackAction = async () => {
    if (!trackActionMode) return;
    if (!targetPlaylistId) {
      setTrackActionError('Choose a destination playlist.');
      return;
    }
    const selectedUris = selectedTracksSorted.map((track) => track.uri).filter(Boolean);
    if (!selectedUris.length) {
      setTrackActionError('No playable tracks selected.');
      return;
    }
    const shouldSkip = skipExistingTracks && targetPlaylistMatch?.cached;
    const tracksToAdd = shouldSkip
      ? selectedTracksSorted.filter((track) => {
        const status = targetPlaylistMatchMap.get(track.selectionKey);
        return status !== 'exact' && status !== 'similar';
      })
      : selectedTracksSorted;
    const uris = tracksToAdd.map((track) => track.uri).filter(Boolean);
    if (!uris.length && trackActionMode === 'add') {
      setTrackActionError('All selected tracks already exist in the target playlist.');
      return;
    }
    setTrackActionLoading(true);
    setTrackActionError(null);
    try {
      if (uris.length) {
        await playlistAPI.addTracks(targetPlaylistId, { track_uris: uris });
      }
      if (trackActionMode === 'move') {
        const items = selectedTracksSorted
          .filter((track) => Number.isFinite(track.playlistIndex))
          .map((track) => ({ uri: track.uri, position: track.playlistIndex }));
        if (items.length > 0) {
          await playlistAPI.removeTracks(currentPlaylist.id, { 
            items,
            snapshot_id: currentPlaylist.snapshot_id 
          });
          await refreshPlaylistDetails();
        }
      }
      setTrackActionOpen(false);
      setSelectedTrackKeys([]);
    } catch (err) {
      setTrackActionError(err.message || 'Action failed.');
    } finally {
      setTrackActionLoading(false);
    }
  };

  const handleRemoveSelection = async () => {
    if (!selectedTracksSorted.length) return;
    closeContextMenu();
    if (!window.confirm(`Remove ${selectedTracksSorted.length} track${selectedTracksSorted.length > 1 ? 's' : ''} from this playlist?`)) {
      return;
    }
    setTrackActionLoading(true);
    setTrackActionError(null);
    try {
      const items = selectedTracksSorted
        .filter((track) => Number.isFinite(track.playlistIndex))
        .map((track) => ({ uri: track.uri, position: track.playlistIndex }));
      
      // Log removal details to backend
      playerAPI.log('info', `Removing ${items.length} track(s) from playlist ${currentPlaylist.id}`, {
        items: items.map(item => ({
          uri: item.uri,
          position: item.position,
          trackId: selectedTracksSorted.find(t => t.uri === item.uri)?.id,
          trackName: selectedTracksSorted.find(t => t.uri === item.uri)?.name,
        })),
      });
      
      if (items.length) {
        await playlistAPI.removeTracks(currentPlaylist.id, { 
          items,
          snapshot_id: currentPlaylist.snapshot_id 
        });
        await refreshPlaylistDetails();
      }
      setSelectedTrackKeys([]);
    } catch (err) {
      setTrackActionError(err.message || 'Failed to remove tracks.');
    } finally {
      setTrackActionLoading(false);
    }
  };

  const handleCreatePlaylist = async () => {
    const name = createPlaylistName.trim();
    if (!name) {
      setTrackActionError('Enter a playlist name.');
      return;
    }
    const uris = selectedTracksSorted.map((track) => track.uri).filter(Boolean);
    if (!uris.length) {
      setTrackActionError('No playable tracks selected.');
      return;
    }
    setTrackActionLoading(true);
    setTrackActionError(null);
    try {
      const payload = {
        name,
        description: createPlaylistDescription.trim() || null,
        public: createPlaylistPublic,
        collaborative: createPlaylistPublic ? false : false,
        track_uris: uris,
      };
      const res = await playlistAPI.createPlaylist(payload);
      setCreatePlaylistOpen(false);
      setSelectedTrackKeys([]);
      if (res?.new_playlist_id) {
        navigate(`/playlist/${res.new_playlist_id}`);
      }
    } catch (err) {
      setTrackActionError(err.message || 'Failed to create playlist.');
    } finally {
      setTrackActionLoading(false);
    }
  };

  const artistUrlFrom = (name, uri, id, external) => {
    if (external) return external;
    if (uri && uri.startsWith('spotify:artist:')) {
      return `https://open.spotify.com/artist/${uri.replace('spotify:artist:', '')}`;
    }
    if (id) return `https://open.spotify.com/artist/${id}`;
    if (name) return `https://open.spotify.com/search/${encodeURIComponent(name)}`;
    return null;
  };

  const albumUrlFrom = (title, uri, id, external) => {
    if (external) return external;
    if (uri && uri.startsWith('spotify:album:')) {
      return `https://open.spotify.com/album/${uri.replace('spotify:album:', '')}`;
    }
    if (id) return `https://open.spotify.com/album/${id}`;
    if (title) return `https://open.spotify.com/search/${encodeURIComponent(title)}`;
    return null;
  };

  const toggleDetails = (key) => {
    setDetailsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const getKeptIndex = (group) => {
    const sortedOcc = sortOccurrences(group.occurrences || []);
    const removed = duplicatesSelection[group.track_id]?.removePositions || [];
    if (removed.length >= sortedOcc.length) return -1;
    const firstKeep = sortedOcc.findIndex(
      (occ) => !removed.some((p) => p.uri === occ.uri && p.position === occ.position)
    );
    if (firstKeep !== -1) return firstKeep;
    return keepStrategy === 'latest' ? Math.max(sortedOcc.length - 1, 0) : 0;
  };

  const toggleRemoveSelection = (group, occ) => {
    setDuplicatesSelection((prev) => {
      const current = prev[group.track_id] || { removePositions: [] };
      const isRemoved = (current.removePositions || []).some(
        (p) => p.uri === occ.uri && p.position === occ.position
      );
      let newRemove = [...(current.removePositions || [])];
      if (isRemoved) {
        newRemove = newRemove.filter((p) => !(p.uri === occ.uri && p.position === occ.position));
      } else {
        newRemove.push({ uri: occ.uri, position: occ.position });
      }
      return { ...prev, [group.track_id]: { removePositions: newRemove } };
    });
  };

  const renderOptionsControls = () => {
    const albumBiasDisabled = !preferAlbumRelease || !includeSimilar;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-spotify-gray-light">Keep preference</span>
            <div className="inline-flex rounded-full bg-spotify-gray-dark/60 border border-spotify-gray-mid/60 overflow-hidden">
              {['earliest', 'latest'].map((opt) => (
                <Tip key={opt} label={opt === 'earliest' ? 'Keep earliest' : 'Keep latest'} side="top" align="start">
                  <button
                    onClick={() => handleKeepChoice(opt)}
                    className={`px-3 py-2 flex items-center gap-2 text-xs font-semibold transition-colors ${
                      keepStrategy === opt
                        ? 'bg-spotify-green/20 text-white shadow-[0_0_0_1px_rgba(29,185,84,0.35)]'
                        : 'text-spotify-gray-light hover:text-white'
                    }`}
                    aria-label={opt === 'earliest' ? 'Keep earliest' : 'Keep latest'}
                  >
                    <span className="icon text-sm">{opt === 'earliest' ? 'history' : 'update'}</span>
                    <span className="hidden sm:inline">{opt === 'earliest' ? 'Earliest' : 'Latest'}</span>
                  </button>
                </Tip>
              ))}
            </div>
          </div>
          <div className="text-[11px] text-spotify-gray-light leading-snug">
            Keep preference decides which copy stays in each duplicate group (based on sorting below).
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="bg-spotify-gray-dark/50 border border-spotify-gray-mid/60 rounded-lg p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="text-sm text-white font-semibold flex items-center gap-2">
                <span className="icon text-base">link</span>
                Matching scope
              </div>
              <Tip label="Include similar matches" side="top" align="end">
                <button
                  onClick={handleIncludeSimilarToggle}
                  aria-pressed={includeSimilar}
                  className={`w-10 h-10 rounded-lg border flex items-center justify-center transition-colors ${
                    includeSimilar
                      ? 'bg-spotify-green/20 text-spotify-green border-spotify-green/60'
                      : 'bg-spotify-gray-dark/40 text-spotify-gray-light border-spotify-gray-mid/60 hover:text-white'
                  }`}
                >
                  <span className="icon text-base">link</span>
                </button>
              </Tip>
            </div>
            <p className="text-[11px] text-spotify-gray-light leading-snug">
              Similar matches use normalized title/artist with a small time tolerance. Turn off to limit to exact duplicates only.
            </p>
          </div>

          <div className="bg-spotify-gray-dark/50 border border-spotify-gray-mid/60 rounded-lg p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="text-sm text-white font-semibold flex items-center gap-2">
                <span className="icon text-base">album</span>
                Album handling
              </div>
              <Tip label="Prefer album releases (requires similar matches)" side="top" align="end">
                <button
                  onClick={handlePreferAlbumToggle}
                  aria-pressed={preferAlbumRelease}
                  disabled={!includeSimilar}
                  className={`w-10 h-10 rounded-lg border flex items-center justify-center transition-colors ${
                    preferAlbumRelease && includeSimilar
                      ? 'bg-spotify-green/20 text-spotify-green border-spotify-green/60'
                      : 'bg-spotify-gray-dark/40 text-spotify-gray-light border-spotify-gray-mid/60 hover:text-white'
                  } ${!includeSimilar ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <span className="icon text-base">album</span>
                </button>
              </Tip>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className={`inline-flex rounded-full overflow-hidden border ${albumBiasDisabled ? 'border-spotify-gray-mid/40' : 'border-spotify-green/40'}`}>
                {['earliest', 'latest'].map((opt) => (
                  <Tip key={opt} label={opt === 'earliest' ? 'Favor earliest album release' : 'Favor latest album release'} side="top" align="start">
                    <button
                      onClick={() => handleAlbumReleaseBiasChange(opt)}
                      disabled={albumBiasDisabled}
                      className={`px-3 py-2 text-xs font-semibold flex items-center gap-2 transition-colors ${
                        albumReleaseBias === opt && !albumBiasDisabled
                          ? 'bg-spotify-green/20 text-white shadow-[0_0_0_1px_rgba(29,185,84,0.35)]'
                          : 'text-spotify-gray-light'
                      } ${albumBiasDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:text-white'}`}
                    >
                      <span className="icon text-sm">{opt === 'earliest' ? 'history' : 'update'}</span>
                      <span className="hidden sm:inline">{opt === 'earliest' ? 'Earliest album' : 'Latest album'}</span>
                    </button>
                  </Tip>
                ))}
              </div>
              <span className="text-[11px] text-spotify-gray-light">
                {albumBiasDisabled
                  ? 'Enable album preference to bias toward earliest or latest album releases.'
                  : albumReleaseBias === 'earliest'
                    ? 'Album bias: keep the oldest album release when multiple versions exist.'
                    : 'Album bias: keep the newest album release when multiple versions exist.'}
              </span>
            </div>
            <p className="text-[11px] text-spotify-gray-light leading-snug">
              Prefer album releases boosts albums/full releases over singles/EPs. Album bias decides which album version to keep.
            </p>
          </div>
        </div>
      </div>
    );
  };

  const handleIgnorePair = async (scope) => {
    if (!ignoreTarget) return;
    
    setIgnoringPair(true);
    try {
      const playlistId = scope === 'playlist' ? playlist.id : null;
      await ignoreAPI.addIgnoredPair(
        ignoreTarget.trackId1,
        ignoreTarget.trackId2,
        playlistId
      );
      
      // Preserve collapse state before re-analyzing
      const currentCollapseState = { ...collapsedGroups };
      
      // Re-analyze to update the list
      await handleAnalyzeDuplicates({ includeSimilar, preferAlbumRelease, keepStrategy });
      
      // Restore collapse state
      setCollapsedGroups(currentCollapseState);
      
      setShowIgnoreModal(false);
      setIgnoreTarget(null);
    } catch (err) {
      setDuplicatesError(err.message || 'Failed to ignore pair');
      setShowIgnoreModal(false);
    } finally {
      setIgnoringPair(false);
    }
  };

  const handleRemoveDuplicates = async () => {
    setDuplicatesError(null);
    setRemovingDuplicates(true);
    try {
      const items = [];
      Object.values(duplicatesSelection).forEach((sel) => {
        (sel.removePositions || []).forEach((occ) => items.push(occ));
      });
      if (items.length === 0) {
        setDuplicatesError('Select at least one duplicate to remove.');
        setRemovingDuplicates(false);
        return;
      }
      await playlistAPI.removeDuplicates(playlist.id, items, duplicates?.snapshot_id);
      const updated = await playlistAPI.getPlaylistDetails(playlist.id);
      setCurrentPlaylist(updated);
      setShowDuplicatesModal(false);
      setDuplicates(null);
      setDuplicatesSelection({});
      fetchHistory(playlist.id);
    } catch (err) {
      setDuplicatesError(err.message || 'Failed to remove duplicates');
    } finally {
      setRemovingDuplicates(false);
    }
  };

  if (!currentPlaylist) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-spotify-black via-spotify-gray-dark to-spotify-gray-mid flex items-center justify-center">
        <LoadingSpinner text="Loading playlist details..." />
      </div>
    );
  }

  return (
    <Tooltip.Provider delayDuration={100}>
      <div className="animate-fade-in relative">
      {refreshing && (
        <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center rounded-lg">
          <LoadingSpinner text="Refreshing playlist..." />
        </div>
      )}

      {/* Duplicates Modal */}
      {showDuplicatesModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-spotify-gray-dark rounded-2xl shadow-2xl max-w-4xl w-full border border-spotify-gray-mid/60 max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-start justify-between p-6 pb-4 border-b border-spotify-gray-mid/50">
              <div>
                <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Playlist actions</p>
                <h3 className="text-2xl font-semibold text-white">Find duplicates</h3>
                <p className="text-sm text-amber-300 mt-1">
                  This tool permanently removes tracks from your playlist, use with caution.
                </p>
              </div>
              <div className="relative group">
                <button
                  onClick={() => { setShowDuplicatesModal(false); setDuplicates(null); setDuplicatesError(null); }}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-spotify-gray-light hover:text-white hover:bg-spotify-gray-mid/60"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div className="tooltip tooltip-left group-hover:tooltip-visible">Close</div>
              </div>
            </div>

            <div className={`p-6 pt-4 flex-1 ${duplicatesMode === 'review' && duplicates ? 'overflow-y-auto overflow-x-hidden' : 'overflow-visible'} space-y-4`}>
              {duplicatesLoading && (
                <div className="flex items-center gap-3 text-spotify-gray-light text-sm">
                  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="12" cy="12" r="10" strokeWidth="4" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" strokeWidth="4" className="opacity-75" />
                  </svg>
                  <span>Analyzing duplicates…</span>
                </div>
              )}

              {duplicatesMode === 'options' && (
                <div className="space-y-4 overflow-visible">
                  {renderOptionsControls()}
                </div>
              )}

              {duplicatesMode === 'review' && duplicates && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 overflow-visible">
                    <div>
                      <p className="text-white font-semibold text-sm">{duplicates.total_groups} song groups</p>
                      <p className="text-xs text-spotify-gray-light">{selectedCount} tracks selected for removal</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap overflow-visible">
                      <Tip label="Edit options" side="top" align="end">
                        <button
                          onClick={() => setShowOptionsPanel((v) => !v)}
                          className="text-xs font-semibold text-spotify-green hover:text-white underline decoration-spotify-green decoration-2"
                        >
                          {showOptionsPanel ? 'Hide options' : 'Edit options'}
                        </button>
                      </Tip>
                      <Tip label={showAlbumMeta ? 'Hide album details' : 'Show album details'} side="top" align="end">
                        <button
                          onClick={() => updateAlbumDetailsPreference(!showAlbumMeta)}
                          className={`w-9 h-9 rounded-lg border ${showAlbumMeta ? 'bg-spotify-green/20 text-spotify-green border-spotify-green/60' : 'bg-spotify-gray-dark/40 text-spotify-gray-light border-spotify-gray-mid/60 hover:text-white'} flex items-center justify-center`}
                        >
                          <span className="icon text-sm">library_music</span>
                        </button>
                      </Tip>
                      <Tip label={anyCollapsed ? 'Expand all groups' : 'Collapse all groups'} side="top" align="center">
                        <button
                          onClick={() => setAllCollapsed(!anyCollapsed ? true : false)}
                          disabled={groupsList.length === 0}
                          className="w-9 h-9 rounded-lg bg-spotify-gray-dark/40 border border-spotify-gray-mid/60 text-white hover:text-spotify-green transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <span className="icon text-sm">{anyCollapsed ? 'unfold_more' : 'unfold_less'}</span>
                        </button>
                      </Tip>
                      {optionsDirty && (
                        <button
                          onClick={() => handleAnalyzeDuplicates({ includeSimilar, preferAlbumRelease, keepStrategy })}
                          className="px-3 py-2 rounded-lg bg-spotify-gray-mid hover:bg-spotify-green hover:text-black text-sm text-white transition-colors"
                        >
                          Re-run detection
                        </button>
                      )}
                      <Tip label="Reset selections to default" side="top" align="end">
                        <button
                          onClick={() => {
                            if (duplicates?.groups) {
                              setDuplicatesSelection(buildSelection(duplicates.groups, 'earliest'));
                              setKeepStrategy('earliest');
                            }
                          }}
                          className="w-9 h-9 text-white hover:text-spotify-green transition-colors rounded-lg bg-spotify-gray-dark/40 border border-spotify-gray-mid/60"
                          aria-label="Reset selections to default"
                        >
                          <span className="icon text-sm">restart_alt</span>
                        </button>
                      </Tip>
                      <Tip label="Deselect all" side="top" align="end">
                        <button
                          onClick={() => {
                            const selection = {};
                            (duplicates?.groups || []).forEach((group) => {
                              selection[group.track_id] = {
                                removePositions: []
                              };
                            });
                            setDuplicatesSelection(selection);
                          }}
                          className="w-9 h-9 text-white hover:text-spotify-green transition-colors rounded-lg bg-spotify-gray-dark/40 border border-spotify-gray-mid/60"
                          aria-label="Deselect all"
                        >
                          <span className="icon text-sm">deselect</span>
                        </button>
                      </Tip>
                    </div>
                  </div>

                  {showOptionsPanel && (
                    <div className="bg-spotify-gray-dark/50 border border-spotify-gray-mid/60 rounded-lg p-3 space-y-3">
                      {renderOptionsControls()}
                      <p className="text-xs text-spotify-gray-light">Changes require re-running detection.</p>
                    </div>
                  )}

                  {duplicates.total_groups === 0 && (
                    <div className="bg-spotify-gray-mid/30 border border-spotify-gray-mid/60 rounded-lg p-4 text-sm text-spotify-gray-light">
                      No duplicates found in this playlist.
                    </div>
                  )}

                  {(duplicates.groups || []).map((group, groupIdx) => {
                    const sortedOccurrences = sortOccurrences(group.occurrences || []);
                    const sel = duplicatesSelection[group.track_id] || { removePositions: [] };
                    const keptIndex = getKeptIndex(group);
                    const groupSelected = sel.removePositions?.length || 0;
                    const collapsedState = collapsedGroups[group.track_id];
                    const collapsed = collapsedState === undefined ? groupIdx !== 0 : collapsedState;
                    return (
                      <div key={group.track_id} className="bg-spotify-gray-mid/30 border border-spotify-gray-mid/60 rounded-lg p-4 space-y-3">
                        <button
                          className="w-full flex items-center justify-between gap-3 text-left"
                          onClick={() => toggleGroupCollapse(group.track_id)}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {group.album_images?.[0]?.url && (
                              <img src={group.album_images[0].url} alt={group.album} className="w-12 h-12 rounded" />
                            )}
                            <div className="min-w-0">
                              {(() => {
                                const trackLink = trackUrlFromUri(group.track_uri, group.track_id);
                                return trackLink ? (
                                  <a
                                    href={trackLink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-white font-semibold truncate hover:text-spotify-green hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {group.name}
                                  </a>
                                ) : (
                                  <p className="text-white font-semibold truncate">{group.name}</p>
                                );
                              })()}
                              <p className="text-xs text-spotify-gray-light truncate">
                                {(group.artists || []).map((artistName, artistIdx) => {
                                  const url = artistUrlFrom(
                                    artistName,
                                    group.artist_uris?.[artistIdx],
                                    group.artist_ids?.[artistIdx],
                                    group.artist_external_urls?.[artistIdx]
                                  );
                                  return (
                                    <span key={`${artistName}-${artistIdx}`}>
                                      {url ? (
                                        <a
                                          href={url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="hover:text-white hover:underline"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {artistName}
                                        </a>
                                      ) : (
                                        artistName
                                      )}
                                      {artistIdx < (group.artists?.length || 0) - 1 ? ', ' : ''}
                                    </span>
                                  );
                                })}
                                {' • '}
                                {(() => {
                                  const url = albumUrlFrom(
                                    group.album,
                                    group.album_uri,
                                    group.album_id,
                                    group.album_external_url
                                  );
                                  return url ? (
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="hover:text-white hover:underline"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {group.album}
                                    </a>
                                  ) : (
                                    group.album
                                  );
                                })()}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {/* Ignore button: Only shown for pairs (2 tracks). For groups with 3+ tracks 
                                (e.g., original + remix + acoustic), ignoring specific pairs gets complex 
                                since there are multiple possible pair combinations. Future enhancement: 
                                Allow selecting which specific pairs to ignore within larger groups. */}
                            {group.occurrences.length === 2 && (
                              <Tip label="Ignore this pair" side="top" align="end">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const trackIds = group.occurrences.map(occ => occ.track_id);
                                    setIgnoreTarget({
                                      trackId1: trackIds[0],
                                      trackId2: trackIds[1],
                                      name: group.name,
                                      artists: group.artists
                                    });
                                    setShowIgnoreModal(true);
                                  }}
                                  className="w-8 h-8 rounded-lg bg-spotify-gray-dark/60 border border-spotify-gray-mid/60 text-spotify-gray-light hover:text-spotify-green hover:bg-spotify-gray-mid/60 transition-colors flex items-center justify-center"
                                >
                                  <span className="icon text-sm">block</span>
                                </button>
                              </Tip>
                            )}
                            <span className="text-xs text-spotify-green font-semibold px-2 py-1 rounded-full border border-spotify-green/70">
                              {group.occurrences.length} copies{groupSelected ? `, ${groupSelected} selected` : ''}
                            </span>
                            <span className="icon text-base text-spotify-gray-light">{collapsed ? 'expand_more' : 'expand_less'}</span>
                          </div>
                        </button>

                        {!collapsed && (
                          <div className="space-y-2 pt-1">
                            {sortedOccurrences.map((occ, idx) => {
                              const isRemoved = sel.removePositions?.some((p) => p.uri === occ.uri && p.position === occ.position);
                              const isKept = idx === keptIndex && !isRemoved;
                              const metaParts = [];
                              if (occ.album_type) metaParts.push(`release type: ${occ.album_type}`);
                              if (occ.album_total_tracks) metaParts.push(`tracks: ${occ.album_total_tracks}`);
                              if (occ.album_release_date) {
                                const prec = (occ.album_release_date_precision || '').toLowerCase();
                                metaParts.push(`released: ${occ.album_release_date}${prec && prec !== 'day' ? ` (${prec})` : ''}`);
                              }
                              const detailKey = `${group.track_id}-${idx}`;
                              const showDetails = detailsOpen[detailKey] || false;
                              return (
                                <div key={`${occ.uri}-${occ.position}`} className="bg-spotify-gray-dark/60 rounded-lg px-3 py-2 border border-spotify-gray-mid/60">
                                  <div className="flex items-center gap-3 justify-between">
                                  <div className="flex flex-col min-w-0 text-sm text-white flex-1">
                                      {(() => {
                                    const url = trackUrlFromUri(occ.uri, occ.id || group.track_id);
                                    return url ? (
                                      <a
                                        href={url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="font-semibold truncate hover:text-spotify-green hover:underline"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {occ.name || group.name}
                                      </a>
                                    ) : (
                                      <span className="font-semibold truncate">{occ.name || group.name}</span>
                                    );
                                  })()}
                                  <span className="text-spotify-gray-light text-xs truncate">
                                    {(occ.artists || []).map((artistName, artistIdx) => {
                                      const url = artistUrlFrom(
                                        artistName,
                                        occ.artist_uris?.[artistIdx],
                                            occ.artist_ids?.[artistIdx],
                                            occ.artist_external_urls?.[artistIdx]
                                          );
                                          return (
                                            <span key={`${artistName}-${artistIdx}`}>
                                              {url ? (
                                                <a
                                                  href={url}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  className="hover:text-white hover:underline"
                                                  onClick={(e) => e.stopPropagation()}
                                                >
                                                  {artistName}
                                                </a>
                                              ) : (
                                                artistName
                                              )}
                                              {artistIdx < (occ.artists?.length || 0) - 1 ? ', ' : ''}
                                            </span>
                                          );
                                        })}
                                        {' • '}
                                        {(() => {
                                          const url = albumUrlFrom(
                                            occ.album,
                                            occ.album_uri,
                                            occ.album_id,
                                            occ.album_external_url || occ.album_external_urls?.spotify
                                          );
                                          return url ? (
                                            <a
                                              href={url}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="hover:text-white hover:underline"
                                              onClick={(e) => e.stopPropagation()}
                                            >
                                              {occ.album}
                                            </a>
                                          ) : (
                                            occ.album
                                          );
                                        })()}
                                        {occ.duration_ms != null && (
                                          <>
                                            {' • '}
                                            <span className="whitespace-nowrap">({formatDuration(occ.duration_ms)})</span>
                                          </>
                                        )}
                                      </span>
                                      {(showAlbumMeta || showDetails) && metaParts.length > 0 && (
                                        <span className="text-spotify-gray-light text-[11px] truncate">
                                          {metaParts.join(' • ')}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-spotify-gray-light">
                                      <div className="flex items-center gap-2">
                                        {isKept && (
                                          <div className="relative group">
                                            <span className="text-spotify-green flex items-center justify-center flex-shrink-0">
                                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M12 2C6.5 2 2 6.5 2 12S6.5 22 12 22 22 17.5 22 12 17.5 2 12 2M12 20C7.59 20 4 16.41 4 12S7.59 4 12 4 20 7.59 20 12 16.41 20 12 20M16.59 7.58L10 14.17L7.41 11.59L6 13L10 17L18 9L16.59 7.58Z" />
                                              </svg>
                                            </span>
                                            <div className="tooltip tooltip-left group-hover:tooltip-visible">{`Default keep (${keepStrategy === 'earliest' ? 'earliest' : 'latest'})`}</div>
                                          </div>
                                        )}
                                        {occ.reason === 'similar' && (
                                          <div className="relative group">
                                            <span className="text-amber-300 flex items-center justify-center flex-shrink-0">
                                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M10.59,13.41C11,13.8 11,14.44 10.59,14.83C10.2,15.22 9.56,15.22 9.17,14.83C7.22,12.88 7.22,9.71 9.17,7.76L12.71,4.22C14.66,2.27 17.83,2.27 19.78,4.22C21.73,6.17 21.73,9.34 19.78,11.29L18.29,12.78C18.3,11.96 18.17,11.14 17.89,10.36L18.36,9.88C19.54,8.71 19.54,6.81 18.36,5.64C17.19,4.46 15.29,4.46 14.12,5.64L10.59,9.17C9.41,10.34 9.41,12.24 10.59,13.41M13.41,9.17C13.8,8.78 14.44,8.78 14.83,9.17C16.78,11.12 16.78,14.29 14.83,16.24L11.29,19.78C9.34,21.73 6.17,21.73 4.22,19.78C2.27,17.83 2.27,14.66 4.22,12.71L5.71,11.22C5.7,12.04 5.83,12.86 6.11,13.65L5.64,14.12C4.46,15.29 4.46,17.19 5.64,18.36C6.81,19.54 8.71,19.54 9.88,18.36L13.41,14.83C14.59,13.66 14.59,11.76 13.41,10.59C13,10.2 13,9.56 13.41,9.17Z" />
                                              </svg>
                                            </span>
                                            <div className="tooltip tooltip-left group-hover:tooltip-visible">Similar match (normalized title/artist)</div>
                                          </div>
                                        )}
                                        {occ.reason === 'exact' && (
                                          <div className="relative group">
                                            <span className="text-spotify-gray-light flex items-center justify-center flex-shrink-0">
                                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M11,17H4A2,2 0 0,1 2,15V3A2,2 0 0,1 4,1H16V3H4V15H11V13L15,16L11,19V17M19,21V7H8V13H6V7A2,2 0 0,1 8,5H19A2,2 0 0,1 21,7V21A2,2 0 0,1 19,23H8A2,2 0 0,1 6,21V19H8V21H19Z" />
                                              </svg>
                                            </span>
                                            <div className="tooltip tooltip-left group-hover:tooltip-visible">Identical match (same track ID)</div>
                                          </div>
                                        )}
                                      </div>
                                      <span className="text-xs text-spotify-gray-light w-20 text-right">
                                        {occ.added_at ? new Date(occ.added_at).toLocaleDateString() : 'Unknown'}
                                      </span>
                                      {metaParts.length > 0 && !showAlbumMeta && (
                                        <button
                                          onClick={() => toggleDetails(detailKey)}
                                          className="w-8 h-8 rounded-lg bg-spotify-gray-dark/60 border border-spotify-gray-mid/60 text-white hover:text-spotify-green transition-colors"
                                          aria-label="Toggle details"
                                        >
                                          <span className="icon text-sm">{showDetails ? 'expand_less' : 'expand_more'}</span>
                                        </button>
                                      )}
                                      <label className="inline-flex items-center gap-1">
                                        <input
                                          type="checkbox"
                                          checked={isRemoved}
                                          onChange={() => toggleRemoveSelection(group, occ)}
                                          className="w-4 h-4 rounded border-spotify-gray-light text-spotify-green focus:ring-spotify-green bg-spotify-gray-mid"
                                        />
                                        <span>Remove</span>
                                      </label>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {duplicatesError && <p className="text-red-400 text-sm">{duplicatesError}</p>}
                </div>
              )}

              {duplicatesError && !duplicatesLoading && !duplicates && (
                <div className="text-red-400 text-sm">{duplicatesError}</div>
              )}

              {duplicatesMode === 'options' && !duplicatesLoading && !duplicatesError && (
                <div className="text-sm text-spotify-gray-light">
                  Set your options and click Detect matches to see duplicates.
                </div>
              )}
            </div>

            <div className="p-6 pt-4 border-t border-spotify-gray-mid/50 flex items-center justify-between gap-3">
              <button
                onClick={() => { setShowDuplicatesModal(false); setDuplicates(null); setDuplicatesError(null); }}
                className="px-4 py-2 rounded-lg border border-spotify-gray-mid/60 text-spotify-gray-light hover:text-white hover:border-white transition-colors"
              >
                Cancel
              </button>
              {duplicatesMode === 'options' ? (
                <button
                  onClick={() => handleAnalyzeDuplicates({ includeSimilar, preferAlbumRelease, keepStrategy })}
                  className="px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  disabled={duplicatesLoading}
                >
                  Detect matches
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  {optionsDirty && (
                    <button
                      onClick={() => handleAnalyzeDuplicates({ includeSimilar, preferAlbumRelease, keepStrategy })}
                      className="px-4 py-2 rounded-lg bg-spotify-gray-mid hover:bg-spotify-green hover:text-black text-white font-semibold transition-colors"
                      disabled={duplicatesLoading}
                    >
                      Re-run detection
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (!window.confirm('Apply removals to this playlist? This action is irreversible.')) {
                        return;
                      }
                      handleRemoveDuplicates();
                    }}
                    disabled={removingDuplicates}
                    className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {removingDuplicates ? 'Removing…' : 'Apply removals'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Ignore Pair Scope Modal */}
      {showIgnoreModal && ignoreTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center px-4">
          <div className="bg-gradient-to-b from-spotify-gray-dark to-spotify-black max-w-lg w-full rounded-2xl shadow-2xl border border-spotify-gray-mid/60 flex flex-col max-h-[90vh]">
            <div className="p-6 pb-4 border-b border-spotify-gray-mid/50 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-spotify-gray-light mb-1">Ignore Duplicate</p>
                <h2 className="text-2xl font-bold text-white">
                  {ignoreTarget.name}
                </h2>
                {ignoreTarget.artists && (
                  <p className="text-sm text-spotify-gray-light mt-1">
                    {ignoreTarget.artists.join(', ')}
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setShowIgnoreModal(false);
                  setIgnoreTarget(null);
                }}
                className="w-9 h-9 rounded-full flex items-center justify-center text-spotify-gray-light hover:text-white hover:bg-spotify-gray-mid/60"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 flex-1 overflow-y-auto space-y-4">
              <p className="text-sm text-white">
                Choose where to ignore this duplicate pair:
              </p>
              
              {ignoringPair ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-spotify-green"></div>
                  <span className="ml-3 text-white">Ignoring pair...</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <button
                    onClick={() => handleIgnorePair('playlist')}
                    disabled={ignoringPair}
                    className="w-full p-4 rounded-lg bg-spotify-gray-mid border border-spotify-gray-mid/60 hover:border-spotify-green hover:bg-spotify-gray-mid/80 text-left transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-start gap-3">
                      <span className="icon text-lg text-spotify-green mt-0.5">playlist_play</span>
                      <div>
                        <p className="text-white font-semibold group-hover:text-spotify-green">This playlist only</p>
                        <p className="text-xs text-spotify-gray-light mt-1">
                          Hide this pair in "{playlist.name}" but show it in other playlists
                        </p>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => handleIgnorePair('global')}
                    disabled={ignoringPair}
                    className="w-full p-4 rounded-lg bg-spotify-gray-mid border border-spotify-gray-mid/60 hover:border-spotify-green hover:bg-spotify-gray-mid/80 text-left transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-start gap-3">
                      <span className="icon text-lg text-spotify-green mt-0.5">public</span>
                      <div>
                        <p className="text-white font-semibold group-hover:text-spotify-green">All playlists</p>
                        <p className="text-xs text-spotify-gray-light mt-1">
                          Hide this pair everywhere across all your playlists
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            <div className="p-6 pt-4 border-t border-spotify-gray-mid/50">
              <button
                onClick={() => {
                  setShowIgnoreModal(false);
                  setIgnoreTarget(null);
                }}
                className="w-full px-4 py-2 rounded-lg border border-spotify-gray-mid/60 text-spotify-gray-light hover:text-white hover:border-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back Button */}
      <button
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold shadow-md transition-all hover:scale-[1.02]"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        <span>Back to Playlists</span>
      </button>

      {/* Playlist Header */}
      <div className="bg-gradient-to-b from-spotify-gray-dark to-transparent rounded-lg p-8 mb-6">
        <div className="flex flex-col md:flex-row gap-6">
          {/* Cover Image */}
          <div className="w-60 h-60 flex-shrink-0 shadow-2xl relative group">
            <div className="absolute inset-0 rounded-lg overflow-hidden bg-spotify-gray-mid">
              {currentPlaylist.images && currentPlaylist.images.length > 0 ? (
                <img
                  src={getBestImage(currentPlaylist.images)}
                  alt={currentPlaylist.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <svg className="w-24 h-24 text-spotify-gray-light" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                  </svg>
                </div>
              )}
            </div>
            <div className="absolute inset-3 flex items-start justify-end opacity-0 group-hover:opacity-100 transition-opacity z-40">
              <div className="relative group">
                <a
                  href={(currentPlaylist.external_urls && currentPlaylist.external_urls.spotify) || `https://open.spotify.com/playlist/${currentPlaylist.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="w-9 h-9 rounded-lg bg-spotify-green text-black flex items-center justify-center hover:bg-spotify-green-dark transition-colors shadow-md"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </a>
                <div className="tooltip tooltip-left group-hover:tooltip-visible z-50">Play playlist on Spotify</div>
              </div>
            </div>
          </div>

      {/* Playlist Info */}
      <div className="flex flex-col justify-end">
            <p className="text-sm text-spotify-gray-light uppercase font-semibold mb-2">Playlist</p>
            <h1 className="text-4xl md:text-6xl font-bold text-white mb-4">{currentPlaylist.name}</h1>
            {playlistDescription && (
              <p className="text-spotify-gray-light mb-4 max-w-2xl">{playlistDescription}</p>
            )}
            <div className="flex items-center space-x-2 text-sm text-spotify-gray-light">
              {(currentPlaylist.owner?.display_name || currentPlaylist.owner?.id) && (
                <>
                  <span className="font-semibold text-white">{currentPlaylist.owner.display_name || currentPlaylist.owner.id}</span>
                  <span>•</span>
                </>
              )}
              <span>
                {(currentPlaylist.total_tracks ?? allTracks.length) > 0 
                  ? `${(currentPlaylist.total_tracks ?? allTracks.length).toLocaleString()} song${(currentPlaylist.total_tracks ?? allTracks.length) === 1 ? '' : 's'}`
                  : 'No songs'}
              </span>
              <span>•</span>
              <span>
                {hours > 0 ? `${hours} hr ${minutes} min` : `${minutes} min`}
              </span>
              <span>•</span>
              <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${currentPlaylist.public ? 'border-spotify-green text-spotify-green' : 'border-spotify-gray-light text-spotify-gray-light'}`}>
                  {currentPlaylist.public ? 'Public' : 'Private'}
                </span>
                {currentPlaylist.collaborative && (
                  <span className="text-xs font-semibold px-2 py-1 rounded-full border border-spotify-green/70 text-spotify-green">
                    Collaborative
                  </span>
                )}
              </div>
            {currentPlaylist.followers != null && currentPlaylist.followers > 0 && (
              <>
                <span>•</span>
                <span>{currentPlaylist.followers.toLocaleString()} followers</span>
              </>
            )}
            <div className="flex items-center gap-2">
              <span>•</span>
              <div className="relative group">
                <button
                  type="button"
                  onClick={() => navigate('/cache')}
                  className={`w-9 h-9 rounded-full border transition-colors flex items-center justify-center ${
                    userCachedTracks > 0
                      ? 'border-spotify-green text-spotify-green bg-spotify-green/10 hover:bg-spotify-green/20'
                      : 'border-amber-400 text-amber-200 bg-amber-500/10 hover:bg-amber-500/20'
                  }`}
                  aria-label={userCachedTracks > 0 ? 'Cache active' : 'Cache empty'}
                >
                  <span className="icon text-base">download_for_offline</span>
                </button>
                <div className="tooltip tooltip-up group-hover:tooltip-visible">
                  <div className="text-xs">
                    <div className="font-semibold mb-1">Playlist Cache</div>
                    <div className="space-y-0.5 text-[11px]">
                      <div>{userCachedTracks.toLocaleString()} tracks from this playlist cached</div>
                      {userExpiredTracks > 0 && <div className="text-amber-300">{userExpiredTracks.toLocaleString()} expired</div>}
                      <div className="text-spotify-gray-light">{totalCachedTracks.toLocaleString()} total (all users)</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {schedules.length > 0 && (
              <>
                <span>•</span>
                <div className="relative group">
                  <button
                    onClick={() => navigate(`/schedules?playlistId=${currentPlaylist.id}`)}
                    className="text-spotify-green text-xs font-semibold bg-spotify-green/10 px-2 py-1 rounded-full border border-spotify-green/60 hover:bg-spotify-green/20 transition-colors"
                  >
                    Scheduled ({schedules.length})
                  </button>
                  <div className="tooltip tooltip-up group-hover:tooltip-visible">
                    Manage schedules
                  </div>
                </div>
              </>
            )}
          </div>
            <div className="mt-4 relative">
              <div className="flex flex-wrap items-center gap-3">
                {player?.canUseAppPlayer && (
                  <>
                    <div className="relative group">
                      <button
                        type="button"
                        onClick={() => {
                          if (isPlaylistActive) {
                            player.togglePlay();
                          } else {
                            const firstTrack = tracksSource[0];
                            const contextMeta = currentPlaylist ? {
                              id: currentPlaylist.id,
                              name: currentPlaylist.name,
                              uri: currentPlaylist.uri,
                              externalUrl: currentPlaylist.external_urls?.spotify,
                            } : null;
                            if (firstTrack) {
                              const offsetIndex = Number.isFinite(firstTrack.playlistIndex) ? firstTrack.playlistIndex : 0;
                              player.playTrack({ track: firstTrack, contextUri: currentPlaylist.uri, offsetIndex, contextMeta });
                            } else {
                              player.playTrack({ contextUri: currentPlaylist.uri, offsetIndex: 0, contextMeta });
                            }
                          }
                        }}
                        className="w-12 h-12 rounded-full bg-spotify-green text-black flex items-center justify-center hover:bg-spotify-green-dark transition-colors"
                        aria-label={isPlaylistPlaying ? 'Pause playlist' : 'Play playlist'}
                      >
                        <span className="icon text-xl">{isPlaylistPlaying ? 'pause' : 'play_arrow'}</span>
                      </button>
                      <div className="tooltip tooltip-up group-hover:tooltip-visible">
                        {isPlaylistPlaying ? 'Pause playlist' : 'Play playlist'}
                      </div>
                    </div>
                    <div className="relative group">
                      <button
                        type="button"
                        onClick={async () => {
                          const tracks = tracksSource;
                          const offsetIndex = tracks.length ? Math.floor(Math.random() * tracks.length) : 0;
                          const randomTrack = tracks[offsetIndex];
                          const contextMeta = currentPlaylist ? {
                            id: currentPlaylist.id,
                            name: currentPlaylist.name,
                            uri: currentPlaylist.uri,
                            externalUrl: currentPlaylist.external_urls?.spotify,
                          } : null;
                          if (randomTrack) {
                            const safeOffset = Number.isFinite(randomTrack.playlistIndex) ? randomTrack.playlistIndex : offsetIndex;
                            player.playTrack({ track: randomTrack, contextUri: currentPlaylist.uri, offsetIndex: safeOffset, contextMeta, shuffle: true });
                          } else {
                            player.playTrack({ contextUri: currentPlaylist.uri, offsetIndex, contextMeta, shuffle: true });
                          }
                        }}
                        className="w-12 h-12 rounded-full border border-spotify-green/60 text-spotify-green flex items-center justify-center hover:bg-spotify-green/10 transition-colors"
                        aria-label="Shuffle playlist"
                      >
                        <span className="icon text-xl">shuffle</span>
                      </button>
                      <div className="tooltip tooltip-up group-hover:tooltip-visible">
                        Shuffle playlist
                      </div>
                    </div>
                    <div className="relative group">
                      <button
                        type="button"
                        onClick={() => setSearchOpen((prev) => !prev)}
                        className={`w-12 h-12 rounded-full border flex items-center justify-center transition-colors ${
                          searchOpen
                            ? 'border-spotify-green text-spotify-green bg-spotify-green/10'
                            : 'border-spotify-gray-mid/60 text-spotify-gray-light hover:text-white hover:border-spotify-gray-light'
                        }`}
                        aria-label="Search this playlist"
                      >
                        <span className="icon text-xl">search</span>
                      </button>
                      <div className="tooltip tooltip-up group-hover:tooltip-visible">
                        Search playlist
                      </div>
                    </div>
                    <div className="relative group">
                      <button
                        type="button"
                        onClick={() => refreshPlaylistDetails({ resetSort: true })}
                        disabled={refreshing}
                        className="w-12 h-12 rounded-full border border-spotify-gray-mid/60 text-spotify-gray-light hover:text-white hover:border-spotify-gray-light flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Refresh playlist"
                      >
                        <span className={`icon text-xl ${refreshing ? 'animate-spin' : ''}`}>refresh</span>
                      </button>
                      <div className="tooltip tooltip-up group-hover:tooltip-visible">
                        {refreshing ? 'Refreshing…' : 'Refresh playlist'}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {(() => {
                  const historyAvailable = Array.isArray(history) && history.length > 0;
                  const baseActions = [
                  {
                    label: 'Reorder in Spotify',
                    onClick: () => setShowSortModal(true),
                    icon: "reorder",
                    colorClass: 'bg-spotify-gray-mid hover:bg-spotify-green hover:text-black',
                    disabled: false
                  },
                  {
                    label: 'Find duplicates',
                    onClick: () => { setShowDuplicatesModal(true); setDuplicates(null); setDuplicatesError(null); setDuplicatesLoading(false); },
                    icon: "manage_search",
                    colorClass: 'bg-spotify-gray-mid hover:bg-spotify-green hover:text-black',
                    disabled: false
                  },
                  {
                    label: 'Edit playlist',
                    onClick: () => setShowEditModal(true),
                    icon: "edit",
                    colorClass: 'bg-spotify-gray-mid hover:bg-spotify-green hover:text-black',
                    disabled: false
                  },
                  {
                    label: cloning ? 'Cloning…' : 'Clone playlist',
                    onClick: async () => {
                      setEditError(null); setEditMessage(null);
                      // Generate clone name by checking existing playlists
                      try {
                        const allPlaylists = await playlistAPI.getPlaylists();
                        
                        // Extract base name by removing existing (clone N) suffix if present
                        const cloneRegex = /^(.+?)\s*\(clone\s+\d+\)$/i;
                        const match = currentPlaylist.name.match(cloneRegex);
                        const baseName = match ? match[1].trim() : currentPlaylist.name;
                        
                        // Find all existing clones with this base name
                        const existingClones = allPlaylists
                          .map(p => {
                            const cloneMatch = p.name.match(new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(clone\\s+(\\d+)\\)$`, 'i'));
                            return cloneMatch ? parseInt(cloneMatch[1], 10) : null;
                          })
                          .filter(num => num !== null);
                        
                        // Find the next available clone number
                        const cloneNumber = existingClones.length > 0 ? Math.max(...existingClones) + 1 : 1;
                        const suggestedName = `${baseName} (clone ${cloneNumber})`;
                        
                        setCloneName(suggestedName);
                        setShowCloneModal(true);
                      } catch (err) {
                        setEditError(err.message || 'Failed to prepare clone');
                      }
                    },
                    icon: "difference",
                    colorClass: 'bg-spotify-gray-mid hover:bg-spotify-green hover:text-black',
                    disabled: cloning
                  },
                ];

                const historyActions = [];
                if (historyAvailable) {
                  historyActions.push({
                    label: 'Recent actions',
                    onClick: () => navigate('/history'),
                    icon: "history",
                    colorClass: 'bg-spotify-gray-mid hover:bg-spotify-green hover:text-black',
                    disabled: false
                  });
                }

                const deleteAction = {
                  label: deleting ? 'Deleting…' : 'Delete playlist',
                  onClick: async () => {
                    if (!window.confirm('Delete this playlist from your library?')) return;
                    setEditError(null); setEditMessage(null);
                    setDeleting(true);
                    try {
                      await playlistAPI.deletePlaylist(currentPlaylist.id);
                      navigate('/playlists');
                    } catch (err) {
                      setEditError(err.message || 'Delete failed');
                    } finally {
                      setDeleting(false);
                    }
                  },
                    icon: "delete",
                  colorClass: 'bg-spotify-gray-mid hover:bg-red-600 hover:text-white text-red-400',
                  disabled: deleting,
                    tooltipClass: 'tooltip tooltip-down tooltip-danger',
                    tooltipSide: 'down'
                };

                const scheduleAction = {
                  label: 'View schedules',
                  onClick: () => navigate(`/schedules?playlistId=${currentPlaylist.id}`),
                  icon: "event",
                  colorClass: 'bg-spotify-gray-mid hover:bg-spotify-green hover:text-black',
                  disabled: false
                };

                const actions = [...baseActions, ...historyActions, scheduleAction, deleteAction];
              return actions;
                })().map((action, idx) => (
                  <div key={idx} className="relative group">
                    <button
                      onClick={action.onClick}
                      onMouseEnter={action.onMouseEnter}
                      onMouseLeave={action.onMouseLeave}
                      disabled={action.disabled}
                      className={`w-10 h-10 rounded-lg ${action.colorClass} text-white flex items-center justify-center transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <span className="icon text-base">{action.icon}</span>
                    </button>
                    {!action.noTooltip && (
                      <div className={`tooltip ${action.tooltipSide === 'down' ? 'tooltip-down' : 'tooltip-up'} group-hover:tooltip-visible ${action.tooltipClass || ''}`}>
                        {action.label}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {searchOpen && (
                <div className="mt-3 flex items-center gap-3 bg-spotify-gray-dark/50 border border-spotify-gray-mid/60 rounded-xl px-3 py-2">
                  <span className="icon text-lg text-spotify-gray-light">search</span>
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search this playlist"
                    className="flex-1 bg-transparent text-sm text-white placeholder:text-spotify-gray-light focus:outline-none"
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="text-spotify-gray-light hover:text-white"
                      aria-label="Clear search"
                    >
                      <span className="icon text-base">close</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSearchOpen(false)}
                      className="text-spotify-gray-light hover:text-white"
                      aria-label="Close search"
                    >
                      <span className="icon text-base">close</span>
                    </button>
                  )}
                </div>
              )}
              {schedulesOpen && Array.isArray(schedules) && schedules.length > 0 && (
                <div
                  className="absolute right-full mr-2 top-0 p-3 bg-spotify-gray-mid/90 border border-spotify-gray-mid/60 rounded-lg text-sm text-spotify-gray-light space-y-2 max-w-md z-50 shadow-xl"
                  onMouseEnter={() => {
                    if (schedulesHoverTimer.current) clearTimeout(schedulesHoverTimer.current);
                    setSchedulesOpen(true);
                  }}
                  onMouseLeave={() => {
                    if (schedulesHoverTimer.current) clearTimeout(schedulesHoverTimer.current);
                    schedulesHoverTimer.current = setTimeout(() => setSchedulesOpen(false), 120);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">Active schedules</span>
                    <button
                      onClick={() => navigate(`/schedules?playlistId=${currentPlaylist.id}`)}
                      className="text-xs text-spotify-green hover:underline"
                    >
                      Manage →
                    </button>
                  </div>
                  {schedules.map((sched) => {
                    const params = sched.params || {};
                    const friendlySort = {
                      date_added: 'Date added',
                      title: 'Title',
                      artist: 'Artist',
                      album: 'Album',
                      release_date: 'Release date',
                      duration: 'Duration',
                    }[params.sort_by] || 'Date added';
                    const friendlyDirection = params.direction === 'asc' ? 'Ascending' : 'Descending';
                    const friendlyMethod = params.method === 'fast' ? 'Fast' : 'Preserve dates';
                    const desc = `${friendlySort} • ${friendlyDirection} • ${friendlyMethod}`;
                    const scheduleType = params.schedule_type || 'custom';
                    const hasError = sched.status === 'failed';
                    const isRunning = sched.status === 'running';
                    const wasSuccessful = sched.status === 'success';
                    
                    return (
                      <div key={sched.id} className={`flex flex-col gap-1 p-2 rounded-lg ${hasError ? 'bg-red-900/20 border border-red-500/30' : 'bg-spotify-gray-dark/40'}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-white text-xs font-medium capitalize">{scheduleType}</span>
                          {!sched.enabled && (
                            <span className="text-[11px] text-spotify-gray-light bg-spotify-gray-dark/60 px-2 py-0.5 rounded-full">Paused</span>
                          )}
                          {hasError && (
                            <span className="text-[11px] text-red-400 font-semibold">✗ Failed</span>
                          )}
                          {isRunning && (
                            <span className="text-[11px] text-amber-300 font-semibold">◐ Running</span>
                          )}
                          {wasSuccessful && sched.last_run_at && (
                            <span className="text-[11px] text-spotify-green font-semibold">✓ Success</span>
                          )}
                        </div>
                        <span className="text-[11px] text-spotify-gray-light">{desc}</span>
                        {sched.next_run_at && sched.enabled && (
                          <div className="text-[11px] text-spotify-gray-light">
                            Next: {new Date(sched.next_run_at).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                        )}
                        {sched.last_run_at && (
                          <div className="text-[11px] text-spotify-gray-light">
                            Last: {new Date(sched.last_run_at).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                        )}
                        {hasError && sched.last_error && (
                          <div className="text-[11px] text-red-400 mt-1 break-words" title={sched.last_error}>
                            Error: {sched.last_error.length > 100 ? sched.last_error.substring(0, 100) + '...' : sched.last_error}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tracks Table */}
      <div className="bg-spotify-gray-dark/40 rounded-lg overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-4 py-3 text-sm text-spotify-gray-light border-b border-spotify-gray-mid font-semibold">
          <div className="col-span-1 text-center">
            {selectedTrackCount > 0 ? (
              <div className="flex items-center justify-center gap-2 text-[11px] text-spotify-gray-light">
                <span className="text-white font-semibold">{selectedTrackCount} selected</span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTrackKeys([]);
                    setTrackActionError(null);
                  }}
                  className="w-5 h-5 rounded-full flex items-center justify-center text-spotify-gray-light hover:text-white hover:bg-spotify-gray-mid/60"
                  aria-label="Clear selection"
                  title="Clear selection"
                >
                  <span className="icon text-sm">close</span>
                </button>
              </div>
            ) : (
              '#'
            )}
          </div>
          
          <button 
            onClick={() => handleSort('title')}
            className="col-span-5 md:col-span-3 text-left hover:text-white transition-colors flex items-center gap-2 group"
          >
            TITLE
            <SortIndicator column="title" />
          </button>
          
          <button
            onClick={() => handleSort('album')}
            className="hidden md:flex col-span-3 hover:text-white transition-colors items-center gap-2 group"
          >
            ALBUM
            <SortIndicator column="album" />
          </button>

          <button
            onClick={() => handleSort('release_date')}
            className="hidden md:flex col-span-2 hover:text-white transition-colors items-center gap-2 group"
          >
            RELEASE
            <SortIndicator column="release_date" />
          </button>
          
          <button
            onClick={() => handleSort('date_added')}
            className="col-span-4 md:col-span-2 hover:text-white transition-colors flex items-center gap-2 group"
          >
            DATE ADDED
            <SortIndicator column="date_added" />
          </button>
          
          <button
            onClick={() => handleSort('duration')}
            className="col-span-2 md:col-span-1 text-center hover:text-white transition-colors flex items-center justify-center gap-2 group"
          >
            DURATION
            <SortIndicator column="duration" />
          </button>
        </div>

        {/* Tracks */}
        <div className="divide-y divide-spotify-gray-mid/30">
          {sortedTracks.map((track, index) => {
            const isCurrentTrack = isSamePlaylistEntry(track);
            const isPlayingTrack = isCurrentTrack && !player?.isPaused;
            const isSelected = selectedTrackSet.has(track.selectionKey);
            const tooltipLabel = player?.canUseAppPlayer ? 'Play in Playlist Polisher' : 'Play on Spotify';
            const albumMetaParts = [];
            if (track.album?.album_type) albumMetaParts.push(`release type: ${track.album.album_type}`);
            if (track.album?.total_tracks) albumMetaParts.push(`tracks: ${track.album.total_tracks}`);
            if (track.album?.release_date) {
              const prec = (track.album?.release_date_precision || '').toLowerCase();
              const formatted = formatReleaseDate(track.album.release_date, track.album.release_date_precision);
              albumMetaParts.push(`released: ${formatted}${prec && prec !== 'day' ? ` (${prec})` : ''}`);
            }
            const albumMetaLabel = albumMetaParts.length > 0 ? (
              <div className="space-y-1 text-xs">
                {albumMetaParts.map((part, partIndex) => (
                  <div key={`${track.selectionKey}-meta-${partIndex}`}>{part}</div>
                ))}
              </div>
            ) : null;

            return (
              <div
                key={track.selectionKey}
                onClick={(event) => handleTrackRowSelect(event, track, index)}
                onContextMenu={(event) => openContextMenu(event, track, index)}
                className={`grid grid-cols-12 gap-4 px-4 py-3 text-sm transition-colors group relative ${
                  isCurrentTrack ? 'bg-spotify-green/10 border-l-2 border-spotify-green/80' : isSelected ? 'bg-spotify-gray-mid/40' : 'hover:bg-spotify-gray-mid/30'
                }`}
                aria-selected={isSelected}
                data-track-id={track.id}
                data-track-uri={track.uri}
                data-track-linked-id={track.linked_from?.id}
                data-track-linked-uri={track.linked_from?.uri}
              >
              {/* Track Number */}
              <div className="col-span-1 text-center text-spotify-gray-light flex items-center justify-center group relative">
                <button
                  type="button"
                  data-no-select
                  onClick={(event) => handleTrackToggleSelect(event, track, index)}
                  className={`absolute left-0 w-6 h-6 rounded-full flex items-center justify-center transition-opacity ${
                    isSelected ? 'opacity-100 text-spotify-green' : 'opacity-0 group-hover:opacity-70 text-spotify-gray-light'
                  }`}
                  aria-label={isSelected ? 'Deselect track' : 'Select track'}
                  title={isSelected ? 'Deselect track' : 'Select track'}
                >
                  <span className="icon text-base">
                    {isSelected ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                </button>
                {isCurrentTrack ? (
                  <span className="text-spotify-green">
                    <span className="icon text-base">pause</span>
                  </span>
                ) : isSelected ? (
                  <span className="text-spotify-green">
                    <span className="icon text-base">check</span>
                  </span>
                ) : (
                  <span className="group-hover:opacity-0 transition-opacity">{index + 1}</span>
                )}
                {(track.external_urls?.spotify || track.id || track.uri) && (
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-30 pointer-events-none">
                  <Tip label={tooltipLabel} side="top" align="center">
                    <button
                      type="button"
                      data-no-select
                      className="w-8 h-8 rounded-lg bg-spotify-green text-black flex items-center justify-center hover:bg-spotify-green-dark transition-colors shadow pointer-events-auto"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTrackPlay(track, Number.isFinite(track.playlistIndex) ? track.playlistIndex : index);
                      }}
                      aria-label={tooltipLabel}
                    >
                      <span className="icon text-lg">
                        {isCurrentTrack ? (isPlayingTrack ? 'pause' : 'play_arrow') : 'play_arrow'}
                      </span>
                    </button>
                  </Tip>
                </div>
              )}
            </div>

              {/* Title & Artist */}
              <div className="col-span-5 md:col-span-3 flex items-center space-x-3 min-w-0">
                {track.album.images && track.album.images.length > 0 && (
                  <img
                    src={getBestImage(track.album.images)}
                    alt={track.album.name}
                    className="w-10 h-10 rounded flex-shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  {(() => {
                    const trackUrl = (track.external_urls && track.external_urls.spotify) || (track.id ? `https://open.spotify.com/track/${track.id}` : null);
                    const trackTitle = track.name || '';
                    return trackUrl ? (
                      <a
                        href={trackUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-white font-medium truncate group-hover:text-spotify-green transition-colors hover:underline"
                        onClick={(e) => e.stopPropagation()}
                        title={trackTitle}
                      >
                        {track.name}
                        {track.explicit && (
                          <span className="ml-2 text-xs bg-spotify-gray-light text-black px-1 py-0.5 rounded">E</span>
                        )}
                      </a>
                    ) : (
                      <p className="block text-white font-medium truncate group-hover:text-spotify-green transition-colors" title={trackTitle}>
                        {track.name}
                        {track.explicit && (
                          <span className="ml-2 text-xs bg-spotify-gray-light text-black px-1 py-0.5 rounded">E</span>
                        )}
                      </p>
                    );
                  })()}
                  <p className="text-spotify-gray-light text-xs truncate">
                    {track.artists.map((a, i) => {
                      const url = a.external_urls?.spotify || (a.id ? `https://open.spotify.com/artist/${a.id}` : null);
                      const name = a.name;
                      return (
                        <span key={a.id || `${name}-${i}`}>
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:text-white hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {name}
                            </a>
                          ) : name}
                          {i < track.artists.length - 1 ? ', ' : ''}
                        </span>
                      );
                    })}
                  </p>
                </div>
              </div>

              {/* Album */}
              <div className="hidden md:flex col-span-3 items-center min-w-0">
                {(() => {
                  const albumNode = track.album?.id || track.album?.external_urls?.spotify ? (
                    <a
                      href={(track.album.external_urls && track.album.external_urls.spotify) || `https://open.spotify.com/album/${track.album.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-spotify-gray-light truncate hover:text-white hover:underline cursor-pointer transition-colors"
                      onClick={(e) => e.stopPropagation()}
                      title={track.album?.name}
                    >
                      {track.album.name}
                    </a>
                  ) : (
                    <p className="text-spotify-gray-light truncate" title={track.album?.name}>
                      {track.album.name}
                    </p>
                  );
                  return albumMetaLabel ? (
                    <Tip label={albumMetaLabel} side="top" align="start">
                      {albumNode}
                    </Tip>
                  ) : albumNode;
                })()}
              </div>

              {/* Release Date */}
              <div className="hidden md:flex col-span-2 items-center text-spotify-gray-light">
                {formatReleaseDate(track.album?.release_date, track.album?.release_date_precision)}
              </div>

              {/* Date Added */}
              <div className="col-span-4 md:col-span-2 flex items-center text-spotify-gray-light">
                {formatDateTime(track.added_at)}
              </div>

              {/* Duration */}
              <div className="col-span-2 md:col-span-1 flex items-center justify-center text-spotify-gray-light">
                {formatDuration(track.duration_ms)}
              </div>
              <button
                type="button"
                data-no-select
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openContextMenu(event, track, index, event.currentTarget);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full text-spotify-gray-light hover:text-white hover:bg-spotify-gray-mid/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-colors"
                aria-label="Track actions"
                title="Track actions"
              >
                <span className="icon text-base">more_vert</span>
              </button>
              </div>
            );
          })}
          
          {/* Infinite scroll loading indicator */}
          {loadingMore && (
            <div className="py-8 flex items-center justify-center">
              <div className="flex items-center gap-3 text-spotify-gray-light">
                <div className="w-5 h-5 border-2 border-spotify-green border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">Loading more tracks...</span>
              </div>
            </div>
          )}
          
          {/* End of list indicator */}
          {!hasMoreTracks && allTracks.length > 0 && (
            <div className="py-6 text-center text-spotify-gray-light text-sm">
              {totalTrackCount > 0 ? (
                <span>All {totalTrackCount} tracks loaded</span>
              ) : (
                <span>End of playlist</span>
              )}
            </div>
          )}
        </div>
      </div>

      {contextMenu && (
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
              onClick={handlePlaySelection}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-spotify-gray-mid/60 text-white"
            >
              <span className="icon text-base">play_arrow</span>
              Play selection
            </button>
            <button
              type="button"
              onClick={() => openTrackActionModal('add')}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-spotify-gray-mid/60"
            >
              <span className="icon text-base">playlist_add</span>
              Add to playlist
            </button>
            <button
              type="button"
              onClick={() => openTrackActionModal('move')}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-spotify-gray-mid/60"
            >
              <span className="icon text-base">drive_file_move</span>
              Move to playlist
            </button>
            <button
              type="button"
              onClick={handleRemoveSelection}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-spotify-gray-mid/60 text-red-300"
            >
              <span className="icon text-base">delete</span>
              Remove from this playlist
            </button>
            <button
              type="button"
              onClick={() => {
                setCreatePlaylistOpen(true);
                closeContextMenu();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-spotify-gray-mid/60"
            >
              <span className="icon text-base">library_add</span>
              Create playlist from selection
            </button>
            <button
              type="button"
              onClick={handleShareSelection}
              disabled={selectedTrackCount !== 1}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-spotify-gray-mid/60 ${
                selectedTrackCount !== 1 ? 'opacity-40 cursor-not-allowed' : ''
              }`}
            >
              <span className="icon text-base">share</span>
              Share track
            </button>
          </div>
        </div>
      )}

      {trackActionOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-spotify-gray-dark rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 border border-spotify-gray-mid/60">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Track actions</p>
                <h3 className="text-2xl font-semibold text-white">
                  {trackActionMode === 'move' ? 'Move to playlist' : 'Add to playlist'}
                </h3>
                <p className="text-sm text-spotify-gray-light mt-1">
                  {selectedTrackCount} track{selectedTrackCount === 1 ? '' : 's'} selected
                </p>
              </div>
              <button
                type="button"
                onClick={closeTrackActionModal}
                className="w-9 h-9 rounded-full flex items-center justify-center text-spotify-gray-light hover:text-white hover:bg-spotify-gray-mid/60"
              >
                <span className="icon text-lg">close</span>
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2">
                  <label htmlFor="playlist-action-sort" className="text-sm text-spotify-gray-light">
                    Sort:
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      id="playlist-action-sort"
                      value={targetPlaylistSortOption}
                      onChange={(event) => handleTargetPlaylistSortChange(event.target.value)}
                      className="bg-spotify-gray-dark text-white text-sm rounded-md px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                    >
                      <option value="default">Default (Spotify order)</option>
                      {targetCacheSortEnabled && (
                        <option value="recently-updated-estimated">Recently updated (estimated)</option>
                      )}
                      <option value="name-asc">Name A → Z</option>
                      <option value="name-desc">Name Z → A</option>
                      <option value="tracks-desc">Tracks ↓</option>
                      <option value="tracks-asc">Tracks ↑</option>
                      <option value="owner-asc">Owner A → Z</option>
                      <option value="owner-desc">Owner Z → A</option>
                    </select>
                    {targetPlaylistSortSpinner && (
                      <span className="icon text-xs text-spotify-gray-light animate-spin">autorenew</span>
                    )}
                  </div>
                </div>
                {targetCacheSortEnabled && targetPlaylistSortOption === 'recently-updated-estimated' && (
                  <div className="relative group">
                    <button
                      type="button"
                      className="w-8 h-8 rounded-full flex items-center justify-center text-spotify-gray-light hover:text-white hover:bg-spotify-gray-mid/60 transition-colors"
                      aria-label="Recently updated sort details"
                    >
                      <span className="icon text-base">info</span>
                    </button>
                    <div className="tooltip tooltip-up group-hover:tooltip-visible">
                      Based on the most recent track added to each playlist from cached data.
                    </div>
                  </div>
                )}
              </div>
              <input
                type="text"
                value={targetPlaylistQuery}
                onChange={(event) => setTargetPlaylistQuery(event.target.value)}
                placeholder="Search playlists"
                className="w-full px-3 py-2 rounded-lg bg-spotify-gray-dark border border-spotify-gray-mid text-sm text-white placeholder-spotify-gray-light focus:outline-none focus:ring-2 focus:ring-spotify-green"
              />
              <div className="max-h-64 overflow-y-auto space-y-2">
                {targetPlaylistsLoading && (
                  <div className="text-spotify-gray-light text-sm">Loading playlists…</div>
                )}
                {!targetPlaylistsLoading && targetPlaylistsError && (
                  <div className="text-red-400 text-sm">{targetPlaylistsError}</div>
                )}
                {!targetPlaylistsLoading && !targetPlaylistsError && filteredTargetPlaylists.length === 0 && (
                  <div className="text-spotify-gray-light text-sm">No matching playlists.</div>
                )}
                {!targetPlaylistsLoading && !targetPlaylistsError && (
                  <>
                    {sortedTargetPlaylists.matches.map((pl) => renderTargetPlaylistButton(pl))}
                    {sortedTargetPlaylists.matches.length > 0 && sortedTargetPlaylists.rest.length > 0 && (
                      <div className="border-t border-spotify-gray-mid/60 my-1" />
                    )}
                    {sortedTargetPlaylists.rest.map((pl) => renderTargetPlaylistButton(pl))}
                  </>
                )}
              </div>
              {targetPlaylistId && (
                <div className="border-t border-spotify-gray-mid/60 pt-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs uppercase tracking-wide text-spotify-gray-light">Already in playlist</div>
                    {targetPlaylistMatch?.cached && selectedTrackCount > 0 && (
                      <button
                        type="button"
                        onClick={handleToggleMatchDetails}
                        className="text-xs text-spotify-gray-light hover:text-white"
                      >
                        {showMatchDetails ? 'Hide details' : 'Show details'}
                      </button>
                    )}
                  </div>
                  {targetPlaylistMatchLoading && (
                    <div className="text-spotify-gray-light text-sm">Checking cache…</div>
                  )}
                  {!targetPlaylistMatchLoading && targetPlaylistMatchError && (
                    <div className="text-red-400 text-sm">{targetPlaylistMatchError}</div>
                  )}
                  {!targetPlaylistMatchLoading && !targetPlaylistMatchError && !targetPlaylistMatch?.cached && (
                    <div className="text-spotify-gray-light text-sm">
                      Cache not ready for this playlist yet. Open it once to warm the cache.
                    </div>
                  )}
                  {!targetPlaylistMatchLoading && !targetPlaylistMatchError && targetPlaylistMatch?.cached && (
                    <div className="space-y-2">
                      <div className="text-sm text-spotify-gray-light">
                        Exact: {targetPlaylistMatchSummary.exact} • Similar: {targetPlaylistMatchSummary.similar} • New: {targetPlaylistMatchSummary.fresh}
                      </div>
                      {showMatchDetails && (
                        <div className="max-h-40 overflow-y-auto space-y-2">
                          {selectedTracksSorted.map((track) => {
                            const status = targetPlaylistMatchMap.get(track.selectionKey);
                            const label = status === 'exact' ? 'Exact' : status === 'similar' ? 'Similar' : 'New';
                            const badgeClass = status === 'exact'
                              ? 'border-spotify-green/60 text-spotify-green'
                              : status === 'similar'
                                ? 'border-amber-400/60 text-amber-300'
                                : 'border-spotify-gray-mid/60 text-spotify-gray-light';
                            const icon = status === 'exact' ? 'check_circle' : status === 'similar' ? 'difference' : 'add';
                            return (
                              <div key={track.selectionKey} className="flex items-center justify-between gap-3 text-xs text-spotify-gray-light">
                                <span className="truncate">{track.name}</span>
                                <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 border ${badgeClass}`}>
                                  <span className="icon text-sm">{icon}</span>
                                  {label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  <label className="inline-flex items-center gap-2 text-sm text-spotify-gray-light pt-1">
                    <input
                      type="checkbox"
                      checked={skipExistingTracks}
                      onChange={(event) => setSkipExistingTracks(event.target.checked)}
                      disabled={!targetPlaylistMatch?.cached || targetPlaylistMatchLoading}
                      className="w-4 h-4 rounded border-spotify-gray-mid text-spotify-green focus:ring-spotify-green"
                    />
                    Auto-skip tracks already in this playlist
                  </label>
                  {!targetPlaylistMatchLoading && !targetPlaylistMatch?.cached && (
                    <div className="text-xs text-spotify-gray-light">Cache is required to auto-skip.</div>
                  )}
                </div>
              )}
              {trackActionError && <div className="text-red-400 text-sm">{trackActionError}</div>}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeTrackActionModal}
                className="px-4 py-2 rounded-lg border border-spotify-gray-mid/60 text-sm text-spotify-gray-light hover:text-white hover:border-spotify-gray-light"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmTrackAction}
                disabled={trackActionLoading || !targetPlaylistId}
                className="px-4 py-2 rounded-lg bg-spotify-green text-black text-sm font-semibold hover:bg-spotify-green-dark disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {trackActionLoading ? 'Working…' : trackActionMode === 'move' ? 'Move tracks' : 'Add tracks'}
              </button>
            </div>
          </div>
        </div>
      )}

      {createPlaylistOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-spotify-gray-dark rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 border border-spotify-gray-mid/60">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Track actions</p>
                <h3 className="text-2xl font-semibold text-white">Create playlist</h3>
                <p className="text-sm text-spotify-gray-light mt-1">
                  {selectedTrackCount} track{selectedTrackCount === 1 ? '' : 's'} selected
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreatePlaylistOpen(false)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-spotify-gray-light hover:text-white hover:bg-spotify-gray-mid/60"
              >
                <span className="icon text-lg">close</span>
              </button>
            </div>

            <div className="space-y-3">
              <label className="text-sm text-spotify-gray-light flex flex-col gap-2">
                Playlist name
                <input
                  type="text"
                  value={createPlaylistName}
                  onChange={(event) => setCreatePlaylistName(event.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-spotify-gray-dark border border-spotify-gray-mid text-sm text-white placeholder-spotify-gray-light focus:outline-none focus:ring-2 focus:ring-spotify-green"
                />
              </label>
              <label className="text-sm text-spotify-gray-light flex flex-col gap-2">
                Description (optional)
                <textarea
                  value={createPlaylistDescription}
                  onChange={(event) => setCreatePlaylistDescription(event.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-spotify-gray-dark border border-spotify-gray-mid text-sm text-white placeholder-spotify-gray-light focus:outline-none focus:ring-2 focus:ring-spotify-green"
                />
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-spotify-gray-light">
                <input
                  type="checkbox"
                  checked={createPlaylistPublic}
                  onChange={(event) => setCreatePlaylistPublic(event.target.checked)}
                  className="w-4 h-4 rounded border-spotify-gray-mid text-spotify-green focus:ring-spotify-green"
                />
                Public playlist
              </label>
              {trackActionError && <div className="text-red-400 text-sm">{trackActionError}</div>}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setCreatePlaylistOpen(false)}
                className="px-4 py-2 rounded-lg border border-spotify-gray-mid/60 text-sm text-spotify-gray-light hover:text-white hover:border-spotify-gray-light"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreatePlaylist}
                disabled={trackActionLoading}
                className="px-4 py-2 rounded-lg bg-spotify-green text-black text-sm font-semibold hover:bg-spotify-green-dark disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {trackActionLoading ? 'Creating…' : 'Create playlist'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sort Modal */}
      {showSortModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-spotify-gray-dark rounded-2xl shadow-2xl max-w-2xl w-full p-6 space-y-5 border border-spotify-gray-mid/60">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Playlist actions</p>
                <h3 className="text-2xl font-semibold text-white">Reorder playlist</h3>
                <p className="text-sm text-spotify-gray-light mt-1">
                  Preserve dates keeps Spotify&apos;s added_at timestamps but is slower; Fast is quicker but resets added_at.
                </p>
              </div>
              <div className="relative group">
                <button
                  onClick={() => { 
                    setShowSortModal(false); 
                    setAnalysis(null); 
                    setJobError(null); 
                    // Don't clear job/jobStatus - let it continue in background
                  }}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-spotify-gray-light hover:text-white hover:bg-spotify-gray-mid/60"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div className="tooltip tooltip-left group-hover:tooltip-visible">
                  {jobStatus?.status === 'in_progress' || jobStatus?.status === 'pending' ? 'Continue in background' : 'Close'}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {/*
                Disable controls once a sort job is in-flight or finished,
                to keep the flow linear until the user acknowledges with Done.
              */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="text-sm text-spotify-gray-light flex flex-col gap-2">
                  Sort by
                  <select
                    value={sortForm.sort_by}
                    onChange={(e) => setSortForm({ ...sortForm, sort_by: e.target.value })}
                    disabled={jobStatus && jobStatus.status !== 'failed'}
                    className="bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="date_added">Date added</option>
                    <option value="title">Title</option>
                    <option value="artist">Artist</option>
                    <option value="album">Album</option>
                    <option value="release_date">Release date</option>
                    <option value="duration">Duration</option>
                  </select>
                </label>

                <label className="text-sm text-spotify-gray-light flex flex-col gap-2">
                  Direction
                  <select
                    value={sortForm.direction}
                    onChange={(e) => setSortForm({ ...sortForm, direction: e.target.value })}
                    disabled={jobStatus && jobStatus.status !== 'failed'}
                    className="bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="desc">Descending</option>
                    <option value="asc">Ascending</option>
                  </select>
                </label>

                <label className="text-sm text-spotify-gray-light flex flex-col gap-2">
                  Method
                  <select
                    value={sortForm.method}
                    onChange={(e) => setSortForm({ ...sortForm, method: e.target.value })}
                    disabled={jobStatus && jobStatus.status !== 'failed'}
                    className="bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="preserve">Preserve dates (slower)</option>
                    <option value="fast">Fast (resets dates)</option>
                  </select>
                </label>
              </div>

              <div className="flex flex-col sm:flex-row sm:justify-end gap-3 pt-2">
                <div className="relative group">
                  <button
                    onClick={handleAnalyzeSort}
                    disabled={analyzing || startingSort || (jobStatus && jobStatus.status !== 'failed')}
                    aria-label="Analyze sort"
                    className="w-10 h-10 rounded-lg border border-spotify-gray-light text-white bg-spotify-gray-dark/60 hover:bg-spotify-gray-mid/60 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                  >
                    <span className="icon text-base">
                      {analyzing ? 'hourglass_top' : 'travel_explore'}
                    </span>
                  </button>
                  <div className="tooltip group-hover:tooltip-visible">
                    {analyzing ? 'Analyzing…' : 'Analyze sort plan'}
                  </div>
                </div>
                <div className="relative group">
                  <button
                    onClick={handleStartSort}
                    disabled={startingSort || analyzing || (jobStatus && jobStatus.status !== 'failed')}
                    aria-label="Start sort"
                    className="w-10 h-10 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="icon text-base">
                      {startingSort ? 'hourglass_bottom' : 'play_arrow'}
                    </span>
                  </button>
                  <div className="tooltip group-hover:tooltip-visible">Start sort</div>
                </div>
              </div>

              {analysis && (
                <div className="bg-spotify-gray-mid rounded-lg p-4 text-sm text-white space-y-1 border border-spotify-gray-mid/60">
                  <p><span className="text-spotify-gray-light">Tracks:</span> {analysis.total_tracks}</p>
                  <p><span className="text-spotify-gray-light">Moves needed:</span> {analysis.tracks_to_move}</p>
                  <p><span className="text-spotify-gray-light">Estimated time:</span> {analysis.estimated_time_seconds}s</p>
                  {analysis.warning && <p className="text-amber-300">{analysis.warning}</p>}
                </div>
              )}

              {jobStatus && (
                <div className="bg-spotify-gray-mid rounded-lg p-4 text-sm text-white space-y-1 border border-spotify-gray-mid/60">
                  <p><span className="text-spotify-gray-light">Job:</span> {jobStatus.job_id || job?.job_id}</p>
                  <p>
                    <span className="text-spotify-gray-light">Status:</span>{' '}
                    <span className={
                      jobStatus.status === 'completed' ? 'text-spotify-green' :
                      jobStatus.status === 'failed' ? 'text-red-400' :
                      jobStatus.status === 'cancelled' ? 'text-amber-300' :
                      jobStatus.status === 'running' ? 'text-blue-400' :
                      'text-spotify-gray-light'
                    }>
                      {jobStatus.status}
                    </span>
                  </p>
                  {jobStatus.progress !== undefined && jobStatus.total !== undefined && (
                    <p><span className="text-spotify-gray-light">Progress:</span> {jobStatus.progress}/{jobStatus.total}</p>
                  )}
                  {jobStatus.message && <p className="text-spotify-gray-light">{jobStatus.message}</p>}
                  {jobStatus.error && <p className="text-red-400">{jobStatus.error}</p>}
                  {(jobStatus.status === 'completed' || jobStatus.status === 'failed' || jobStatus.status === 'cancelled') && (
                    <div className="pt-2 flex items-center justify-between gap-3">
                      {jobStatus.status === 'failed' && (
                        <button
                          onClick={() => {
                            setJob(null);
                            setJobStatus(null);
                            setJobError(null);
                            setAnalysis(null);
                          }}
                          className="px-4 py-2 bg-spotify-gray-dark hover:bg-spotify-gray-mid border border-spotify-gray-light text-white rounded-lg text-sm"
                        >
                          Try again
                        </button>
                      )}
                      <button
                        onClick={() => { setShowSortModal(false); setAnalysis(null); setJob(null); setJobStatus(null); setJobError(null); }}
                        className="px-4 py-2 bg-spotify-green hover:bg-spotify-green-dark text-white rounded-lg text-sm ml-auto"
                      >
                        {jobStatus.status === 'completed' ? 'Done' : 'Close'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {jobError && !jobStatus?.error && (
                <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-3 text-red-400 text-sm">
                  <div className="flex items-start gap-2">
                    <span className="icon text-base flex-shrink-0">error</span>
                    <span>{jobError}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-spotify-gray-dark rounded-2xl shadow-2xl max-w-2xl w-full p-6 space-y-5 border border-spotify-gray-mid/60">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Playlist actions</p>
                <h3 className="text-2xl font-semibold text-white">Edit playlist</h3>
                </div>
            <div className="flex items-center gap-2">
                {[
                  hasEdits && {
                    label: saving ? 'Saving…' : 'Save changes',
                    onClick: async () => {
                      setEditError(null); setEditMessage(null);
                    setSaving(true);
                    try {
                      await playlistAPI.updatePlaylist(currentPlaylist.id, {
                        name: editForm.name,
                        description: editForm.description
                      });
                        const updated = await playlistAPI.getPlaylistDetails(currentPlaylist.id);
                        setCurrentPlaylist(updated);
                        setEditMessage('Playlist updated');
                        setShowEditModal(false);
                      } catch (err) {
                        setEditError(err.message || 'Update failed');
                      } finally {
                        setSaving(false);
                      }
                    },
                    icon: (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    ),
                    disabled: saving,
                    primary: true,
                  },
                  {
                    label: 'Close',
                    onClick: () => { setShowEditModal(false); setEditMessage(null); setEditError(null); },
                    icon: (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    ),
                    disabled: false,
                  }
                ].filter(Boolean).map((action, idx) => (
                  <div key={idx} className="relative group">
                    <button
                      onClick={action.onClick}
                      disabled={action.disabled}
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors shadow-sm border border-spotify-gray-mid/60 text-white ${action.primary ? 'bg-spotify-green hover:bg-spotify-green-dark text-black' : 'bg-spotify-gray-mid hover:bg-spotify-gray-light'} disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {action.icon}
                      </svg>
                    </button>
                    <div className="tooltip group-hover:tooltip-visible">
                      {action.label}
                </div>
            </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex flex-col lg:flex-row gap-4">
                <label className="flex-1 text-sm text-spotify-gray-light flex flex-col gap-2">
                  Name
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                  />
                </label>
              </div>

              <label className="text-sm text-spotify-gray-light flex flex-col gap-2">
                Description
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  rows={3}
                  className="bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                />
              </label>

              {editMessage && <p className="text-spotify-green text-sm">{editMessage}</p>}
              {editError && <p className="text-red-400 text-sm">{editError}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Clone Playlist Modal */}
      {showCloneModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-spotify-gray-dark rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5 border border-spotify-gray-mid/60">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Clone playlist</p>
                <h3 className="text-2xl font-semibold text-white">Name your clone</h3>
              </div>
              <button
                onClick={() => { setShowCloneModal(false); setEditMessage(null); setEditError(null); }}
                className="w-9 h-9 rounded-full bg-spotify-gray-mid hover:bg-spotify-gray-light text-white flex items-center justify-center transition-colors border border-spotify-gray-mid/60"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <label className="block space-y-2 text-sm text-white">
                Clone Name
                <input
                  type="text"
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  className="w-full bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                  placeholder={`${currentPlaylist.name} (clone 1)`}
                />
              </label>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => { setShowCloneModal(false); setEditMessage(null); setEditError(null); }}
                  className="px-4 py-2 rounded-lg bg-spotify-gray-mid hover:bg-spotify-gray-light text-white transition-colors border border-spotify-gray-mid/60"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setEditError(null);
                    setEditMessage(null);
                    setCloning(true);
                    try {
                      const res = await playlistAPI.clonePlaylist(currentPlaylist.id, {
                        name: cloneName || `${currentPlaylist.name} (clone 1)`,
                        public: currentPlaylist.public,
                        collaborative: currentPlaylist.collaborative,
                        description: currentPlaylist.description
                      });
                      setEditMessage(`Cloned to ${res.new_playlist_id}`);
                      setShowCloneModal(false);
                      navigate(`/playlist/${res.new_playlist_id}`);
                    } catch (err) {
                      setEditError(err.message || 'Clone failed');
                    } finally {
                      setCloning(false);
                    }
                  }}
                  disabled={cloning || !cloneName.trim()}
                  className="px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {cloning ? 'Creating clone...' : 'Clone'}
                </button>
              </div>

              {editMessage && <p className="text-spotify-green text-sm">{editMessage}</p>}
              {editError && <p className="text-red-400 text-sm">{editError}</p>}
            </div>
          </div>
        </div>
      )}
      </div>
    </Tooltip.Provider>
  );
};

export default PlaylistView;
