/**
 * Ignored Tracks Page
 * 
 * Displays and manages all ignored duplicate track pairs.
 * Users can view their ignored pairs and un-ignore them.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { ignoreAPI, playlistAPI } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

const IgnoredTracksPage = ({ user, onLogout }) => {
  const navigate = useNavigate();
  const [ignoredPairs, setIgnoredPairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playlists, setPlaylists] = useState({});
  const [trackDetails, setTrackDetails] = useState({});
  const [confirmUnignore, setConfirmUnignore] = useState(null);

  useEffect(() => {
    loadIgnoredPairs();
    loadPlaylists();
  }, []);

  const loadIgnoredPairs = async () => {
    try {
      setLoading(true);
      setError(null);
      const pairs = await ignoreAPI.listIgnoredPairs();
      setIgnoredPairs(pairs);
      
      // Extract unique track IDs
      const trackIds = new Set();
      pairs.forEach(pair => {
        trackIds.add(pair.track_id_1);
        trackIds.add(pair.track_id_2);
      });
      
      // Fetch track details in batches of 50 (Spotify API limit)
      const trackIdArray = Array.from(trackIds);
      const batchSize = 50;
      const detailsMap = {};
      
      for (let i = 0; i < trackIdArray.length; i += batchSize) {
        const batch = trackIdArray.slice(i, i + batchSize);
        const batchDetails = await playlistAPI.getTracksBatch(batch);
        batchDetails.forEach(track => {
          detailsMap[track.id] = track;
        });
      }
      
      setTrackDetails(detailsMap);
    } catch (err) {
      setError(err.message || 'Failed to load ignored pairs');
    } finally {
      setLoading(false);
    }
  };

  const loadPlaylists = async () => {
    try {
      const data = await playlistAPI.getPlaylists();
      const playlistMap = {};
      data.forEach(p => {
        playlistMap[p.id] = p.name;
      });
      setPlaylists(playlistMap);
    } catch (err) {
      console.error('Failed to load playlists:', err);
    }
  };

  const handleUnignore = async (pairId) => {
    try {
      await ignoreAPI.removeIgnoredPair(pairId);
      await loadIgnoredPairs();
      setConfirmUnignore(null);
    } catch (err) {
      setError(err.message || 'Failed to un-ignore pair');
      setConfirmUnignore(null);
    }
  };

  return (
    <Layout user={user} onLogout={onLogout}>
      <div className="bg-gradient-to-b from-spotify-gray-dark to-spotify-black text-white">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">Ignored Tracks</h1>
              <p className="text-spotify-gray-light mt-1">Manage duplicate track pairs you've chosen to ignore</p>
            </div>
            <button
              onClick={() => navigate('/playlists')}
              className="px-4 py-2 rounded-lg bg-spotify-gray-mid hover:bg-spotify-gray-light text-white transition-colors border border-spotify-gray-mid/60"
            >
              ← Back to Playlists
            </button>
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

          {/* Empty State */}
          {!loading && !error && ignoredPairs.length === 0 && (
            <div className="bg-spotify-gray-dark/40 rounded-lg p-8 text-center border border-spotify-gray-mid/60">
              <span className="icon text-6xl text-spotify-gray-light mb-4 block">visibility_off</span>
              <h2 className="text-xl font-semibold text-white mb-2">No Ignored Pairs</h2>
              <p className="text-spotify-gray-light">
                You haven't ignored any duplicate track pairs yet. When you ignore a pair from duplicate detection, it will appear here.
              </p>
            </div>
          )}

          {/* Content Table */}
          {!loading && !error && ignoredPairs.length > 0 && (
            <div className="bg-spotify-gray-dark/40 rounded-lg border border-spotify-gray-mid/60 overflow-hidden">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-4 px-4 py-3 text-xs text-spotify-gray-light font-semibold border-b border-spotify-gray-mid/60 bg-spotify-gray-mid/20">
                <div className="col-span-4">Track 1</div>
                <div className="col-span-4">Track 2</div>
                <div className="col-span-2">Scope</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>

              {/* Table Rows */}
              <div className="divide-y divide-spotify-gray-mid/40">
                {ignoredPairs.map((pair) => {
                  const track1 = trackDetails[pair.track_id_1];
                  const track2 = trackDetails[pair.track_id_2];
                  
                  return (
                    <div
                      key={pair.id}
                      className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-spotify-gray-mid/20 transition-colors"
                    >
                      {/* Track 1 */}
                      <div className="col-span-4 flex items-center gap-3 min-w-0">
                        {track1 ? (
                          <>
                            {track1.album?.images?.[0] && (
                              <img 
                                src={track1.album.images[track1.album.images.length - 1].url} 
                                alt={track1.album.name}
                                className="w-10 h-10 rounded flex-shrink-0"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-white text-sm truncate">{track1.name}</div>
                              <div className="text-spotify-gray-light text-xs truncate">
                                {track1.artists?.map(a => a.name).join(', ')}
                              </div>
                            </div>
                          </>
                        ) : (
                          <span className="text-spotify-gray-light text-xs font-mono truncate">
                            {pair.track_id_1}
                          </span>
                        )}
                      </div>
                      
                      {/* Track 2 */}
                      <div className="col-span-4 flex items-center gap-3 min-w-0">
                        {track2 ? (
                          <>
                            {track2.album?.images?.[0] && (
                              <img 
                                src={track2.album.images[track2.album.images.length - 1].url} 
                                alt={track2.album.name}
                                className="w-10 h-10 rounded flex-shrink-0"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-white text-sm truncate">{track2.name}</div>
                              <div className="text-spotify-gray-light text-xs truncate">
                                {track2.artists?.map(a => a.name).join(', ')}
                              </div>
                            </div>
                          </>
                        ) : (
                          <span className="text-spotify-gray-light text-xs font-mono truncate">
                            {pair.track_id_2}
                          </span>
                        )}
                      </div>
                      
                      {/* Scope */}
                      <div className="col-span-2 flex items-center">
                        {pair.scope === 'global' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-spotify-green/20 text-spotify-green text-xs">
                            <span className="icon text-xs">public</span>
                            Global
                          </span>
                        ) : (
                          <button
                            onClick={() => navigate(`/playlist/${pair.playlist_id}`)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 hover:text-blue-300 text-xs truncate max-w-full transition-colors"
                            title={playlists[pair.playlist_id] || pair.playlist_id}
                          >
                            <span className="icon text-xs">playlist_play</span>
                            <span className="truncate">{playlists[pair.playlist_id] || 'Playlist'}</span>
                          </button>
                        )}
                      </div>
                      
                      {/* Actions */}
                      <div className="col-span-2 flex items-center justify-end">
                        <div className="relative group">
                          <button
                            onClick={() => setConfirmUnignore(pair.id)}
                            className="w-8 h-8 rounded-full border border-spotify-gray-light text-spotify-gray-light hover:bg-red-600 hover:text-white hover:border-red-600 transition-colors flex items-center justify-center"
                          >
                            <span className="icon text-sm">visibility</span>
                          </button>
                          <div className="tooltip tooltip-up group-hover:tooltip-visible z-30">
                            Un-ignore
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirm Un-ignore Modal */}
      {confirmUnignore && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center px-4">
          <div className="bg-gradient-to-b from-spotify-gray-dark to-spotify-black max-w-md w-full rounded-2xl shadow-2xl border border-spotify-gray-mid/60">
            <div className="p-6 pb-4 border-b border-spotify-gray-mid/50">
              <p className="text-xs uppercase tracking-wide text-spotify-gray-light mb-1">Confirm Action</p>
              <h2 className="text-2xl font-bold text-white">Un-ignore Track Pair</h2>
            </div>
            
            <div className="p-6">
              <p className="text-white">
                This pair will appear in duplicate detection again.
              </p>
            </div>

            <div className="p-6 pt-0 flex gap-3">
              <button
                onClick={() => setConfirmUnignore(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-spotify-gray-mid/60 text-spotify-gray-light hover:text-white hover:border-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleUnignore(confirmUnignore)}
                className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                Un-ignore
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default IgnoredTracksPage;
