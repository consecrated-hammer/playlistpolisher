import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { cacheAPI, formatDuration, getBestImage, playlistAPI, smartPlaylistAPI } from '../services/api';

const SmartPlaylistBuilder = ({ user, onLogout }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sourceFromParam = searchParams.get('source_playlist_id');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [playlistFacts, setPlaylistFacts] = useState({});
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourceIds, setSourceIds] = useState([]);
  const [initializedSources, setInitializedSources] = useState(false);

  const [facets, setFacets] = useState(null);
  const [facetsLoading, setFacetsLoading] = useState(false);
  const [facetsError, setFacetsError] = useState(null);

  const [matchMode, setMatchMode] = useState('any');
  const [selectedGenres, setSelectedGenres] = useState([]);
  const [selectedDecades, setSelectedDecades] = useState([]);
  const [selectedYears, setSelectedYears] = useState([]);
  const [selectedArtists, setSelectedArtists] = useState([]);
  const [titleFilters, setTitleFilters] = useState([]);
  const [titleInput, setTitleInput] = useState('');
  const [genreSearch, setGenreSearch] = useState('');
  const [artistSearch, setArtistSearch] = useState('');

  const [preview, setPreview] = useState({ tracks: [], total_matches: 0 });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [selectedTrackIds, setSelectedTrackIds] = useState([]);
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);

  const [playlistName, setPlaylistName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState(null);
  const [createError, setCreateError] = useState(null);

  useEffect(() => {
    const loadSources = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await playlistAPI.getPlaylists();
        const playlistIds = (data || []).map((playlist) => playlist.id).filter(Boolean);
        const factsResponse = playlistIds.length > 0
          ? await cacheAPI.getPlaylistFacts(playlistIds)
          : { facts: [] };
        const factMap = (factsResponse?.facts || []).reduce((acc, fact) => {
          acc[fact.playlist_id] = fact;
          return acc;
        }, {});
        setPlaylists(data || []);
        setPlaylistFacts(factMap);
      } catch (err) {
        setError(err.message || 'Failed to load playlists');
      } finally {
        setLoading(false);
      }
    };

    loadSources();
  }, []);

  useEffect(() => {
    if (initializedSources || !playlists.length) {
      return;
    }
    const cachedIds = playlists
      .filter((playlist) => playlistFacts[playlist.id]?.last_snapshot_id)
      .map((playlist) => playlist.id);

    if (sourceFromParam && playlists.some((playlist) => playlist.id === sourceFromParam)) {
      setSourceIds([sourceFromParam]);
    } else if (cachedIds.length > 0) {
      setSourceIds(cachedIds);
    } else {
      setSourceIds(playlists.map((playlist) => playlist.id));
    }
    setInitializedSources(true);
  }, [initializedSources, playlists, playlistFacts, sourceFromParam]);

  const filteredSources = useMemo(() => {
    const query = sourceSearch.trim().toLowerCase();
    if (!query) {
      return playlists;
    }
    return playlists.filter((playlist) => {
      const name = playlist.name?.toLowerCase() || '';
      const owner = playlist.owner?.display_name?.toLowerCase() || playlist.owner?.id?.toLowerCase() || '';
      return name.includes(query) || owner.includes(query);
    });
  }, [playlists, sourceSearch]);

  const sourceIdSet = useMemo(() => new Set(sourceIds), [sourceIds]);

  const uncachedSources = useMemo(() => {
    return sourceIds.filter((playlistId) => !playlistFacts[playlistId]?.last_snapshot_id);
  }, [sourceIds, playlistFacts]);

  const handleToggleSource = (playlistId) => {
    setSourceIds((prev) => {
      if (prev.includes(playlistId)) {
        return prev.filter((id) => id !== playlistId);
      }
      return [...prev, playlistId];
    });
  };

  const selectAllCached = () => {
    const cachedIds = playlists
      .filter((playlist) => playlistFacts[playlist.id]?.last_snapshot_id)
      .map((playlist) => playlist.id);
    setSourceIds(cachedIds);
  };

  const selectAllSources = () => {
    setSourceIds(playlists.map((playlist) => playlist.id));
  };

  const clearSources = () => {
    setSourceIds([]);
  };

  useEffect(() => {
    if (!sourceIds.length) {
      setFacets(null);
      return;
    }
    const fetchFacets = async () => {
      setFacetsLoading(true);
      setFacetsError(null);
      try {
        const data = await smartPlaylistAPI.getFacets(sourceIds);
        setFacets(data);
      } catch (err) {
        setFacetsError(err.message || 'Failed to load tags');
      } finally {
        setFacetsLoading(false);
      }
    };
    fetchFacets();
  }, [sourceIds]);

  useEffect(() => {
    if (!sourceIds.length) {
      setPreview({ tracks: [], total_matches: 0 });
      return;
    }

    const payload = {
      playlist_ids: sourceIds,
      match_mode: matchMode,
      genres: selectedGenres,
      decades: selectedDecades,
      years: selectedYears,
      artist_ids: selectedArtists,
      title_contains: titleFilters,
      limit: 250,
      offset: 0,
    };

    const handle = setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const data = await smartPlaylistAPI.getPreview(payload);
        setPreview(data || { tracks: [], total_matches: 0 });
      } catch (err) {
        setPreviewError(err.message || 'Failed to build preview');
      } finally {
        setPreviewLoading(false);
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [
    matchMode,
    selectedGenres,
    selectedDecades,
    selectedYears,
    selectedArtists,
    sourceIds,
    titleFilters,
  ]);

  useEffect(() => {
    const trackIds = (preview?.tracks || []).map((track) => track.id);
    if (!trackIds.length) {
      setSelectedTrackIds([]);
      setSelectionTouched(false);
      return;
    }
    setSelectedTrackIds((prev) => {
      if (!selectionTouched) {
        return trackIds;
      }
      const prevSet = new Set(prev);
      return trackIds.filter((id) => prevSet.has(id));
    });
  }, [preview, selectionTouched]);

  const handleToggleTrack = (trackId) => {
    setSelectionTouched(true);
    setSelectedTrackIds((prev) => {
      if (prev.includes(trackId)) {
        return prev.filter((id) => id !== trackId);
      }
      return [...prev, trackId];
    });
  };

  const handleSelectAllTracks = () => {
    setSelectionTouched(true);
    setSelectedTrackIds((preview?.tracks || []).map((track) => track.id));
  };

  const handleClearTracks = () => {
    setSelectionTouched(true);
    setSelectedTrackIds([]);
  };

  const genreGroups = useMemo(() => {
    if (!facets?.genre_groups?.length) {
      return [];
    }
    if (!genreSearch.trim()) {
      return facets.genre_groups;
    }
    const query = genreSearch.trim().toLowerCase();
    return facets.genre_groups
      .map((group) => {
        const tags = (group.tags || []).filter((tag) => tag.name.toLowerCase().includes(query));
        if (!tags.length) return null;
        return { ...group, tags };
      })
      .filter(Boolean);
  }, [facets, genreSearch]);

  const artistOptions = useMemo(() => {
    const list = facets?.artists || [];
    if (!artistSearch.trim()) {
      return list;
    }
    const query = artistSearch.trim().toLowerCase();
    return list.filter((artist) => (artist.name || '').toLowerCase().includes(query));
  }, [facets, artistSearch]);

  const artistNameMap = useMemo(() => {
    const map = {};
    (facets?.artists || []).forEach((artist) => {
      map[artist.id] = artist.name;
    });
    return map;
  }, [facets]);

  const autoName = useMemo(() => {
    const tags = [];
    selectedDecades.forEach((decade) => tags.push(`${decade}s`));
    selectedYears.forEach((year) => tags.push(String(year)));
    selectedGenres.forEach((genre) => tags.push(genre));
    selectedArtists.forEach((artistId) => {
      const name = artistNameMap[artistId];
      if (name) tags.push(name);
    });
    titleFilters.forEach((term) => tags.push(term));
    if (!tags.length) {
      return 'Auto: Smart playlist';
    }
    return `Auto: ${tags.join(', ')}`;
  }, [artistNameMap, selectedDecades, selectedGenres, selectedArtists, selectedYears, titleFilters]);

  useEffect(() => {
    if (!nameTouched) {
      setPlaylistName(autoName);
    }
  }, [autoName, nameTouched]);

  const handleAddTitleFilter = () => {
    const value = titleInput.trim();
    if (!value) return;
    const exists = titleFilters.some((term) => term.toLowerCase() === value.toLowerCase());
    if (exists) {
      setTitleInput('');
      return;
    }
    setTitleFilters((prev) => [...prev, value]);
    setTitleInput('');
  };

  const handleRemoveTitleFilter = (term) => {
    setTitleFilters((prev) => prev.filter((item) => item !== term));
  };

  const toggleGenre = (genreName) => {
    setSelectedGenres((prev) => {
      if (prev.includes(genreName)) {
        return prev.filter((name) => name !== genreName);
      }
      return [...prev, genreName];
    });
  };

  const toggleDecade = (decade) => {
    setSelectedDecades((prev) => {
      if (prev.includes(decade)) {
        return prev.filter((value) => value !== decade);
      }
      return [...prev, decade];
    });
  };

  const toggleYear = (year) => {
    setSelectedYears((prev) => {
      if (prev.includes(year)) {
        return prev.filter((value) => value !== year);
      }
      return [...prev, year];
    });
  };

  const toggleArtist = (artistId) => {
    setSelectedArtists((prev) => {
      if (prev.includes(artistId)) {
        return prev.filter((value) => value !== artistId);
      }
      return [...prev, artistId];
    });
  };

  const selectedTrackUris = useMemo(() => {
    const selected = new Set(selectedTrackIds);
    return (preview?.tracks || [])
      .filter((track) => selected.has(track.id))
      .map((track) => track.track_uri)
      .filter(Boolean);
  }, [preview, selectedTrackIds]);

  const handleCreatePlaylist = async () => {
    if (!playlistName.trim() || !selectedTrackUris.length) {
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
        navigate(`/playlists/${response.new_playlist_id}`);
      }
    } catch (err) {
      setCreateError(err.message || 'Failed to create playlist');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Layout user={user} onLogout={onLogout}>
      <div className="bg-gradient-to-b from-spotify-gray-dark to-spotify-black text-white min-h-screen">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Smart playlists</p>
              <h2 className="text-2xl font-semibold">Create smart playlist</h2>
              <p className="text-sm text-spotify-gray-light mt-1">
                Build a cached playlist using tags, metadata, and custom rules.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/playlists')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-spotify-gray-light bg-spotify-gray-dark/60 hover:bg-spotify-gray-mid/60 text-white transition-colors"
            >
              <span className="icon text-base">arrow_back</span>
              Back to Playlists
            </button>
          </div>

          {loading ? (
            <LoadingSpinner text="Loading playlists..." />
          ) : (
            <>
              {error && <ErrorMessage message={error} />}

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <div className="bg-spotify-gray-dark/40 rounded-2xl border border-spotify-gray-mid/60 p-6 space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">Source playlists</p>
                        <p className="text-xs text-spotify-gray-light">
                          Choose cached playlists to pull tracks from.
                        </p>
                      </div>
                      <span className="text-xs text-spotify-gray-light">
                        {sourceIds.length} selected
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={selectAllCached}
                        className="px-3 py-1.5 text-xs rounded-full border border-spotify-gray-mid/60 text-spotify-gray-light hover:text-white hover:border-spotify-gray-light transition-colors"
                      >
                        Select cached
                      </button>
                      <button
                        type="button"
                        onClick={selectAllSources}
                        className="px-3 py-1.5 text-xs rounded-full border border-spotify-gray-mid/60 text-spotify-gray-light hover:text-white hover:border-spotify-gray-light transition-colors"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={clearSources}
                        className="px-3 py-1.5 text-xs rounded-full border border-spotify-gray-mid/60 text-spotify-gray-light hover:text-white hover:border-spotify-gray-light transition-colors"
                      >
                        Clear
                      </button>
                    </div>

                    <input
                      type="text"
                      value={sourceSearch}
                      onChange={(event) => setSourceSearch(event.target.value)}
                      placeholder="Search playlists"
                      className="w-full bg-spotify-gray-mid/60 text-white text-sm rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                    />

                    <div className="max-h-56 overflow-y-auto divide-y divide-spotify-gray-mid/60 border border-spotify-gray-mid/60 rounded-lg">
                      {filteredSources.length === 0 ? (
                        <div className="p-4 text-sm text-spotify-gray-light">No playlists match your search.</div>
                      ) : (
                        filteredSources.map((playlist) => {
                          const ownerName = playlist.owner?.display_name || playlist.owner?.id || 'Unknown';
                          const cached = Boolean(playlistFacts[playlist.id]?.last_snapshot_id);
                          const isSelected = sourceIdSet.has(playlist.id);
                          return (
                            <label
                              key={playlist.id}
                              className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-spotify-gray-light hover:bg-spotify-gray-mid/40 cursor-pointer"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => handleToggleSource(playlist.id)}
                                  className="accent-spotify-green"
                                />
                                <div className="min-w-0">
                                  <div className="text-white font-medium truncate">{playlist.name}</div>
                                  <div className="text-xs text-spotify-gray-light truncate">
                                    {ownerName}
                                  </div>
                                </div>
                              </div>
                              <span
                                className={`text-[11px] px-2 py-1 rounded-full border ${
                                  cached
                                    ? 'border-spotify-green/40 text-spotify-green'
                                    : 'border-spotify-gray-mid/60 text-spotify-gray-light'
                                }`}
                              >
                                {cached ? 'Cached' : 'Not cached'}
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>

                    {uncachedSources.length > 0 && (
                      <div className="rounded-lg border border-amber-700/40 bg-amber-900/20 p-3 text-xs text-amber-300">
                        {uncachedSources.length} selected playlists are not cached yet. Refresh the cache to include them.
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Match logic</p>
                      <p className="text-xs text-spotify-gray-light">
                        Control whether tracks must match all tags or any tag.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setMatchMode('any')}
                        className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                          matchMode === 'any'
                            ? 'border-spotify-green bg-spotify-green text-black'
                            : 'border-spotify-gray-mid/60 text-spotify-gray-light hover:text-white hover:border-spotify-gray-light'
                        }`}
                      >
                        Match any
                      </button>
                      <button
                        type="button"
                        onClick={() => setMatchMode('all')}
                        className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                          matchMode === 'all'
                            ? 'border-spotify-green bg-spotify-green text-black'
                            : 'border-spotify-gray-mid/60 text-spotify-gray-light hover:text-white hover:border-spotify-gray-light'
                        }`}
                      >
                        Match all
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">Genres</p>
                        <p className="text-xs text-spotify-gray-light">
                          Auto-grouped by genre families with counts.
                        </p>
                      </div>
                      <span className="text-xs text-spotify-gray-light">{selectedGenres.length} selected</span>
                    </div>

                    <input
                      type="text"
                      value={genreSearch}
                      onChange={(event) => setGenreSearch(event.target.value)}
                      placeholder="Search genres"
                      className="w-full bg-spotify-gray-mid/60 text-white text-sm rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                    />

                    {facetsLoading && (
                      <div className="text-xs text-spotify-gray-light">Loading genre tags...</div>
                    )}
                    {facetsError && (
                      <div className="text-xs text-red-400">{facetsError}</div>
                    )}
                    {!facetsLoading && genreGroups.length === 0 && (
                      <div className="text-xs text-spotify-gray-light">No genre tags available yet.</div>
                    )}

                    <div className="space-y-2">
                      {genreGroups.map((group) => (
                        <details
                          key={group.group}
                          className="rounded-lg border border-spotify-gray-mid/60 bg-spotify-gray-mid/30 px-3 py-2"
                        >
                          <summary className="cursor-pointer text-sm text-white flex items-center justify-between">
                            <span>{group.group}</span>
                            <span className="text-xs text-spotify-gray-light">{group.count}</span>
                          </summary>
                          <div className="mt-2 space-y-2">
                            {group.tags.map((tag) => {
                              const checked = selectedGenres.includes(tag.name);
                              return (
                                <label
                                  key={tag.name}
                                  className="flex items-center justify-between text-sm text-spotify-gray-light"
                                >
                                  <span className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleGenre(tag.name)}
                                      className="accent-spotify-green"
                                    />
                                    <span>{tag.name}</span>
                                  </span>
                                  <span className="text-xs text-spotify-gray-light">{tag.count}</span>
                                </label>
                              );
                            })}
                          </div>
                        </details>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">Release dates</p>
                        <p className="text-xs text-spotify-gray-light">
                          Pick decades or drill down to specific years.
                        </p>
                      </div>
                      <span className="text-xs text-spotify-gray-light">
                        {selectedDecades.length + selectedYears.length} selected
                      </span>
                    </div>

                    {facets?.decades?.length ? (
                      <div className="space-y-2">
                        {facets.decades.map((decade) => (
                          <details
                            key={decade.decade}
                            className="rounded-lg border border-spotify-gray-mid/60 bg-spotify-gray-mid/30 px-3 py-2"
                          >
                            <summary className="cursor-pointer text-sm text-white flex items-center justify-between">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={selectedDecades.includes(decade.decade)}
                                  onChange={() => toggleDecade(decade.decade)}
                                  className="accent-spotify-green"
                                />
                                <span>{decade.label}</span>
                              </label>
                              <span className="text-xs text-spotify-gray-light">{decade.count}</span>
                            </summary>
                            <div className="mt-2 space-y-2">
                              {decade.years.map((year) => (
                                <label
                                  key={year.year}
                                  className="flex items-center justify-between text-sm text-spotify-gray-light"
                                >
                                  <span className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={selectedYears.includes(year.year)}
                                      onChange={() => toggleYear(year.year)}
                                      className="accent-spotify-green"
                                    />
                                    <span>{year.year}</span>
                                  </span>
                                  <span className="text-xs text-spotify-gray-light">{year.count}</span>
                                </label>
                              ))}
                            </div>
                          </details>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-spotify-gray-light">No release date tags available yet.</div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">Artists</p>
                        <p className="text-xs text-spotify-gray-light">
                          Filter by artist names from cached tracks.
                        </p>
                      </div>
                      <span className="text-xs text-spotify-gray-light">{selectedArtists.length} selected</span>
                    </div>

                    <input
                      type="text"
                      value={artistSearch}
                      onChange={(event) => setArtistSearch(event.target.value)}
                      placeholder="Search artists"
                      className="w-full bg-spotify-gray-mid/60 text-white text-sm rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                    />

                    <div className="max-h-48 overflow-y-auto divide-y divide-spotify-gray-mid/60 border border-spotify-gray-mid/60 rounded-lg">
                      {(artistOptions || []).length === 0 ? (
                        <div className="p-4 text-sm text-spotify-gray-light">No artists match your search.</div>
                      ) : (
                        artistOptions.slice(0, 200).map((artist) => (
                          <label
                            key={artist.id}
                            className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-spotify-gray-light hover:bg-spotify-gray-mid/40 cursor-pointer"
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={selectedArtists.includes(artist.id)}
                                onChange={() => toggleArtist(artist.id)}
                                className="accent-spotify-green"
                              />
                              <span className="truncate">{artist.name}</span>
                            </span>
                            <span className="text-xs text-spotify-gray-light">{artist.count}</span>
                          </label>
                        ))
                      )}
                    </div>
                    {(artistOptions || []).length > 200 && (
                      <p className="text-xs text-spotify-gray-light">Showing top 200 matches.</p>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Custom tag</p>
                      <p className="text-xs text-spotify-gray-light">
                        Add title keywords to include tracks that match the phrase.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={titleInput}
                        onChange={(event) => setTitleInput(event.target.value)}
                        placeholder="Title contains..."
                        className="flex-1 min-w-[160px] bg-spotify-gray-mid/60 text-white text-sm rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                      />
                      <button
                        type="button"
                        onClick={handleAddTitleFilter}
                        className="px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold transition-colors"
                      >
                        Add
                      </button>
                    </div>
                    {titleFilters.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {titleFilters.map((term) => (
                          <span
                            key={term}
                            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-spotify-gray-mid/60 text-xs text-white border border-spotify-gray-mid/60"
                          >
                            {term}
                            <button
                              type="button"
                              onClick={() => handleRemoveTitleFilter(term)}
                              className="text-spotify-gray-light hover:text-white"
                            >
                              <span className="icon text-sm">close</span>
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-spotify-gray-dark/40 rounded-2xl border border-spotify-gray-mid/60 p-6 space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-white">Playlist preview</p>
                        <p className="text-xs text-spotify-gray-light">
                          {preview?.total_matches || 0} matches in cache. {selectedTrackIds.length} selected.
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
                          Use auto name
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
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSelectAllTracks}
                        className="px-3 py-1.5 text-xs rounded-full border border-spotify-gray-mid/60 text-spotify-gray-light hover:text-white hover:border-spotify-gray-light transition-colors"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={handleClearTracks}
                        className="px-3 py-1.5 text-xs rounded-full border border-spotify-gray-mid/60 text-spotify-gray-light hover:text-white hover:border-spotify-gray-light transition-colors"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="text-xs text-spotify-gray-light">
                      Auto-balance enabled (manual quotas coming later).
                    </div>
                  </div>

                  {previewError && <ErrorMessage message={previewError} />}

                  <div className="border border-spotify-gray-mid/60 rounded-xl overflow-hidden">
                    <div className="grid grid-cols-[40px_minmax(0,1fr)_80px] gap-3 px-4 py-3 text-xs uppercase tracking-wide text-spotify-gray-light bg-spotify-gray-mid/40">
                      <span />
                      <span>Track</span>
                      <span className="text-right">Time</span>
                      {showMetadata && (
                        <>
                          <span className="col-span-3" />
                        </>
                      )}
                    </div>
                    {previewLoading ? (
                      <div className="py-8 flex justify-center">
                        <LoadingSpinner />
                      </div>
                    ) : preview?.tracks?.length ? (
                      <div className="divide-y divide-spotify-gray-mid/60">
                        {preview.tracks.map((track) => {
                          const isSelected = selectedTrackIds.includes(track.id);
                          return (
                            <div key={track.id} className="px-4 py-3 hover:bg-spotify-gray-mid/30">
                              <div className="grid grid-cols-[40px_minmax(0,1fr)_80px] gap-3 items-center">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => handleToggleTrack(track.id)}
                                  className="accent-spotify-green"
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
                                      {(track.artists || []).map((artist) => artist.name).join(', ')}
                                    </div>
                                  </div>
                                </div>
                                <div className="text-xs text-spotify-gray-light text-right">
                                  {track.duration_ms ? formatDuration(track.duration_ms) : '--:--'}
                                </div>
                              </div>
                              {showMetadata && (
                                <div className="mt-2 text-xs text-spotify-gray-light space-y-1">
                                  <div>
                                    <span className="text-spotify-gray-light">Year:</span>{' '}
                                    <span className="text-white">{track.year || 'Unknown'}</span>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {(track.genres || []).slice(0, 6).map((genre) => (
                                      <span
                                        key={genre}
                                        className="px-2 py-0.5 rounded-full bg-spotify-gray-mid/60 text-[11px] text-white"
                                      >
                                        {genre}
                                      </span>
                                    ))}
                                    {(track.genres || []).length > 6 && (
                                      <span className="text-[11px] text-spotify-gray-light">
                                        +{track.genres.length - 6} more
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="py-10 text-center text-sm text-spotify-gray-light">
                        No matches yet. Adjust tags or sources to preview tracks.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default SmartPlaylistBuilder;
