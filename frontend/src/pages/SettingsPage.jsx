import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { playlistAPI, preferencesAPI, settingsAPI } from '../services/api';

const hourOptions = Array.from({ length: 24 }).map((_, i) => ({ value: i, label: `${i}:00` }));
const dayOptions = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
  { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun' },
];

const SettingsSection = ({ title, description, open, onToggle, children }) => (
  <div className="bg-spotify-gray-dark/40 rounded-2xl border border-spotify-gray-mid/60">
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-start justify-between gap-4 px-5 py-4 text-left"
      aria-expanded={open}
    >
      <div>
        <p className="text-xs uppercase tracking-wide text-spotify-gray-light">{title}</p>
        {description && <p className="text-sm text-spotify-gray-light mt-1">{description}</p>}
      </div>
      <span
        className={`icon text-xl text-spotify-gray-light transition-transform ${open ? 'rotate-180' : ''}`}
      >
        expand_more
      </span>
    </button>
    {open && (
      <div className="px-5 pb-5 pt-1 space-y-4">
        {children}
      </div>
    )}
  </div>
);

const ToggleField = ({ label, description, checked, onChange, disabled = false }) => (
  <label className={`flex items-center justify-between gap-4 bg-spotify-gray-mid/30 rounded-lg border border-spotify-gray-mid/60 px-3 py-3 ${disabled ? 'opacity-50' : ''}`}>
    <div>
      <p className="text-sm text-white">{label}</p>
      {description && <p className="text-xs text-spotify-gray-light">{description}</p>}
    </div>
    <span className="relative inline-flex items-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="sr-only peer"
      />
      <span className="w-11 h-6 rounded-full bg-spotify-gray-mid peer-checked:bg-spotify-green transition-colors" />
      <span className="absolute left-1 top-1 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
    </span>
  </label>
);

const SettingsPage = ({ user, onLogout }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sectionsOpen, setSectionsOpen] = useState({
    backups: true,
    playlists: false,
    player: false,
    cache: false,
  });

  const [cacheTtlDays, setCacheTtlDays] = useState(30);
  const [cacheTtlSource, setCacheTtlSource] = useState('env');
  const [cacheSaving, setCacheSaving] = useState(false);
  const [cacheMessage, setCacheMessage] = useState(null);
  const [cacheError, setCacheError] = useState(null);
  const [cacheScope, setCacheScope] = useState('all');
  const [cacheSelectedIds, setCacheSelectedIds] = useState([]);
  const [cacheAutoIncludeNew, setCacheAutoIncludeNew] = useState(true);
  const [playlistSearch, setPlaylistSearch] = useState('');
  const [playlistOptions, setPlaylistOptions] = useState([]);
  const [cachePlaylistSaving, setCachePlaylistSaving] = useState(false);
  const [cachePlaylistMessage, setCachePlaylistMessage] = useState(null);
  const [cachePlaylistError, setCachePlaylistError] = useState(null);
  const [cleanupSchedule, setCleanupSchedule] = useState(null);

  const [backupNameTemplate, setBackupNameTemplate] = useState('{playlist} backup {date}');
  const [backupRetentionDays, setBackupRetentionDays] = useState(60);
  const [backupCacheFirst, setBackupCacheFirst] = useState(true);
  const [backupCleanupEnabled, setBackupCleanupEnabled] = useState(true);
  const [cleanupScheduleType, setCleanupScheduleType] = useState('daily');
  const [cleanupHour, setCleanupHour] = useState(4);
  const [cleanupDayOfWeek, setCleanupDayOfWeek] = useState('sun');
  const [cleanupDayOfMonth, setCleanupDayOfMonth] = useState(1);
  const [backupSaving, setBackupSaving] = useState(false);
  const [backupMessage, setBackupMessage] = useState(null);
  const [backupError, setBackupError] = useState(null);

  const [playlistView, setPlaylistView] = useState('grid');
  const [playlistSort, setPlaylistSort] = useState('default');
  const [playlistAlbumOpen, setPlaylistAlbumOpen] = useState(false);
  const [playlistActionsOpen, setPlaylistActionsOpen] = useState(false);
  const [playlistSaving, setPlaylistSaving] = useState(false);
  const [playlistMessage, setPlaylistMessage] = useState(null);
  const [playlistError, setPlaylistError] = useState(null);

  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [playerSaving, setPlayerSaving] = useState(false);
  const [playerMessage, setPlayerMessage] = useState(null);
  const [playerError, setPlayerError] = useState(null);

  const cleanupNextRun = useMemo(() => {
    if (!cleanupSchedule?.next_run_at) return null;
    const date = new Date(cleanupSchedule.next_run_at);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [cleanupSchedule]);

  const backupTemplateExample = useMemo(() => {
    const exampleName = 'Friday Mix';
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const datetime = `${date} ${time}`;
    const safeTemplate = backupNameTemplate && backupNameTemplate.trim()
      ? backupNameTemplate
      : '{playlist} backup {date}';
    return safeTemplate
      .replace('{playlist}', exampleName)
      .replace('{date}', date)
      .replace('{time}', time)
      .replace('{datetime}', datetime);
  }, [backupNameTemplate]);

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

  const toggleSection = (key) => {
    setSectionsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
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

  const computeFirstRunIso = (scheduleType, hourOfDay, dayOfWeek, dayOfMonth) => {
    const now = new Date();
    const offsetMinutes = -now.getTimezoneOffset();
    const target = new Date();
    target.setSeconds(0, 0);
    target.setMinutes(0);
    target.setHours(Number(hourOfDay || 0));

    if (scheduleType === 'daily') {
      if (target <= now) target.setDate(target.getDate() + 1);
    } else if (scheduleType === 'weekly') {
      const dowMap = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
      const desired = dowMap[dayOfWeek] ?? 1;
      const current = target.getDay();
      let diff = desired - current;
      if (diff < 0 || (diff === 0 && target <= now)) diff += 7;
      target.setDate(target.getDate() + diff);
    } else if (scheduleType === 'monthly') {
      const day = Math.min(28, Number(dayOfMonth || 1));
      target.setDate(day);
      if (target <= now) {
        target.setMonth(target.getMonth() + 1);
      }
    }
    return { first_run_at: target.toISOString(), timezone_offset_minutes: offsetMinutes };
  };

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const [prefs, schedules, appSettings, playlists] = await Promise.all([
        preferencesAPI.getPreferences(),
        playlistAPI.listSchedules().catch(() => []),
        settingsAPI.getSettings().catch(() => null),
        playlistAPI.getPlaylists().catch(() => []),
      ]);
      const cleanup = (schedules || []).find((sched) => sched.action_type === 'backup_cleanup');
      setCleanupSchedule(cleanup || null);

      setBackupNameTemplate(prefs?.backup_name_template || '{playlist} backup {date}');
      setBackupRetentionDays(prefs?.backup_retention_days ?? 60);
      setBackupCacheFirst(prefs?.backup_cache_first ?? true);
      setBackupCleanupEnabled(prefs?.backup_cleanup_enabled ?? true);

      const params = cleanup?.params || {};
      setCleanupScheduleType(params.schedule_type || 'daily');
      setCleanupHour(params.hour_of_day ?? 4);
      setCleanupDayOfWeek(params.day_of_week || 'sun');
      setCleanupDayOfMonth(params.day_of_month ?? 1);

      setPlaylistView(prefs?.playlist_view || 'grid');
      setPlaylistSort(prefs?.playlist_sort || 'default');
      setPlaylistAlbumOpen(prefs?.playlist_album_details_open ?? false);
      setPlaylistActionsOpen(prefs?.playlist_action_details_open ?? false);
      setNowPlayingOpen(prefs?.now_playing_details_open ?? false);
      setCacheScope(prefs?.cache_playlist_scope || 'all');
      setCacheSelectedIds(prefs?.cache_selected_playlist_ids || []);
      setCacheAutoIncludeNew(prefs?.cache_auto_include_new ?? true);
      setPlaylistOptions(playlists || []);
      setCacheTtlDays(appSettings?.track_cache_ttl_days ?? 30);
      setCacheTtlSource(appSettings?.track_cache_ttl_source || 'env');
    } catch (err) {
      setError(err.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSaveBackupSettings = async () => {
    setBackupSaving(true);
    setBackupError(null);
    setBackupMessage(null);

    try {
      const prefPayload = {
        backup_name_template: backupNameTemplate.trim() || '{playlist} backup {date}',
        backup_retention_days: Number(backupRetentionDays) || 60,
        backup_cache_first: Boolean(backupCacheFirst),
        backup_cleanup_enabled: Boolean(backupCleanupEnabled),
      };
      await preferencesAPI.updatePreferences(prefPayload);

      if (backupCleanupEnabled) {
        const { first_run_at, timezone_offset_minutes } = computeFirstRunIso(
          cleanupScheduleType,
          cleanupHour,
          cleanupDayOfWeek,
          cleanupDayOfMonth
        );
        const payload = {
          action_type: 'backup_cleanup',
          schedule_type: cleanupScheduleType,
          hour_of_day: Number(cleanupHour),
          day_of_week: cleanupDayOfWeek,
          day_of_month: Number(cleanupDayOfMonth),
          frequency_minutes: cleanupScheduleType === 'weekly' ? 10080 : cleanupScheduleType === 'monthly' ? 43200 : 1440,
          timezone_offset_minutes,
          first_run_at,
          enabled: true,
        };
        if (cleanupSchedule?.id) {
          await playlistAPI.updateBackupCleanupSchedule(cleanupSchedule.id, payload);
        } else {
          await playlistAPI.createBackupCleanupSchedule(payload);
        }
      } else if (cleanupSchedule?.id) {
        await playlistAPI.updateBackupCleanupSchedule(cleanupSchedule.id, { enabled: false });
      }

      await loadSettings();
      setBackupMessage('Backup settings saved.');
    } catch (err) {
      setBackupError(err.message || 'Failed to save backup settings');
    } finally {
      setBackupSaving(false);
    }
  };

  const handleSavePlaylistSettings = async () => {
    setPlaylistSaving(true);
    setPlaylistError(null);
    setPlaylistMessage(null);
    try {
      await preferencesAPI.updatePreferences({
        playlist_view: playlistView,
        playlist_sort: playlistSort,
        playlist_album_details_open: playlistAlbumOpen,
        playlist_action_details_open: playlistActionsOpen,
      });
      setPlaylistMessage('Playlist settings saved.');
    } catch (err) {
      setPlaylistError(err.message || 'Failed to save playlist settings');
    } finally {
      setPlaylistSaving(false);
    }
  };

  const handleSavePlayerSettings = async () => {
    setPlayerSaving(true);
    setPlayerError(null);
    setPlayerMessage(null);
    try {
      await preferencesAPI.updatePreferences({
        now_playing_details_open: nowPlayingOpen,
      });
      setPlayerMessage('Player settings saved.');
    } catch (err) {
      setPlayerError(err.message || 'Failed to save player settings');
    } finally {
      setPlayerSaving(false);
    }
  };

  const handleSavePlaylistCacheSettings = async () => {
    setCachePlaylistSaving(true);
    setCachePlaylistError(null);
    setCachePlaylistMessage(null);

    try {
      const payload = {
        cache_playlist_scope: cacheScope,
        cache_selected_playlist_ids: cacheSelectedIds,
        cache_auto_include_new: cacheAutoIncludeNew,
      };
      await preferencesAPI.updatePreferences(payload);

      setCachePlaylistMessage('Playlist caching settings saved.');
    } catch (err) {
      setCachePlaylistError(err.message || 'Failed to save playlist caching settings');
    } finally {
      setCachePlaylistSaving(false);
    }
  };

  const handleSaveCacheSettings = async () => {
    setCacheSaving(true);
    setCacheError(null);
    setCacheMessage(null);
    try {
      const ttlValue = Number(cacheTtlDays) || 30;
      const updated = await settingsAPI.updateSettings({ track_cache_ttl_days: ttlValue });
      setCacheTtlDays(updated?.track_cache_ttl_days ?? ttlValue);
      setCacheTtlSource(updated?.track_cache_ttl_source || 'stored');
      setCacheMessage('Cache settings saved.');
    } catch (err) {
      setCacheError(err.message || 'Failed to save cache settings');
    } finally {
      setCacheSaving(false);
    }
  };

  return (
    <Layout user={user} onLogout={onLogout}>
      <div className="bg-gradient-to-b from-spotify-gray-dark to-spotify-black text-white min-h-screen">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Preferences</p>
              <h2 className="text-2xl font-semibold">Settings</h2>
              <p className="text-sm text-spotify-gray-light mt-1">
                Control backup defaults, playlist behavior, and cache preferences.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/playlists')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-spotify-gray-light bg-spotify-gray-dark/60 hover:bg-spotify-gray-mid/60 text-white transition-colors"
            >
              <span className="icon text-base">arrow_back</span>
              Back to Playlists
            </button>
          </div>

          {loading ? (
            <LoadingSpinner text="Loading settings..." />
          ) : (
            <>
              {error && <ErrorMessage message={error} />}

              <SettingsSection
                title="Backups"
                description="Control retention, naming, and cleanup cadence."
                open={sectionsOpen.backups}
                onToggle={() => toggleSection('backups')}
              >
                <div className="md:max-w-md space-y-2">
                  <label className="text-sm text-spotify-gray-light flex flex-col gap-2">
                    Backup name template
                    <input
                      type="text"
                      value={backupNameTemplate}
                      onChange={(event) => setBackupNameTemplate(event.target.value)}
                      className="w-full bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                      placeholder="{playlist} backup {date}"
                    />
                  </label>
                  <p className="text-xs text-spotify-gray-light">
                    Template strings: {'{playlist}'}, {'{date}'}, {'{time}'}, {'{datetime}'}.
                  </p>
                  <p className="text-xs text-spotify-gray-light">
                    Example output: <span className="text-white">{backupTemplateExample}</span>
                  </p>
                </div>

                <div className="md:max-w-md">
                  <label className="text-sm text-spotify-gray-light flex flex-col gap-2">
                    Retention (days)
                    <input
                      type="number"
                      min="1"
                      max="3650"
                      value={backupRetentionDays}
                      onChange={(event) => setBackupRetentionDays(event.target.value)}
                      className="w-full bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                    />
                  </label>
                </div>
                <div className="md:max-w-md">
                  <ToggleField
                    label="Cache before backup"
                    description="Refresh the playlist cache before creating backups."
                    checked={backupCacheFirst}
                    onChange={setBackupCacheFirst}
                  />
                </div>

                <div className="md:max-w-md">
                  <ToggleField
                    label="Cleanup old backups"
                    description="Delete backups older than your retention window."
                    checked={backupCleanupEnabled}
                    onChange={setBackupCleanupEnabled}
                  />
                </div>

                <div className={backupCleanupEnabled ? '' : 'opacity-50 pointer-events-none'}>
                  <div className="md:max-w-md space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs text-spotify-gray-light flex flex-col gap-2">
                        Cadence
                        <select
                          value={cleanupScheduleType}
                          onChange={(event) => setCleanupScheduleType(event.target.value)}
                          className="bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                        >
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </label>
                      <label className="text-xs text-spotify-gray-light flex flex-col gap-2">
                        Time
                        <select
                          value={cleanupHour}
                          onChange={(event) => setCleanupHour(event.target.value)}
                          className="bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                        >
                          {hourOptions.map((hour) => (
                            <option key={hour.value} value={hour.value}>{hour.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {cleanupScheduleType === 'weekly' && (
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-xs text-spotify-gray-light flex flex-col gap-2">
                          Day
                          <select
                            value={cleanupDayOfWeek}
                            onChange={(event) => setCleanupDayOfWeek(event.target.value)}
                            className="bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                          >
                            {dayOptions.map((day) => (
                              <option key={day.value} value={day.value}>{day.label}</option>
                            ))}
                          </select>
                        </label>
                        <div />
                      </div>
                    )}
                    {cleanupScheduleType === 'monthly' && (
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-xs text-spotify-gray-light flex flex-col gap-2">
                          Day
                          <select
                            value={cleanupDayOfMonth}
                            onChange={(event) => setCleanupDayOfMonth(event.target.value)}
                            className="bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                          >
                            {Array.from({ length: 28 }).map((_, idx) => (
                              <option key={idx + 1} value={idx + 1}>{idx + 1}</option>
                            ))}
                          </select>
                        </label>
                        <div />
                      </div>
                    )}
                  </div>
                </div>

                {cleanupNextRun && (
                  <p className="text-xs text-spotify-gray-light">
                    Next cleanup run: {cleanupNextRun}
                  </p>
                )}

                {backupError && <p className="text-sm text-red-400">{backupError}</p>}
                {backupMessage && <p className="text-sm text-spotify-green">{backupMessage}</p>}
                <button
                  type="button"
                  onClick={handleSaveBackupSettings}
                  disabled={backupSaving}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {backupSaving ? 'Saving...' : 'Save backup settings'}
                </button>
              </SettingsSection>

              <SettingsSection
                title="Playlists"
                description="Default view and action panel behavior."
                open={sectionsOpen.playlists}
                onToggle={() => toggleSection('playlists')}
              >
                <div className="space-y-4">
                  <div className="md:max-w-md">
                    <label className="text-sm text-spotify-gray-light flex flex-col gap-2">
                      Default view
                      <select
                        value={playlistView}
                        onChange={(event) => setPlaylistView(event.target.value)}
                        className="bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                      >
                        <option value="grid">Grid</option>
                        <option value="list">List</option>
                        <option value="table">Table</option>
                      </select>
                    </label>
                  </div>
                  <div className="md:max-w-md">
                    <label className="text-sm text-spotify-gray-light flex flex-col gap-2">
                      Default sort
                      <select
                        value={playlistSort}
                        onChange={(event) => setPlaylistSort(event.target.value)}
                        className="bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                      >
                        <option value="default">Default</option>
                        <option value="recently-updated-estimated">Recently updated</option>
                        <option value="name-asc">Name (A-Z)</option>
                        <option value="name-desc">Name (Z-A)</option>
                        <option value="tracks-asc">Tracks (asc)</option>
                        <option value="tracks-desc">Tracks (desc)</option>
                        <option value="owner-asc">Owner (A-Z)</option>
                        <option value="owner-desc">Owner (Z-A)</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="md:max-w-md">
                    <ToggleField
                      label="Show album details panel"
                      description="Keep album info expanded by default."
                      checked={playlistAlbumOpen}
                      onChange={setPlaylistAlbumOpen}
                    />
                  </div>
                  <div className="md:max-w-md">
                    <ToggleField
                      label="Show action details panel"
                      description="Keep playlist action details expanded."
                      checked={playlistActionsOpen}
                      onChange={setPlaylistActionsOpen}
                    />
                  </div>
                </div>

                {playlistError && <p className="text-sm text-red-400">{playlistError}</p>}
                {playlistMessage && <p className="text-sm text-spotify-green">{playlistMessage}</p>}
                <button
                  type="button"
                  onClick={handleSavePlaylistSettings}
                  disabled={playlistSaving}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {playlistSaving ? 'Saving...' : 'Save playlist settings'}
                </button>
              </SettingsSection>

              <SettingsSection
                title="Player"
                description="Default playback panel behavior."
                open={sectionsOpen.player}
                onToggle={() => toggleSection('player')}
              >
                <div className="md:max-w-md">
                  <ToggleField
                    label="Show now playing details"
                    description="Keep the now-playing panel expanded."
                    checked={nowPlayingOpen}
                    onChange={setNowPlayingOpen}
                  />
                </div>

                {playerError && <p className="text-sm text-red-400">{playerError}</p>}
                {playerMessage && <p className="text-sm text-spotify-green">{playerMessage}</p>}
                <button
                  type="button"
                  onClick={handleSavePlayerSettings}
                  disabled={playerSaving}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {playerSaving ? 'Saving...' : 'Save player settings'}
                </button>
              </SettingsSection>

              <SettingsSection
                title="Cache"
                description="Playlist caching preferences and retention."
                open={sectionsOpen.cache}
                onToggle={() => toggleSection('cache')}
              >
                <div className="space-y-5">
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-white">Playlist caching</p>
                    <p className="text-sm text-spotify-gray-light">
                      Playlist caching keeps a local copy of your chosen playlists so they open faster and stay ready
                      when you return.
                    </p>
                  </div>

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
                        {visiblePlaylists.length === 0 ? (
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

                  {cachePlaylistError && <p className="text-sm text-red-400">{cachePlaylistError}</p>}
                  {cachePlaylistMessage && <p className="text-sm text-spotify-green">{cachePlaylistMessage}</p>}

                  <button
                    type="button"
                    onClick={handleSavePlaylistCacheSettings}
                    disabled={cachePlaylistSaving}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {cachePlaylistSaving ? 'Saving...' : 'Save playlist caching settings'}
                  </button>
                </div>

                <div className="border-t border-spotify-gray-mid/60 pt-4 space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-white">Cache retention</p>
                    <p className="text-xs text-spotify-gray-light">
                      Cached track metadata expires after the configured TTL.
                    </p>
                    {cacheTtlSource === 'env' && (
                      <p className="text-xs text-spotify-gray-light">
                        Inherited from `.env` on first load. Saving here overrides it.
                      </p>
                    )}
                  </div>
                  <div className="md:max-w-md">
                    <label className="text-sm text-spotify-gray-light flex flex-col gap-2">
                      TTL (days)
                      <input
                        type="number"
                        min="1"
                        max="3650"
                        value={cacheTtlDays}
                        onChange={(event) => setCacheTtlDays(event.target.value)}
                        className="w-full bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                      />
                    </label>
                  </div>
                  {cacheError && <p className="text-sm text-red-400">{cacheError}</p>}
                  {cacheMessage && <p className="text-sm text-spotify-green">{cacheMessage}</p>}
                  <button
                    type="button"
                    onClick={handleSaveCacheSettings}
                    disabled={cacheSaving}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {cacheSaving ? 'Saving...' : 'Save cache retention'}
                  </button>
                </div>
              </SettingsSection>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default SettingsPage;
