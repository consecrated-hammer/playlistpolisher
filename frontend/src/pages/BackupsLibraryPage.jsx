import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { playlistAPI, preferencesAPI } from '../services/api';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'backup-asc', label: 'Backup name (A-Z)' },
  { value: 'backup-desc', label: 'Backup name (Z-A)' },
  { value: 'playlist-asc', label: 'Playlist name (A-Z)' },
  { value: 'playlist-desc', label: 'Playlist name (Z-A)' },
];

const formatTimestamp = (value) => {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatBackupName = (template, playlistName) => {
  const name = playlistName || 'Playlist';
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const datetime = `${date} ${time}`;
  const safeTemplate = template && template.trim() ? template : '{playlist} backup {date}';
  return safeTemplate
    .replace('{playlist}', name)
    .replace('{date}', date)
    .replace('{time}', time)
    .replace('{datetime}', datetime);
};

const BackupsLibraryPage = ({ user, onLogout }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const playlistId = searchParams.get('playlistId');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [backups, setBackups] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState('newest');
  const [viewMode, setViewMode] = useState('grouped');
  const [playlistFilter, setPlaylistFilter] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({});
  const [backupStatus, setBackupStatus] = useState(null);
  const [backupStatusLoading, setBackupStatusLoading] = useState(false);
  const [backupStatusError, setBackupStatusError] = useState(null);
  const [backupCreateName, setBackupCreateName] = useState('');
  const [backupCreateLoading, setBackupCreateLoading] = useState(false);
  const [backupCreateMessage, setBackupCreateMessage] = useState(null);
  const [backupCreateError, setBackupCreateError] = useState(null);
  const [backupCacheFirstSetting, setBackupCacheFirstSetting] = useState(true);
  const [restoreModal, setRestoreModal] = useState(null);
  const [restoreCloneName, setRestoreCloneName] = useState('');
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreError, setRestoreError] = useState(null);
  const [restoreMessage, setRestoreMessage] = useState(null);

  const playlistMap = useMemo(() => {
    const map = {};
    (playlists || []).forEach((playlist) => {
      if (playlist?.id) {
        map[playlist.id] = playlist;
      }
    });
    return map;
  }, [playlists]);

  const filteredPlaylist = playlistId ? playlistMap[playlistId] : null;

  const playlistNameMatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return new Set();
    const matches = new Set();
    (playlists || []).forEach((playlist) => {
      const name = playlist?.name || '';
      if (name.toLowerCase().includes(query)) {
        matches.add(playlist.id);
      }
    });
    return matches;
  }, [playlists, searchQuery]);

  const sortedFlatBackups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let result = [...backups];
    if (!playlistId && playlistFilter) {
      result = result.filter((backup) => backup.playlistId === playlistFilter);
    }
    if (query) {
      result = result.filter((backup) => (
        playlistNameMatches.has(backup.playlistId)
        || (backup.name || '').toLowerCase().includes(query)
      ));
    }
    result.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      const aPlaylist = (a.playlistName || '').toLowerCase();
      const bPlaylist = (b.playlistName || '').toLowerCase();

      switch (sortOption) {
        case 'oldest':
          return aTime - bTime;
        case 'backup-asc':
          return aName.localeCompare(bName);
        case 'backup-desc':
          return bName.localeCompare(aName);
        case 'playlist-asc':
          return aPlaylist.localeCompare(bPlaylist);
        case 'playlist-desc':
          return bPlaylist.localeCompare(aPlaylist);
        case 'newest':
        default:
          return bTime - aTime;
      }
    });
    return result;
  }, [backups, playlistFilter, playlistId, playlistNameMatches, searchQuery, sortOption]);

  const groupedBackups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const groups = new Map();
    backups.forEach((backup) => {
      if (!playlistId && playlistFilter && backup.playlistId !== playlistFilter) return;
      if (!groups.has(backup.playlistId)) {
        groups.set(backup.playlistId, {
          playlistId: backup.playlistId,
          playlistName: backup.playlistName || playlistMap[backup.playlistId]?.name || 'Playlist',
          items: [],
        });
      }
      groups.get(backup.playlistId).items.push(backup);
    });

    const results = [];
    groups.forEach((group) => {
      const playlistMatches = playlistNameMatches.has(group.playlistId);
      const items = (query && !playlistMatches)
        ? group.items.filter((backup) => (backup.name || '').toLowerCase().includes(query))
        : group.items;
      if (items.length === 0) return;
      const sortedItems = [...items].sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });
      const latestBackup = sortedItems[0] || null;
      results.push({
        ...group,
        items: sortedItems,
        backupCount: sortedItems.length,
        latestBackup,
      });
    });

    results.sort((a, b) => {
      const aTime = a.latestBackup?.createdAt ? new Date(a.latestBackup.createdAt).getTime() : 0;
      const bTime = b.latestBackup?.createdAt ? new Date(b.latestBackup.createdAt).getTime() : 0;
      const aPlaylist = (a.playlistName || '').toLowerCase();
      const bPlaylist = (b.playlistName || '').toLowerCase();
      const aBackupName = (a.latestBackup?.name || '').toLowerCase();
      const bBackupName = (b.latestBackup?.name || '').toLowerCase();

      switch (sortOption) {
        case 'oldest':
          return aTime - bTime;
        case 'backup-asc':
          return aBackupName.localeCompare(bBackupName);
        case 'backup-desc':
          return bBackupName.localeCompare(aBackupName);
        case 'playlist-asc':
          return aPlaylist.localeCompare(bPlaylist);
        case 'playlist-desc':
          return bPlaylist.localeCompare(aPlaylist);
        case 'newest':
        default:
          return bTime - aTime;
      }
    });

    return results;
  }, [backups, playlistFilter, playlistId, playlistMap, playlistNameMatches, searchQuery, sortOption]);

  const showGroupedView = !playlistId && viewMode === 'grouped';

  const playlistFilterOptions = useMemo(() => {
    const seen = new Map();
    backups.forEach((backup) => {
      if (!backup.playlistId) return;
      if (!seen.has(backup.playlistId)) {
        seen.set(
          backup.playlistId,
          backup.playlistName || playlistMap[backup.playlistId]?.name || 'Playlist',
        );
      }
    });
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [backups, playlistMap]);

  const handleToggleGroup = (groupId) => {
    setExpandedGroups((prev) => {
      const current = prev[groupId];
      return { ...prev, [groupId]: current === undefined ? false : !current };
    });
  };

  const loadBackupStatus = useCallback(async (id, playlistName) => {
    setBackupStatusLoading(true);
    setBackupStatusError(null);
    try {
      const [status, prefs] = await Promise.all([
        playlistAPI.getBackupStatus(id),
        preferencesAPI.getPreferences().catch(() => null),
      ]);
      setBackupStatus(status);
      const template = prefs?.backup_name_template || '{playlist} backup {date}';
      setBackupCacheFirstSetting(prefs?.backup_cache_first ?? true);
      setBackupCreateName(formatBackupName(template, playlistName));
      const dateStamp = new Date().toISOString().slice(0, 10);
      setRestoreCloneName(`${playlistName || 'Playlist'} (backup ${dateStamp})`);
    } catch (err) {
      setBackupStatusError(err.message || 'Failed to load backup status.');
    } finally {
      setBackupStatusLoading(false);
    }
  }, []);

  const loadBackups = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBackupCreateError(null);
    setBackupCreateMessage(null);
    setRestoreError(null);
    setRestoreMessage(null);
    try {
      const playlistList = await playlistAPI.getPlaylists();
      setPlaylists(playlistList || []);

      if (playlistId) {
        const playlistName = playlistList?.find((pl) => pl.id === playlistId)?.name || 'Playlist';
        const list = await playlistAPI.listBackups(playlistId);
        const normalized = (list || []).map((backup) => ({
          id: backup.id,
          playlistId: backup.playlist_id || playlistId,
          playlistName,
          name: backup.name,
          createdAt: backup.created_at,
          trackCount: backup.track_count ?? 0,
        }));
        setBackups(normalized);
        await loadBackupStatus(playlistId, playlistName);
      } else {
        const results = await Promise.allSettled(
          (playlistList || []).map(async (playlist) => ({
            playlist,
            list: await playlistAPI.listBackups(playlist.id),
          })),
        );
        const normalized = [];
        results.forEach((result) => {
          if (result.status !== 'fulfilled') return;
          const { playlist, list } = result.value || {};
          (list || []).forEach((backup) => {
            normalized.push({
              id: backup.id,
              playlistId: backup.playlist_id || playlist?.id,
              playlistName: playlist?.name || 'Playlist',
              name: backup.name,
              createdAt: backup.created_at,
              trackCount: backup.track_count ?? 0,
            });
          });
        });
        setBackups(normalized);
      }
    } catch (err) {
      setError(err.message || 'Failed to load backups.');
    } finally {
      setLoading(false);
    }
  }, [loadBackupStatus, playlistId]);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  const handleRemoveFilter = () => {
    setSearchParams({});
    setPlaylistFilter('');
  };

  const handleCreateBackup = async () => {
    if (!playlistId || backupCreateLoading) return;
    const trimmedName = backupCreateName.trim();
    if (!trimmedName) {
      setBackupCreateError('Please enter a backup name.');
      return;
    }
    setBackupCreateLoading(true);
    setBackupCreateError(null);
    setBackupCreateMessage(null);
    try {
      await playlistAPI.createBackup(playlistId, { name: trimmedName, cache_first: backupCacheFirstSetting });
      setBackupCreateMessage('Backup created.');
      await loadBackups();
    } catch (err) {
      setBackupCreateError(err.message || 'Failed to create backup.');
    } finally {
      setBackupCreateLoading(false);
    }
  };

  const handleRestoreSnapshot = async () => {
    if (!playlistId || restoreLoading) return;
    if (!restoreModal) return;
    setRestoreLoading(true);
    setRestoreError(null);
    setRestoreMessage(null);
    const payload = { mode: restoreModal.mode };
    if (restoreModal.mode === 'clone' && restoreCloneName.trim()) {
      payload.name = restoreCloneName.trim();
    }
    try {
      const result = await playlistAPI.restoreFromBackup(playlistId, payload);
      setRestoreMessage(result.message || 'Restore completed.');
      if (restoreModal.mode === 'clone' && result.new_playlist_id) {
        navigate(`/playlist/${result.new_playlist_id}`);
      } else {
        await loadBackupStatus(playlistId, filteredPlaylist?.name || 'Playlist');
      }
      setRestoreModal(null);
    } catch (err) {
      setRestoreError(err.message || 'Failed to restore playlist.');
    } finally {
      setRestoreLoading(false);
    }
  };

  const hasGroupedResults = groupedBackups.length > 0;
  const hasFlatResults = sortedFlatBackups.length > 0;
  const showEmptyState = showGroupedView ? !hasGroupedResults : !hasFlatResults;

  return (
    <Layout user={user} onLogout={onLogout}>
      <div className="bg-gradient-to-b from-spotify-gray-dark to-spotify-black text-white">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">Backups</h1>
              <p className="text-spotify-gray-light mt-1">
                Browse playlist backups and restore when you need a clean slate.
              </p>
            </div>
            <button
              onClick={() => navigate('/playlists')}
              className="px-4 py-2 rounded-lg bg-spotify-gray-mid hover:bg-spotify-gray-light text-white transition-colors border border-spotify-gray-mid/60"
            >
              ← Back to Playlists
            </button>
          </div>

          {playlistId && (
            <div className="bg-spotify-gray-dark/40 border border-spotify-gray-mid/60 rounded-2xl p-4 md:p-5 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs uppercase tracking-wide text-spotify-gray-light">Filtered playlist</span>
                <div className="flex items-center gap-2 bg-spotify-gray-mid/60 text-white text-sm px-3 py-1.5 rounded-full">
                  <span className="icon text-sm">filter_alt</span>
                  <span>{filteredPlaylist?.name || 'Playlist'}</span>
                  <button
                    type="button"
                    onClick={handleRemoveFilter}
                    className="ml-1 text-xs text-spotify-gray-light hover:text-white"
                  >
                    Remove filter
                  </button>
                </div>
              </div>
              <p className="text-xs text-spotify-gray-light">
                Showing backups for one playlist. Remove the filter to view your full backup library.
              </p>
            </div>
          )}

          {playlistId && (
            <div className="space-y-4">
              <div className="bg-spotify-gray-dark/40 border border-spotify-gray-mid/60 rounded-2xl p-4 space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Cached snapshot</p>
                  <p className="text-sm text-spotify-gray-light mt-1">
                    Restore from the latest cached snapshot of this playlist.
                  </p>
                </div>
                {backupStatusLoading ? (
                  <div className="flex items-center gap-2 text-spotify-gray-light text-sm">
                    <div className="w-4 h-4 border-2 border-spotify-green border-t-transparent rounded-full animate-spin" />
                    <span>Loading snapshot status…</span>
                  </div>
                ) : backupStatus ? (
                  <div className="bg-spotify-gray-mid/40 border border-spotify-gray-mid/60 rounded-xl p-3 text-sm space-y-1">
                    <p><span className="text-spotify-gray-light">Status:</span> {backupStatus.cached ? 'Cached' : 'Not cached'}</p>
                    <p><span className="text-spotify-gray-light">Tracks:</span> {backupStatus.track_count ?? 0}</p>
                    {backupStatus.last_cached_at_utc && (
                      <p>
                        <span className="text-spotify-gray-light">Last cached:</span>{' '}
                        {formatTimestamp(backupStatus.last_cached_at_utc)}
                      </p>
                    )}
                    {backupStatus.is_dirty && (
                      <p className="text-amber-300 text-sm">Cache is out of date; refresh the playlist before restoring.</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-spotify-gray-light">Snapshot status unavailable.</p>
                )}
                {backupStatusError && <p className="text-sm text-red-400">{backupStatusError}</p>}
                {restoreMessage && <p className="text-sm text-spotify-green">{restoreMessage}</p>}
                {restoreError && <p className="text-sm text-red-400">{restoreError}</p>}
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setRestoreModal({ mode: 'overwrite', source: 'snapshot' })}
                    disabled={restoreLoading || !backupStatus?.cached || (backupStatus?.track_count || 0) === 0}
                    className="w-full px-4 py-2 rounded-lg border border-spotify-gray-light text-white bg-spotify-gray-dark/60 hover:bg-spotify-gray-mid/60 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => setRestoreModal({ mode: 'clone', source: 'snapshot' })}
                    disabled={restoreLoading || !backupStatus?.cached || (backupStatus?.track_count || 0) === 0}
                    className="w-full px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Restore as new
                  </button>
                </div>
              </div>

              <div className="bg-spotify-gray-dark/40 border border-spotify-gray-mid/60 rounded-2xl p-4 space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Create backup</p>
                  <p className="text-sm text-spotify-gray-light mt-1">
                    Save a named snapshot from the cached playlist.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={backupCreateName}
                    onChange={(event) => setBackupCreateName(event.target.value)}
                    className="bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                    placeholder="Backup name"
                  />
                  <button
                    type="button"
                    onClick={handleCreateBackup}
                    disabled={backupCreateLoading}
                    className="w-full px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {backupCreateLoading ? 'Creating…' : 'Create backup'}
                  </button>
                </div>
                {backupCreateError && <p className="text-sm text-red-400">{backupCreateError}</p>}
                {backupCreateMessage && <p className="text-sm text-spotify-green">{backupCreateMessage}</p>}
              </div>
            </div>
          )}

          <div className="bg-spotify-gray-dark/40 border border-spotify-gray-mid/60 rounded-2xl p-4 space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:gap-4">
              <div className="flex-1 min-w-[220px]">
                <label className="text-xs uppercase tracking-wide text-spotify-gray-light">Search backups</label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search playlists, backup names"
                  className="mt-2 w-full bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                />
              </div>
              {!playlistId && (
                <div className="flex flex-col gap-2 md:w-64">
                  <label className="text-xs uppercase tracking-wide text-spotify-gray-light">Playlist filter</label>
                  <select
                    value={playlistFilter}
                    onChange={(event) => setPlaylistFilter(event.target.value)}
                    className="bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                  >
                    <option value="">All playlists</option>
                    {playlistFilterOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex flex-col gap-2 md:w-48">
                <label className="text-xs uppercase tracking-wide text-spotify-gray-light">Sort</label>
                <select
                  value={sortOption}
                  onChange={(event) => setSortOption(event.target.value)}
                  className="bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              {!playlistId && (
                <div className="flex flex-col gap-2">
                  <label className="text-xs uppercase tracking-wide text-spotify-gray-light">View mode</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setViewMode('grouped')}
                      className={`px-3 py-2 rounded-lg text-sm border ${
                        viewMode === 'grouped'
                          ? 'bg-spotify-green text-black border-spotify-green'
                          : 'bg-spotify-gray-dark/60 text-white border-spotify-gray-mid/60 hover:bg-spotify-gray-mid/60'
                      }`}
                    >
                      Grouped
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('flat')}
                      className={`px-3 py-2 rounded-lg text-sm border ${
                        viewMode === 'flat'
                          ? 'bg-spotify-green text-black border-spotify-green'
                          : 'bg-spotify-gray-dark/60 text-white border-spotify-gray-mid/60 hover:bg-spotify-gray-mid/60'
                      }`}
                    >
                      Flat list
                    </button>
                  </div>
                </div>
              )}
            </div>

            {loading && (
              <div className="flex justify-center items-center py-16">
                <LoadingSpinner />
              </div>
            )}

            {error && !loading && (
              <ErrorMessage message={error} />
            )}

            {!loading && !error && showEmptyState && (
              <div className="bg-spotify-gray-dark/40 rounded-lg p-8 text-center border border-spotify-gray-mid/60">
                <span className="icon text-6xl text-spotify-gray-light mb-4 block">inventory_2</span>
                <h2 className="text-xl font-semibold text-white mb-2">
                  {searchQuery ? 'No matches found' : 'No backups yet'}
                </h2>
                <p className="text-spotify-gray-light">
                  {searchQuery
                    ? 'Try a different search term or adjust the filter.'
                    : 'Create a backup to see it appear here.'}
                </p>
              </div>
            )}

            {!loading && !error && !showEmptyState && showGroupedView && (
              <div className="space-y-4">
                {groupedBackups.map((group) => {
                  const isExpanded = expandedGroups[group.playlistId] ?? true;
                  return (
                    <div
                      key={group.playlistId}
                      className="bg-spotify-gray-dark/60 border border-spotify-gray-mid/60 rounded-2xl overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleGroup(group.playlistId)}
                        className="w-full text-left px-4 py-3 flex items-center justify-between gap-4 hover:bg-spotify-gray-mid/40 transition-colors"
                      >
                        <div className="space-y-1">
                          <p className="text-lg font-semibold text-white">{group.playlistName}</p>
                          <p className="text-sm text-spotify-gray-light">
                            {group.backupCount} {group.backupCount === 1 ? 'backup' : 'backups'} •{' '}
                            {formatTimestamp(group.latestBackup?.createdAt)}
                          </p>
                        </div>
                        <span
                          className={`icon text-spotify-gray-light text-xl transition-transform ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                        >
                          expand_more
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="border-t border-spotify-gray-mid/60">
                          <div className="space-y-2 p-3">
                            {group.items.map((backup) => (
                              <button
                                key={`${group.playlistId}-${backup.id}`}
                                type="button"
                                onClick={() => navigate(`/backups/${backup.id}`, { state: { playlistId: backup.playlistId } })}
                                className="w-full text-left bg-spotify-gray-dark/40 border border-spotify-gray-mid/60 rounded-xl p-3 hover:bg-spotify-gray-mid/40 transition-colors flex items-center justify-between gap-4"
                              >
                                <div className="space-y-1">
                                  <p className="text-base font-semibold text-white">{backup.name || 'Backup'}</p>
                                  <p className="text-sm text-spotify-gray-light">
                                    {formatTimestamp(backup.createdAt)} • {backup.trackCount ?? 0} tracks
                                  </p>
                                </div>
                                <span className="icon text-spotify-gray-light text-xl">chevron_right</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!loading && !error && !showEmptyState && !showGroupedView && (
              <div className="space-y-3">
                {sortedFlatBackups.map((backup) => (
                  <button
                    key={`${backup.playlistId}-${backup.id}`}
                    type="button"
                    onClick={() => navigate(`/backups/${backup.id}`, { state: { playlistId: backup.playlistId } })}
                    className="w-full text-left bg-spotify-gray-dark/60 border border-spotify-gray-mid/60 rounded-2xl p-4 hover:bg-spotify-gray-mid/40 transition-colors flex items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <p className="text-xs uppercase tracking-wide text-spotify-gray-light">{backup.playlistName}</p>
                      <p className="text-lg font-semibold text-white">{backup.name || 'Backup'}</p>
                      <p className="text-sm text-spotify-gray-light">
                        {formatTimestamp(backup.createdAt)} • {backup.trackCount ?? 0} tracks
                      </p>
                    </div>
                    <span className="icon text-spotify-gray-light text-xl">chevron_right</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {restoreModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-spotify-gray-dark rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-spotify-gray-mid/60">
            <div>
              <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Confirm restore</p>
              <h3 className="text-xl font-semibold text-white">
                {restoreModal.mode === 'clone' ? 'Restore as new playlist' : 'Restore playlist'}
              </h3>
            </div>
            <div className="bg-spotify-gray-mid/40 border border-spotify-gray-mid/60 rounded-lg p-3 text-sm text-white space-y-1">
              <p>
                <span className="text-spotify-gray-light">Target:</span>{' '}
                {restoreModal.mode === 'clone' ? 'New playlist' : filteredPlaylist?.name || 'Playlist'}
              </p>
              <p>
                <span className="text-spotify-gray-light">Tracks:</span>{' '}
                {backupStatus?.track_count ?? 0}
              </p>
            </div>
            {restoreModal.mode === 'clone' && (
              <label className="text-sm text-spotify-gray-light flex flex-col gap-2">
                New playlist name
                <input
                  type="text"
                  value={restoreCloneName}
                  onChange={(event) => setRestoreCloneName(event.target.value)}
                  className="bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                />
              </label>
            )}
            <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
              <button
                type="button"
                onClick={() => setRestoreModal(null)}
                disabled={restoreLoading}
                className="px-4 py-2 rounded-lg border border-spotify-gray-light text-white bg-spotify-gray-dark/60 hover:bg-spotify-gray-mid/60 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRestoreSnapshot}
                disabled={restoreLoading || (restoreModal.mode === 'clone' && !restoreCloneName.trim())}
                className="px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {restoreLoading ? 'Restoring…' : restoreModal.mode === 'clone' ? 'Restore as new' : 'Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default BackupsLibraryPage;
