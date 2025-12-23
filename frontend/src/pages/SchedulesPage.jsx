import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { playlistAPI } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';

// Action type configurations for extensibility
const actionConfigs = {
  sort: {
    label: 'Sort',
    fields: ['sort_by', 'direction', 'method'],
    summary: (params) => {
      const sortLabels = { date_added: 'Date added', title: 'Title', artist: 'Artist', album: 'Album', duration: 'Duration' };
      const sort = sortLabels[params.sort_by] || 'Date added';
      const dir = params.direction === 'asc' ? '↑' : '↓';
      const method = params.method === 'fast' ? 'Fast' : 'Preserve dates';
      return `${sort} ${dir} • ${method}`;
    }
  },
  cache_clear: {
    label: 'Cache refresh',
    fields: [],
    summary: () => 'Clear expired cache entries'
  },
  // Future: dedupe, reorder, etc.
};

const SchedulesPage = ({ user, onLogout }) => {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [playlists, setPlaylists] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editingRowId, setEditingRowId] = useState(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  
  // Edit state for inline editing
  const [editForm, setEditForm] = useState({
    playlistId: '',
    action_type: 'sort',
    sort_by: 'date_added',
    direction: 'desc',
    method: 'preserve',
    schedule_type: 'daily',
    hour_of_day: 9,
    day_of_week: 'mon',
    day_of_month: 1,
  });

  const playlistMap = useMemo(() => {
    const map = {};
    playlists.forEach((p) => { map[p.id] = p; });
    return map;
  }, [playlists]);

  const showToast = (message, type = 'info') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [pls, schedResp] = await Promise.all([
          playlistAPI.getPlaylists(),
          playlistAPI.listSchedules().catch(() => []),
        ]);
        setPlaylists(pls);
        const initialPlaylist = searchParams.get('playlistId');
        if (initialPlaylist) {
            try {
              const scoped = await playlistAPI.listPlaylistSchedules(initialPlaylist);
              setSchedules(scoped);
            } catch {
              setSchedules(schedResp || []);
            }
        } else {
          setSchedules(schedResp || []);
        }
      } catch (e) {
        const msg = e.message || 'Failed to load schedules';
        setError(msg);
        showToast(msg, 'error');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [searchParams]);

  const refreshSchedules = async () => {
    try {
      const schedResp = await playlistAPI.listSchedules();
      setSchedules(schedResp);
    } catch (e) {
      const msg = e.message || 'Failed to refresh schedules';
      setError(msg);
      showToast(msg, 'error');
    }
  };

  const freqForType = (type) => {
    if (type === 'weekly') return 10080;
    if (type === 'monthly') return 43200;
    return 1440;
  };

  const computeFirstRunIso = (form) => {
    const now = new Date();
    const offsetMinutes = -now.getTimezoneOffset();
    const target = new Date();
    target.setSeconds(0, 0);
    target.setMinutes(0);
    target.setHours(Number(form.hour_of_day || 0));

    if (form.schedule_type === 'daily') {
      if (target <= now) target.setDate(target.getDate() + 1);
    } else if (form.schedule_type === 'weekly') {
      const dowMap = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
      const desired = dowMap[form.day_of_week] ?? 1;
      const current = target.getDay();
      let diff = desired - current;
      if (diff < 0 || (diff === 0 && target <= now)) diff += 7;
      target.setDate(target.getDate() + diff);
    } else if (form.schedule_type === 'monthly') {
      const day = Math.min(28, Number(form.day_of_month || 1));
      target.setDate(day);
      if (target <= now) {
        target.setMonth(target.getMonth() + 1);
      }
    }
    return { first_run_at: target.toISOString(), timezone_offset_minutes: offsetMinutes };
  };

  const handleStartNew = () => {
    setCreatingNew(true);
    setEditingRowId(null);
    setEditForm({
      playlistId: '',
      action_type: 'sort',
      sort_by: 'date_added',
      direction: 'desc',
      method: 'preserve',
      schedule_type: 'daily',
      hour_of_day: 9,
      day_of_week: 'mon',
      day_of_month: 1,
    });
  };

  const handleCancelEdit = () => {
    setCreatingNew(false);
    setEditingRowId(null);
    setEditForm({});
  };

  const handleStartEdit = (sched) => {
    const p = sched.params || {};
    setEditingRowId(sched.id);
    setCreatingNew(false);
    setEditForm({
      playlistId: sched.playlist_id,
      action_type: sched.action_type || 'sort',
      sort_by: p.sort_by || 'date_added',
      direction: p.direction || 'desc',
      method: p.method || 'preserve',
      schedule_type: p.schedule_type || 'daily',
      hour_of_day: p.hour_of_day ?? 9,
      day_of_week: p.day_of_week || 'mon',
      day_of_month: p.day_of_month ?? 1,
    });
  };

  const handleSaveEdit = async () => {
    const isCache = editForm.action_type === 'cache_clear';
    if (!isCache && !editForm.playlistId) {
      showToast('Please select a playlist', 'error');
      return;
    }
    
    // Check for duplicate when creating new (one per playlist/action)
    if (creatingNew && !isCache) {
      const existing = schedules.find((s) => s.playlist_id === editForm.playlistId && s.action_type === 'sort');
      if (existing) {
        showToast('This playlist already has a schedule', 'error');
        return;
      }
    }
    if (creatingNew && isCache) {
      const existingCache = schedules.find((s) => s.action_type === 'cache_clear');
      if (existingCache) {
        showToast('Cache refresh schedule already exists', 'error');
        return;
      }
    }

    setSaving(true);
    setError(null);
    
    const { first_run_at, timezone_offset_minutes } = computeFirstRunIso(editForm);
    const payload = {
      action_type: editForm.action_type,
      schedule_type: editForm.schedule_type,
      hour_of_day: Number(editForm.hour_of_day),
      day_of_week: editForm.day_of_week,
      day_of_month: Number(editForm.day_of_month),
      frequency_minutes: freqForType(editForm.schedule_type),
      timezone_offset_minutes,
      first_run_at,
    };
    if (editForm.action_type === 'sort') {
      payload.sort_by = editForm.sort_by;
      payload.direction = editForm.direction;
      payload.method = editForm.method;
    }

    try {
      if (editingRowId) {
        if (editForm.action_type === 'cache_clear') {
          await playlistAPI.updateCacheSchedule(editingRowId, payload);
        } else {
          await playlistAPI.updateSchedule(editForm.playlistId, editingRowId, payload);
        }
        showToast('Schedule updated', 'success');
      } else {
        if (editForm.action_type === 'cache_clear') {
          await playlistAPI.createCacheSchedule(payload);
        } else {
          await playlistAPI.createSchedule(editForm.playlistId, payload);
        }
        showToast('Schedule created', 'success');
      }
      await refreshSchedules();
      handleCancelEdit();
    } catch (e) {
      const msg = e.message || 'Failed to save schedule';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (sched) => {
    try {
      if (sched.action_type === 'cache_clear') {
        await playlistAPI.updateCacheSchedule(sched.id, { enabled: !sched.enabled });
      } else {
        await playlistAPI.updateSchedule(sched.playlist_id, sched.id, {
          enabled: !sched.enabled,
        });
      }
      await refreshSchedules();
      showToast(sched.enabled ? 'Schedule paused' : 'Schedule enabled', 'success');
    } catch (e) {
      const msg = e.message || 'Failed to update schedule';
      setError(msg);
      showToast(msg, 'error');
    }
  };

  const handleDelete = async (sched) => {
    if (!window.confirm('Delete this schedule?')) return;
    try {
      if (sched.action_type === 'cache_clear') {
        await playlistAPI.deleteCacheSchedule(sched.id);
      } else {
        await playlistAPI.deleteSchedule(sched.playlist_id, sched.id);
      }
      await refreshSchedules();
      if (editingRowId === sched.id) {
        handleCancelEdit();
      }
      showToast('Schedule deleted', 'success');
    } catch (e) {
      const msg = e.message || 'Failed to delete schedule';
      setError(msg);
      showToast(msg, 'error');
    }
  };

  // Get available playlists for dropdown (exclude already scheduled when creating new)
  const availablePlaylists = useMemo(() => {
    if (creatingNew) {
      const scheduledIds = new Set(schedules.map(s => s.playlist_id));
      return playlists.filter(p => !scheduledIds.has(p.id));
    }
    return playlists;
  }, [playlists, schedules, creatingNew]);

  // Render edit row (shared for new and edit modes)
  const renderEditRow = () => {
    const inputClass = "bg-spotify-gray-mid text-white text-sm rounded px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-1 focus:ring-spotify-green";
    const iconBtn = "w-8 h-8 rounded-full border flex items-center justify-center transition-colors";
    const canSave = editForm.action_type === 'cache_clear' || !!editForm.playlistId;
    
    return (
      <div className="grid grid-cols-12 px-4 py-3 text-sm items-center bg-spotify-green/5 border-l-4 border-spotify-green">
        {/* Type */}
        <div className="col-span-2 pr-2">
          <select
            value={editForm.action_type}
            onChange={(e) => setEditForm({ ...editForm, action_type: e.target.value })}
            className={inputClass}
          >
            {Object.entries(actionConfigs).map(([key, config]) => (
              <option key={key} value={key}>{config.label}</option>
            ))}
          </select>
        </div>

        {/* Playlist */}
        <div className="col-span-2 pr-2">
          {editForm.action_type === 'cache_clear' ? (
            <input
              value="Global cache"
              disabled
              className={`${inputClass} bg-spotify-gray-dark/40 text-spotify-gray-light`}
            />
          ) : (
            <select
              value={editForm.playlistId}
              onChange={(e) => setEditForm({ ...editForm, playlistId: e.target.value })}
              className={inputClass}
              disabled={editingRowId} // Can't change playlist when editing
            >
              <option value="">Select playlist</option>
              {availablePlaylists.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Action-specific fields */}
        <div className="col-span-3 pr-2 flex gap-1">
          {editForm.action_type === 'sort' && (
            <>
              <select
                value={editForm.sort_by}
                onChange={(e) => setEditForm({ ...editForm, sort_by: e.target.value })}
                className={inputClass}
              >
                <option value="date_added">Date added</option>
                <option value="title">Title</option>
                <option value="artist">Artist</option>
                <option value="album">Album</option>
                <option value="duration">Duration</option>
              </select>
              <select
                value={editForm.direction}
                onChange={(e) => setEditForm({ ...editForm, direction: e.target.value })}
                className={inputClass}
              >
                <option value="desc">↓</option>
                <option value="asc">↑</option>
              </select>
              <select
                value={editForm.method}
                onChange={(e) => setEditForm({ ...editForm, method: e.target.value })}
                className={inputClass}
              >
                <option value="preserve">Preserve</option>
                <option value="fast">Fast</option>
              </select>
            </>
          )}
        </div>

        {/* Frequency */}
        <div className="col-span-1 pr-2">
          <select
            value={editForm.schedule_type}
            onChange={(e) => setEditForm({ ...editForm, schedule_type: e.target.value })}
            className={inputClass}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        {/* Next run details (hour + optional day) */}
        <div className="col-span-2 pr-2 flex gap-1">
          <select
            value={editForm.hour_of_day}
            onChange={(e) => setEditForm({ ...editForm, hour_of_day: e.target.value })}
            className={inputClass}
          >
            {Array.from({ length: 24 }).map((_, i) => (
              <option key={i} value={i}>{`${i}:00`}</option>
            ))}
          </select>
          {editForm.schedule_type === 'weekly' && (
            <select
              value={editForm.day_of_week}
              onChange={(e) => setEditForm({ ...editForm, day_of_week: e.target.value })}
              className={inputClass}
            >
              <option value="mon">Mon</option>
              <option value="tue">Tue</option>
              <option value="wed">Wed</option>
              <option value="thu">Thu</option>
              <option value="fri">Fri</option>
              <option value="sat">Sat</option>
              <option value="sun">Sun</option>
            </select>
          )}
          {editForm.schedule_type === 'monthly' && (
            <select
              value={editForm.day_of_month}
              onChange={(e) => setEditForm({ ...editForm, day_of_month: e.target.value })}
              className={inputClass}
            >
              {Array.from({ length: 28 }).map((_, i) => (
                <option key={i + 1} value={i + 1}>{i + 1}</option>
              ))}
            </select>
          )}
        </div>

        {/* Outcome placeholder to keep grid alignment */}
        <div className="col-span-1 text-spotify-gray-light text-xs">—</div>

        {/* Actions */}
        <div className="col-span-1 flex items-center justify-end gap-2">
          <div className="relative group">
            <button
              onClick={handleSaveEdit}
              disabled={!canSave || saving}
              className={`${iconBtn} ${canSave && !saving ? 'border-spotify-green text-spotify-green hover:bg-spotify-green hover:text-black' : 'border-spotify-gray-light text-spotify-gray-light cursor-not-allowed opacity-50'}`}
            >
              <span className="icon text-base">{saving ? 'hourglass_empty' : 'check'}</span>
            </button>
            <div className="tooltip tooltip-up group-hover:tooltip-visible z-20">Save schedule</div>
          </div>
          <div className="relative group">
            <button
              onClick={handleCancelEdit}
              disabled={saving}
              className={`${iconBtn} border-spotify-gray-light text-spotify-gray-light hover:bg-spotify-gray-mid`}
            >
              <span className="icon text-base">close</span>
            </button>
            <div className="tooltip tooltip-up group-hover:tooltip-visible z-20">Cancel</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Layout user={user} onLogout={onLogout}>
      <div className="bg-spotify-gray-dark/60 rounded-xl border border-spotify-gray-mid/60 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Automation</p>
            <h2 className="text-2xl font-semibold text-white">Scheduled actions</h2>
            <p className="text-sm text-spotify-gray-light mt-1">Create and manage recurring operations. One schedule per playlist.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleStartNew}
              disabled={creatingNew || editingRowId}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="icon text-base">add</span>
              New Schedule
            </button>
            <a
              href="/history"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-spotify-gray-mid hover:bg-spotify-green hover:text-black text-white transition-colors border border-spotify-gray-mid/60"
            >
              <span className="icon text-base">history</span>
              History
            </a>
          </div>
        </div>

        {loading ? (
          <LoadingSpinner text="Loading schedules..." />
        ) : (
          <>
            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="bg-spotify-gray-mid/20 rounded-lg border border-spotify-gray-mid/60">
              {/* Table Header */}
              <div className="grid grid-cols-12 px-4 py-3 text-xs text-spotify-gray-light font-semibold border-b border-spotify-gray-mid/60">
                <div className="col-span-2">Type</div>
                <div className="col-span-2">Scope</div>
                <div className="col-span-3">Action Details</div>
                <div className="col-span-1">Frequency</div>
                <div className="col-span-2">Next run</div>
                <div className="col-span-1">Outcome</div>
                <div className="col-span-1 text-right">Actions</div>
              </div>

              {/* Table Body */}
              <div className="divide-y divide-spotify-gray-mid/40">
                {/* New schedule row (if creating) */}
                {creatingNew && renderEditRow()}

                {/* Empty state */}
                {schedules.length === 0 && !creatingNew && (
                  <div className="px-4 py-8 text-center text-spotify-gray-light">
                    <span className="icon text-4xl block mb-2">schedule</span>
                    <p className="text-sm">No schedules yet. Click "New Schedule" to get started.</p>
                  </div>
                )}

                {/* Existing schedules */}
                {schedules.map((s) => {
                  const isEditingThis = editingRowId === s.id;
                  
                  if (isEditingThis) {
                    return renderEditRow();
                  }

                  const playlist = playlistMap[s.playlist_id] || {};
                  const params = s.params || {};
                  const actionType = s.action_type || 'sort';
                  const config = actionConfigs[actionType];
                  const actionSummary = config ? config.summary(params) : 'Unknown';
                  const isCache = actionType === 'cache_clear';

                  return (
                    <div 
                      key={s.id} 
                      className={`grid grid-cols-12 px-4 py-3 text-sm items-center transition-colors ${
                        creatingNew || editingRowId ? 'opacity-50' : 'hover:bg-spotify-gray-mid/20'
                      }`}
                    >
                      {/* Type */}
                      <div className="col-span-2 text-spotify-gray-light capitalize">
                        {config?.label || actionType}
                      </div>

                      {/* Scope */}
                      <div className="col-span-2 truncate text-white">
                        {isCache ? (
                          <span>Global cache</span>
                        ) : (
                          <a href={`/playlist/${s.playlist_id}`} className="text-white hover:underline">
                            {playlist.name || s.playlist_id}
                          </a>
                        )}
                      </div>

                      {/* Action Details */}
                      <div className="col-span-3 text-spotify-gray-light truncate">
                        {actionSummary}
                      </div>

                      {/* Frequency */}
                      <div className="col-span-1 text-spotify-gray-light capitalize">
                        {params.schedule_type || `${s.frequency_minutes}m`}
                      </div>

                      {/* Next run */}
                      <div className="col-span-2 text-spotify-gray-light text-xs">
                        {s.next_run_at ? (() => {
                          const d = new Date(s.next_run_at);
                          return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
                        })() : '—'}
                      </div>

                      {/* Outcome */}
                      <div className="col-span-1 text-xs flex items-center gap-2">
                        {s.status && s.last_run_at ? (
                          <>
                            <a
                              href="/history"
                              className={`text-[11px] font-medium underline decoration-dotted underline-offset-2 hover:no-underline ${
                                s.status === 'success' ? 'text-spotify-green' :
                                s.status === 'failed' ? 'text-red-400' :
                                s.status === 'running' ? 'text-amber-300' :
                                'text-spotify-gray-light'
                              }`}
                            >
                              {s.status === 'success' ? '✓ Ok' :
                               s.status === 'failed' ? '✗ Failed' :
                               s.status === 'running' ? '◐ Running' :
                               s.status}
                            </a>
                            <span className="text-spotify-gray-light text-[10px]">
                              {(() => {
                                const d = new Date(s.last_run_at);
                                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                              })()}
                            </span>
                          </>
                        ) : (
                          <span className="text-spotify-gray-light">—</span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="col-span-1 flex items-center justify-end gap-2">
                        <div className="relative group">
                          <button
                            onClick={() => toggleEnabled(s)}
                            disabled={creatingNew || editingRowId}
                            className={`w-8 h-8 rounded-full border transition-colors flex items-center justify-center disabled:opacity-30 ${
                              s.enabled 
                                ? 'border-spotify-green text-spotify-green hover:bg-spotify-green hover:text-black hover:border-spotify-green' 
                                : 'border-spotify-gray-light text-spotify-gray-light hover:bg-spotify-green hover:text-black hover:border-spotify-green'
                            }`}
                          >
                            <span className="icon text-sm">{s.enabled ? 'pause' : 'play_arrow'}</span>
                          </button>
                          <div className="tooltip tooltip-up group-hover:tooltip-visible">
                            {s.enabled ? 'Pause schedule' : 'Enable schedule'}
                          </div>
                        </div>
                        <div className="relative group">
                          <button
                            onClick={() => handleStartEdit(s)}
                            disabled={creatingNew || editingRowId}
                            className="w-8 h-8 rounded-full border border-spotify-gray-light text-spotify-gray-light hover:bg-spotify-green hover:text-black hover:border-spotify-green transition-colors flex items-center justify-center disabled:opacity-30"
                          >
                            <span className="icon text-sm">edit</span>
                          </button>
                          <div className="tooltip tooltip-up group-hover:tooltip-visible">Edit schedule</div>
                        </div>
                        <div className="relative group">
                          <button
                            onClick={() => handleDelete(s)}
                            disabled={creatingNew || editingRowId}
                            className="w-8 h-8 rounded-full border border-red-500 text-red-400 hover:bg-red-600 hover:text-white hover:border-red-600 transition-colors flex items-center justify-center disabled:opacity-30"
                          >
                            <span className="icon text-sm">delete</span>
                          </button>
                          <div className="tooltip tooltip-up group-hover:tooltip-visible">Delete schedule</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-xl text-sm font-semibold z-50 ${
            toast.type === 'success'
              ? 'bg-spotify-green text-black'
              : toast.type === 'error'
                ? 'bg-red-500 text-white'
                : 'bg-spotify-gray-mid text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </Layout>
  );
};

export default SchedulesPage;
