/**
 * Job Status Modal Component
 * 
 * Displays detailed progress and status of running/completed jobs.
 * Can be opened from the header indicator or playlist view.
 */

import React from 'react';

const JobStatusModal = ({ jobStatus, onClose, playlistName }) => {
  if (!jobStatus) return null;

  const progress = jobStatus.total > 0 ? Math.round((jobStatus.progress / jobStatus.total) * 100) : 0;
  const isActive = jobStatus.status === 'pending' || jobStatus.status === 'in_progress';
  const isComplete = jobStatus.status === 'completed';
  const isFailed = jobStatus.status === 'failed' || jobStatus.status === 'cancelled';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-spotify-gray-dark rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5 border border-spotify-gray-mid/60">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Job Status</p>
            <h3 className="text-2xl font-semibold text-white">
              {isComplete && 'Completed'}
              {isFailed && 'Failed'}
              {isActive && 'In Progress'}
            </h3>
            {playlistName && (
              <p className="text-sm text-spotify-gray-light mt-1">{playlistName}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center text-spotify-gray-light hover:text-white hover:bg-spotify-gray-mid/60 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Progress Bar */}
        {isActive && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-spotify-gray-light">Progress</span>
              <span className="text-white font-semibold">{progress}%</span>
            </div>
            <div className="w-full h-2 bg-spotify-gray-mid rounded-full overflow-hidden">
              <div 
                className="h-full bg-spotify-green transition-all duration-300 rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-spotify-gray-light">
              {jobStatus.progress} / {jobStatus.total} tracks processed
            </p>
          </div>
        )}

        {/* Job Details */}
        <div className="bg-spotify-gray-mid/30 rounded-lg p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-spotify-gray-light">Job ID:</span>
            <span className="text-white font-mono text-xs">{jobStatus.job_id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-spotify-gray-light">Status:</span>
            <span className={`font-semibold ${
              isComplete ? 'text-spotify-green' :
              isFailed ? 'text-red-400' :
              'text-yellow-400'
            }`}>
              {jobStatus.status.replace('_', ' ')}
            </span>
          </div>
          {jobStatus.sort_by && (
            <>
              <div className="flex justify-between">
                <span className="text-spotify-gray-light">Sort By:</span>
                <span className="text-white">{jobStatus.sort_by}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-spotify-gray-light">Direction:</span>
                <span className="text-white">{jobStatus.direction}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-spotify-gray-light">Method:</span>
                <span className="text-white">{jobStatus.method}</span>
              </div>
            </>
          )}
        </div>

        {/* Message */}
        {jobStatus.message && (
          <div className={`rounded-lg p-3 text-sm ${
            isComplete ? 'bg-spotify-green/10 text-spotify-green' :
            isFailed ? 'bg-red-400/10 text-red-400' :
            'bg-blue-400/10 text-blue-400'
          }`}>
            {jobStatus.message}
          </div>
        )}

        {/* Error */}
        {jobStatus.error && (
          <div className="bg-red-400/10 rounded-lg p-3 text-sm text-red-400">
            <strong>Error:</strong> {jobStatus.error}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-white font-semibold transition-colors"
          >
            {isActive ? 'Continue in background' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default JobStatusModal;
