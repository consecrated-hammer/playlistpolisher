/**
 * API Service Module
 * 
 * Centralized API client for all backend communication. Handles:
 * - HTTP requests to FastAPI backend
 * - Error handling and response transformation
 * - Authentication state management
 * 
 * All API endpoints are defined here as methods for easy maintenance.
 */

import axios from 'axios';

// API base URL - can be configured via environment variable
const fallbackHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const fallbackPort = import.meta.env.VITE_API_PORT || '8001';
const normalizeApiBaseUrl = (value) => {
  if (value === null || value === undefined) return null;
  if (value === '/') return '';
  return value.replace(/\/$/, '');
};
const rawApiBaseUrl = import.meta.env.VITE_API_URL;
const normalizedApiBaseUrl = normalizeApiBaseUrl(rawApiBaseUrl);
export const API_BASE_URL = normalizedApiBaseUrl !== null ? normalizedApiBaseUrl : `http://${fallbackHost}:${fallbackPort}`;

/**
 * Axios instance configured for API communication
 */
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Important for cookie-based sessions
});

/**
 * Response interceptor for consistent error handling
 */
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Log errors in development
    if (import.meta.env.DEV) {
      console.error('API Error:', error.response?.data || error.message);
    }
    
    // Transform error for consistent handling
    const errorMessage = error.response?.data?.detail || 
                         error.response?.data?.message || 
                         error.message ||
                         'An unexpected error occurred';
    
    return Promise.reject({
      status: error.response?.status,
      statusCode: error.response?.status, // Add statusCode for backwards compatibility
      message: errorMessage,
      original: error
    });
  }
);

/**
 * Authentication API
 */
export const authAPI = {
  /**
   * Get OAuth authorization URL
   * @returns {Promise<string>} Authorization URL to redirect user to
   */
  getAuthUrl: async (forceDialog = false) => {
    const response = await api.get('/auth/login', { params: { show_dialog: forceDialog } });
    return response.data.auth_url;
  },

  /**
   * Exchange short-lived auth code for a session cookie
   * @param {string} code - Auth exchange code from backend callback
   * @returns {Promise<{message: string}>}
   */
  exchangeCode: async (code) => {
    const response = await api.post('/auth/exchange', { code });
    return response.data;
  },

  /**
   * Check current authentication status
   * @returns {Promise<{authenticated: boolean, user: object|null}>}
   */
  checkStatus: async () => {
    const response = await api.get('/auth/status');
    return response.data;
  },

  /**
   * Get current user profile
   * @returns {Promise<object>} User profile data
   */
  getCurrentUser: async () => {
    const response = await api.get('/auth/user');
    return response.data;
  },

  /**
   * Get short-lived access token for Spotify Web Playback SDK
   * @returns {Promise<{access_token: string, token_type: string, expires_in: number, scope: string}>}
   */
  getPlaybackToken: async () => {
    const response = await api.get('/auth/player-token');
    return response.data;
  },

  /**
   * Logout and clear authentication
   * @returns {Promise<{message: string}>}
   */
  logout: async () => {
    const response = await api.post('/auth/logout');
    return response.data;
  },
};

/**
 * Player API
 */
export const playerAPI = {
  /**
   * Log a playback event for server-side audit/debugging
   * @param {object} payload - Event payload
   * @returns {Promise<object>} Log acknowledgement
   */
  logEvent: async (payload) => {
    const response = await api.post('/player/events', payload);
    return response.data;
  },

  /**
   * Log a frontend message to backend log file
   * @param {string} level - Log level (debug, info, warn, error)
   * @param {string} message - Log message
   * @param {object} data - Optional additional data
   * @returns {Promise<object>} Log acknowledgement
   */
  log: async (level, message, data = null) => {
    try {
      const response = await api.post('/player/log', { level, message, data });
      return response.data;
    } catch (err) {
      // Silent fail - don't break app if logging fails
      if (import.meta.env.DEV) {
        console.warn('Failed to send log to backend:', err);
      }
    }
  },
};

/**
 * Preferences API
 */
export const preferencesAPI = {
  /**
   * Get stored user preferences
   * @returns {Promise<object>} Preferences data
   */
  getPreferences: async () => {
    const response = await api.get('/preferences');
    return response.data;
  },

  /**
   * Update stored user preferences
   * @param {object} payload - Fields to update
   * @returns {Promise<object>} Updated preferences data
   */
  updatePreferences: async (payload) => {
    const response = await api.patch('/preferences', payload);
    return response.data;
  },
};

/**
 * Playlist API
 */
export const playlistAPI = {
  /**
   * Get all user playlists
   * @returns {Promise<Array>} Array of playlist objects
   */
  getPlaylists: async () => {
    const response = await api.get('/playlists/');
    return response.data;
  },

  /**
   * Get detailed playlist information with tracks
   * @param {string} playlistId - Spotify playlist ID
   * @returns {Promise<object>} Detailed playlist data
   */
  getPlaylistDetails: async (playlistId) => {
    const response = await api.get(`/playlists/${playlistId}`);
    return response.data;
  },

  /**
   * Get lightweight playlist metadata
   * @param {string} playlistId - Spotify playlist ID
   * @returns {Promise<object>} Playlist summary data
   */
  getPlaylistSummary: async (playlistId) => {
    const response = await api.get(`/playlists/${playlistId}/summary`);
    return response.data;
  },

  /**
   * Get paginated playlist tracks for infinite scroll
   * @param {string} playlistId - Spotify playlist ID
   * @param {number} offset - Starting position (default: 0)
   * @param {number} limit - Page size (default: 100)
   * @returns {Promise<object>} Paginated tracks response
   */
  getPlaylistTracksPaginated: async (playlistId, offset = 0, limit = 100) => {
    const response = await api.get(`/playlists/${playlistId}/tracks`, {
      params: { offset, limit }
    });
    return response.data;
  },

  /**
   * Update playlist metadata
   */
  updatePlaylist: async (playlistId, payload) => {
    const response = await api.patch(`/playlists/${playlistId}`, payload);
    return response.data;
  },

  /**
   * Clone playlist
   */
  clonePlaylist: async (playlistId, payload) => {
    const response = await api.post(`/playlists/${playlistId}/clone`, payload);
    return response.data;
  },

  /**
   * Delete (unfollow) playlist
   */
  deletePlaylist: async (playlistId) => {
    const response = await api.delete(`/playlists/${playlistId}`);
    return response.data;
  },

  /**
   * Add tracks to a playlist
   */
  addTracks: async (playlistId, payload) => {
    const response = await api.post(`/playlists/${playlistId}/tracks/add`, payload);
    return response.data;
  },

  /**
   * Check cached playlist matches for selected tracks
   */
  getPlaylistCacheMatches: async (playlistId, payload) => {
    const response = await api.post(`/playlists/${playlistId}/cache/matches`, payload);
    return response.data;
  },

  /**
   * Check cached playlist matches across multiple playlists
   */
  getPlaylistCacheMatchesBatch: async (payload) => {
    const response = await api.post('/playlists/cache/matches', payload);
    return response.data;
  },

  /**
   * Remove tracks from a playlist
   */
  removeTracks: async (playlistId, payload) => {
    const response = await api.post(`/playlists/${playlistId}/tracks/remove`, payload);
    return response.data;
  },

  /**
   * Create a new playlist with optional tracks
   */
  createPlaylist: async (payload) => {
    const response = await api.post('/playlists/create', payload);
    return response.data;
  },

  /**
   * Analyze duplicates in a playlist
   */
  analyzeDuplicates: async (playlistId, includeSimilar = false, preferAlbumRelease = false) => {
    const response = await api.post(
      `/playlists/${playlistId}/duplicates/analyze`,
      null,
      { params: { include_similar: includeSimilar, prefer_album_release: preferAlbumRelease } }
    );
    return response.data;
  },

  /**
   * Remove selected duplicate occurrences
   */
  removeDuplicates: async (playlistId, items, snapshotId) => {
    const response = await api.post(`/playlists/${playlistId}/duplicates/remove`, { items, snapshot_id: snapshotId });
    return response.data;
  },

  /**
   * Get recent undoable history for a playlist
   */
  getHistory: async (playlistId) => {
    const response = await api.get(`/playlists/${playlistId}/history`);
    return response.data;
  },

  /**
   * Undo the most recent bulk operation
   */
  undoLast: async (playlistId) => {
    const response = await api.post(`/playlists/${playlistId}/undo`);
    return response.data;
  },

  /**
   * Scheduling
   */
  listSchedules: async () => {
    const response = await api.get('/schedules');
    const data = response.data;
    return Array.isArray(data?.schedules) ? data.schedules : Array.isArray(data) ? data : [];
  },
  createCacheSchedule: async (payload) => {
    const response = await api.post('/schedules/cache', payload);
    return response.data;
  },
  updateCacheSchedule: async (scheduleId, payload) => {
    const response = await api.patch(`/schedules/cache/${scheduleId}`, payload);
    return response.data;
  },
  deleteCacheSchedule: async (scheduleId) => {
    const response = await api.delete(`/schedules/cache/${scheduleId}`);
    return response.data;
  },
  listPlaylistSchedules: async (playlistId) => {
    const response = await api.get(`/playlists/${playlistId}/schedules`);
    const data = response.data;
    return Array.isArray(data?.schedules) ? data.schedules : Array.isArray(data) ? data : [];
  },
  createSchedule: async (playlistId, payload) => {
    const response = await api.post(`/playlists/${playlistId}/schedules`, payload);
    return response.data;
  },
  updateSchedule: async (playlistId, scheduleId, payload) => {
    const response = await api.patch(`/playlists/${playlistId}/schedules/${scheduleId}`, payload);
    return response.data;
  },
  deleteSchedule: async (playlistId, scheduleId) => {
    const response = await api.delete(`/playlists/${playlistId}/schedules/${scheduleId}`);
    return response.data;
  },
  exportRemovalJson: async (playlistId, operationId) => {
    const response = await api.get(`/playlists/${playlistId}/history/${operationId}/export`, { responseType: 'json' });
    return response.data;
  },
  getAllHistory: async () => {
    const response = await api.get('/playlists/history/all');
    return response.data;
  },

  /**
   * Get track details in batch
   * @param {string[]} trackIds - Array of Spotify track IDs
   * @returns {Promise<Array>} Array of track detail objects
   */
  getTracksBatch: async (trackIds) => {
    if (!trackIds || trackIds.length === 0) {
      return [];
    }
    const response = await api.post('/playlists/tracks/batch', trackIds);
    return response.data;
  },
};

/**
 * Sorting API
 */
export const sortAPI = {
  analyze: async (playlistId, payload) => {
    const response = await api.post(`/playlists/${playlistId}/sort/analyze`, payload);
    return response.data;
  },
  start: async (playlistId, payload) => {
    const response = await api.post(`/playlists/${playlistId}/sort`, payload);
    return response.data;
  },
  status: async (playlistId, jobId) => {
    const response = await api.get(`/playlists/${playlistId}/sort/status/${jobId}`);
    return response.data;
  },
};

/**
 * Utility function to format duration from milliseconds
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration (MM:SS)
 */
export const formatDuration = (ms) => {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * Ignore API - Manage ignored duplicate pairs
 */
export const ignoreAPI = {
  /**
   * Add a track pair to the ignore list
   * @param {string} trackId1 - First track Spotify ID
   * @param {string} trackId2 - Second track Spotify ID
   * @param {string|null} playlistId - Playlist ID (null for global ignore)
   * @returns {Promise<object>} Response with id and message
   */
  addIgnoredPair: async (trackId1, trackId2, playlistId = null) => {
    const response = await api.post('/ignore/pair', {
      track_id_1: trackId1,
      track_id_2: trackId2,
      playlist_id: playlistId,
    });
    return response.data;
  },

  /**
   * Get all ignored pairs for current session
   * @param {string|null} playlistId - Optional playlist ID filter
   * @returns {Promise<Array>} List of ignored pairs
   */
  listIgnoredPairs: async (playlistId = null) => {
    const params = playlistId ? { playlist_id: playlistId } : {};
    const response = await api.get('/ignore/list', { params });
    return response.data;
  },

  /**
   * Remove an ignored pair
   * @param {number} ignoreId - ID of ignored pair to remove
   * @returns {Promise<object>} Success message
   */
  removeIgnoredPair: async (ignoreId) => {
    const response = await api.delete(`/ignore/${ignoreId}`);
    return response.data;
  },

  /**
   * Check if a specific pair is ignored
   * @param {string} trackId1 - First track Spotify ID
   * @param {string} trackId2 - Second track Spotify ID
   * @param {string|null} playlistId - Optional playlist ID
   * @returns {Promise<{ignored: boolean}>}
   */
  checkIfIgnored: async (trackId1, trackId2, playlistId = null) => {
    const params = {
      track_id_1: trackId1,
      track_id_2: trackId2,
    };
    if (playlistId) params.playlist_id = playlistId;
    
    const response = await api.get('/ignore/check', { params });
    return response.data;
  },
};

/**
 * Cache API - Manage track metadata cache
 */
export const cacheAPI = {
  /**
   * Get cache statistics
   * @returns {Promise<object>} Cache stats object
   */
  getStats: async () => {
    const response = await api.get('/cache/stats');
    return response.data;
  },

  /**
   * Get playlist-specific cache statistics (efficient - uses playlist_cache_facts)
   * @param {string} playlistId - Spotify playlist ID
   * @returns {Promise<object>} Playlist cache stats
   */
  getPlaylistCacheStats: async (playlistId) => {
    const response = await api.get(`/cache/stats/playlist/${playlistId}`);
    return response.data;
  },

  /**
   * Get playlist-specific cache statistics (legacy - requires track IDs)
   * @param {string[]} trackIds - Array of track IDs from the playlist
   * @returns {Promise<object>} Playlist cache stats
   */
  getPlaylistStats: async (trackIds) => {
    const response = await api.post('/cache/stats/playlist', { track_ids: trackIds });
    return response.data;
  },

  /**
   * Clear expired cache entries
   * @returns {Promise<object>} Result with removed count
   */
  clearExpired: async () => {
    const response = await api.post('/cache/clear/expired');
    return response.data;
  },

  /**
   * Clear current user's cache
   * @returns {Promise<object>} Result with removed count
   */
  clearUserCache: async () => {
    const response = await api.post('/cache/clear/user');
    return response.data;
  },

  /**
   * Clear entire cache (all users)
   * @returns {Promise<object>} Result with removed count
   */
  clearAllCache: async () => {
    const response = await api.post('/cache/clear/all');
    return response.data;
  },

  /**
   * Warm playlist cache in background
   * @param {string[]} playlistIds
   * @returns {Promise<object>} Result with queued count
   */
  warmPlaylists: async (playlistIds) => {
    const response = await api.post('/cache/warm/playlists', { playlist_ids: playlistIds });
    return response.data;
  },

  /**
   * Get current cache warm status
   * @returns {Promise<object>} Status object
   */
  getWarmStatus: async () => {
    const response = await api.get('/cache/warm/status');
    return response.data;
  },

  /**
   * Get cached playlist facts for the given IDs
   * @param {string[]} playlistIds
   * @returns {Promise<object>} Facts and summary
   */
  getPlaylistFacts: async (playlistIds) => {
    const response = await api.post('/cache/playlist-facts', { playlist_ids: playlistIds });
    return response.data;
  },

  /**
   * Get cached playlists that include a track
   * @param {string} trackId
   * @returns {Promise<object>} Playlists list
   */
  getTrackPlaylists: async (trackId) => {
    const response = await api.get(`/cache/track/${trackId}/playlists`);
    return response.data;
  },
};

/**
 * Utility function to format total playlist duration
 * @param {number} ms - Total duration in milliseconds
 * @returns {string} Formatted duration (H:MM:SS or MM:SS)
 */
export const formatTotalDuration = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * Get the best quality image from Spotify image array
 * @param {Array} images - Array of image objects
 * @param {string} defaultImage - Default image URL if no images available
 * @returns {string} Image URL
 */
export const getBestImage = (images, defaultImage = null) => {
  if (!images || images.length === 0) {
    return defaultImage;
  }
  
  // Return the first image (usually highest quality)
  return images[0].url;
};

export default api;
