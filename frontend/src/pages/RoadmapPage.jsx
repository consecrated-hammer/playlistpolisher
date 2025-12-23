import React from 'react';

const RoadmapPage = () => {
  const sections = [
    {
      title: 'Core Operations',
      icon: 'widgets',
      items: [
        { name: 'Scheduled duplicate detection', desc: 'Automated dedupe on recurring schedule' },
        { name: 'Merge playlists', desc: 'Combine multiple playlists into one' },
        { name: 'Split playlists', desc: 'Divide playlist by criteria (genre, artist, year, duration)' },
        { name: 'Import playlists', desc: 'Bulk import from CSV, text file, or other sources' },
        { name: 'Undo operations', desc: 'Revert playlist to previous state (snapshot-based)' },
      ],
    },
    {
      title: 'Advanced Sorting Options',
      icon: 'sort',
      items: [
        { name: 'Sort by Popularity' },
        { name: 'Sort by Release Date' },
        { name: 'Sort by Artist', desc: 'album-aware grouping' },
        { name: 'Sort by Album Order', desc: 'track number' },
        { name: 'Sort by Recently Added First / Oldest Added First' },
        { name: 'Sort by Tempo (BPM)' },
        { name: 'Sort by Energy Level' },
        { name: 'Sort by Danceability' },
        { name: 'Sort by Valence', desc: 'mood/happiness' },
        { name: 'Sort by Key and Mode' },
      ],
    },
    {
      title: 'Multi-Select Operations',
      icon: 'checklist',
      intro: 'Select multiple tracks for batch actions:',
      items: [
        { name: 'Manual reordering of selection' },
        { name: 'Remove from playlist' },
        { name: 'Add to another playlist' },
        { name: 'Copy to new playlist' },
      ],
    },
    {
      title: 'Export & Sharing',
      icon: 'share',
      items: [
        { name: 'Export playlist as CSV/JSON' },
        { name: 'Share playlist snapshot as read-only link' },
        { name: 'Backup playlists to user\'s account/cloud storage' },
      ],
    },
    {
      title: 'Technical Improvements',
      icon: 'code',
      items: [
        { name: 'Add comprehensive test coverage', desc: 'frontend & backend' },
        { name: 'Implement rate limiting for Spotify API calls' },
        { name: 'Optimize large playlist handling', desc: 'pagination, virtualization' },
        { name: 'Implement retry logic for failed Spotify API calls' },
        { name: 'Add logging and monitoring', desc: 'error tracking, performance metrics' },
      ],
    },
    {
      title: 'Mobile',
      icon: 'smartphone',
      items: [
        { name: 'Mobile app', desc: 'React Native or PWA' },
      ],
    },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 animate-fade-in">
      {/* Header */}
      <div className="bg-gradient-to-br from-spotify-gray-dark via-spotify-gray-mid to-spotify-gray-dark border border-spotify-gray-mid/60 rounded-2xl p-8 shadow-2xl mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-spotify-green text-spotify-black flex items-center justify-center shadow-lg">
            <span className="icon text-2xl">map</span>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-spotify-green font-semibold">What's Coming</p>
            <h1 className="text-3xl font-bold text-white">Development Roadmap</h1>
          </div>
        </div>
        <p className="text-spotify-gray-light leading-relaxed">
          Planned features and improvements for Playlist Polisher. These are ideas under consideration—no timeline or guarantees, but feedback is welcome!
        </p>
      </div>

      {/* Sections Grid */}
      <div className="space-y-6">
        {sections.map((section) => (
          <div
            key={section.title}
            className="bg-spotify-gray-dark/70 border border-spotify-gray-mid rounded-2xl p-6 shadow-xl hover:border-spotify-gray-light/30 transition-colors"
          >
            {/* Section Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-spotify-gray-mid text-spotify-green flex items-center justify-center">
                <span className="icon text-xl">{section.icon}</span>
              </div>
              <h2 className="text-xl font-bold text-white">{section.title}</h2>
            </div>

            {/* Intro Text */}
            {section.intro && (
              <p className="text-spotify-gray-light mb-3 ml-13">{section.intro}</p>
            )}

            {/* Items List */}
            <ul className="space-y-2 ml-13">
              {section.items.map((item, idx) => (
                <li key={idx} className="flex items-start gap-3 text-white">
                  <span className="text-spotify-green mt-1">•</span>
                  <div>
                    <span className="font-medium">{item.name}</span>
                    {item.desc && (
                      <span className="text-spotify-gray-light"> - {item.desc}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Footer Note */}
      <div className="mt-8 bg-spotify-gray-mid/40 border border-spotify-gray-mid rounded-xl p-6">
        <div className="flex items-start gap-3">
          <span className="icon text-amber-300 text-xl">info</span>
          <div className="text-sm text-spotify-gray-light leading-relaxed">
            <p className="mb-2">
              <strong className="text-white">Note:</strong> This app is built on Spotify's development mode API, which is limited to 25 users.
            </p>
            <p>
              Feature priorities may change based on technical constraints, user feedback, and available development time. Have suggestions? Let us know!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoadmapPage;
