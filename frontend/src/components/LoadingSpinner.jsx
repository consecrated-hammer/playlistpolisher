/**
 * Loading Spinner Component
 * 
 * Animated loading indicator for async operations.
 * 
 * Props:
 *   - text: Optional loading text to display
 *   - size: Size variant ('sm', 'md', 'lg')
 */

import React from 'react';

const LoadingSpinner = ({ text = 'Loading...', size = 'md' }) => {
  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-12 h-12',
    lg: 'w-16 h-16'
  };

  return (
    <div className="flex flex-col items-center justify-center p-8">
      <div className={`${sizeClasses[size]} border-4 border-spotify-gray-mid border-t-spotify-green rounded-full animate-spin`}></div>
      {text && <p className="mt-4 text-spotify-gray-light">{text}</p>}
    </div>
  );
};

export default LoadingSpinner;
