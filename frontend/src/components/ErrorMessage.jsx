/**
 * Error Message Component
 * 
 * Displays error messages with retry functionality.
 * 
 * Props:
 *   - message: Error message to display
 *   - onRetry: Optional retry callback function
 */

import React from 'react';

const ErrorMessage = ({ message, onRetry }) => {
  return (
    <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-6 text-center animate-fade-in">
      <svg className="w-12 h-12 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <h3 className="text-lg font-semibold text-red-400 mb-2">Oops! Something went wrong</h3>
      <p className="text-spotify-gray-light mb-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-6 py-2 bg-spotify-green hover:bg-spotify-green-dark text-white rounded-full font-medium transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
};

export default ErrorMessage;
