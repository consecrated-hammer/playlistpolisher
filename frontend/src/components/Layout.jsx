/**
 * Layout Component
 * 
 * Main application layout with header, navigation, and content area.
 * Provides consistent structure across all pages.
 * 
 * Props:
 *   - children: Page content to render
 *   - user: Current user object (optional)
 *   - onLogout: Logout handler function
 */

import React, { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Footer from './Footer';
import JobStatusIndicator from './JobStatusIndicator';
import ActivityIndicator from './ActivityIndicator';
import LoadingSpinner from './LoadingSpinner';
import PlayerBar from './PlayerBar';
import NowPlayingPanel from './NowPlayingPanel';
import { IS_DEV_BUILD } from '../config';
import useActivityContext from '../context/useActivityContext';
import usePlayerContext from '../context/usePlayerContext';

const Layout = ({ children, user, onLogout, jobStatus, onJobIndicatorClick }) => {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const hoverTimer = useRef(null);
  const activityContext = useActivityContext();
  const player = usePlayerContext();
  const cacheWarmStatus = activityContext?.cacheWarmStatus;
  const dedupeStatus = activityContext?.dedupeStatus;
  const buildTimeRaw = import.meta.env.VITE_BUILD_TIME || 'dev-build';
  const buildTime = typeof buildTimeRaw === 'string'
    ? buildTimeRaw.trim().replace(/^['"]|['"]$/g, '')
    : buildTimeRaw;
  const buildTimeLocal = useMemo(() => {
    if (!buildTime || buildTime === 'dev-build') return 'dev-build (local)';

    // Handle numeric build identifiers (e.g., CI run numbers) without converting to bogus dates
    const numericValue = Number(buildTime);
    if (!Number.isNaN(numericValue)) {
      const looksLikeMillis = numericValue > 1e12;
      const looksLikeSeconds = numericValue > 1e9 && numericValue < 1e12;
      if (looksLikeMillis || looksLikeSeconds) {
        const date = new Date(looksLikeMillis ? numericValue : numericValue * 1000);
        if (!Number.isNaN(date.getTime())) return `${date.toLocaleString()} (local)`;
      }
      return `build #${buildTime}`;
    }

    const d = new Date(buildTime);
    if (Number.isNaN(d.getTime())) return `${buildTime} (local)`;
    return `${d.toLocaleString()} (local)`;
  }, [buildTime]);

  const showPlayerBar = Boolean(player?.isPremium && player?.currentTrack);
  const showNowPlayingPanel = showPlayerBar;
  const playlistNavPending = player?.playlistNavPending;

  const commitSha = import.meta.env.VITE_COMMIT_SHA || '';
  const shortCommit = commitSha ? commitSha.substring(0, 7) : '';
  const imageTag = import.meta.env.VITE_IMAGE_TAG;
  const isDevBuild = (imageTag && imageTag !== 'main' && imageTag !== 'latest' && !imageTag.startsWith('v')) || IS_DEV_BUILD;

  return (
    <div className={`min-h-screen bg-gradient-to-br from-spotify-black via-spotify-gray-dark to-spotify-gray-mid flex flex-col ${showPlayerBar ? 'pb-32' : ''}`}>
      {/* Dev Build Banner */}
      {isDevBuild && (
        <div className="bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 border-b border-amber-400/50 sticky top-0 z-50">
          <div className="container mx-auto px-4 py-2">
            <div className="flex items-center justify-center gap-3 text-amber-950">
              <span className="icon text-xl animate-pulse">code_blocks</span>
              <div className="flex items-center gap-2 font-semibold">
                <span className="text-sm uppercase tracking-wide">Development Build</span>
                <span className="text-xs opacity-75">•</span>
                <span className="text-xs font-mono">Branch: {imageTag || 'local'}</span>
                {shortCommit && (
                  <>
                    <span className="text-xs opacity-75">•</span>
                    <span className="text-xs font-mono">Commit: {shortCommit}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-spotify-black/80 backdrop-blur-md border-b border-spotify-gray-mid sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {/* Logo/Title */}
            <Link to="/" className="flex items-center space-x-3 hover:opacity-80 transition-opacity">
              <div className="w-10 h-10 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" className="w-10 h-10" fill="#1DB954">
                  <path d="m562-338-28-28q-12-12-28.5-12.5T477-367q-12 12-12 28.5t12 28.5l57 57q12 12 28 12t28-12l143-143q12-12 11.5-28T732-452q-12-11-28-11.5T676-452L562-338Zm-242-22h40q17 0 28.5-11.5T400-400q0-17-11.5-28.5T360-440h-40q-17 0-28.5 11.5T280-400q0 17 11.5 28.5T320-360Zm0-120h200q17 0 28.5-11.5T560-520q0-17-11.5-28.5T520-560H320q-17 0-28.5 11.5T280-520q0 17 11.5 28.5T320-480Zm0-120h200q17 0 28.5-11.5T560-640q0-17-11.5-28.5T520-680H320q-17 0-28.5 11.5T280-640q0 17 11.5 28.5T320-600ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/>
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Playlist Polisher</h1>
                <p className="text-xs text-spotify-gray-light">Clean, sort, and shine your playlists</p>
              </div>
            </Link>

            {/* Job Status Indicator */}
            <div className="flex items-center gap-2">
              <ActivityIndicator
                active={cacheWarmStatus?.status === 'running'}
                label="Caching playlists"
                detail={
                  cacheWarmStatus?.total
                    ? `${cacheWarmStatus.completed || 0}/${cacheWarmStatus.total} playlists`
                    : 'Working in the background'
                }
                icon="cloud_sync"
              />
              <ActivityIndicator
                active={dedupeStatus?.active}
                label="Removing duplicates"
                detail={dedupeStatus?.detail || 'Working in the background'}
                icon="content_copy"
                tone="amber"
              />
              <JobStatusIndicator jobStatus={jobStatus} onClick={onJobIndicatorClick} />
            </div>

            {/* User Info */}
            {user && (
              <div
                className="flex items-center space-x-4 relative"
                onMouseEnter={() => {
                  if (hoverTimer.current) clearTimeout(hoverTimer.current);
                  setMenuOpen(true);
                }}
                onMouseLeave={() => {
                  if (hoverTimer.current) clearTimeout(hoverTimer.current);
                  hoverTimer.current = setTimeout(() => setMenuOpen(false), 120);
                }}
              >
                <div className="hidden md:block text-right cursor-pointer">
                  <p className="text-sm font-medium text-white">{user.display_name}</p>
                  <p className="text-xs text-spotify-gray-light">{user.email}</p>
                </div>
                <div className="relative focus:outline-none cursor-pointer">
                  {user.images && user.images.length > 0 ? (
                    <img 
                      src={user.images[0].url} 
                      alt={user.display_name}
                      className="w-10 h-10 rounded-full border-2 border-spotify-green"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-spotify-gray-mid border-2 border-spotify-green flex items-center justify-center text-white">
                      <span className="icon text-lg">account_circle</span>
                    </div>
                  )}
                </div>
                {menuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 bg-spotify-gray-dark border border-spotify-gray-mid rounded-lg shadow-lg z-50 transition">
                    <button
                      className="w-full text-left px-4 py-3 text-sm text-white hover:bg-spotify-gray-mid transition-colors flex items-center gap-2"
                      onClick={() => { navigate('/playlists'); }}
                    >
                      <span className="icon text-base">library_music</span>
                      Playlists
                    </button>
                    <button
                      className="w-full text-left px-4 py-3 text-sm text-white hover:bg-spotify-gray-mid transition-colors flex items-center gap-2"
                      onClick={() => { navigate('/history'); }}
                    >
                      <span className="icon text-base">history</span>
                      History
                    </button>
                    <button
                      className="w-full text-left px-4 py-3 text-sm text-white hover:bg-spotify-gray-mid transition-colors flex items-center gap-2"
                      onClick={() => { navigate('/schedules'); }}
                    >
                      <span className="icon text-base">schedule</span>
                      Schedules
                    </button>
                    <button
                      className="w-full text-left px-4 py-3 text-sm text-white hover:bg-spotify-gray-mid transition-colors flex items-center gap-2"
                      onClick={() => { navigate('/ignored-tracks'); }}
                    >
                      <span className="icon text-base">visibility_off</span>
                      Ignored Tracks
                    </button>
                    <button
                      className="w-full text-left px-4 py-3 text-sm text-white hover:bg-spotify-gray-mid transition-colors flex items-center gap-2"
                      onClick={() => { navigate('/cache'); }}
                    >
                      <span className="icon text-base">storage</span>
                      Cache
                    </button>
                    <button
                      className="w-full text-left px-4 py-3 text-sm text-white hover:bg-spotify-gray-mid transition-colors flex items-center gap-2"
                      onClick={onLogout}
                    >
                      <span className="icon text-base">logout</span>
                      Logout
                    </button>
                  </div>
                )}
              </div>
            )}
         </div>
       </div>
     </header>

      {/* Main Content */}
      <main className={`container mx-auto px-4 py-8 flex-grow ${showPlayerBar ? 'pb-32' : ''}`}>
        <div className="relative">
          {playlistNavPending && (
            <div className="absolute inset-0 z-40 bg-black/50 backdrop-blur-sm rounded-2xl flex items-center justify-center">
              <LoadingSpinner text="Loading playlist details..." />
            </div>
          )}
          <div className={`${showNowPlayingPanel ? 'grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]' : 'grid grid-cols-1'}`}>
            <div>{children}</div>
            {showNowPlayingPanel && <NowPlayingPanel />}
          </div>
        </div>
      </main>

      {/* Footer */}
      <Footer />

      {showPlayerBar && <PlayerBar />}
      
      {/* Build Info */}
      <div className="bg-spotify-black/40 border-t border-spotify-gray-mid/30">
        <div className="container mx-auto px-4 py-3 text-center text-spotify-gray-light text-xs">
          <p className="flex items-center justify-center gap-2">
            <span>
              Playlist Polisher {import.meta.env.VITE_APP_VERSION || 'dev'}
            </span>
            {IS_DEV_BUILD && (
              <span className="px-2 py-0.5 bg-amber-500/20 border border-amber-500/40 text-amber-300 rounded text-[10px] uppercase tracking-wide font-semibold" title={shortCommit ? `Commit: ${shortCommit}` : 'Development Build'}>
                Dev Build{shortCommit && ` (${shortCommit})`}
              </span>
            )}
            <span>{' • Build: '}{buildTimeLocal}</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Layout;
