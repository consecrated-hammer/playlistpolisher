import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { cacheAPI, playlistAPI, preferencesAPI } from '../services/api';

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

  const [cacheStats, setCacheStats] = useState(null);
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

  const toggleSection = (key) => {
    setSectionsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
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
      const [prefs, stats, schedules] = await Promise.all([
        preferencesAPI.getPreferences(),
        cacheAPI.getStats(),
        playlistAPI.listSchedules().catch(() => []),
      ]);
      setCacheStats(stats || null);
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
                <div className="space-y-3">
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

                <div className="grid gap-4 md:grid-cols-2">
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
                  <ToggleField
                    label="Cache before backup"
                    description="Refresh the playlist cache before creating backups."
                    checked={backupCacheFirst}
                    onChange={setBackupCacheFirst}
                  />
                </div>

                <ToggleField
                  label="Cleanup old backups"
                  description="Delete backups older than your retention window."
                  checked={backupCleanupEnabled}
                  onChange={setBackupCleanupEnabled}
                />

                <div className={`grid gap-3 md:grid-cols-4 ${backupCleanupEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
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
                  {cleanupScheduleType === 'weekly' && (
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
                  )}
                  {cleanupScheduleType === 'monthly' && (
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
                  )}
                  {cleanupScheduleType === 'daily' && <div className="hidden md:block" />}
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
                <div className="grid gap-4 md:grid-cols-2">
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

                <div className="grid gap-3 md:grid-cols-2">
                  <ToggleField
                    label="Show album details panel"
                    description="Keep album info expanded by default."
                    checked={playlistAlbumOpen}
                    onChange={setPlaylistAlbumOpen}
                  />
                  <ToggleField
                    label="Show action details panel"
                    description="Keep playlist action details expanded."
                    checked={playlistActionsOpen}
                    onChange={setPlaylistActionsOpen}
                  />
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
                <ToggleField
                  label="Show now playing details"
                  description="Keep the now-playing panel expanded."
                  checked={nowPlayingOpen}
                  onChange={setNowPlayingOpen}
                />

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
                description="Track cache configuration and retention."
                open={sectionsOpen.cache}
                onToggle={() => toggleSection('cache')}
              >
                <div className="bg-spotify-gray-mid/30 rounded-lg border border-spotify-gray-mid/60 p-4 space-y-2">
                  <p className="text-sm text-white">Track cache TTL</p>
                  <p className="text-xs text-spotify-gray-light">
                    Cached track metadata expires after {cacheStats?.ttl_days ?? '—'} days.
                  </p>
                  <p className="text-xs text-spotify-gray-light">
                    Change via `TRACK_CACHE_TTL_DAYS` in your backend environment.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/cache')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-spotify-gray-light bg-spotify-gray-dark/60 hover:bg-spotify-gray-mid/60 text-white transition-colors"
                >
                  <span className="icon text-base">storage</span>
                  Manage cache settings
                </button>
              </SettingsSection>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default SettingsPage;
