import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { playlistAPI } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

const HistoryPage = ({ user, onLogout }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [undoingPlaylist, setUndoingPlaylist] = useState(null);
  const latestUndoableByPlaylist = useMemo(() => {
    const map = {};
    for (const entry of history) {
      if (entry.undone) continue;
      if (!map[entry.playlist_id]) {
        map[entry.playlist_id] = entry.id;
      }
    }
    return map;
  }, [history]);

  useEffect(() => {
    const loadHistory = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await playlistAPI.getAllHistory();
        setHistory(data || []);
      } catch (err) {
        setError(err.message || 'Failed to load history');
      } finally {
        setLoading(false);
      }
    };

    loadHistory();
  }, []);

  const formatDate = (isoString) => {
    if (!isoString) return 'Unknown';
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getOperationDescription = (entry) => {
    if (entry.op_type === 'sort_reorder') {
      const sort = entry.sort || {};
      const byMap = {
        date_added: 'Date added',
        title: 'Title',
        artist: 'Artist',
        album: 'Album',
        duration: 'Duration'
      };
      const dirMap = {
        desc: sort.sort_by === 'date_added' ? 'Newest first' : 'Z → A',
        asc: sort.sort_by === 'date_added' ? 'Oldest first' : 'A → Z'
      };
      const methodMap = {
        preserve: 'Preserve dates',
        fast: 'Fast (resets dates)'
      };
      
      const by = byMap[sort.sort_by] || 'Date added';
      const dir = dirMap[sort.direction] || 'Descending';
      const method = methodMap[sort.method] || 'Preserve dates';
      
      return `${by} • ${dir} • ${method}`;
    } else if (entry.op_type === 'duplicates_remove') {
      return `Removed ${entry.removed_count || 0} duplicate tracks`;
    }
    return entry.op_type;
  };

  const getOperationLabel = (entry) => {
    if (entry.op_type === 'sort_reorder') {
      return 'Sort';
    } else if (entry.op_type === 'duplicates_remove') {
      return 'Remove Duplicates';
    }
    return entry.op_type;
  };

  const getSourceBadge = (entry) => {
    if (entry.source === 'scheduled' || entry.schedule_id) {
      return (
        <div className="relative group">
          <button
            onClick={() => navigate('/schedules')}
            className="w-6 h-6 rounded-lg flex items-center justify-center text-amber-300 hover:bg-spotify-gray-mid/60 transition-colors"
          >
            <span className="icon text-sm">event</span>
          </button>
          <div className="tooltip tooltip-up group-hover:tooltip-visible">
            View schedules
          </div>
        </div>
      );
    }
    // Manual operation
    return (
      <div className="relative group">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center text-spotify-gray-light">
          <span className="icon text-sm">touch_app</span>
        </div>
        <div className="tooltip tooltip-up group-hover:tooltip-visible">
          Manual operation
        </div>
      </div>
    );
  };

  const getStatusBadge = (entry) => {
    if (entry.undone) {
      return <span className="text-xs text-spotify-gray-light">Undone</span>;
    }
    if (!entry.changes_made) {
      return <span className="text-xs text-amber-300">No changes</span>;
    }
    if (entry.sort && entry.sort.tracks_moved === 0) {
      return <span className="text-xs text-amber-300">Already sorted</span>;
    }
    return null;
  };

  return (
    <Layout user={user} onLogout={onLogout}>
      <div className="bg-gradient-to-b from-spotify-gray-dark to-spotify-black text-white">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">Operation History</h1>
              <p className="text-spotify-gray-light mt-1">All recent playlist operations across your library</p>
            </div>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 rounded-lg bg-spotify-gray-mid hover:bg-spotify-gray-light text-white transition-colors border border-spotify-gray-mid/60"
            >
              ← Back to Playlists
            </button>
          </div>

          {/* Content */}
          {loading && (
            <div className="flex justify-center items-center py-20">
              <LoadingSpinner />
            </div>
          )}

          {error && !loading && (
            <ErrorMessage message={error} />
          )}

          {!loading && !error && history.length === 0 && (
            <div className="bg-spotify-gray-dark/40 rounded-lg p-8 text-center border border-spotify-gray-mid/60">
              <span className="icon text-6xl text-spotify-gray-light mb-4 block">history</span>
              <h2 className="text-xl font-semibold text-white mb-2">No History Yet</h2>
              <p className="text-spotify-gray-light">
                Start sorting or managing your playlists to see operation history here
              </p>
            </div>
          )}

          {!loading && !error && history.length > 0 && (
            <div className="bg-spotify-gray-dark/40 rounded-lg border border-spotify-gray-mid/60 overflow-hidden">
              {/* Table Header */}
              <div className="grid grid-cols-12 px-4 py-3 text-xs text-spotify-gray-light font-semibold border-b border-spotify-gray-mid/60 bg-spotify-gray-mid/20">
                <div className="col-span-3">Playlist</div>
                <div className="col-span-2">Operation</div>
                <div className="col-span-3">Details</div>
                <div className="col-span-2">Date</div>
                <div className="col-span-1 text-right">Status</div>
                <div className="col-span-1 text-right">Actions</div>
              </div>

              {/* History Entries */}
              <div className="divide-y divide-spotify-gray-mid/40">
                {history.map((entry) => {
                  const isLatestForPlaylist = latestUndoableByPlaylist[entry.playlist_id] === entry.id;
                  const canUndo = isLatestForPlaylist && entry.changes_made && !entry.undone;
                  
                  return (
                    <div
                      key={entry.id}
                      className={`grid grid-cols-12 px-4 py-3 text-sm hover:bg-spotify-gray-mid/20 transition-colors ${
                        entry.undone ? 'opacity-50' : ''
                      }`}
                    >
                      {/* Playlist Name */}
                      <div className="col-span-3 flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/playlist/${entry.playlist_id}`)}
                          className="text-white hover:text-spotify-green hover:underline truncate"
                        >
                          {entry.playlist_name}
                        </button>
                      </div>

                      {/* Operation Type */}
                      <div className="col-span-2 flex items-center gap-2">
                        <span className="text-white">{getOperationLabel(entry)}</span>
                        {getSourceBadge(entry)}
                      </div>

                      {/* Details */}
                      <div className="col-span-3 flex items-center text-spotify-gray-light text-xs">
                        {getOperationDescription(entry)}
                      </div>

                      {/* Date */}
                      <div className="col-span-2 flex items-center text-spotify-gray-light text-xs">
                        {formatDate(entry.created_at)}
                      </div>

                      {/* Status */}
                      <div className="col-span-1 flex items-center justify-end">
                        {getStatusBadge(entry)}
                      </div>

                      {/* Actions */}
                      <div className="col-span-1 flex items-center justify-end">
                        {canUndo && (
                          <div className="relative group z-20">
                            <button
                              disabled={undoingPlaylist === entry.playlist_id}
                              onClick={async () => {
                                if (!window.confirm(`Undo this operation on "${entry.playlist_name}"?`)) return;
                                setUndoingPlaylist(entry.playlist_id);
                                try {
                                  await playlistAPI.undoLast(entry.playlist_id);
                                  // Reload history
                                  const data = await playlistAPI.getAllHistory();
                                  setHistory(data || []);
                                } catch (err) {
                                  alert(err.message || 'Failed to undo operation');
                                } finally {
                                  setUndoingPlaylist(null);
                                }
                              }}
                              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                                undoingPlaylist === entry.playlist_id
                                  ? 'bg-spotify-gray-dark/60 text-spotify-gray-light cursor-wait'
                                  : 'bg-spotify-gray-mid hover:bg-spotify-green hover:text-black text-white'
                              }`}
                            >
                              <span className="icon text-base">
                                {undoingPlaylist === entry.playlist_id ? 'hourglass_bottom' : 'undo'}
                              </span>
                            </button>
                            <div className="tooltip tooltip-up group-hover:tooltip-visible z-30">
                              Undo
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer Note */}
          {!loading && history.length > 0 && (
            <p className="text-xs text-spotify-gray-light text-center">
              History is retained for 7 days
            </p>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default HistoryPage;
