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
  const textClass = tone === 'amber' ? 'text-amber-100' : 'text-white';
  const Container = onClick ? 'button' : 'div';
  const containerProps = onClick ? { type: 'button', onClick } : {};

  return (
    <Container
      {...containerProps}
      className={`flex items-center gap-2 rounded-full border ${toneClass} bg-spotify-gray-dark/70 px-3 py-1 shadow-sm transition-colors ${
        onClick ? 'hover:bg-spotify-gray-mid/60' : ''
      }`}
      aria-label={label}
    >
      <span className={`relative w-8 h-8 rounded-full border ${toneClass} flex items-center justify-center`}>
        <span className="icon text-base">{icon}</span>
        <span className={`absolute inset-0 rounded-full ${pulseClass} animate-ping`}></span>
      </span>
      <div className="flex flex-col items-start leading-tight">
        <span className="text-[10px] uppercase tracking-wide text-spotify-gray-light">{label}</span>
        <span className={`text-xs font-semibold ${textClass}`}>
          {detail || 'Working in the background'}
        </span>
      </div>
    </Container>
  );
};

export default ActivityIndicator;
