/**
 * Job Status Indicator Component
 * 
 * Circular progress indicator shown in header when a job is running.
 * Displays progress percentage and opens detailed modal on click.
 */

import React from 'react';

const JobStatusIndicator = ({ jobStatus, onClick }) => {
  if (!jobStatus || jobStatus.status === 'completed' || jobStatus.status === 'failed' || jobStatus.status === 'cancelled') {
    return null;
  }

  const progress = jobStatus.total > 0 ? Math.round((jobStatus.progress / jobStatus.total) * 100) : 0;
  const circumference = 2 * Math.PI * 16; // radius = 16
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <button
      onClick={onClick}
      className="relative w-10 h-10 flex items-center justify-center rounded-full hover:bg-spotify-gray-mid/40 transition-colors group"
      title="Job in progress - click for details"
    >
      {/* Background circle */}
      <svg className="w-10 h-10 transform -rotate-90" viewBox="0 0 40 40">
        <circle
          cx="20"
          cy="20"
          r="16"
          fill="none"
          stroke="rgba(64, 64, 64, 0.5)"
          strokeWidth="3"
        />
        {/* Progress circle */}
        <circle
          cx="20"
          cy="20"
          r="16"
          fill="none"
          stroke="#1DB954"
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-300"
        />
      </svg>
      
      {/* Percentage text */}
      <span className="absolute text-xs font-semibold text-white group-hover:text-spotify-green transition-colors">
        {progress}%
      </span>

      {/* Pulse animation for in_progress status */}
      {jobStatus.status === 'in_progress' && (
        <span className="absolute inset-0 rounded-full bg-spotify-green/20 animate-ping"></span>
      )}
    </button>
  );
};

export default JobStatusIndicator;
