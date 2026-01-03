import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { playlistAPI } from '../services/api';

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

const BackupDetailPage = ({ user, onLogout }) => {
  const { backupId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [backupMeta, setBackupMeta] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [restoreModal, setRestoreModal] = useState(null);
  const [restoreCloneName, setRestoreCloneName] = useState('');
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreError, setRestoreError] = useState(null);
  const [restoreMessage, setRestoreMessage] = useState(null);

  const playlistIdFromState = location.state?.playlistId || null;

  const resolvePlaylistId = useCallback(async (playlists, targetBackupId) => {
    if (playlistIdFromState) return playlistIdFromState;
    for (const playlist of playlists) {
      try {
        const list = await playlistAPI.listBackups(playlist.id);
        const match = (list || []).find((backup) => String(backup.id) === String(targetBackupId));
        if (match) {
          return playlist.id;
        }
      } catch (err) {
        // keep searching
      }
    }
    return null;
  }, [playlistIdFromState]);

  const loadBackupDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const playlists = await playlistAPI.getPlaylists();
      const playlistMap = new Map((playlists || []).map((pl) => [pl.id, pl]));
      const resolvedPlaylistId = await resolvePlaylistId(playlists || [], backupId);
      if (!resolvedPlaylistId) {
        setError('Unable to locate this backup.');
        return;
      }

      const detail = await playlistAPI.getBackupDetail(resolvedPlaylistId, backupId);
      const playlistName = playlistMap.get(resolvedPlaylistId)?.name || 'Playlist';
      setBackupMeta({
        backupId: detail.backup_id,
        playlistId: resolvedPlaylistId,
        playlistName,
        name: detail.name,
        createdAt: detail.created_at,
        trackCount: detail.track_count ?? 0,
      });
      setTracks(detail.tracks || []);

      const dateStamp = detail.created_at ? new Date(detail.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      setRestoreCloneName(`${playlistName} (backup ${dateStamp})`);
    } catch (err) {
      setError(err.message || 'Failed to load backup.');
    } finally {
      setLoading(false);
    }
  }, [backupId, resolvePlaylistId]);

  useEffect(() => {
    loadBackupDetail();
  }, [loadBackupDetail]);

  const handleRestore = async () => {
    if (!backupMeta || restoreLoading) return;
    setRestoreLoading(true);
    setRestoreError(null);
    setRestoreMessage(null);
    const payload = { mode: restoreModal?.mode || 'overwrite' };
    if (payload.mode === 'clone' && restoreCloneName.trim()) {
      payload.name = restoreCloneName.trim();
    }
    try {
      const result = await playlistAPI.restoreFromNamedBackup(backupMeta.playlistId, backupMeta.backupId, payload);
      setRestoreMessage(result.message || 'Restore completed.');
      if (payload.mode === 'clone' && result.new_playlist_id) {
        navigate(`/playlist/${result.new_playlist_id}`);
      }
      setRestoreModal(null);
    } catch (err) {
      setRestoreError(err.message || 'Failed to restore playlist.');
    } finally {
      setRestoreLoading(false);
    }
  };

  const sortedTracks = useMemo(() => {
    return [...(tracks || [])].sort((a, b) => {
      if (a.position == null || b.position == null) return 0;
      return a.position - b.position;
    });
  }, [tracks]);

  return (
    <Layout user={user} onLogout={onLogout}>
      <div className="bg-gradient-to-b from-spotify-gray-dark to-spotify-black text-white">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-6 pb-24">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">{backupMeta?.name || 'Backup details'}</h1>
              <p className="text-spotify-gray-light mt-1">
                {backupMeta?.playlistName ? `${backupMeta.playlistName} • ` : ''}{backupMeta?.trackCount ?? 0} tracks
              </p>
              {backupMeta?.createdAt && (
                <p className="text-sm text-spotify-gray-light mt-1">
                  Created {formatTimestamp(backupMeta.createdAt)}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => navigate('/backups')}
                className="px-4 py-2 rounded-lg bg-spotify-gray-mid hover:bg-spotify-gray-light text-white transition-colors border border-spotify-gray-mid/60"
              >
                ← Back to Backups
              </button>
              {backupMeta?.playlistId && (
                <button
                  onClick={() => navigate(`/playlist/${backupMeta.playlistId}`)}
                  className="px-4 py-2 rounded-lg border border-spotify-gray-light text-white bg-spotify-gray-dark/60 hover:bg-spotify-gray-mid/60"
                >
                  View Playlist
                </button>
              )}
            </div>
          </div>

          {!loading && !error && backupMeta && (
            <div className="bg-spotify-gray-dark/40 border border-spotify-gray-mid/60 rounded-2xl p-4 shadow-2xl">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Restore options</p>
                  <p className="text-sm text-spotify-gray-light mt-1">
                    Overwrite the playlist or create a new one from this backup.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => setRestoreModal({ mode: 'overwrite' })}
                    disabled={restoreLoading}
                    className="px-4 py-2 rounded-lg border border-spotify-gray-light text-white bg-spotify-gray-dark/60 hover:bg-spotify-gray-mid/60 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => setRestoreModal({ mode: 'clone' })}
                    disabled={restoreLoading}
                    className="px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Restore as new
                  </button>
                </div>
              </div>
            </div>
          )}

          {loading && (
            <div className="flex justify-center items-center py-20">
              <LoadingSpinner />
            </div>
          )}

          {error && !loading && (
            <ErrorMessage message={error} />
          )}

          {!loading && !error && (
            <div className="bg-spotify-gray-dark/40 border border-spotify-gray-mid/60 rounded-2xl p-4 space-y-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Tracks in this backup</p>
                <p className="text-sm text-spotify-gray-light mt-1">
                  Scroll to review tracks and restore when you&apos;re ready.
                </p>
              </div>
              {sortedTracks.length === 0 ? (
                <p className="text-sm text-spotify-gray-light">No tracks found in this backup.</p>
              ) : (
                <div className="space-y-3">
                  {sortedTracks.map((track, index) => {
                    const artistLabel = (track.artists || []).join(', ') || 'Unknown artist';
                    const albumLabel = track.album ? ` • ${track.album}` : '';
                    return (
                      <div
                        key={`${track.track_id}-${index}`}
                        className="bg-spotify-gray-dark/60 border border-spotify-gray-mid/60 rounded-xl p-3"
                      >
                        <div className="flex items-start gap-3">
                          <div className="text-spotify-gray-light text-xs font-semibold mt-1 w-8 text-right">
                            {track.position != null ? track.position + 1 : index + 1}
                          </div>
                          <div className="space-y-1">
                            <p className="text-base font-semibold text-white">{track.title || 'Unknown title'}</p>
                            <p className="text-sm text-spotify-gray-light">
                              {artistLabel}{albumLabel}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {restoreError && <p className="text-sm text-red-400">{restoreError}</p>}
          {restoreMessage && <p className="text-sm text-spotify-green">{restoreMessage}</p>}
        </div>
      </div>

      {restoreModal && backupMeta && (
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
                {restoreModal.mode === 'clone' ? 'New playlist' : backupMeta.playlistName}
              </p>
              <p>
                <span className="text-spotify-gray-light">Tracks:</span> {backupMeta.trackCount ?? 0}
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
                onClick={handleRestore}
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

export default BackupDetailPage;
