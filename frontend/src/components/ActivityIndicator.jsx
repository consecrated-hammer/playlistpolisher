/**
 * Activity Indicator
 *
 * Small circular indicator used for background activity like caching/dedupe.
 */

import React from 'react';

const ActivityIndicator = ({ active, label, detail, icon = 'autorenew', tone = 'spotify-green', onClick }) => {
  if (!active) {
    return null;
  }

  const toneClass = tone === 'amber' ? 'border-amber-300 text-amber-300' : 'border-spotify-green text-spotify-green';
  const pulseClass = tone === 'amber' ? 'bg-amber-300/20' : 'bg-spotify-green/20';

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        className={`relative w-9 h-9 rounded-full border ${toneClass} flex items-center justify-center hover:bg-spotify-gray-mid/40 transition-colors`}
        aria-label={label}
      >
        <span className="icon text-base">{icon}</span>
        <span className={`absolute inset-0 rounded-full ${pulseClass} animate-ping`}></span>
      </button>
      <div className="tooltip group-hover:tooltip-visible">
        <div className="text-xs text-white font-semibold">{label}</div>
        {detail && <div className="text-[11px] text-spotify-gray-light">{detail}</div>}
      </div>
    </div>
  );
};

export default ActivityIndicator;
