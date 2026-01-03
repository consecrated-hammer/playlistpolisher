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
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const playlistIdFromState = location.state?.playlistId || null;

  const resolvePlaylistId = useCallback(async (targetBackupId) => {
    if (playlistIdFromState) return playlistIdFromState;
    try {
      const list = await playlistAPI.listAllBackups();
      const match = (list || []).find((backup) => String(backup.id) === String(targetBackupId));
      return match?.playlist_id || match?.playlistId || null;
    } catch (err) {
      return null;
    }
  }, [playlistIdFromState]);

  const loadBackupDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const playlists = await playlistAPI.getPlaylists();
      const playlistMap = new Map((playlists || []).map((pl) => [pl.id, pl]));
      const resolvedPlaylistId = await resolvePlaylistId(backupId);
      if (!resolvedPlaylistId) {
        setError('Unable to locate this backup.');
        return;
      }

      const detail = await playlistAPI.getBackupDetail(resolvedPlaylistId, backupId);
      const playlistMeta = playlistMap.get(resolvedPlaylistId);
      const playlistDeleted = !playlistMeta;
      const snapshotName = detail.playlist_name || 'Deleted playlist';
      const playlistName = playlistMeta?.name || snapshotName;
      setBackupMeta({
        backupId: detail.backup_id,
        playlistId: resolvedPlaylistId,
        playlistName,
        snapshotName,
        playlistDeleted,
        name: detail.name,
        createdAt: detail.created_at,
        trackCount: detail.track_count ?? 0,
      });
      setTracks(detail.tracks || []);
      setRenameName(detail.name || '');

      const dateStamp = detail.created_at ? new Date(detail.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      const cloneBaseName = playlistMeta?.name || snapshotName || 'Restored playlist';
      setRestoreCloneName(`${cloneBaseName} (Restored ${dateStamp})`);
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
    if (backupMeta.playlistDeleted && restoreModal?.mode === 'overwrite') return;
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

  const handleRenameBackup = async () => {
    if (!backupMeta || renameLoading) return;
    const trimmedName = renameName.trim();
    if (!trimmedName) {
      setRenameError('Please enter a backup name.');
      return;
    }
    setRenameLoading(true);
    setRenameError(null);
    try {
      await playlistAPI.renameBackup(backupMeta.playlistId, backupMeta.backupId, { name: trimmedName });
      setBackupMeta((prev) => (prev ? { ...prev, name: trimmedName } : prev));
      setRenameModalOpen(false);
    } catch (err) {
      setRenameError(err.message || 'Failed to rename backup.');
    } finally {
      setRenameLoading(false);
    }
  };

  const handleDeleteBackup = async () => {
    if (!backupMeta || deleteLoading) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await playlistAPI.deleteBackup(backupMeta.playlistId, backupMeta.backupId);
      let remaining = null;
      try {
        remaining = await playlistAPI.listBackups(backupMeta.playlistId);
      } catch (err) {
        remaining = null;
      }
      if (!remaining || remaining.length === 0) {
        navigate('/backups');
      } else {
        navigate(`/backups?playlistId=${backupMeta.playlistId}`);
      }
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete backup.');
    } finally {
      setDeleteLoading(false);
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
              <div className="flex flex-wrap items-center gap-2 text-spotify-gray-light mt-1">
                {backupMeta?.playlistName && <span>{backupMeta.playlistName}</span>}
                {backupMeta?.playlistDeleted && (
                  <span className="text-[10px] uppercase tracking-wide text-amber-300 border border-amber-400/60 px-2 py-0.5 rounded-full">
                    Deleted
                  </span>
                )}
                {backupMeta?.playlistName && <span>•</span>}
                <span>{backupMeta?.trackCount ?? 0} tracks</span>
              </div>
              {backupMeta?.playlistDeleted && (
                <p className="text-xs text-spotify-gray-light mt-1">
                  Playlist no longer exists in Spotify.
                </p>
              )}
              {!backupMeta?.playlistDeleted
                && backupMeta?.snapshotName
                && backupMeta?.playlistName
                && backupMeta.snapshotName !== backupMeta.playlistName && (
                  <p className="text-xs text-spotify-gray-light mt-1">
                    Name at backup: {backupMeta.snapshotName}
                  </p>
              )}
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
              {backupMeta?.playlistId && !backupMeta?.playlistDeleted && (
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
            <div className="bg-spotify-gray-dark/40 border border-spotify-gray-mid/60 rounded-2xl p-4 shadow-2xl space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Restore options</p>
                  <p className="text-sm text-spotify-gray-light mt-1">
                    Overwrite the playlist or create a new one from this backup.
                  </p>
                  {backupMeta?.playlistDeleted && (
                    <p className="text-sm text-amber-300 mt-2">
                      Playlist no longer exists in Spotify.
                    </p>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => setRestoreModal({ mode: 'overwrite' })}
                    disabled={restoreLoading || backupMeta?.playlistDeleted}
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
              <div className="pt-4 border-t border-spotify-gray-mid/60">
                <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Backup actions</p>
                <p className="text-sm text-spotify-gray-light mt-1">
                  Rename or remove this backup from your library.
                </p>
                {deleteError && <p className="text-sm text-red-400 mt-2">{deleteError}</p>}
                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRenameError(null);
                      setRenameName(backupMeta.name || '');
                      setRenameModalOpen(true);
                    }}
                    disabled={renameLoading}
                    className="px-4 py-2 rounded-lg border border-spotify-gray-light text-white bg-spotify-gray-dark/60 hover:bg-spotify-gray-mid/60 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Rename backup
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteModalOpen(true);
                    }}
                    disabled={deleteLoading}
                    className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Delete backup
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

      {deleteModalOpen && backupMeta && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-spotify-gray-dark rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-spotify-gray-mid/60">
            <div>
              <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Confirm delete</p>
              <h3 className="text-xl font-semibold text-white">Delete this backup?</h3>
            </div>
            <div className="bg-spotify-gray-mid/40 border border-spotify-gray-mid/60 rounded-lg p-3 text-sm text-white space-y-1">
              <p>
                <span className="text-spotify-gray-light">Backup:</span>{' '}
                {backupMeta.name || 'Backup'}
              </p>
              <p>
                <span className="text-spotify-gray-light">Tracks:</span>{' '}
                {backupMeta.trackCount ?? 0}
              </p>
            </div>
            <p className="text-sm text-spotify-gray-light">
              This action cannot be undone.
            </p>
            {deleteError && <p className="text-sm text-red-400">{deleteError}</p>}
            <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteModalOpen(false);
                }}
                disabled={deleteLoading}
                className="px-4 py-2 rounded-lg border border-spotify-gray-light text-white bg-spotify-gray-dark/60 hover:bg-spotify-gray-mid/60 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteBackup}
                disabled={deleteLoading}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleteLoading ? 'Deleting…' : 'Delete backup'}
              </button>
            </div>
          </div>
        </div>
      )}

      {renameModalOpen && backupMeta && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-spotify-gray-dark rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-spotify-gray-mid/60">
            <div>
              <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Rename backup</p>
              <h3 className="text-xl font-semibold text-white">Update backup name</h3>
            </div>
            <label className="text-sm text-spotify-gray-light flex flex-col gap-2">
              Backup name
              <input
                type="text"
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                className="bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
              />
            </label>
            {renameError && <p className="text-sm text-red-400">{renameError}</p>}
            <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setRenameError(null);
                  setRenameModalOpen(false);
                }}
                disabled={renameLoading}
                className="px-4 py-2 rounded-lg border border-spotify-gray-light text-white bg-spotify-gray-dark/60 hover:bg-spotify-gray-mid/60 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRenameBackup}
                disabled={renameLoading}
                className="px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {renameLoading ? 'Saving…' : 'Save name'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default BackupDetailPage;
