/**
 * useInfiniteScroll Hook
 * 
 * Custom React hook for implementing infinite scroll pagination.
 * Detects when user scrolls near the bottom of a container and triggers
 * loading of the next page of data.
 * 
 * @param {Function} loadMore - Callback to load next page of data
 * @param {boolean} hasMore - Whether there are more items to load
 * @param {boolean} loading - Whether currently loading
 * @param {number} threshold - Distance from bottom to trigger load (0-1 for percentage, >1 for pixels, default: 0.2 = 20% from bottom)
 * @returns {Object} - { loading, hasMore }
 */

import { useEffect, useRef, useCallback } from 'react';

export const useInfiniteScroll = (loadMore, hasMore, loading, threshold = 0.2) => {
  const loadingRef = useRef(loading);
  const hasMoreRef = useRef(hasMore);

  // Keep refs in sync
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  const handleScroll = useCallback(() => {
    // Use window scroll for page-level infinite scroll
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = window.innerHeight;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    // Support both percentage (0-1) and pixel (>1) thresholds
    const triggerDistance = threshold <= 1 
      ? scrollHeight * threshold  // Percentage-based (e.g., 0.2 = 20% from bottom)
      : threshold;                 // Pixel-based (e.g., 500 = 500px from bottom)

    // Debug logging (can be removed in production)
    if (distanceFromBottom < triggerDistance + 100) {
      console.log('[Infinite Scroll] Near bottom:', {
        distanceFromBottom,
        triggerDistance,
        threshold,
        hasMore: hasMoreRef.current,
        loading: loadingRef.current,
        willTrigger: distanceFromBottom < triggerDistance && hasMoreRef.current && !loadingRef.current
      });
    }

    // If we're within threshold distance of the bottom and not already loading
    if (distanceFromBottom < triggerDistance && hasMoreRef.current && !loadingRef.current) {
      console.log('[Infinite Scroll] Triggering loadMore');
      loadMore();
    }
  }, [loadMore, threshold]);

  useEffect(() => {
    // Attach scroll listener to window
    window.addEventListener('scroll', handleScroll);

    // Also check on mount in case content doesn't fill the viewport
    handleScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll]);

  return { loading, hasMore };
};

export default useInfiniteScroll;
