import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { cacheAPI, playlistAPI } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

const REFRESH_STATUSES = new Set(['running', 'enriching_artists', 'enriching_audio_features']);

const CachePage = ({ user, onLogout }) => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);
  const [cacheSchedule, setCacheSchedule] = useState(null);
  const [refreshAllStatus, setRefreshAllStatus] = useState(null);
  const isRefreshInProgress = REFRESH_STATUSES.has(refreshAllStatus?.status);

  const getRefreshStatusLabel = (status) => {
    if (status === 'enriching_artists') {
      return 'Enriching artist metadata...';
    }
    if (status === 'enriching_audio_features') {
      return 'Enriching audio features...';
    }
    return 'Refreshing playlists...';
  };

  // Load cache stats
  const loadStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await cacheAPI.getStats();
      setStats(data);
    } catch (err) {
      console.error('Failed to load cache stats:', err);
      setError(err.message || 'Failed to load cache statistics');
    } finally {
      setLoading(false);
    }
  };

  const loadCacheSchedule = async () => {
    try {
      const sched = await playlistAPI.listSchedules();
      const cacheSched = (sched || []).find((s) => String(s.action_type || '').startsWith('cache_'));
      setCacheSchedule(cacheSched || null);
    } catch {
      setCacheSchedule(null);
    }
  };

  useEffect(() => {
    loadStats();
    loadCacheSchedule();
  }, []);


  // Refresh user cache
  const handleClearUserCache = async () => {
    if (!window.confirm('Refresh your cache now? This clears your cache and rebuilds it for every playlist. This may take several minutes.')) {
      return;
    }

    try {
      setActionLoading(true);
      setActionMessage(null);
      const playlists = await playlistAPI.getPlaylists();
      if (!playlists || playlists.length === 0) {
        setActionMessage({ type: 'error', text: 'No playlists found to refresh.' });
        setRefreshAllStatus(null);
        return;
      }
      const playlistIds = playlists.map((playlist) => playlist.id).filter(Boolean);
      await cacheAPI.clearUserCache();

      setRefreshAllStatus({ status: 'running', total: playlistIds.length, completed: 0 });
      const warmResult = await cacheAPI.warmPlaylists(playlistIds, { source: 'manual', mode: 'refresh_full' });
      const queued = warmResult?.queued || 0;
      if (queued === 0) {
        setActionMessage({ type: 'warning', text: 'No playlists queued for refresh. Another refresh may already be running.' });
        setRefreshAllStatus(null);
        return;
      }

      const finalStatus = await pollCacheWarmStatus(Date.now(), playlistIds.length);
      const total = finalStatus?.total || queued || playlistIds.length;
      setActionMessage({ type: 'success', text: `Cleared your cache and refreshed ${total} playlists.` });
      await loadStats();
    } catch (err) {
      console.error('Failed to refresh user cache:', err);
      setActionMessage({ type: 'error', text: err.message || 'Failed to refresh your cache' });
    } finally {
      setActionLoading(false);
      setRefreshAllStatus(null);
    }
  };

  // Clear all cache
  const handleClearAllCache = async () => {
    if (!window.confirm('⚠️ WARNING: This will clear the ENTIRE cache for ALL USERS. Are you absolutely sure?')) {
      return;
    }

    try {
      setActionLoading(true);
      setActionMessage(null);
      const result = await cacheAPI.clearAllCache();
      setActionMessage({ type: 'warning', text: result.message });
      await loadStats(); // Reload stats
    } catch (err) {
      console.error('Failed to clear all cache:', err);
      setActionMessage({ type: 'error', text: err.message || 'Failed to clear all cache' });
    } finally {
      setActionLoading(false);
    }
  };

  const pollCacheWarmStatus = async (startedAtMs, expectedTotal) => {
    let status = await cacheAPI.getWarmStatus();
    if (status && !status.total && expectedTotal) {
      status = { ...status, total: expectedTotal };
    }
    setRefreshAllStatus(status);
    while (REFRESH_STATUSES.has(status?.status)) {
      if (Date.now() - startedAtMs > 30 * 60 * 1000) {
        throw new Error('Playlist cache refresh timed out.');
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      status = await cacheAPI.getWarmStatus();
      if (status && !status.total && expectedTotal) {
        status = { ...status, total: expectedTotal };
      }
      setRefreshAllStatus(status);
    }
    return status;
  };

  const getPlaylistsToRefresh = (playlists, factsMap, forceRefresh = false) => {
    if (forceRefresh) {
      return playlists.map((playlist) => playlist.id).filter(Boolean);
    }
    return playlists.filter((playlist) => {
      const fact = factsMap[playlist.id];
      if (!fact || !fact.last_snapshot_id) return true;
      if (!playlist.snapshot_id) return true;
      if (fact.last_snapshot_id !== playlist.snapshot_id) return true;
      if (fact.is_dirty === 1) return true;
      return false;
    }).map((playlist) => playlist.id);
  };

  const handleRefreshAllPlaylists = async () => {
    if (!window.confirm('Refresh cache for playlists that are out of date? This may take several minutes for large libraries.')) {
      return;
    }

    try {
      setActionLoading(true);
      setActionMessage(null);

      const playlists = await playlistAPI.getPlaylists();
      if (!playlists || playlists.length === 0) {
        setActionMessage({ type: 'error', text: 'No playlists found to refresh.' });
        setRefreshAllStatus(null);
        return;
      }

      const playlistIds = playlists.map((playlist) => playlist.id).filter(Boolean);
      const factsResponse = await cacheAPI.getPlaylistFacts(playlistIds);
      const factsMap = (factsResponse?.facts || []).reduce((acc, fact) => {
        acc[fact.playlist_id] = fact;
        return acc;
      }, {});
      const playlistsToRefresh = getPlaylistsToRefresh(playlists, factsMap, false);
      if (playlistsToRefresh.length === 0) {
        setActionMessage({ type: 'success', text: 'All playlists are already up to date.' });
        setRefreshAllStatus(null);
        return;
      }

      setRefreshAllStatus({ status: 'running', total: playlistsToRefresh.length, completed: 0 });
      const warmResult = await cacheAPI.warmPlaylists(playlistsToRefresh, { source: 'manual', mode: 'refresh_changed' });
      const queued = warmResult?.queued || 0;
      if (queued === 0) {
        setActionMessage({ type: 'warning', text: 'No playlists queued for refresh. Another refresh may already be running.' });
        setRefreshAllStatus(null);
        return;
      }

      const finalStatus = await pollCacheWarmStatus(Date.now(), playlistsToRefresh.length);
      const total = finalStatus?.total || queued || playlistsToRefresh.length;
      setActionMessage({ type: 'success', text: `Refreshed cache for ${total} playlists.` });
      await loadStats();
    } catch (err) {
      setActionMessage({ type: 'error', text: err.message || 'Failed to refresh playlist cache.' });
    } finally {
      setActionLoading(false);
      setRefreshAllStatus(null);
    }
  };

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  return (
    <Layout user={user} onLogout={onLogout}>
      <div className="bg-gradient-to-b from-spotify-gray-dark to-spotify-black text-white relative">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">Track Cache</h1>
              <p className="text-spotify-gray-light mt-1">
                Track metadata cached locally to reduce Spotify API calls and improve performance
              </p>
            </div>
            <div className="flex gap-2 items-center">
              {cacheSchedule && (
                <button
                  onClick={() => navigate('/schedules')}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-spotify-green text-spotify-green hover:bg-spotify-green hover:text-black transition-colors text-sm"
                  title="Manage cache refresh schedule"
                >
                  <span className="icon text-sm">event</span>
                  Cache refresh scheduled
                </button>
              )}
              <button
                onClick={loadStats}
                disabled={loading}
                className="px-4 py-2 rounded-lg bg-spotify-gray-mid hover:bg-spotify-gray-light text-white transition-colors border border-spotify-gray-mid/60 disabled:opacity-50"
                title="Refresh stats"
              >
                <span className="icon text-base">refresh</span>
              </button>
              <button
                onClick={() => navigate('/playlists')}
                className="px-4 py-2 rounded-lg bg-spotify-gray-mid hover:bg-spotify-gray-light text-white transition-colors border border-spotify-gray-mid/60"
              >
                ← Back to Playlists
              </button>
            </div>
          </div>

          {/* Loading State */}
          {loading && (
            <div className="flex justify-center items-center py-20">
              <LoadingSpinner />
            </div>
          )}

          {/* Error State */}
          {error && !loading && (
            <ErrorMessage message={error} />
          )}

          {/* Action Message */}
          {!loading && actionMessage && (
            <div className={`rounded-lg p-4 border ${
              actionMessage.type === 'success' ? 'bg-green-900/20 border-green-700 text-green-300' :
              actionMessage.type === 'warning' ? 'bg-amber-900/20 border-amber-700 text-amber-300' :
              'bg-red-900/20 border-red-700 text-red-300'
            }`}>
              {actionMessage.text}
            </div>
          )}

          {/* Stats Cards */}
          {!loading && !error && stats && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Total Cached */}
              <div className="bg-spotify-gray-dark/40 rounded-lg p-6 border border-spotify-gray-mid/60">
                <div className="text-spotify-gray-light text-sm mb-2">Total Cached Tracks</div>
                <div className="text-4xl font-bold text-white">{stats?.total_cached?.toLocaleString() || 0}</div>
                <div className="text-xs text-spotify-gray-light mt-2">Active, not expired</div>
              </div>

              {/* User Tracks */}
              <div className="bg-spotify-gray-dark/40 rounded-lg p-6 border border-spotify-gray-mid/60">
                <div className="text-spotify-gray-light text-sm mb-2">Your Tracks</div>
                <div className="text-4xl font-bold text-spotify-green">{stats?.user_tracks?.toLocaleString() || 0}</div>
                <div className="text-xs text-spotify-gray-light mt-2">Tracks you've accessed</div>
              </div>

              {/* Expired */}
              <div className="bg-spotify-gray-dark/40 rounded-lg p-6 border border-spotify-gray-mid/60">
                <div className="text-spotify-gray-light text-sm mb-2">Expired Tracks</div>
                <div className="text-4xl font-bold text-amber-300">{stats?.expired?.toLocaleString() || 0}</div>
                <div className="text-xs text-spotify-gray-light mt-2">Ready to be cleaned up</div>
              </div>
            </div>
          )}

          {/* Cache Info */}
          {!loading && !error && stats && (
            <div className="bg-spotify-gray-dark/40 rounded-lg p-6 border border-spotify-gray-mid/60 space-y-3">
        <h2 className="text-xl font-semibold text-white mb-4">Cache Configuration</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-spotify-gray-light">Total in Database:</span>
            <span className="text-white ml-2 font-medium">{stats?.total_in_db?.toLocaleString() || 0} tracks</span>
          </div>
          
          <div>
            <span className="text-spotify-gray-light">Expiration Cutoff:</span>
            <span className="text-white ml-2 font-medium">{formatDate(stats?.cutoff_date)}</span>
          </div>
        </div>

              <div className="mt-4 p-4 bg-spotify-gray-mid/40 rounded-lg">
                <p className="text-xs text-spotify-gray-light leading-relaxed">
                  <strong className="text-white">How it works:</strong> When you load playlists or view track details, 
                  metadata is cached locally. Cached tracks are shared across all users for efficiency. 
                  Expired entries can be cleaned up from the cache when needed.
                </p>
              </div>
            </div>
          )}

          {/* Actions */}
          {!loading && !error && stats && (
            <div className="bg-spotify-gray-dark/40 rounded-lg p-6 border border-spotify-gray-mid/60 space-y-4">
        <h2 className="text-xl font-semibold text-white mb-4">Cache Management</h2>

        {/* Refresh Changed Playlists */}
        <div className="flex items-center justify-between p-4 bg-spotify-gray-mid/40 rounded-lg">
          <div>
            <div className="text-white font-medium">Refresh changed playlists</div>
            <div className="text-sm text-spotify-gray-light">
              Warm the cache for changed playlists and enrich metadata (artists, audio features)
            </div>
            <div className="text-xs text-spotify-gray-light mt-1">
              This may take several minutes for large libraries.
            </div>
            {isRefreshInProgress && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-spotify-gray-light">
                  <span>{getRefreshStatusLabel(refreshAllStatus?.status)}</span>
                  <span>
                    {refreshAllStatus.total
                      ? `${refreshAllStatus.completed || 0}/${refreshAllStatus.total}`
                      : 'Starting...'}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-spotify-gray-mid/60 overflow-hidden">
                  <div
                    className="h-full bg-spotify-green transition-all"
                    style={{
                      width: refreshAllStatus.total
                        ? `${Math.min(100, Math.round(((refreshAllStatus.completed || 0) / refreshAllStatus.total) * 100))}%`
                        : '0%',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
          <button
            onClick={handleRefreshAllPlaylists}
            disabled={actionLoading}
            className="px-4 py-2 bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRefreshInProgress ? 'Refreshing...' : 'Refresh changed'}
          </button>
        </div>

        {/* Clear User Cache */}
        <div className="flex items-center justify-between p-4 bg-spotify-gray-mid/40 rounded-lg">
          <div>
            <div className="text-white font-medium">Refresh Your Cache</div>
            <div className="text-sm text-spotify-gray-light">
              Clear and rebuild your cache for every playlist, including metadata enrichment
            </div>
          </div>
          <button
            onClick={handleClearUserCache}
            disabled={actionLoading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Rebuild cache
          </button>
        </div>

        {/* Clear All Cache */}
        <div className="flex items-center justify-between p-4 bg-red-900/20 border border-red-700/40 rounded-lg">
          <div>
            <div className="text-white font-medium">Clear Entire Cache</div>
            <div className="text-sm text-red-300">⚠️ Affects all users - use with caution</div>
          </div>
          <button
            onClick={handleClearAllCache}
            disabled={actionLoading || stats?.total_in_db === 0}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
              Clear All
            </button>
          </div>
            </div>
          )}

          {/* Metadata Info */}
          {!loading && !error && stats && stats.total_cached > 0 && (
            <div className="bg-spotify-gray-dark/40 rounded-lg p-6 border border-spotify-gray-mid/60">
              <h2 className="text-xl font-semibold text-white mb-4">Metadata Enrichment</h2>
              <div className="p-4 bg-blue-900/20 border border-blue-700/40 rounded-lg">
                <p className="text-sm text-blue-300 leading-relaxed">
                  <strong className="text-white">ℹ️ Automatic enrichment enabled</strong><br/>
                  When you refresh your cache, the system automatically enriches tracks with:
                </p>
                <ul className="mt-3 space-y-2 text-sm text-blue-300">
                  <li>• <strong>Artist metadata:</strong> Genres, popularity, followers</li>
                  <li>• <strong>Audio features:</strong> Tempo, energy, danceability, valence</li>
                </ul>
                <p className="mt-3 text-xs text-spotify-gray-light">
                  This enables advanced features like smart playlists (90s rock, workout mixes), 
                  genre filtering, mood-based sorting, and enhanced duplicate detection.
                </p>
              </div>
            </div>
          )}

          {/* Loading Overlay */}
          {actionLoading && (
            <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px] flex items-center justify-center z-40">
              <div className="bg-spotify-gray-dark/95 rounded-2xl p-8 border border-spotify-gray-mid/60 shadow-2xl">
                <LoadingSpinner />
                <p className="text-white text-center mt-4">Processing...</p>
                {isRefreshInProgress && (
                  <div className="mt-4 w-64 space-y-2">
                    <p className="text-xs text-spotify-gray-light text-center">
                      This may take several minutes for large libraries.
                    </p>
                    <div className="flex items-center justify-between text-xs text-spotify-gray-light">
                      <span>{getRefreshStatusLabel(refreshAllStatus?.status)}</span>
                      <span>
                        {refreshAllStatus.total
                          ? `${refreshAllStatus.completed || 0}/${refreshAllStatus.total}`
                          : 'Starting...'}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-spotify-gray-mid/60 overflow-hidden">
                      <div
                        className="h-full bg-spotify-green transition-all"
                        style={{
                          width: refreshAllStatus.total
                            ? `${Math.min(100, Math.round(((refreshAllStatus.completed || 0) / refreshAllStatus.total) * 100))}%`
                            : '0%',
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default CachePage;
