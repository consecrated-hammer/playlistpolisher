/**
 * Feature flag configuration for Playlist Polisher
 * 
 * These flags differentiate between official hosted instance
 * and community self-hosted deployments.
 */

/**
 * Show donation/support links
 * Enabled only for the official hosted instance
 * Self-hosted users should set VITE_SHOW_DONATION=false
 */
export const SHOW_DONATION = import.meta.env.VITE_SHOW_DONATION === 'true';

/**
 * Build time (for cache busting)
 */
export const BUILD_TIME = import.meta.env.VITE_BUILD_TIME || Date.now().toString();

/**
 * Build environment (production or development)
 */
export const BUILD_ENV = import.meta.env.VITE_BUILD_ENV || 'development';

/**
 * Check if this is a development build
 */
export const IS_DEV_BUILD = BUILD_ENV === 'development';

/**
 * Check if this is the official hosted instance
 */
export const IS_OFFICIAL_INSTANCE = SHOW_DONATION;

/**
 * Instance type label
 */
export const INSTANCE_TYPE = IS_OFFICIAL_INSTANCE ? 'Official' : 'Self-Hosted';

/**
 * Playlist pagination - page size for infinite scroll
 * Configurable via VITE_PLAYLIST_PAGE_SIZE (default: 100)
 */
export const PLAYLIST_PAGE_SIZE = parseInt(import.meta.env.VITE_PLAYLIST_PAGE_SIZE || '100', 10);

export default {
  SHOW_DONATION,
  BUILD_TIME,
  BUILD_ENV,
  IS_DEV_BUILD,
  IS_OFFICIAL_INSTANCE,
  INSTANCE_TYPE,
  PLAYLIST_PAGE_SIZE,
};
