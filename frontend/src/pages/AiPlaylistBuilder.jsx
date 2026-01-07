import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { aiPlaylistAPI, formatDuration, getBestImage, playlistAPI } from '../services/api';

const PRIMARY_GENRES = [
  'Rock',
  'Pop',
  'Hip Hop',
  'R&B',
  'Electronic',
  'Dance',
  'Indie',
  'Alternative',
  'Country',
  'Latin',
  'Metal',
  'Punk',
  'Jazz',
  'Blues',
  'Folk',
  'Soul',
  'Funk',
  'Reggae',
  'Classical',
  'Soundtrack',
  'Ambient',
];

const SUGGESTED_PROMPTS = [
  '90s rock road trip',
  'indie chill for rainy nights',
  'sunset drive synthwave',
  'upbeat pop for workouts',
  'late-night jazz lounge',
];

const SIZE_OPTIONS = [25, 50, 75, 100, 150];

const buildDecadeOptions = () => {
  const currentYear = new Date().getFullYear();
  const currentDecade = Math.floor(currentYear / 10) * 10;
  const decades = [];
  for (let decade = currentDecade; decade >= 1950; decade -= 10) {
    const yearMax = Math.min(currentYear, decade + 9);
    const years = [];
    for (let year = yearMax; year >= decade; year -= 1) {
      years.push(year);
    }
    decades.push({ decade, years });
  }
  return decades;
};

const FilterChip = ({ label, onRemove }) => (
  <span className="inline-flex items-center gap-2 rounded-full border border-spotify-gray-mid/60 bg-spotify-gray-mid/60 text-white px-3 py-1 text-xs">
    {label}
    {onRemove && (
      <button
        type="button"
        onClick={onRemove}
        className="text-spotify-gray-light hover:text-white"
        aria-label={`Remove ${label}`}
      >
        <span className="icon text-sm">close</span>
      </button>
    )}
  </span>
);

const AiPlaylistBuilder = ({ user, onLogout }) => {
  const navigate = useNavigate();
  const decadeOptions = useMemo(() => buildDecadeOptions(), []);

  const [mode, setMode] = useState('describe');
  const [description, setDescription] = useState('');

  const [selectedDecades, setSelectedDecades] = useState([]);
  const [selectedYears, setSelectedYears] = useState([]);
  const [selectedGenres, setSelectedGenres] = useState([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [keywords, setKeywords] = useState([]);

  const [size, setSize] = useState(SIZE_OPTIONS[1]);
  const [openDecades, setOpenDecades] = useState({});

  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [previewSearch, setPreviewSearch] = useState('');

  const [selectedTrackIds, setSelectedTrackIds] = useState([]);
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);

  const [playlistName, setPlaylistName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState(null);
  const [createError, setCreateError] = useState(null);

  const hasBuildFilters = selectedDecades.length > 0
    || selectedYears.length > 0
    || selectedGenres.length > 0
    || keywords.length > 0;

  const canGenerate = mode === 'describe'
    ? description.trim().length > 0
    : hasBuildFilters;

  const previewTracks = useMemo(() => preview?.tracks || [], [preview]);
  const previewSearchValue = previewSearch.trim().toLowerCase();
  const filteredPreviewTracks = useMemo(() => {
    if (!previewSearchValue) {
      return previewTracks;
    }
    return previewTracks.filter((track) => {
      const name = (track.name || '').toLowerCase();
      const album = (track.album || '').toLowerCase();
      const artists = (track.artists || []).map((artist) => artist.name).join(', ').toLowerCase();
      return name.includes(previewSearchValue)
        || album.includes(previewSearchValue)
        || artists.includes(previewSearchValue);
    });
  }, [previewSearchValue, previewTracks]);

  const autoName = preview?.name || 'Auto: AI playlist';

  useEffect(() => {
    if (!nameTouched) {
      setPlaylistName(autoName);
    }
  }, [autoName, nameTouched]);

  useEffect(() => {
    const ids = previewTracks.map((track) => track.id).filter(Boolean);
    setSelectedTrackIds((prev) => {
      if (!selectionTouched) {
        return ids;
      }
      const prevSet = new Set(prev);
      return ids.filter((id) => prevSet.has(id));
    });
  }, [previewTracks, selectionTouched]);

  const handleToggleGenre = useCallback((genre) => {
    setSelectedGenres((prev) => {
      if (prev.includes(genre)) {
        return prev.filter((value) => value !== genre);
      }
      return [...prev, genre];
    });
  }, []);

  const handleToggleDecade = useCallback((decade) => {
    setSelectedDecades((prev) => {
      if (prev.includes(decade)) {
        return prev.filter((value) => value !== decade);
      }
      return [...prev, decade];
    });
  }, []);

  const handleToggleYear = useCallback((year) => {
    setSelectedYears((prev) => {
      if (prev.includes(year)) {
        return prev.filter((value) => value !== year);
      }
      return [...prev, year];
    });
  }, []);

  const handleAddKeyword = useCallback(() => {
    const term = keywordInput.trim();
    if (!term) return;
    setKeywords((prev) => (prev.includes(term) ? prev : [...prev, term]));
    setKeywordInput('');
  }, [keywordInput]);

  const handleRemoveKeyword = useCallback((term) => {
    setKeywords((prev) => prev.filter((value) => value !== term));
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setCreateMessage(null);
    setCreateError(null);
    setSelectionTouched(false);

    try {
      const payload = {
        mode,
        description: mode === 'describe' ? description.trim() : null,
        decades: selectedDecades,
        years: selectedYears,
        genres: selectedGenres,
        keywords,
        size,
      };
      const data = await aiPlaylistAPI.preview(payload);
      setPreview(data || null);
    } catch (err) {
      setPreviewError(err.message || 'Failed to generate AI playlist.');
    } finally {
      setPreviewLoading(false);
    }
  }, [canGenerate, description, keywords, mode, selectedDecades, selectedGenres, selectedYears, size]);

  const handleToggleTrack = useCallback((trackId) => {
    setSelectionTouched(true);
    setSelectedTrackIds((prev) => {
      if (prev.includes(trackId)) {
        return prev.filter((value) => value !== trackId);
      }
      return [...prev, trackId];
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectionTouched(true);
    setSelectedTrackIds(filteredPreviewTracks.map((track) => track.id));
  }, [filteredPreviewTracks]);

  const handleClearSelection = useCallback(() => {
    setSelectionTouched(true);
    setSelectedTrackIds([]);
  }, []);

  const selectedTrackUris = useMemo(() => {
    const selected = new Set(selectedTrackIds);
    return previewTracks
      .filter((track) => selected.has(track.id))
      .map((track) => track.track_uri || track.uri)
      .filter(Boolean);
  }, [previewTracks, selectedTrackIds]);

  const handleCreatePlaylist = useCallback(async () => {
    if (!playlistName.trim()) {
      setCreateError('Enter a playlist name.');
      return;
    }
    if (!selectedTrackUris.length) {
      setCreateError('Select at least one track.');
      return;
    }
    setCreating(true);
    setCreateMessage(null);
    setCreateError(null);
    try {
      const response = await playlistAPI.createPlaylist({
        name: playlistName.trim(),
        public: false,
        track_uris: selectedTrackUris,
      });
      setCreateMessage(response?.message || 'Playlist created.');
      if (response?.new_playlist_id) {
        navigate(`/playlist/${response.new_playlist_id}`);
      }
    } catch (err) {
      setCreateError(err.message || 'Failed to create playlist.');
    } finally {
      setCreating(false);
    }
  }, [navigate, playlistName, selectedTrackUris]);

  const handleClearBuildFilters = useCallback(() => {
    setSelectedDecades([]);
    setSelectedYears([]);
    setSelectedGenres([]);
    setKeywords([]);
    setKeywordInput('');
  }, []);

  const handleApplySuggestedPrompt = useCallback((prompt) => {
    setDescription((prev) => (prev ? `${prev}, ${prompt}` : prompt));
  }, []);

  return (
    <Layout user={user} onLogout={onLogout}>
      <div className="bg-gradient-to-b from-spotify-gray-dark to-spotify-black text-white min-h-screen">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-spotify-gray-light">AI playlists</p>
              <h2 className="text-2xl font-semibold text-white">Create AI playlist</h2>
              <p className="text-sm text-spotify-gray-light mt-2">
                Describe the vibe or build from categories to discover new tracks from Spotify.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/playlists')}
              className="px-4 py-2 rounded-lg border border-spotify-gray-light text-spotify-gray-light hover:text-white hover:border-white transition-colors"
            >
              <span className="icon text-base mr-1">arrow_back</span>
              Back to Playlists
            </button>
          </div>

          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:min-h-[calc(100vh-220px)]">
            <div className="space-y-6">
              <div className="bg-spotify-gray-dark/40 rounded-2xl border border-spotify-gray-mid/60 p-5 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMode('describe')}
                    className={`px-4 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                      mode === 'describe'
                        ? 'border-spotify-green bg-spotify-green text-black'
                        : 'border-spotify-gray-mid/60 text-spotify-gray-light hover:text-white hover:border-spotify-gray-light'
                    }`}
                  >
                    Describe
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('build')}
                    className={`px-4 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                      mode === 'build'
                        ? 'border-spotify-green bg-spotify-green text-black'
                        : 'border-spotify-gray-mid/60 text-spotify-gray-light hover:text-white hover:border-spotify-gray-light'
                    }`}
                  >
                    Build from categories
                  </button>
                </div>
                <p className="text-xs text-spotify-gray-light">
                  {mode === 'describe'
                    ? 'Tell the AI what you want and it will suggest tracks from Spotify.'
                    : 'Pick primary genres, release dates, and keywords to guide the AI.'}
                </p>
              </div>

              {mode === 'describe' ? (
                <div className="bg-spotify-gray-dark/40 rounded-2xl border border-spotify-gray-mid/60 p-5 space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-white">Describe your playlist</p>
                    <p className="text-xs text-spotify-gray-light">Use mood, era, or activity keywords.</p>
                  </div>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={4}
                    placeholder="E.g. 90s rock for late-night drives with a gritty edge"
                    className="w-full bg-spotify-gray-mid/60 text-white text-sm rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                  />
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTED_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => handleApplySuggestedPrompt(prompt)}
                        className="px-3 py-1.5 rounded-full border border-spotify-gray-mid/60 text-xs text-spotify-gray-light hover:text-white hover:border-spotify-gray-light transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-spotify-gray-dark/40 rounded-2xl border border-spotify-gray-mid/60 p-5 space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">Build your playlist</p>
                      <p className="text-xs text-spotify-gray-light">Select categories to guide the AI.</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearBuildFilters}
                      className="text-xs text-spotify-gray-light hover:text-white"
                    >
                      Clear all
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Release dates</p>
                    </div>
                    <div className="space-y-2">
                      {decadeOptions.map((decade) => {
                        const isOpen = Boolean(openDecades[decade.decade]);
                        return (
                          <div key={decade.decade} className="rounded-lg border border-spotify-gray-mid/60 bg-spotify-gray-mid/30">
                            <div className="flex items-center justify-between px-3 py-2">
                              <label className="flex items-center gap-2 text-sm text-white">
                                <input
                                  type="checkbox"
                                  checked={selectedDecades.includes(decade.decade)}
                                  onChange={() => handleToggleDecade(decade.decade)}
                                  className="accent-spotify-green"
                                />
                                {decade.decade}s
                              </label>
                              <button
                                type="button"
                                onClick={() => setOpenDecades((prev) => ({
                                  ...prev,
                                  [decade.decade]: !prev[decade.decade],
                                }))}
                                className="text-spotify-gray-light hover:text-white"
                                aria-label={isOpen ? 'Collapse years' : 'Expand years'}
                              >
                                <span className={`icon text-base transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                                  expand_more
                                </span>
                              </button>
                            </div>
                            {isOpen && (
                              <div className="px-4 pb-3">
                                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 pl-6">
                                  {decade.years.map((year) => (
                                    <label key={year} className="flex items-center gap-2 text-xs text-spotify-gray-light">
                                      <input
                                        type="checkbox"
                                        checked={selectedYears.includes(year)}
                                        onChange={() => handleToggleYear(year)}
                                        className="accent-spotify-green"
                                      />
                                      {year}
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {(selectedDecades.length > 0 || selectedYears.length > 0) && (
                      <div className="flex flex-wrap gap-2">
                        {selectedDecades.map((decade) => (
                          <FilterChip
                            key={`decade-${decade}`}
                            label={`${decade}s`}
                            onRemove={() => handleToggleDecade(decade)}
                          />
                        ))}
                        {selectedYears.map((year) => (
                          <FilterChip
                            key={`year-${year}`}
                            label={String(year)}
                            onRemove={() => handleToggleYear(year)}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Primary genres</p>
                    <div className="grid grid-cols-2 gap-2">
                      {PRIMARY_GENRES.map((genre) => (
                        <label
                          key={genre}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                            selectedGenres.includes(genre)
                              ? 'border-spotify-green bg-spotify-green/20 text-white'
                              : 'border-spotify-gray-mid/60 text-spotify-gray-light hover:border-spotify-gray-light'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedGenres.includes(genre)}
                            onChange={() => handleToggleGenre(genre)}
                            className="accent-spotify-green"
                          />
                          {genre}
                        </label>
                      ))}
                    </div>
                    {selectedGenres.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {selectedGenres.map((genre) => (
                          <FilterChip
                            key={genre}
                            label={genre}
                            onRemove={() => handleToggleGenre(genre)}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Keywords</p>
                    {keywords.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {keywords.map((term) => (
                          <FilterChip
                            key={term}
                            label={term}
                            onRemove={() => handleRemoveKeyword(term)}
                          />
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={keywordInput}
                        onChange={(event) => setKeywordInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            handleAddKeyword();
                          }
                        }}
                        placeholder="Add a keyword like romantic, grunge..."
                        className="flex-1 min-w-[180px] bg-spotify-gray-mid/60 text-white text-sm rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                      />
                      <button
                        type="button"
                        onClick={handleAddKeyword}
                        className="px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold transition-colors"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-spotify-gray-dark/40 rounded-2xl border border-spotify-gray-mid/60 p-5 space-y-4">
                <div>
                  <p className="text-sm font-semibold text-white">Playlist size</p>
                  <p className="text-xs text-spotify-gray-light">Pick how many suggestions to generate.</p>
                </div>
                <select
                  value={size}
                  onChange={(event) => setSize(Number(event.target.value))}
                  className="w-full bg-spotify-gray-mid/60 text-white text-sm rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                >
                  {SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option} tracks</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!canGenerate || previewLoading}
                  className="w-full px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {previewLoading ? 'Generating...' : 'Generate playlist'}
                </button>
                <p className="text-xs text-spotify-gray-light">
                  Uses Spotify catalog discovery. Results may include tracks not in your library.
                </p>
              </div>
            </div>

            <div className="bg-spotify-gray-dark/40 rounded-2xl border border-spotify-gray-mid/60 md:overflow-y-auto md:min-h-0 scrollbar-thin pb-6">
              <div className="sticky top-0 z-10 bg-spotify-gray-dark/95 backdrop-blur border-b border-spotify-gray-mid/60 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Preview results</p>
                    <p className="text-xs text-spotify-gray-light">
                      {preview?.matched ? `Matched ${preview.matched} of ${preview.requested}` : 'Generate to preview tracks.'}
                      {previewTracks.length ? ` · ${selectedTrackIds.length} selected` : ''}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-spotify-gray-light">
                    <input
                      type="checkbox"
                      checked={showMetadata}
                      onChange={(event) => setShowMetadata(event.target.checked)}
                      className="accent-spotify-green"
                    />
                    Show metadata
                  </label>
                </div>
                <div className="flex flex-wrap gap-3 items-center">
                  <div className="relative flex-1 min-w-[220px]">
                    <span className="icon text-base absolute left-3 top-1/2 -translate-y-1/2 text-spotify-gray-light">
                      search
                    </span>
                    <input
                      type="text"
                      value={previewSearch}
                      onChange={(event) => setPreviewSearch(event.target.value)}
                      placeholder="Search preview"
                      className="w-full bg-spotify-gray-mid/60 text-white text-sm rounded-lg px-9 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    disabled={!previewTracks.length}
                    className="px-3 py-2 rounded-lg border border-spotify-gray-mid/60 text-xs text-spotify-gray-light hover:text-white hover:border-spotify-gray-light transition-colors disabled:opacity-50"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    disabled={!previewTracks.length}
                    className="px-3 py-2 rounded-lg border border-spotify-gray-mid/60 text-xs text-spotify-gray-light hover:text-white hover:border-spotify-gray-light transition-colors disabled:opacity-50"
                  >
                    Clear
                  </button>
                </div>

                <div className="bg-spotify-gray-mid/30 rounded-lg border border-spotify-gray-mid/60 p-4 space-y-3">
                  <label className="text-xs text-spotify-gray-light flex flex-col gap-2">
                    Playlist name
                    <input
                      type="text"
                      value={playlistName}
                      onChange={(event) => {
                        setPlaylistName(event.target.value);
                        setNameTouched(true);
                      }}
                      className="w-full bg-spotify-gray-mid text-white rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPlaylistName(autoName);
                        setNameTouched(false);
                      }}
                      className="px-3 py-1.5 text-xs rounded-full border border-spotify-gray-mid/60 text-spotify-gray-light hover:text-white hover:border-spotify-gray-light transition-colors"
                    >
                      Use AI name
                    </button>
                    <button
                      type="button"
                      onClick={handleCreatePlaylist}
                      disabled={creating || !playlistName.trim() || selectedTrackUris.length === 0}
                      className="px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {creating ? 'Creating...' : 'Create playlist'}
                    </button>
                  </div>
                  {createMessage && <p className="text-xs text-spotify-green">{createMessage}</p>}
                  {createError && <p className="text-xs text-red-400">{createError}</p>}
                </div>

                {preview?.unmatched?.length ? (
                  <div className="rounded-lg border border-amber-700/40 bg-amber-900/20 p-3 text-xs text-amber-300">
                    {preview.unmatched.length} suggestion{preview.unmatched.length > 1 ? 's' : ''} could not be matched on Spotify.
                  </div>
                ) : null}
              </div>

              {previewError && <div className="px-4 pt-4"><ErrorMessage message={previewError} /></div>}

              <div className="px-4 pb-6 pt-4">
                <div className="border border-spotify-gray-mid/60 rounded-xl overflow-hidden">
                  <div className="hidden md:grid grid-cols-[40px_minmax(0,1fr)_80px] gap-3 px-4 py-3 text-xs uppercase tracking-wide text-spotify-gray-light bg-spotify-gray-mid/40">
                    <span />
                    <span>Track</span>
                    <span className="text-right">Time</span>
                  </div>
                  {previewLoading && previewTracks.length === 0 ? (
                    <div className="py-8 flex justify-center">
                      <LoadingSpinner />
                    </div>
                  ) : filteredPreviewTracks.length ? (
                    <div className="divide-y divide-spotify-gray-mid/60">
                      {filteredPreviewTracks.map((track) => {
                        const isSelected = selectedTrackIds.includes(track.id);
                        const artistsLabel = (track.artists || []).map((artist) => artist.name).join(', ');
                        const durationLabel = track.duration_ms ? formatDuration(track.duration_ms) : '--:--';
                        const subtitle = [artistsLabel, track.album, durationLabel].filter(Boolean).join(' · ');
                        return (
                          <div key={track.id} className="px-4 py-3 hover:bg-spotify-gray-mid/30">
                            <div className="flex items-start gap-3 md:grid md:grid-cols-[40px_minmax(0,1fr)_80px] md:items-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleTrack(track.id)}
                                className="accent-spotify-green mt-1 md:mt-0"
                              />
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 rounded bg-spotify-gray-mid/60 overflow-hidden flex items-center justify-center text-xs text-spotify-gray-light">
                                  {track.album_art_url ? (
                                    <img
                                      src={getBestImage([{ url: track.album_art_url }])}
                                      alt={track.name}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <span className="icon text-base">music_note</span>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-sm text-white truncate">{track.name}</div>
                                  <div className="text-xs text-spotify-gray-light truncate">
                                    {subtitle || '—'}
                                  </div>
                                </div>
                              </div>
                              <div className="hidden md:block text-xs text-spotify-gray-light text-right">
                                {durationLabel}
                              </div>
                            </div>
                            {showMetadata && (
                              <div className="mt-2 text-xs text-spotify-gray-light space-y-2">
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <div className="sm:col-span-2">
                                    <span className="text-spotify-gray-light">Artists:</span>{' '}
                                    <span className="text-white">
                                      {artistsLabel || 'Unknown'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-spotify-gray-light">Album:</span>{' '}
                                    <span className="text-white">{track.album || 'Unknown'}</span>
                                  </div>
                                  <div>
                                    <span className="text-spotify-gray-light">Release:</span>{' '}
                                    <span className="text-white">
                                      {track.album_release_date || 'Unknown'}
                                    </span>
                                    {track.album_release_date_precision && (
                                      <span className="text-spotify-gray-light">
                                        {' '}({track.album_release_date_precision})
                                      </span>
                                    )}
                                  </div>
                                  <div>
                                    <span className="text-spotify-gray-light">Popularity:</span>{' '}
                                    <span className="text-white">
                                      {track.popularity ?? '—'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-spotify-gray-light">Explicit:</span>{' '}
                                    <span className="text-white">{track.explicit ? 'Yes' : 'No'}</span>
                                  </div>
                                  <div>
                                    <span className="text-spotify-gray-light">Album type:</span>{' '}
                                    <span className="text-white">{track.album_type || '—'}</span>
                                  </div>
                                  <div>
                                    <span className="text-spotify-gray-light">Label:</span>{' '}
                                    <span className="text-white">{track.album_label || '—'}</span>
                                  </div>
                                  <div>
                                    <span className="text-spotify-gray-light">Track / Disc:</span>{' '}
                                    <span className="text-white">
                                      {track.track_number ?? '—'} / {track.disc_number ?? '—'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-spotify-gray-light">ISRC:</span>{' '}
                                    <span
                                      className="text-white font-mono truncate inline-block max-w-[180px]"
                                      title={track.isrc || ''}
                                    >
                                      {track.isrc || '—'}
                                    </span>
                                  </div>
                                </div>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <div>
                                    <span className="text-spotify-gray-light">Track ID:</span>{' '}
                                    <span className="text-white font-mono truncate inline-block max-w-[200px]" title={track.id}>
                                      {track.id}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-spotify-gray-light">Track URI:</span>{' '}
                                    <span className="text-white font-mono truncate inline-block max-w-[200px]" title={track.track_uri || ''}>
                                      {track.track_uri || '—'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-spotify-gray-light">Album ID:</span>{' '}
                                    <span className="text-white font-mono truncate inline-block max-w-[200px]" title={track.album_id || ''}>
                                      {track.album_id || '—'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-spotify-gray-light">Album URI:</span>{' '}
                                    <span className="text-white font-mono truncate inline-block max-w-[200px]" title={track.album_uri || ''}>
                                      {track.album_uri || '—'}
                                    </span>
                                  </div>
                                </div>
                                <div>
                                  <span className="text-spotify-gray-light">Markets:</span>{' '}
                                  <span className="text-white">
                                    {(track.available_markets || []).length
                                      ? `${track.available_markets.slice(0, 8).join(', ')}${track.available_markets.length > 8 ? ` +${track.available_markets.length - 8} more` : ''}`
                                      : '—'}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-10 text-center text-sm text-spotify-gray-light">
                      {previewLoading ? 'Generating suggestions...' : 'No tracks yet. Generate to see results.'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default AiPlaylistBuilder;
