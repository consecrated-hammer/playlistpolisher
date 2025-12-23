import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { cacheAPI, preferencesAPI, playlistAPI } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

const CachePage = ({ user, onLogout }) => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);
  const [cacheSchedule, setCacheSchedule] = useState(null);
  const [showCacheModal, setShowCacheModal] = useState(false);
  const [cacheModalLoading, setCacheModalLoading] = useState(false);
  const [cacheModalError, setCacheModalError] = useState(null);
  const [cacheScope, setCacheScope] = useState('all');
  const [cacheSelectedIds, setCacheSelectedIds] = useState([]);
  const [cacheAutoIncludeNew, setCacheAutoIncludeNew] = useState(true);
  const [cacheRunInitial, setCacheRunInitial] = useState(true);
  const [playlistSearch, setPlaylistSearch] = useState('');
  const [playlistOptions, setPlaylistOptions] = useState([]);

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
      const cacheSched = (sched || []).find((s) => s.action_type === 'cache_clear');
      setCacheSchedule(cacheSched || null);
    } catch {
      setCacheSchedule(null);
    }
  };

  useEffect(() => {
    loadStats();
    loadCacheSchedule();
  }, []);

  const visiblePlaylists = useMemo(() => {
    const query = playlistSearch.trim().toLowerCase();
    if (!query) {
      return playlistOptions;
    }
    return playlistOptions.filter((playlist) => {
      const name = playlist.name?.toLowerCase() || '';
      const owner = playlist.owner?.display_name?.toLowerCase() || playlist.owner?.id?.toLowerCase() || '';
      return name.includes(query) || owner.includes(query);
    });
  }, [playlistOptions, playlistSearch]);

  const allVisibleSelected = useMemo(() => {
    if (!visiblePlaylists.length) {
      return false;
    }
    const selected = new Set(cacheSelectedIds);
    return visiblePlaylists.every((playlist) => selected.has(playlist.id));
  }, [visiblePlaylists, cacheSelectedIds]);

  const openCacheModal = async () => {
    setShowCacheModal(true);
    setCacheModalLoading(true);
    setCacheModalError(null);
    setPlaylistSearch('');

    try {
      const [prefs, playlists] = await Promise.all([
        preferencesAPI.getPreferences(),
        playlistAPI.getPlaylists(),
      ]);
      setPlaylistOptions(playlists || []);
      setCacheScope(prefs?.cache_playlist_scope || 'all');
      setCacheSelectedIds(prefs?.cache_selected_playlist_ids || []);
      setCacheAutoIncludeNew(prefs?.cache_auto_include_new ?? true);
      setCacheRunInitial(true);
    } catch (err) {
      console.error('Failed to load cache preferences:', err);
      setCacheModalError(err.message || 'Failed to load caching preferences');
    } finally {
      setCacheModalLoading(false);
    }
  };

  const closeCacheModal = () => {
    if (cacheModalLoading) {
      return;
    }
    setShowCacheModal(false);
    setCacheModalError(null);
  };

  const togglePlaylistSelection = (playlistId) => {
    setCacheSelectedIds((prev) => {
      if (prev.includes(playlistId)) {
        return prev.filter((id) => id !== playlistId);
      }
      return [...prev, playlistId];
    });
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = visiblePlaylists.map((playlist) => playlist.id);
    if (!visibleIds.length) {
      return;
    }
    setCacheSelectedIds((prev) => {
      const prevSet = new Set(prev);
      if (allVisibleSelected) {
        return prev.filter((id) => !visibleIds.includes(id));
      }
      visibleIds.forEach((id) => prevSet.add(id));
      return Array.from(prevSet);
    });
  };

  const handleSaveCacheSettings = async () => {
    setCacheModalLoading(true);
    setCacheModalError(null);

    try {
      const payload = {
        cache_playlist_scope: cacheScope,
        cache_selected_playlist_ids: cacheSelectedIds,
        cache_auto_include_new: cacheAutoIncludeNew,
      };
      await preferencesAPI.updatePreferences(payload);

      if (cacheRunInitial) {
        let playlistIds = [];
        if (cacheScope === 'all') {
          playlistIds = playlistOptions.map((playlist) => playlist.id);
        } else if (cacheScope === 'selected' || cacheScope === 'manual') {
          playlistIds = cacheSelectedIds;
        }
        if (playlistIds.length > 0) {
          await cacheAPI.warmPlaylists(playlistIds);
        }
      }

      setShowCacheModal(false);
    } catch (err) {
      console.error('Failed to save caching preferences:', err);
      setCacheModalError(err.message || 'Failed to save caching preferences');
    } finally {
      setCacheModalLoading(false);
    }
  };

  // Clear user cache
  const handleClearUserCache = async () => {
    if (!window.confirm('Clear all tracks from your cache? This will force re-fetching from Spotify next time.')) {
      return;
    }

    try {
      setActionLoading(true);
      setActionMessage(null);
      const result = await cacheAPI.clearUserCache();
      setActionMessage({ type: 'success', text: result.message });
      await loadStats(); // Reload stats
    } catch (err) {
      console.error('Failed to clear user cache:', err);
      setActionMessage({ type: 'error', text: err.message || 'Failed to clear user cache' });
    } finally {
      setActionLoading(false);
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

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  return (
    <Layout user={user} onLogout={onLogout}>
      <div className="bg-gradient-to-b from-spotify-gray-dark to-spotify-black text-white">
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
            <span className="text-spotify-gray-light">TTL (Time to Live):</span>
            <span className="text-white ml-2 font-medium">{stats?.ttl_days || 30} days</span>
          </div>
          
          <div>
            <span className="text-spotify-gray-light">Total in Database:</span>
            <span className="text-white ml-2 font-medium">{stats?.total_in_db?.toLocaleString() || 0} tracks</span>
          </div>
          
          <div className="md:col-span-2">
            <span className="text-spotify-gray-light">Expiration Cutoff:</span>
            <span className="text-white ml-2 font-medium">{formatDate(stats?.cutoff_date)}</span>
          </div>
        </div>

              <div className="mt-4 p-4 bg-spotify-gray-mid/40 rounded-lg">
                <p className="text-xs text-spotify-gray-light leading-relaxed">
                  <strong className="text-white">How it works:</strong> When you load playlists or view track details, 
                  metadata is cached locally. Cached tracks are shared across all users for efficiency. 
                  After {stats?.ttl_days || 30} days, entries expire and can be cleaned up.
                </p>
              </div>
            </div>
          )}

          {/* Actions */}
          {!loading && !error && stats && (
            <div className="bg-spotify-gray-dark/40 rounded-lg p-6 border border-spotify-gray-mid/60 space-y-4">
        <h2 className="text-xl font-semibold text-white mb-4">Cache Management</h2>

        {/* Playlist Cache Settings */}
        <div className="flex items-center justify-between p-4 bg-spotify-gray-mid/40 rounded-lg">
          <div>
            <div className="text-white font-medium">Manage playlist caching</div>
            <div className="text-sm text-spotify-gray-light">
              Choose which playlists are cached locally for faster browsing
            </div>
          </div>
          <button
            onClick={openCacheModal}
            className="px-4 py-2 bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold rounded-lg transition-colors"
          >
            Manage
          </button>
        </div>

        {/* Clear User Cache */}
        <div className="flex items-center justify-between p-4 bg-spotify-gray-mid/40 rounded-lg">
          <div>
            <div className="text-white font-medium">Refresh Your Cache</div>
            <div className="text-sm text-spotify-gray-light">Clear your tracks to force fresh data from Spotify</div>
          </div>
          <button
            onClick={handleClearUserCache}
            disabled={actionLoading || stats?.user_tracks === 0}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Refresh
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

          {showCacheModal && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
              <div className="bg-spotify-gray-dark rounded-2xl border border-spotify-gray-mid/60 shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden">
                <div className="flex items-start justify-between p-6 border-b border-spotify-gray-mid/60">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Cache Management</p>
                    <h3 className="text-2xl font-bold text-white">Playlist caching</h3>
                  </div>
                  <button
                    onClick={closeCacheModal}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-spotify-gray-light hover:bg-spotify-gray-mid/60 transition-colors"
                    aria-label="Close playlist caching"
                  >
                    <span className="icon text-lg">close</span>
                  </button>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(85vh-140px)]">
                  <p className="text-sm text-spotify-gray-light">
                    Playlist caching keeps a local copy of your chosen playlists so they open faster and stay ready
                    when you return.
                  </p>

                  {cacheModalError && (
                    <div className="rounded-lg p-3 border border-red-700/40 bg-red-900/30 text-red-300 text-sm">
                      {cacheModalError}
                    </div>
                  )}

                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-white">Caching scope</p>
                    <div className="space-y-2">
                      <label className="flex items-start gap-3 text-sm text-spotify-gray-light">
                        <input
                          type="radio"
                          name="cache-scope"
                          value="all"
                          checked={cacheScope === 'all'}
                          onChange={() => setCacheScope('all')}
                          className="mt-1 accent-spotify-green"
                        />
                        <span>
                          <span className="text-white font-medium">Cache all current playlists</span>
                          <span className="block text-xs text-spotify-gray-light">
                            Keep all playlists you see today ready for faster access.
                          </span>
                        </span>
                      </label>
                      <label className="flex items-start gap-3 text-sm text-spotify-gray-light">
                        <input
                          type="radio"
                          name="cache-scope"
                          value="selected"
                          checked={cacheScope === 'selected'}
                          onChange={() => setCacheScope('selected')}
                          className="mt-1 accent-spotify-green"
                        />
                        <span>
                          <span className="text-white font-medium">Cache selected playlists</span>
                          <span className="block text-xs text-spotify-gray-light">
                            Choose only the playlists you want kept locally.
                          </span>
                        </span>
                      </label>
                      <label className="flex items-start gap-3 text-sm text-spotify-gray-light">
                        <input
                          type="radio"
                          name="cache-scope"
                          value="manual"
                          checked={cacheScope === 'manual'}
                          onChange={() => setCacheScope('manual')}
                          className="mt-1 accent-spotify-green"
                        />
                        <span>
                          <span className="text-white font-medium">Manual caching only</span>
                          <span className="block text-xs text-spotify-gray-light">
                            Only cache playlists when you trigger it here.
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>

                  {cacheScope === 'all' && (
                    <label className="flex items-start gap-3 text-sm text-spotify-gray-light bg-spotify-gray-mid/40 p-3 rounded-lg border border-spotify-gray-mid/60">
                      <input
                        type="checkbox"
                        checked={cacheAutoIncludeNew}
                        onChange={(event) => setCacheAutoIncludeNew(event.target.checked)}
                        className="mt-1 accent-spotify-green"
                      />
                      <span>
                        <span className="text-white font-medium">
                          Automatically cache playlists I create or follow in the future
                        </span>
                        <span className="block text-xs text-spotify-gray-light">
                          New playlists will follow the same caching rules without extra setup.
                        </span>
                      </span>
                    </label>
                  )}

                  {(cacheScope === 'selected' || cacheScope === 'manual') && (
                    <div className="space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">Select playlists</p>
                          <p className="text-xs text-spotify-gray-light">
                            {cacheSelectedIds.length} selected
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={toggleSelectAllVisible}
                            className="px-3 py-1.5 text-xs rounded-full border border-spotify-gray-mid/60 text-spotify-gray-light hover:text-white hover:border-spotify-gray-light transition-colors"
                          >
                            {allVisibleSelected ? 'Clear visible' : 'Select visible'}
                          </button>
                        </div>
                      </div>
                      <input
                        type="text"
                        value={playlistSearch}
                        onChange={(event) => setPlaylistSearch(event.target.value)}
                        placeholder="Search playlists"
                        className="w-full bg-spotify-gray-mid/60 text-white text-sm rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                      />
                      <div className="max-h-56 overflow-y-auto divide-y divide-spotify-gray-mid/60 border border-spotify-gray-mid/60 rounded-lg">
                        {cacheModalLoading ? (
                          <div className="p-4 text-sm text-spotify-gray-light">Loading playlists...</div>
                        ) : visiblePlaylists.length === 0 ? (
                          <div className="p-4 text-sm text-spotify-gray-light">No playlists match your search.</div>
                        ) : (
                          visiblePlaylists.map((playlist) => {
                            const ownerName = playlist.owner?.display_name || playlist.owner?.id || 'Unknown';
                            const trackTotal = playlist.tracks?.total || 0;
                            const isSelected = cacheSelectedIds.includes(playlist.id);
                            return (
                              <label
                                key={playlist.id}
                                className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-spotify-gray-light hover:bg-spotify-gray-mid/40 cursor-pointer"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => togglePlaylistSelection(playlist.id)}
                                    className="accent-spotify-green"
                                  />
                                  <div className="min-w-0">
                                    <div className="text-white font-medium truncate">{playlist.name}</div>
                                    <div className="text-xs text-spotify-gray-light truncate">
                                      {ownerName} • {trackTotal} {trackTotal === 1 ? 'track' : 'tracks'}
                                    </div>
                                  </div>
                                </div>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}

                  <div className="bg-spotify-gray-mid/40 rounded-lg p-4 text-xs text-spotify-gray-light leading-relaxed border border-spotify-gray-mid/60">
                    <p className="text-white font-semibold mb-1">How playlist caching works</p>
                    <p>
                      Cached playlists load faster because we keep a local copy. Over time, the app refreshes cached
                      playlists so they stay current without any extra steps from you.
                    </p>
                  </div>

                  <label className="flex items-center gap-3 text-sm text-spotify-gray-light">
                    <input
                      type="checkbox"
                      checked={cacheRunInitial}
                      onChange={(event) => setCacheRunInitial(event.target.checked)}
                      className="accent-spotify-green"
                    />
                    <span>Run initial cache now</span>
                  </label>
                </div>

                <div className="flex items-center justify-end gap-3 p-6 border-t border-spotify-gray-mid/60">
                  <button
                    type="button"
                    onClick={closeCacheModal}
                    className="px-4 py-2 rounded-lg border border-spotify-gray-light bg-spotify-gray-dark/60 text-white hover:bg-spotify-gray-mid/60 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveCacheSettings}
                    disabled={cacheModalLoading}
                    className="px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save caching settings
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Loading Overlay */}
          {actionLoading && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
              <div className="bg-spotify-gray-dark rounded-2xl p-8 border border-spotify-gray-mid/60 shadow-2xl">
                <LoadingSpinner />
                <p className="text-white text-center mt-4">Processing...</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default CachePage;
