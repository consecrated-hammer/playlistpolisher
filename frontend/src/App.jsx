/**
 * Main App Component
 * 
 * Root component that handles:
 * - Authentication state management
 * - Routing between login, playlists, and playlist details
 * - Loading and error states
 * 
 * This is the entry point for the application logic.
 */

import React, { useState, useEffect, useMemo, useLayoutEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useSearchParams, useNavigate, useParams, Link, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import PlaylistList from './components/PlaylistList';
import PlaylistView from './components/PlaylistView';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorMessage from './components/ErrorMessage';
import JobStatusModal from './components/JobStatusModal';
import { authAPI, playlistAPI, sortAPI, preferencesAPI, cacheAPI, API_BASE_URL } from './services/api';
import SchedulesPage from './pages/SchedulesPage';
import HistoryPage from './pages/HistoryPage';
import IgnoredTracksPage from './pages/IgnoredTracksPage';
import CachePage from './pages/CachePage';
import RoadmapPage from './pages/RoadmapPage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import ActivityProvider from './context/ActivityContext';
import useActivityContext from './context/useActivityContext';
import PlayerProvider from './context/PlayerContext';
import usePlayerContext from './context/usePlayerContext';

const PRIMARY_TASKS = [
  {
    title: 'Play in Playlist Polisher',
    icon: 'play_circle',
    description: 'Premium users can play tracks in-app with queue, shuffle, and repeat.',
    cta: 'Open the player',
    to: '/playlists',
  },
  {
    title: 'Sort playlists',
    icon: 'swap_vert',
    description: 'Reorder tracks by artist, title, album, or date added.',
    cta: 'Sort a playlist',
    to: '/playlists',
  },
  {
    title: 'Remove duplicate songs',
    icon: 'manage_search',
    description: 'Find exact or similar duplicates with a review step.',
    cta: 'Find duplicates',
    to: '/playlists',
  },
  {
    title: 'Automate with schedules',
    icon: 'schedule',
    description: 'Schedule sorts and cache refreshes that run in the background.',
    cta: 'Manage schedules',
    to: '/schedules',
  },
];

const VIEW_MODE_STORAGE_KEY = 'PlaylistBrowser.ViewMode';
const VIEW_MODE_OPTIONS = [
  { value: 'grid', label: 'Grid view', icon: 'grid_view' },
  { value: 'list', label: 'List view', icon: 'view_list' },
  { value: 'table', label: 'Table view', icon: 'table_rows' },
];

const normalizeViewMode = (value) => {
  if (value === 'grid' || value === 'list' || value === 'table') {
    return value;
  }
  return 'grid';
};

const getViewModeStorageKey = (userId) => {
  return userId ? `${VIEW_MODE_STORAGE_KEY}.${userId}` : VIEW_MODE_STORAGE_KEY;
};

const readViewModeFromStorage = (userId) => {
  try {
    const userKey = getViewModeStorageKey(userId);
    const userValue = window.localStorage?.getItem(userKey);
    if (userValue) {
      return normalizeViewMode(userValue);
    }
    if (!userId) {
      const fallbackValue = window.localStorage?.getItem(VIEW_MODE_STORAGE_KEY);
      return fallbackValue ? normalizeViewMode(fallbackValue) : null;
    }
    return null;
  } catch (err) {
    return null;
  }
};

const writeViewModeToStorage = (userId, mode) => {
  try {
    const userKey = getViewModeStorageKey(userId);
    window.localStorage?.setItem(userKey, mode);
    window.localStorage?.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch (err) {
    console.error('Failed to persist view mode:', err);
  }
};

const SECONDARY_FEATURES = [
  {
    title: 'In-app playback (Premium)',
    icon: 'headphones',
    items: [
      'Play tracks with the Spotify Web Playback SDK.',
      'Persistent player bar and now playing panel.',
      'Queue, shuffle, repeat, seek, and mute controls.',
    ],
  },
  {
    title: 'Queue & context',
    icon: 'queue_music',
    items: [
      'Clickable queue modal with scrollable list.',
      'From-playlist links keep your context while browsing.',
      'Jump to the current track in its playlist.',
    ],
  },
  {
    title: 'Cache & performance',
    icon: 'cloud_sync',
    items: [
      'Track metadata cache to reduce Spotify API calls.',
      'Choose cache scope and run warm-up passes.',
      'Cache status indicators and dashboard.',
    ],
  },
  {
    title: 'Browse your playlists',
    icon: 'grid_view',
    items: [
      'Grid, list, or table views for your library.',
      'Filter by ownership and privacy settings.',
      'Estimated recency sort when cache coverage is available.',
    ],
  },
  {
    title: 'Track tools',
    icon: 'manage_search',
    items: [
      'Search within playlists by title, artist, or album.',
      'Sortable columns for key track metadata.',
      'Hover tooltips for quick context.',
    ],
  },
  {
    title: 'Edit and manage playlists',
    icon: 'edit',
    items: [
      'Update playlist names and descriptions.',
      'Clone playlists for safe experimentation.',
      'Delete playlists you own, per Spotify rules.',
    ],
  },
  {
    title: 'Duplicate management',
    icon: 'content_copy',
    items: [
      'Exact or similar duplicate detection with options.',
      'Prefer album releases and keep strategies.',
      'Ignore duplicate pairs globally or per playlist.',
    ],
  },
  {
    title: 'Automation & history',
    icon: 'history',
    items: [
      'Schedule sorts and cache refreshes.',
      'History view with undo for recent changes.',
      'Activity indicators for background jobs.',
    ],
  },
];

function HomeFeatureOverview() {
  return (
    <section className="bg-spotify-gray-dark/70 border border-spotify-gray-mid rounded-2xl p-6 md:p-8 shadow-xl mb-8 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 md:gap-8 mb-6">
        <div className="space-y-3 md:max-w-2xl">
          <p className="text-xs uppercase tracking-[0.2em] text-spotify-green font-semibold">What do you want to do?</p>
          <h2 className="text-2xl md:text-3xl font-bold text-white leading-tight">
            Focus on the quickest ways to polish your playlists.
          </h2>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 md:gap-5 mb-8">
        {PRIMARY_TASKS.map((task) => (
          <div
            key={task.title}
            className="relative overflow-hidden bg-gradient-to-br from-spotify-green/25 via-spotify-gray-dark to-spotify-gray-mid border border-spotify-green/40 rounded-2xl p-5 md:p-6 shadow-2xl shadow-spotify-green/25"
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-spotify-green text-spotify-black flex items-center justify-center shadow-lg shadow-spotify-green/40">
                  <span className="icon text-xl">{task.icon}</span>
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">{task.title}</h3>
                  <p className="text-spotify-gray-light mt-1">{task.description}</p>
                </div>
              </div>
            </div>
            <Link
              to={task.to}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-full bg-white text-spotify-black font-semibold hover:bg-spotify-gray-light transition-colors shadow-md"
            >
              {task.cta}
              <span className="icon text-base">arrow_forward</span>
            </Link>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">More inside Playlist Polisher</h3>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-5">
        {SECONDARY_FEATURES.map((section) => (
          <div key={section.title} className="bg-spotify-black/40 border border-spotify-gray-mid rounded-xl p-4 md:p-5 shadow-lg shadow-black/20">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-spotify-gray-mid/60 text-white flex items-center justify-center">
                <span className="icon text-base">{section.icon}</span>
              </div>
              <h3 className="text-base font-semibold text-white">{section.title}</h3>
            </div>
            <ul className="space-y-2 text-spotify-gray-light text-sm leading-relaxed">
              {section.items.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1 text-spotify-green">•</span>
                  <span className="text-white/90">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// Scroll to top on route changes to avoid landing mid-page
const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

/**
 * Public Home Page Component
 */
const HomePage = ({ isAuthenticated, user, onLogout }) => {
  return (
    <Layout user={user} onLogout={onLogout}>
      <div className="max-w-5xl mx-auto space-y-8 animate-fade-in">
        <div className="bg-spotify-gray-dark/70 border border-spotify-gray-mid rounded-2xl p-6 md:p-8 shadow-xl">
          <p className="text-xs uppercase tracking-[0.2em] text-spotify-green font-semibold mb-3">Playlist Polisher</p>
          <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight mb-3">
            Organize, clean, and maintain your Spotify playlists with confidence.
          </h1>
          <p className="text-spotify-gray-light text-lg mb-6">
            Sign in with Spotify to sort, dedupe, cache, and play your playlists. Authentication is handled securely by Spotify - Playlist Polisher never sees or stores your Spotify password.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {!isAuthenticated ? (
              <>
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center px-5 py-3 rounded-full bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold transition-all hover:scale-[1.02]"
                >
                  Sign in with Spotify
                </Link>
              </>
            ) : (
              <Link
                to="/playlists"
                className="inline-flex items-center justify-center px-5 py-3 rounded-full bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold transition-all hover:scale-[1.02]"
              >
                Open your playlists
              </Link>
            )}
          </div>
        </div>

        <HomeFeatureOverview />
      </div>
    </Layout>
  );
};

/**
 * Login Page Component
 */
const LoginPage = () => {
  const [loading, setLoading] = useState(false);
  const [forceLoading, setForceLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleLogin = (forceDialog = false) => {
    forceDialog ? setForceLoading(true) : setLoading(true);
    setError(null);
    
    // Navigate directly to backend login endpoint which will redirect to Spotify
    // This ensures the state cookie is properly set via browser navigation
    const loginUrl = `${API_BASE_URL}/auth/login?show_dialog=${forceDialog}`;
    window.location.href = loginUrl;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-spotify-black via-spotify-gray-dark to-spotify-gray-mid flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center animate-fade-in">
        {/* Logo */}
        <div className="w-20 h-20 bg-spotify-green rounded-full flex items-center justify-center mx-auto mb-8">
          <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
        </div>

        <h1 className="text-4xl font-bold text-white mb-4">Playlist Polisher</h1>
        <p className="text-spotify-gray-light mb-8">
          View, clean, and organize your Spotify playlists in one beautiful interface
        </p>

        {error && (
          <div className="mb-6">
            <ErrorMessage message={error} onRetry={handleLogin} />
          </div>
        )}

        <button
          onClick={() => handleLogin(false)}
          disabled={loading || forceLoading}
          className="w-full px-8 py-4 bg-spotify-green hover:bg-spotify-green-dark text-white rounded-full font-bold text-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          title="Uses your current Spotify login"
        >
          {loading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Connecting to Spotify...
            </span>
          ) : (
            'Continue with Spotify'
          )}
        </button>

        <button
          onClick={() => handleLogin(true)}
          disabled={loading || forceLoading}
          className="w-full mt-3 px-8 py-4 border border-spotify-gray-mid text-white rounded-full font-semibold text-base transition-all hover:bg-spotify-gray-mid/60 hover:border-spotify-gray-light disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {forceLoading ? 'Switching account…' : 'Use a different Spotify account'}
        </button>

        <p className="text-spotify-gray-light text-sm mt-6">
          You’ll be redirected to Spotify to authorize Playlist Polisher
        </p>
      </div>
    </div>
  );
};

/**
 * OAuth Callback Handler Component
 */
const CallbackHandler = () => {
  const [searchParams] = useSearchParams();
  const status = searchParams.get('status');
  const message = searchParams.get('message');
  const code = searchParams.get('code');
  const [finalizeStatus, setFinalizeStatus] = useState(status === 'success' ? 'pending' : null);
  const [finalizeError, setFinalizeError] = useState(null);

  useEffect(() => {
    if (status === 'success') {
      let cancelled = false;
      const finalizeAuth = async () => {
        try {
          if (code) {
            await authAPI.exchangeCode(code);
          }
          const authStatus = await authAPI.checkStatus();
          if (cancelled) {
            return;
          }
          if (authStatus.authenticated) {
            setFinalizeStatus('success');
            setTimeout(() => window.location.href = '/playlists', 700);
            return;
          }
          setFinalizeStatus('error');
          setFinalizeError('Session not established. Please try again.');
          setTimeout(() => window.location.href = '/login', 3000);
        } catch (err) {
          if (cancelled) {
            return;
          }
          try {
            const authStatus = await authAPI.checkStatus();
            if (!cancelled && authStatus.authenticated) {
              setFinalizeStatus('success');
              setTimeout(() => window.location.href = '/playlists', 700);
              return;
            }
          } catch (statusErr) {
            // Ignore and fall back to error handling.
          }
          setFinalizeStatus('error');
          setFinalizeError(err?.message || 'Authentication failed. Please try again.');
          setTimeout(() => window.location.href = '/login', 3000);
        }
      };
      finalizeAuth();
      return () => {
        cancelled = true;
      };
    }
    if (status === 'error') {
      setTimeout(() => window.location.href = '/login', 3000);
    }
  }, [status, code]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-spotify-black via-spotify-gray-dark to-spotify-gray-mid flex items-center justify-center">
      <div className="text-center">
        {status === 'success' ? (
          finalizeStatus === 'pending' ? (
            <LoadingSpinner text="Finalizing authentication..." />
          ) : finalizeStatus === 'success' ? (
            <>
              <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Successfully logged in!</h2>
              <p className="text-spotify-gray-light">Redirecting to your playlists...</p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Authentication failed</h2>
              <p className="text-spotify-gray-light mb-4">{finalizeError || 'Please try again'}</p>
            </>
          )
        ) : status === 'error' ? (
          <>
            <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Authentication failed</h2>
            <p className="text-spotify-gray-light mb-4">{message || 'Please try again'}</p>
          </>
        ) : (
          <LoadingSpinner text="Processing authentication..." />
        )}
      </div>
    </div>
  );
};

/**
 * Main Playlists Page Component  
 */
const PlaylistsPage = ({ user, onLogout }) => {
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortOption, setSortOption] = useState('default');
  const [filterOption, setFilterOption] = useState('all');
  const [viewMode, setViewMode] = useState('grid');
  const [cacheFacts, setCacheFacts] = useState({});
  const [cacheFactsSummary, setCacheFactsSummary] = useState({ coverage_ratio: 0, facts_count: 0, total_playlists: 0 });
  const [cacheScope, setCacheScope] = useState(null);
  const scrollPositionRef = useRef(0);
  const restoreScrollRef = useRef(false);
  const navigate = useNavigate();
  const activityContext = useActivityContext();
  const cacheWarmStatus = activityContext?.cacheWarmStatus;

  useEffect(() => {
    loadPlaylists();
  }, []);

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    let isActive = true;
    const storedMode = readViewModeFromStorage(user.id);

    if (storedMode) {
      setViewMode(storedMode);
    }

    const loadPreferences = async () => {
      try {
        const prefs = await preferencesAPI.getPreferences();
        const remoteMode = normalizeViewMode(prefs?.playlist_view);
        if (!isActive) {
          return;
        }
        if (!storedMode && remoteMode) {
          setViewMode(remoteMode);
          writeViewModeToStorage(user.id, remoteMode);
        } else if (storedMode && remoteMode !== storedMode) {
          await preferencesAPI.updatePreferences({ playlist_view: storedMode });
        }
        setCacheScope(prefs?.cache_playlist_scope || null);
      } catch (err) {
        console.error('Failed to load user preferences:', err);
      }
    };

    loadPreferences();

    return () => {
      isActive = false;
    };
  }, [user?.id]);

  const fetchCacheFacts = async (playlistList) => {
    if (!playlistList.length) {
      setCacheFacts({});
      setCacheFactsSummary({ coverage_ratio: 0, facts_count: 0, total_playlists: 0 });
      return;
    }
    try {
      const ids = playlistList.map((playlist) => playlist.id);
      const data = await cacheAPI.getPlaylistFacts(ids);
      const factsById = {};
      (data?.facts || []).forEach((fact) => {
        factsById[fact.playlist_id] = fact;
      });
      setCacheFacts(factsById);
      setCacheFactsSummary(data?.summary || { coverage_ratio: 0, facts_count: 0, total_playlists: 0 });
    } catch (err) {
      console.error('Failed to load playlist cache facts:', err);
    }
  };

  useEffect(() => {
    let active = true;
    const loadFacts = async () => {
      if (!active) return;
      await fetchCacheFacts(playlists);
    };
    loadFacts();
    return () => {
      active = false;
    };
  }, [playlists]);

  useEffect(() => {
    if (cacheWarmStatus?.status !== 'completed') {
      return;
    }
    fetchCacheFacts(playlists);
  }, [cacheWarmStatus?.status, playlists]);

  useLayoutEffect(() => {
    if (!restoreScrollRef.current) {
      return;
    }
    window.scrollTo({ top: scrollPositionRef.current, behavior: 'auto' });
    restoreScrollRef.current = false;
  }, [viewMode]);

  const loadPlaylists = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await playlistAPI.getPlaylists();
      setPlaylists(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePlaylistClick = (playlistId) => {
    navigate(`/playlist/${playlistId}`);
  };

  const handleViewModeChange = (nextMode) => {
    const normalized = normalizeViewMode(nextMode);
    if (normalized === viewMode) {
      return;
    }
    scrollPositionRef.current = window.scrollY;
    restoreScrollRef.current = true;
    setViewMode(normalized);
    writeViewModeToStorage(user?.id, normalized);
    if (user?.id) {
      preferencesAPI.updatePreferences({ playlist_view: normalized }).catch((err) => {
        console.error('Failed to update user preferences:', err);
      });
    }
  };

  const cacheSortEnabled = cacheScope === 'all'
    && cacheFactsSummary.coverage_ratio >= 0.8
    && cacheFactsSummary.facts_count > 0;

  useEffect(() => {
    if (sortOption === 'recently-updated-estimated' && !cacheSortEnabled) {
      setSortOption('default');
    }
  }, [sortOption, cacheSortEnabled]);

  const filteredPlaylists = useMemo(() => {
    return playlists.filter((pl) => {
      if (filterOption === 'owned') {
        return pl.owner?.id && user?.id && pl.owner.id === user.id;
      }
      if (filterOption === 'public') {
        return pl.public === true;
      }
      if (filterOption === 'private') {
        return pl.public === false;
      }
      if (filterOption === 'collaborative') {
        return pl.collaborative === true;
      }
      return true;
    });
  }, [playlists, filterOption, user]);

  const sortedPlaylists = useMemo(() => {
    const copy = [...filteredPlaylists];
    switch (sortOption) {
      case 'recently-updated-estimated':
        return copy.sort((a, b) => {
          const aFact = cacheFacts[a.id];
          const bFact = cacheFacts[b.id];
          const aDate = aFact?.last_track_added_at_utc ? new Date(aFact.last_track_added_at_utc) : null;
          const bDate = bFact?.last_track_added_at_utc ? new Date(bFact.last_track_added_at_utc) : null;
          const aTime = aDate && !Number.isNaN(aDate.getTime()) ? aDate.getTime() : null;
          const bTime = bDate && !Number.isNaN(bDate.getTime()) ? bDate.getTime() : null;

          if (aTime && bTime) {
            return bTime - aTime;
          }
          if (aTime && !bTime) return -1;
          if (!aTime && bTime) return 1;
          return a.name.localeCompare(b.name);
        });
      case 'name-asc':
        return copy.sort((a, b) => a.name.localeCompare(b.name));
      case 'name-desc':
        return copy.sort((a, b) => b.name.localeCompare(a.name));
      case 'tracks-asc':
        return copy.sort((a, b) => (a.tracks?.total || 0) - (b.tracks?.total || 0));
      case 'tracks-desc':
        return copy.sort((a, b) => (b.tracks?.total || 0) - (a.tracks?.total || 0));
      case 'owner-asc':
        return copy.sort((a, b) =>
          (a.owner?.display_name || a.owner?.id || '').localeCompare(b.owner?.display_name || b.owner?.id || '')
        );
      case 'owner-desc':
        return copy.sort((a, b) =>
          (b.owner?.display_name || b.owner?.id || '').localeCompare(a.owner?.display_name || a.owner?.id || '')
        );
      default:
        return copy;
    }
  }, [filteredPlaylists, sortOption, cacheFacts]);

  return (
    <Layout user={user} onLogout={onLogout}>
      {loading ? (
        <LoadingSpinner text="Loading your playlists..." />
      ) : error ? (
        <ErrorMessage message={error} onRetry={loadPlaylists} />
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-3">
            <h2 className="text-2xl font-bold text-white">Your Playlists ({sortedPlaylists.length})</h2>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <div className="flex items-center gap-2">
                <label htmlFor="playlist-filter" className="text-sm text-spotify-gray-light">
                  Filter:
                </label>
                <select
                  id="playlist-filter"
                  value={filterOption}
                  onChange={(e) => setFilterOption(e.target.value)}
                  className="bg-spotify-gray-dark text-white text-sm rounded-md px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                >
                  <option value="all">All playlists</option>
                  <option value="owned">Owned by me</option>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                  <option value="collaborative">Collaborative</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="playlist-sort" className="text-sm text-spotify-gray-light">
                  Sort:
                </label>
                <select
                  id="playlist-sort"
                  value={sortOption}
                  onChange={(e) => setSortOption(e.target.value)}
                  className="bg-spotify-gray-dark text-white text-sm rounded-md px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                >
                  <option value="default">Default (Spotify order)</option>
                  {cacheSortEnabled && (
                    <option value="recently-updated-estimated">Recently updated (estimated)</option>
                  )}
                  <option value="name-asc">Name A → Z</option>
                  <option value="name-desc">Name Z → A</option>
                  <option value="tracks-desc">Tracks ↓</option>
                  <option value="tracks-asc">Tracks ↑</option>
                  <option value="owner-asc">Owner A → Z</option>
                  <option value="owner-desc">Owner Z → A</option>
                </select>
                {cacheSortEnabled && sortOption === 'recently-updated-estimated' && (
                  <div className="relative group">
                    <button
                      type="button"
                      className="w-8 h-8 rounded-full flex items-center justify-center text-spotify-gray-light hover:text-white hover:bg-spotify-gray-mid/60 transition-colors"
                      aria-label="Recently updated sort details"
                    >
                      <span className="icon text-base">info</span>
                    </button>
                    <div className="tooltip tooltip-up group-hover:tooltip-visible">
                      Based on the most recent track added to each playlist from cached data.
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-spotify-gray-light">View:</span>
                <div className="flex items-center gap-1 bg-spotify-gray-dark/60 border border-spotify-gray-mid/60 rounded-lg p-1">
                  {VIEW_MODE_OPTIONS.map((option) => {
                    const isActive = viewMode === option.value;
                    return (
                      <div key={option.value} className="relative group">
                        <button
                          type="button"
                          onClick={() => handleViewModeChange(option.value)}
                          aria-pressed={isActive}
                          aria-label={option.label}
                          className={`w-9 h-9 rounded-md flex items-center justify-center transition-all focus:outline-none focus:ring-2 focus:ring-spotify-green ${
                            isActive
                              ? 'bg-spotify-green text-black shadow-sm'
                              : 'text-spotify-gray-light hover:text-white hover:bg-spotify-gray-mid/60'
                          }`}
                        >
                          <span className="icon text-base">{option.icon}</span>
                        </button>
                        <div className="tooltip tooltip-up group-hover:tooltip-visible">
                          {option.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <PlaylistList
            playlists={sortedPlaylists}
            onPlaylistClick={handlePlaylistClick}
            viewMode={viewMode}
            sortOption={sortOption}
            onSortChange={setSortOption}
            cacheFacts={cacheFacts}
          />
        </>
      )}
    </Layout>
  );
};

/**
 * Playlist Detail Page Component
 */
const PlaylistDetailPage = ({ user, onLogout, globalJob, setGlobalJob, globalJobStatus, setGlobalJobStatus, jobStatus, onJobIndicatorClick, onDedupeStatusChange }) => {
  const { playlistId } = useParams();
  const navigate = useNavigate();
  const player = usePlayerContext();
  const [playlist, setPlaylist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadPlaylistDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  const loadPlaylistDetails = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Load playlist summary (metadata only)
      const summary = await playlistAPI.getPlaylistSummary(playlistId);
      
      // Load first page of tracks (100 by default)
      const firstPage = await playlistAPI.getPlaylistTracksPaginated(playlistId, 0, 100);
      
      // Combine into playlist object for PlaylistView
      const data = {
        ...summary,
        tracks: firstPage.tracks,
        total_tracks: firstPage.total,
        cache_info: firstPage.cache_info || { hits: 0, misses: 0, warmed: 0 }
      };
      
      setPlaylist(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!loading) {
      player?.clearPlaylistNavPending?.();
    }
  }, [loading, player]);

  const handleBack = () => {
    navigate('/playlists');
  };

  return (
    <Layout user={user} onLogout={onLogout} jobStatus={jobStatus} onJobIndicatorClick={onJobIndicatorClick}>
      {loading ? (
        <LoadingSpinner text="Loading playlist details..." />
      ) : error ? (
        <ErrorMessage message={error} onRetry={loadPlaylistDetails} />
      ) : playlist ? (
        <PlaylistView 
          playlist={playlist} 
          onBack={handleBack}
          globalJob={globalJob}
          setGlobalJob={setGlobalJob}
          globalJobStatus={globalJobStatus}
          setGlobalJobStatus={setGlobalJobStatus}
          onDedupeStatusChange={onDedupeStatusChange}
        />
      ) : null}
    </Layout>
  );
};

/**
 * Protected Route Wrapper
 */
const ProtectedRoute = ({ children, isAuthenticated, loading }) => {
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-spotify-black via-spotify-gray-dark to-spotify-gray-mid flex items-center justify-center">
        <LoadingSpinner text="Checking authentication..." />
      </div>
    );
  }

  return isAuthenticated ? children : <Navigate to="/" replace />;
};

/**
 * Main App Component
 */
function App() {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Global job state for background tracking
  const [globalJob, setGlobalJob] = useState(null);
  const [globalJobStatus, setGlobalJobStatus] = useState(null);
  const [showJobModal, setShowJobModal] = useState(false);
  const [cacheWarmStatus, setCacheWarmStatus] = useState({ status: 'idle', total: 0, completed: 0 });
  const [dedupeStatus, setDedupeStatus] = useState({ active: false, detail: null });

  useEffect(() => {
    checkAuthStatus();
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setCacheWarmStatus({ status: 'idle', total: 0, completed: 0 });
      return;
    }

    let active = true;
    const pollCacheWarmStatus = async () => {
      try {
        const status = await cacheAPI.getWarmStatus();
        if (!active) return;
        setCacheWarmStatus(status);
      } catch (err) {
        if (!active) return;
        console.error('Failed to load cache warm status:', err);
      }
    };

    pollCacheWarmStatus();
    const interval = setInterval(pollCacheWarmStatus, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  // Background polling for active jobs
  useEffect(() => {
    if (!globalJob?.job_id) return;

    const pollJobStatus = async () => {
      try {
        const status = await sortAPI.getJobStatus(globalJob.job_id);
        setGlobalJobStatus({ 
          ...status, 
          playlist_id: globalJob.playlist_id,
          playlist_name: globalJob.playlist_name 
        });

        // Clear job if completed, failed, or cancelled
        if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
          setTimeout(() => {
            setGlobalJob(null);
            setGlobalJobStatus(null);
          }, 3000); // Keep visible for 3 seconds after completion
        }
      } catch (err) {
        console.error('Failed to poll job status:', err);
      }
    };

    // Poll immediately, then every 2 seconds
    pollJobStatus();
    const interval = setInterval(pollJobStatus, 2000);

    return () => clearInterval(interval);
  }, [globalJob?.job_id, globalJob?.playlist_id, globalJob?.playlist_name]);

  const checkAuthStatus = async () => {
    try {
      const status = await authAPI.checkStatus();
      setIsAuthenticated(status.authenticated);
      setUser(status.user);
    } catch (err) {
      console.error('Failed to check auth status:', err);
      setIsAuthenticated(false);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await authAPI.logout();
      setIsAuthenticated(false);
      setUser(null);
      // Clear job state on logout
      setGlobalJob(null);
      setGlobalJobStatus(null);
      setCacheWarmStatus({ status: 'idle', total: 0, completed: 0 });
      setDedupeStatus({ active: false, detail: null });
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const handleJobIndicatorClick = () => {
    setShowJobModal(true);
  };

  const handleCloseJobModal = () => {
    setShowJobModal(false);
  };

  const activityValue = useMemo(() => ({
    cacheWarmStatus,
    setCacheWarmStatus,
    dedupeStatus,
    setDedupeStatus,
  }), [cacheWarmStatus, dedupeStatus]);

  return (
    <ActivityProvider value={activityValue}>
      <PlayerProvider user={user}>
        <Router>
          <ScrollToTop />
          <Routes>
        <Route path="/login" element={
          isAuthenticated ? <Navigate to="/playlists" replace /> : <LoginPage />
        } />
        
        <Route path="/callback" element={<CallbackHandler />} />

        <Route path="/" element={
          <HomePage isAuthenticated={isAuthenticated} user={user} onLogout={handleLogout} />
        } />

        <Route path="/playlists" element={
          <ProtectedRoute isAuthenticated={isAuthenticated} loading={loading}>
            <PlaylistsPage user={user} onLogout={handleLogout} />
          </ProtectedRoute>
        } />

        <Route path="/playlist/:playlistId" element={
          <ProtectedRoute isAuthenticated={isAuthenticated} loading={loading}>
            <PlaylistDetailPage 
              user={user} 
              onLogout={handleLogout}
              globalJob={globalJob}
              setGlobalJob={setGlobalJob}
              globalJobStatus={globalJobStatus}
              setGlobalJobStatus={setGlobalJobStatus}
              jobStatus={globalJobStatus}
              onJobIndicatorClick={handleJobIndicatorClick}
              onDedupeStatusChange={setDedupeStatus}
            />
          </ProtectedRoute>
        } />
        <Route path="/schedules" element={
          <ProtectedRoute isAuthenticated={isAuthenticated} loading={loading}>
            <SchedulesPage user={user} onLogout={handleLogout} />
          </ProtectedRoute>
        } />
        <Route path="/history" element={
          <ProtectedRoute isAuthenticated={isAuthenticated} loading={loading}>
            <HistoryPage user={user} onLogout={handleLogout} />
          </ProtectedRoute>
        } />
        <Route path="/ignored-tracks" element={
          <ProtectedRoute isAuthenticated={isAuthenticated} loading={loading}>
            <IgnoredTracksPage user={user} onLogout={handleLogout} />
          </ProtectedRoute>
        } />
        <Route path="/cache" element={
          <CachePage user={user} onLogout={handleLogout} />
        } />
        <Route path="/roadmap" element={
          <Layout user={user} onLogout={handleLogout}>
            <RoadmapPage />
          </Layout>
        } />
        <Route path="/terms" element={
          <Layout user={user} onLogout={handleLogout}>
            <TermsPage />
          </Layout>
        } />
        <Route path="/privacy" element={
          <Layout user={user} onLogout={handleLogout}>
            <PrivacyPage />
          </Layout>
        } />
        
        <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        
          {/* Global job status modal */}
          {showJobModal && globalJobStatus && (
            <JobStatusModal
              jobStatus={globalJobStatus}
              onClose={handleCloseJobModal}
            />
          )}
        </Router>
      </PlayerProvider>
    </ActivityProvider>
  );
}

export default App;
