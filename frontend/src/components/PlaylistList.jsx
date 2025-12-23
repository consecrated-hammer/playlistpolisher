/**
 * Playlist List Component
 * 
 * Displays a grid of user's playlists with image, title, and metadata.
 * Each playlist is clickable to view details.
 * 
 * Props:
 *   - playlists: Array of playlist objects
 *   - onPlaylistClick: Handler for playlist selection
 *   - viewMode: "grid" | "list" | "table"
 *   - sortOption: Current sort option
 *   - onSortChange: Handler to update sort option (table headers)
 *   - cacheFacts: Map of playlist_id -> cache fact
 */

import React from 'react';
import { getBestImage } from '../services/api';

const PlaylistList = ({ playlists, onPlaylistClick, viewMode = 'grid', sortOption, onSortChange, cacheFacts = {} }) => {
  if (!playlists || playlists.length === 0) {
    return (
      <div className="text-center py-12">
        <svg className="w-16 h-16 text-spotify-gray-mid mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
        <p className="text-spotify-gray-light text-lg">No playlists found</p>
        <p className="text-spotify-gray-light text-sm mt-2">Create your first playlist on Spotify!</p>
      </div>
    );
  }

  const renderCachedIcon = (playlistId) => {
    const fact = cacheFacts[playlistId];
    if (!fact || !fact.last_cached_at_utc) {
      return null;
    }
    const isDirty = fact.is_dirty === 1;
    return (
      <div className="relative group">
        <span className={`icon text-sm ${isDirty ? 'text-amber-300' : 'text-spotify-green'}`}>
          cloud_done
        </span>
        <div className="tooltip tooltip-up group-hover:tooltip-visible">
          {isDirty ? 'Cached playlist (needs refresh)' : 'Cached playlist'}
        </div>
      </div>
    );
  };

  if (viewMode === 'list') {
    return (
      <div className="space-y-3">
        {playlists.map((playlist) => {
          const ownerName = playlist.owner?.display_name || playlist.owner?.id || 'Unknown';
          const trackTotal = playlist.tracks?.total || 0;
          return (
            <button
              key={playlist.id}
              type="button"
              onClick={() => onPlaylistClick(playlist.id)}
              className="w-full text-left bg-spotify-gray-dark/60 hover:bg-spotify-gray-mid/60 border border-spotify-gray-mid/60 rounded-xl px-4 py-3 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-spotify-green"
              aria-label={`Open playlist ${playlist.name}`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="w-12 h-12 rounded-md overflow-hidden bg-spotify-gray-mid flex-shrink-0">
                  {playlist.images && playlist.images.length > 0 ? (
                    <img
                      src={getBestImage(playlist.images)}
                      alt={playlist.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-6 h-6 text-spotify-gray-light" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                      </svg>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-white font-semibold text-sm sm:text-base truncate" title={playlist.name}>
                      {playlist.name}
                    </p>
                    {renderCachedIcon(playlist.id)}
                  </div>
                  <p className="text-spotify-gray-light text-xs sm:text-sm truncate">
                    by {ownerName}
                  </p>
                </div>
                <div className="text-spotify-gray-light text-xs sm:text-sm sm:ml-auto">
                  {trackTotal} {trackTotal === 1 ? 'track' : 'tracks'}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  if (viewMode === 'table') {
    const sortMap = {
      name: { asc: 'name-asc', desc: 'name-desc' },
      owner: { asc: 'owner-asc', desc: 'owner-desc' },
      tracks: { asc: 'tracks-asc', desc: 'tracks-desc' },
    };

    const getNextSort = (key) => {
      const current = sortMap[key];
      if (!current) return 'default';
      return sortOption === current.asc ? current.desc : current.asc;
    };

    const getSortDirection = (key) => {
      const current = sortMap[key];
      if (!current) return null;
      if (sortOption === current.asc) return 'asc';
      if (sortOption === current.desc) return 'desc';
      return null;
    };

    const renderSortIcon = (key) => {
      const dir = getSortDirection(key);
      if (!dir) {
        return <span className="icon text-xs ml-1 text-spotify-gray-light">swap_vert</span>;
      }
      return (
        <span className="icon text-xs ml-1 text-spotify-green">
          {dir === 'asc' ? 'arrow_drop_up' : 'arrow_drop_down'}
        </span>
      );
    };

    return (
      <div className="overflow-x-auto">
        <table className="min-w-[680px] w-full border-separate border-spacing-y-2 text-left">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-spotify-gray-light">
              <th className="px-3 py-2 font-semibold">Artwork</th>
              <th className="px-3 py-2 font-semibold">
                <button
                  type="button"
                  onClick={() => onSortChange?.(getNextSort('name'))}
                  className="inline-flex items-center hover:text-white transition-colors"
                >
                  Name
                  {renderSortIcon('name')}
                </button>
              </th>
              <th className="px-3 py-2 font-semibold">
                <button
                  type="button"
                  onClick={() => onSortChange?.(getNextSort('owner'))}
                  className="inline-flex items-center hover:text-white transition-colors"
                >
                  Owner
                  {renderSortIcon('owner')}
                </button>
              </th>
              <th className="px-3 py-2 font-semibold">
                <button
                  type="button"
                  onClick={() => onSortChange?.(getNextSort('tracks'))}
                  className="inline-flex items-center hover:text-white transition-colors"
                >
                  Tracks
                  {renderSortIcon('tracks')}
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {playlists.map((playlist) => {
              const ownerName = playlist.owner?.display_name || playlist.owner?.id || 'Unknown';
              const trackTotal = playlist.tracks?.total || 0;
              return (
                <tr
                  key={playlist.id}
                  onClick={() => onPlaylistClick(playlist.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onPlaylistClick(playlist.id);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open playlist ${playlist.name}`}
                  className="bg-spotify-gray-dark/60 hover:bg-spotify-gray-mid/60 focus:outline-none focus:ring-2 focus:ring-spotify-green rounded-lg transition-colors cursor-pointer"
                >
                  <td className="px-3 py-2">
                    <div className="w-10 h-10 rounded-md overflow-hidden bg-spotify-gray-mid">
                      {playlist.images && playlist.images.length > 0 ? (
                        <img
                          src={getBestImage(playlist.images)}
                          alt={playlist.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <svg className="w-5 h-5 text-spotify-gray-light" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                          </svg>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <p className="text-white font-semibold truncate max-w-[320px]" title={playlist.name}>
                        {playlist.name}
                      </p>
                      {renderCachedIcon(playlist.id)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-spotify-gray-light">
                    {ownerName}
                  </td>
                  <td className="px-3 py-2 text-spotify-gray-light">
                    {trackTotal}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {playlists.map((playlist) => (
          <div
            key={playlist.id}
            className="bg-spotify-gray-dark hover:bg-spotify-gray-mid rounded-lg p-4 transition-all duration-200 hover:scale-105 animate-fade-in group relative"
          >
            <div className="absolute top-3 right-3">
              {renderCachedIcon(playlist.id)}
            </div>
            {/* Playlist Cover */}
            <div className="relative mb-4 aspect-square rounded-md cursor-pointer group" onClick={() => onPlaylistClick(playlist.id)}>
              <div className="absolute inset-0 rounded-md overflow-hidden bg-spotify-gray-mid">
                {playlist.images && playlist.images.length > 0 ? (
                  <img
                    src={getBestImage(playlist.images)}
                    alt={playlist.name}
                    className="w-full h-full object-cover transition-opacity"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-12 h-12 text-spotify-gray-light" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                    </svg>
                  </div>
                )}
              </div>

            </div>

            {/* Playlist Info */}
            <h3 className="text-white font-semibold text-sm mb-1 truncate" title={playlist.name}>
              {playlist.name}
            </h3>
            <p className="text-spotify-gray-light text-xs truncate mb-2">
              by {playlist.owner?.display_name || playlist.owner?.id || 'Unknown'}
            </p>
            <p className="text-spotify-gray-light text-xs">
              {playlist.tracks?.total || 0} {(playlist.tracks?.total === 1) ? 'track' : 'tracks'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PlaylistList;
