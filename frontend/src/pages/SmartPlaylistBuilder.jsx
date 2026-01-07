import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { cacheAPI, formatDuration, getBestImage, playlistAPI, smartPlaylistAPI } from '../services/api';

const CollapsibleSection = ({
  title,
  description,
  open,
  onToggle,
  onClear,
  children,
}) => {
  return (
    <div className="rounded-2xl border border-spotify-gray-mid/60 bg-spotify-gray-mid/30">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 text-left space-y-1"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">{title}</span>
            <span className={`icon text-lg text-spotify-gray-light transition-transform ${open ? 'rotate-180' : ''}`}>
              expand_more
            </span>
          </div>
          {description && <p className="text-xs text-spotify-gray-light">{description}</p>}
        </button>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-spotify-gray-light hover:text-white"
          >
            Clear filter
          </button>
        )}
      </div>
      {open && <div className="px-4 pb-4 pt-1 space-y-4">{children}</div>}
    </div>
  );
};

const FilterChip = ({ label, onRemove, compact = false }) => (
  <span
    className={`inline-flex items-center gap-2 rounded-full border border-spotify-gray-mid/60 bg-spotify-gray-mid/60 text-white ${
      compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1 text-xs'
    }`}
  >
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

const ActiveFiltersBar = ({
  chips,
  onClearAll,
  compact = false,
}) => {
  const hasChips = chips.length > 0;
  return (
    <div
      className={`rounded-2xl border border-spotify-gray-mid/60 bg-spotify-gray-dark/70 ${
        compact ? 'px-3 py-2' : 'px-4 py-3'
      }`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-spotify-gray-light">
          Active filters
        </p>
        <button
          type="button"
          onClick={onClearAll}
          disabled={!hasChips}
          className="text-xs text-spotify-gray-light hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Clear all
        </button>
      </div>
      {hasChips ? (
        <div className={`mt-2 flex flex-wrap gap-2 ${compact ? '' : 'pt-1'}`}>
          {chips.map((chip) => (
            <FilterChip
              key={chip.key}
              label={chip.label}
              onRemove={chip.onRemove}
              compact={compact}
            />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-spotify-gray-light">No active filters.</p>
      )}
    </div>
  );
};

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
  const [albumFilters, setAlbumFilters] = useState([]);
  const [albumInput, setAlbumInput] = useState('');
  const [genreSearch, setGenreSearch] = useState('');
  const [artistSearch, setArtistSearch] = useState('');
  const [sectionOpen, setSectionOpen] = useState({
    sources: false,
    matchLogic: false,
    constraints: false,
    genres: false,
    dates: false,
    artists: false,
    title: false,
    album: false,
  });
  const [openDecades, setOpenDecades] = useState({});
  const [openGenreGroups, setOpenGenreGroups] = useState({});

  const [preview, setPreview] = useState({ tracks: [], total_matches: 0 });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [selectedTrackIds, setSelectedTrackIds] = useState([]);
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [previewSearch, setPreviewSearch] = useState('');
  const [previewSort, setPreviewSort] = useState('default');
  const [selectionMenuOpen, setSelectionMenuOpen] = useState(false);

  const [playlistName, setPlaylistName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState(null);
  const [createError, setCreateError] = useState(null);

  useEffect(() => {
    if (!filtersOpen) {
      document.body.style.overflow = '';
      return;
    }
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [filtersOpen]);

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

  const sourceIdSet = useMemo(() => new Set(sourceIds), [sourceIds]);

  const orderedSources = useMemo(() => {
    const query = sourceSearch.trim().toLowerCase();
    const selected = playlists.filter((playlist) => sourceIdSet.has(playlist.id));
    const unselected = playlists.filter((playlist) => !sourceIdSet.has(playlist.id));
    const matches = (playlist) => {
      if (!query) return true;
      const name = playlist.name?.toLowerCase() || '';
      const owner = playlist.owner?.display_name?.toLowerCase() || playlist.owner?.id?.toLowerCase() || '';
      return name.includes(query) || owner.includes(query);
    };
    const selectedSorted = [...selected].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const filteredUnselected = unselected.filter(matches).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return [...selectedSorted, ...filteredUnselected];
  }, [playlists, sourceIdSet, sourceSearch]);

  const uncachedSources = useMemo(() => {
    return sourceIds.filter((playlistId) => !playlistFacts[playlistId]?.last_snapshot_id);
  }, [sourceIds, playlistFacts]);

  const defaultSourceIds = useMemo(() => {
    if (!playlists.length) {
      return [];
    }
    const cachedIds = playlists
      .filter((playlist) => playlistFacts[playlist.id]?.last_snapshot_id)
      .map((playlist) => playlist.id);
    return cachedIds.length > 0 ? cachedIds : playlists.map((playlist) => playlist.id);
  }, [playlists, playlistFacts]);

  const toggleSection = (key) => {
    setSectionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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

  const resetSourcesToDefault = useCallback(() => {
    if (defaultSourceIds.length > 0) {
      setSourceIds(defaultSourceIds);
      return;
    }
    if (playlists.length > 0) {
      setSourceIds(playlists.map((playlist) => playlist.id));
      return;
    }
    setSourceIds([]);
  }, [defaultSourceIds, playlists]);

  const isDefaultSources = useMemo(() => {
    if (!defaultSourceIds.length && !sourceIds.length) {
      return true;
    }
    if (sourceIds.length !== defaultSourceIds.length) {
      return false;
    }
    const defaultSet = new Set(defaultSourceIds);
    return sourceIds.every((id) => defaultSet.has(id));
  }, [defaultSourceIds, sourceIds]);

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
      album_contains: albumFilters,
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
    albumFilters,
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

  const handleSelectVisibleTracks = () => {
    setSelectionTouched(true);
    setSelectedTrackIds(visibleTrackIds);
  };

  const selectedGenreSet = useMemo(() => {
    return new Set(selectedGenres.map((genre) => genre.toLowerCase()));
  }, [selectedGenres]);

  const genreGroups = useMemo(() => {
    if (!facets?.genre_groups?.length) {
      return [];
    }
    const query = genreSearch.trim().toLowerCase();
    return facets.genre_groups
      .map((group) => {
        const groupMatches = query ? group.group.toLowerCase().includes(query) : false;
        const tags = (group.tags || [])
          .filter((tag) => {
            const tagName = tag.name.toLowerCase();
            if (selectedGenreSet.has(tagName)) {
              return true;
            }
            if (!query) return true;
            if (groupMatches) return true;
            return tagName.includes(query);
          })
          .sort((a, b) => {
            const aSelected = selectedGenreSet.has(a.name.toLowerCase());
            const bSelected = selectedGenreSet.has(b.name.toLowerCase());
            if (aSelected !== bSelected) return aSelected ? -1 : 1;
            if (b.count !== a.count) return b.count - a.count;
            return a.name.localeCompare(b.name);
          });
        if (!tags.length) return null;
        return { ...group, tags };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aSelected = (a.tags || []).some((tag) => selectedGenreSet.has(tag.name.toLowerCase()));
        const bSelected = (b.tags || []).some((tag) => selectedGenreSet.has(tag.name.toLowerCase()));
        if (aSelected !== bSelected) return aSelected ? -1 : 1;
        if (b.count !== a.count) return b.count - a.count;
        return a.group.localeCompare(b.group);
      });
  }, [facets, genreSearch, selectedGenreSet]);

  const artistOptions = useMemo(() => {
    return facets?.artists || [];
  }, [facets]);

  const orderedArtists = useMemo(() => {
    const query = artistSearch.trim().toLowerCase();
    const selectedSet = new Set(selectedArtists);
    const selectedList = artistOptions.filter((artist) => selectedSet.has(artist.id));
    const filteredList = artistOptions.filter((artist) => {
      if (selectedSet.has(artist.id)) return false;
      if (!query) return true;
      return (artist.name || '').toLowerCase().includes(query);
    });
    return [...selectedList, ...filteredList];
  }, [artistOptions, artistSearch, selectedArtists]);

  const sortedDecades = useMemo(() => {
    const list = facets?.decades || [];
    const selectedYearsSet = new Set(selectedYears);
    const selectedDecadesSet = new Set(selectedDecades);
    return [...list].sort((a, b) => {
      const aSelected = selectedDecadesSet.has(a.decade)
        || (a.years || []).some((year) => selectedYearsSet.has(year.year));
      const bSelected = selectedDecadesSet.has(b.decade)
        || (b.years || []).some((year) => selectedYearsSet.has(year.year));
      if (aSelected !== bSelected) return aSelected ? -1 : 1;
      return b.decade - a.decade;
    });
  }, [facets, selectedDecades, selectedYears]);

  useEffect(() => {
    if (!facets?.decades?.length) {
      return;
    }
    setOpenDecades((prev) => {
      const next = { ...prev };
      facets.decades.forEach((decade) => {
        const hasSelectedYear = (decade.years || []).some((year) => selectedYears.includes(year.year));
        if (selectedDecades.includes(decade.decade) || hasSelectedYear) {
          next[decade.decade] = true;
        }
      });
      return next;
    });
  }, [facets, selectedDecades, selectedYears]);

  useEffect(() => {
    if (!facets?.genre_groups?.length) {
      return;
    }
    setOpenGenreGroups((prev) => {
      const next = { ...prev };
      facets.genre_groups.forEach((group) => {
        const hasSelected = (group.tags || [])
          .some((tag) => selectedGenreSet.has(tag.name.toLowerCase()));
        if (hasSelected) {
          next[group.group] = true;
        }
      });
      return next;
    });
  }, [facets, selectedGenreSet]);

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
    albumFilters.forEach((term) => tags.push(term));
    if (!tags.length) {
      return 'Auto: Smart playlist';
    }
    return `Auto: ${tags.join(', ')}`;
  }, [albumFilters, artistNameMap, selectedDecades, selectedGenres, selectedArtists, selectedYears, titleFilters]);

  useEffect(() => {
    if (!nameTouched) {
      setPlaylistName(autoName);
    }
  }, [autoName, nameTouched]);

  const selectedArtistSummary = useMemo(() => {
    return selectedArtists.map((id) => artistNameMap[id] || id).filter(Boolean);
  }, [artistNameMap, selectedArtists]);

  const selectedDateSummary = useMemo(() => {
    const decadeLabels = selectedDecades.map((decade) => `${decade}s`);
    const yearLabels = selectedYears.map((year) => String(year));
    return [...decadeLabels, ...yearLabels];
  }, [selectedDecades, selectedYears]);

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

  const handleRemoveTitleFilter = useCallback((term) => {
    setTitleFilters((prev) => prev.filter((item) => item !== term));
  }, []);

  const handleAddAlbumFilter = () => {
    const value = albumInput.trim();
    if (!value) return;
    const exists = albumFilters.some((term) => term.toLowerCase() === value.toLowerCase());
    if (exists) {
      setAlbumInput('');
      return;
    }
    setAlbumFilters((prev) => [...prev, value]);
    setAlbumInput('');
  };

  const handleRemoveAlbumFilter = useCallback((term) => {
    setAlbumFilters((prev) => prev.filter((item) => item !== term));
  }, []);

  const handleClearAllFilters = () => {
    resetSourcesToDefault();
    setSourceSearch('');
    setMatchMode('any');
    setSelectedGenres([]);
    setSelectedDecades([]);
    setSelectedYears([]);
    setSelectedArtists([]);
    setTitleFilters([]);
    setAlbumFilters([]);
    setGenreSearch('');
    setArtistSearch('');
    setTitleInput('');
    setAlbumInput('');
    setSelectionTouched(false);
    setSelectedTrackIds([]);
    setNameTouched(false);
    setCreateMessage(null);
    setCreateError(null);
  };

  const toggleGenre = useCallback((genreName) => {
    setSelectedGenres((prev) => {
      if (prev.includes(genreName)) {
        return prev.filter((name) => name !== genreName);
      }
      return [...prev, genreName];
    });
  }, []);

  const clearGenres = () => {
    setSelectedGenres([]);
    setGenreSearch('');
  };

  const clearDates = () => {
    setSelectedDecades([]);
    setSelectedYears([]);
  };

  const clearArtists = () => {
    setSelectedArtists([]);
    setArtistSearch('');
  };

  const clearTitleTags = () => {
    setTitleFilters([]);
    setTitleInput('');
  };

  const clearAlbumTags = () => {
    setAlbumFilters([]);
    setAlbumInput('');
  };

  const toggleGenreGroup = (groupName) => {
    setOpenGenreGroups((prev) => ({
      ...prev,
      [groupName]: !prev[groupName],
    }));
  };

  const toggleDecade = useCallback((decade) => {
    setSelectedDecades((prev) => {
      if (prev.includes(decade)) {
        return prev.filter((value) => value !== decade);
      }
      return [...prev, decade];
    });
  }, []);

  const toggleYear = useCallback((year) => {
    setSelectedYears((prev) => {
      if (prev.includes(year)) {
        return prev.filter((value) => value !== year);
      }
      return [...prev, year];
    });
  }, []);

  const toggleArtist = useCallback((artistId) => {
    setSelectedArtists((prev) => {
      if (prev.includes(artistId)) {
        return prev.filter((value) => value !== artistId);
      }
      return [...prev, artistId];
    });
  }, []);

  const parseReleaseDateValue = (value) => {
    if (!value) return 0;
    if (value.length === 4) {
      return Date.parse(`${value}-01-01`) || 0;
    }
    if (value.length === 7) {
      return Date.parse(`${value}-01`) || 0;
    }
    return Date.parse(value) || 0;
  };

  const previewTracks = useMemo(() => preview?.tracks || [], [preview]);
  const previewSearchValue = previewSearch.trim().toLowerCase();
  const filteredPreviewTracks = useMemo(() => {
    if (!previewSearchValue) {
      return previewTracks;
    }
    return previewTracks.filter((track) => {
      const name = track.name?.toLowerCase() || '';
      const album = track.album?.toLowerCase() || '';
      const artists = (track.artists || [])
        .map((artist) => artist.name?.toLowerCase() || '')
        .join(' ');
      return name.includes(previewSearchValue)
        || album.includes(previewSearchValue)
        || artists.includes(previewSearchValue);
    });
  }, [previewSearchValue, previewTracks]);

  const sortedPreviewTracks = useMemo(() => {
    if (previewSort === 'default') {
      return filteredPreviewTracks;
    }
    const list = [...filteredPreviewTracks];
    switch (previewSort) {
      case 'release_date':
        list.sort((a, b) => parseReleaseDateValue(b.album_release_date) - parseReleaseDateValue(a.album_release_date));
        break;
      case 'popularity':
        list.sort((a, b) => (b.popularity ?? -1) - (a.popularity ?? -1));
        break;
      case 'artist':
        list.sort((a, b) => {
          const aName = (a.artists?.[0]?.name || '').toLowerCase();
          const bName = (b.artists?.[0]?.name || '').toLowerCase();
          return aName.localeCompare(bName);
        });
        break;
      case 'title':
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        break;
      case 'duration':
        list.sort((a, b) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0));
        break;
      default:
        break;
    }
    return list;
  }, [filteredPreviewTracks, previewSort]);

  const visibleTrackIds = useMemo(() => {
    return sortedPreviewTracks.map((track) => track.id);
  }, [sortedPreviewTracks]);

  const totalMatches = preview?.total_matches || 0;
  const previewCapped = totalMatches > previewTracks.length;

  const selectedTrackUris = useMemo(() => {
    const selected = new Set(selectedTrackIds);
    return previewTracks
      .filter((track) => selected.has(track.id))
      .map((track) => track.track_uri)
      .filter(Boolean);
  }, [previewTracks, selectedTrackIds]);

  const activeFilterChips = useMemo(() => {
    const chips = [];
    if (!isDefaultSources && sourceIds.length > 0) {
      chips.push({
        key: 'sources',
        label: `Sources: ${sourceIds.length}`,
        onRemove: () => {
          resetSourcesToDefault();
          setSourceSearch('');
        },
      });
    }
    selectedGenres.forEach((genre) => {
      chips.push({
        key: `genre-${genre}`,
        label: genre,
        onRemove: () => toggleGenre(genre),
      });
    });
    selectedDecades.forEach((decade) => {
      const label = `${decade}s`;
      chips.push({
        key: `decade-${decade}`,
        label,
        onRemove: () => toggleDecade(decade),
      });
    });
    selectedYears.forEach((year) => {
      chips.push({
        key: `year-${year}`,
        label: String(year),
        onRemove: () => toggleYear(year),
      });
    });
    selectedArtists.forEach((artistId) => {
      const label = artistNameMap[artistId] || artistId;
      chips.push({
        key: `artist-${artistId}`,
        label,
        onRemove: () => toggleArtist(artistId),
      });
    });
    titleFilters.forEach((term) => {
      chips.push({
        key: `title-${term}`,
        label: `Title: ${term}`,
        onRemove: () => handleRemoveTitleFilter(term),
      });
    });
    albumFilters.forEach((term) => {
      chips.push({
        key: `album-${term}`,
        label: `Album: ${term}`,
        onRemove: () => handleRemoveAlbumFilter(term),
      });
    });
    return chips;
  }, [
    albumFilters,
    artistNameMap,
    isDefaultSources,
    sourceIds,
    resetSourcesToDefault,
    selectedArtists,
    selectedDecades,
    selectedGenres,
    selectedYears,
    titleFilters,
    toggleArtist,
    toggleDecade,
    toggleGenre,
    toggleYear,
    handleRemoveTitleFilter,
    handleRemoveAlbumFilter,
  ]);

  const visibleCount = sortedPreviewTracks.length;
  const previewStatusLabel = totalMatches > 0
    ? `Showing ${visibleCount} of ${totalMatches} matches`
    : 'No matches yet.';
  const previewUpdating = previewLoading && previewTracks.length > 0;

  const configPanel = (
    <div className="bg-spotify-gray-dark/40 rounded-2xl border border-spotify-gray-mid/60 p-6 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Config</p>
        <p className="text-sm text-spotify-gray-light mt-1">
          Sources, match logic, and core behavior.
        </p>
      </div>

      <CollapsibleSection
        title="Source playlists"
        description="Choose cached playlists to pull tracks from."
        open={sectionOpen.sources}
        onToggle={() => toggleSection('sources')}
        onClear={() => {
          resetSourcesToDefault();
          setSourceSearch('');
        }}
      >
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
        </div>

        <input
          type="text"
          value={sourceSearch}
          onChange={(event) => setSourceSearch(event.target.value)}
          placeholder="Search playlists"
          className="w-full bg-spotify-gray-mid/60 text-white text-sm rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
        />

        <div className="max-h-56 overflow-y-auto divide-y divide-spotify-gray-mid/60 border border-spotify-gray-mid/60 rounded-lg scrollbar-thin">
          {orderedSources.length === 0 ? (
            <div className="p-4 text-sm text-spotify-gray-light">No playlists match your search.</div>
          ) : (
            orderedSources.map((playlist) => {
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
      </CollapsibleSection>

      <CollapsibleSection
        title="Match logic"
        description="Applies to tag filters only (genres, dates, artists, title, album)."
        open={sectionOpen.matchLogic}
        onToggle={() => toggleSection('matchLogic')}
      >
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
      </CollapsibleSection>
    </div>
  );

  const filteringPanel = (
    <div className="bg-spotify-gray-dark/40 rounded-2xl border border-spotify-gray-mid/60 p-6 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-spotify-gray-light">Filtering</p>
        <p className="text-sm text-spotify-gray-light mt-1">
          Pick tags, dates, artists, and custom terms.
        </p>
      </div>

      <CollapsibleSection
        title="Track filters"
        description="Hard constraints applied alongside tag matches."
        open={sectionOpen.constraints}
        onToggle={() => toggleSection('constraints')}
      >
        <div className="text-xs text-spotify-gray-light">
          No track constraints configured yet.
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Release dates"
        description="Pick decades or drill down to specific years."
        open={sectionOpen.dates}
        onToggle={() => toggleSection('dates')}
        onClear={clearDates}
      >
        {selectedDateSummary.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedDateSummary.map((term) => (
              <FilterChip
                key={term}
                label={term}
                onRemove={() => {
                  if (term.endsWith('s')) {
                    const decadeValue = Number(term.replace('s', ''));
                    if (!Number.isNaN(decadeValue)) {
                      toggleDecade(decadeValue);
                      return;
                    }
                  }
                  const yearValue = Number(term);
                  if (!Number.isNaN(yearValue)) {
                    toggleYear(yearValue);
                  }
                }}
              />
            ))}
          </div>
        )}

        {sortedDecades.length ? (
          <div className="space-y-2">
            {sortedDecades.map((decade) => {
              const isOpen = Boolean(openDecades[decade.decade]);
              const yearList = [...(decade.years || [])].sort((a, b) => {
                const aSelected = selectedYears.includes(a.year);
                const bSelected = selectedYears.includes(b.year);
                if (aSelected !== bSelected) return aSelected ? -1 : 1;
                return b.year - a.year;
              });
              return (
                <div
                  key={decade.decade}
                  className="rounded-lg border border-spotify-gray-mid/60 bg-spotify-gray-mid/30 px-3 py-2"
                >
                  <div className="flex items-center justify-between text-sm text-white">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setOpenDecades((prev) => ({
                          ...prev,
                          [decade.decade]: !prev[decade.decade],
                        }))}
                        className="text-spotify-gray-light hover:text-white"
                      >
                        <span className={`icon text-base transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                          expand_more
                        </span>
                      </button>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedDecades.includes(decade.decade)}
                          onChange={() => toggleDecade(decade.decade)}
                          className="accent-spotify-green"
                        />
                        <span>{decade.label}</span>
                      </label>
                    </div>
                    <span className="text-xs text-spotify-gray-light">{decade.count}</span>
                  </div>
                {isOpen && (
                    <div className="mt-2 space-y-2 border-l border-spotify-gray-mid/60 pl-6 ml-3">
                      {yearList.map((year) => (
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
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-spotify-gray-light">No release date tags available yet.</div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Genres"
        description="Auto-grouped by genre families with counts."
        open={sectionOpen.genres}
        onToggle={() => toggleSection('genres')}
        onClear={clearGenres}
      >
        {selectedGenres.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedGenres.map((term) => (
              <FilterChip
                key={term}
                label={term}
                onRemove={() => toggleGenre(term)}
              />
            ))}
          </div>
        )}

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
        {!facetsLoading && genreGroups.length === 0 && genreSearch && facets?.genre_groups?.length > 0 && (
          <div className="text-xs text-spotify-gray-light">No genres match your search.</div>
        )}
        {!facetsLoading && genreGroups.length === 0 && (!genreSearch || !facets?.genre_groups?.length) && (
          <div className="text-xs text-spotify-gray-light">
            No genre tags in cache yet. Refresh the cache to enrich artists.
          </div>
        )}

        <div className="space-y-2">
          {genreGroups.map((group) => (
            <div
              key={group.group}
              className="rounded-lg border border-spotify-gray-mid/60 bg-spotify-gray-mid/30 px-3 py-2"
            >
              <div className="flex items-center justify-between text-sm text-white">
                <button
                  type="button"
                  onClick={() => toggleGenreGroup(group.group)}
                  className="flex items-center gap-2 text-left"
                >
                  <span
                    className={`icon text-base text-spotify-gray-light transition-transform ${
                      genreSearch || openGenreGroups[group.group] ? 'rotate-180' : ''
                    }`}
                  >
                    expand_more
                  </span>
                  <span>{group.group}</span>
                </button>
                <span className="text-xs text-spotify-gray-light">{group.count}</span>
              </div>
              {(genreSearch || openGenreGroups[group.group]) && (
                <div className="mt-2 space-y-2 border-l border-spotify-gray-mid/60 pl-6 ml-3">
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
              )}
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Artists"
        description="Filter by artist names from cached tracks."
        open={sectionOpen.artists}
        onToggle={() => toggleSection('artists')}
        onClear={clearArtists}
      >
        {selectedArtistSummary.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedArtists.map((artistId) => (
              <FilterChip
                key={artistId}
                label={artistNameMap[artistId] || artistId}
                onRemove={() => toggleArtist(artistId)}
              />
            ))}
          </div>
        )}

        <input
          type="text"
          value={artistSearch}
          onChange={(event) => setArtistSearch(event.target.value)}
          placeholder="Search artists"
          className="w-full bg-spotify-gray-mid/60 text-white text-sm rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
        />

        <div className="max-h-48 overflow-y-auto divide-y divide-spotify-gray-mid/60 border border-spotify-gray-mid/60 rounded-lg scrollbar-thin">
          {orderedArtists.length === 0 ? (
            <div className="p-4 text-sm text-spotify-gray-light">No artists match your search.</div>
          ) : (
            orderedArtists.slice(0, 200).map((artist) => (
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
        {orderedArtists.length > 200 && (
          <p className="text-xs text-spotify-gray-light">Showing top 200 matches.</p>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Title tags"
        description="Add keywords that must appear in track titles."
        open={sectionOpen.title}
        onToggle={() => toggleSection('title')}
        onClear={clearTitleTags}
      >
        {titleFilters.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {titleFilters.map((term) => (
              <FilterChip
                key={term}
                label={term}
                onRemove={() => handleRemoveTitleFilter(term)}
              />
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={titleInput}
            onChange={(event) => setTitleInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleAddTitleFilter();
              }
            }}
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
      </CollapsibleSection>

      <CollapsibleSection
        title="Album tags"
        description="Add keywords that must appear in album titles."
        open={sectionOpen.album}
        onToggle={() => toggleSection('album')}
        onClear={clearAlbumTags}
      >
        {albumFilters.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {albumFilters.map((term) => (
              <FilterChip
                key={term}
                label={term}
                onRemove={() => handleRemoveAlbumFilter(term)}
              />
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={albumInput}
            onChange={(event) => setAlbumInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleAddAlbumFilter();
              }
            }}
            placeholder="Album contains..."
            className="flex-1 min-w-[160px] bg-spotify-gray-mid/60 text-white text-sm rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
          />
          <button
            type="button"
            onClick={handleAddAlbumFilter}
            className="px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold transition-colors"
          >
            Add
          </button>
        </div>
      </CollapsibleSection>
    </div>
  );

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

              <div className="space-y-4 md:space-y-6">
                <div className="md:hidden sticky top-0 z-20">
                  <div className="rounded-2xl border border-spotify-gray-mid/60 bg-spotify-gray-dark/90 backdrop-blur px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs text-spotify-gray-light">Preview</p>
                        <p className="text-sm text-white font-semibold">{previewStatusLabel}</p>
                        <p className="text-xs text-spotify-gray-light">
                          {selectedTrackIds.length} selected
                          {previewCapped ? ` · Preview capped at ${previewTracks.length}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFiltersOpen(true)}
                        className="px-3 py-2 rounded-lg bg-spotify-gray-mid/60 text-xs text-white hover:bg-spotify-gray-mid"
                      >
                        Filters
                      </button>
                    </div>
                    {previewUpdating && (
                      <p className="text-xs text-spotify-gray-light">Updating…</p>
                    )}
                  </div>
                </div>

                {activeFilterChips.length > 0 && (
                  <div className="md:hidden">
                    <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
                      {activeFilterChips.map((chip) => (
                        <FilterChip
                          key={chip.key}
                          label={chip.label}
                          onRemove={chip.onRemove}
                          compact
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:h-[calc(100vh-220px)] md:overflow-hidden md:min-h-0">
                  <div className="hidden md:flex md:flex-col md:overflow-y-auto md:min-h-0 pr-2 scrollbar-thin">
                    <div className="sticky top-0 z-10 pb-4 bg-spotify-gray-dark/80 backdrop-blur">
                      <ActiveFiltersBar
                        chips={activeFilterChips}
                        onClearAll={handleClearAllFilters}
                      />
                    </div>
                    <div className="space-y-6">
                      {configPanel}
                      {filteringPanel}
                    </div>
                  </div>

                  <div className="bg-spotify-gray-dark/40 rounded-2xl border border-spotify-gray-mid/60 md:overflow-y-auto md:min-h-0 scrollbar-thin pb-24 md:pb-6">
                    <div className="hidden md:block sticky top-0 z-10 bg-spotify-gray-dark/95 backdrop-blur border-b border-spotify-gray-mid/60 p-4 space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-white">Playlist preview</p>
                          <p className="text-xs text-spotify-gray-light">
                            {previewStatusLabel}. {selectedTrackIds.length} selected.
                          </p>
                          {previewCapped && (
                            <p className="text-[11px] text-spotify-gray-light">
                              Preview capped at {previewTracks.length} tracks.
                            </p>
                          )}
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
                        <select
                          value={previewSort}
                          onChange={(event) => setPreviewSort(event.target.value)}
                          className="bg-spotify-gray-mid/60 text-white text-sm rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                        >
                          <option value="default">Sort: Default</option>
                          <option value="release_date">Sort: Release date</option>
                          <option value="popularity">Sort: Popularity</option>
                          <option value="artist">Sort: Artist</option>
                          <option value="title">Sort: Title</option>
                          <option value="duration">Sort: Duration</option>
                        </select>
                      </div>

                      {previewUpdating && (
                        <p className="text-xs text-spotify-gray-light">Updating…</p>
                      )}

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
                    </div>

                    <div className="md:hidden px-4 pt-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-white">Preview results</p>
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
                      <div className="flex flex-col gap-2">
                        <div className="relative">
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
                        <select
                          value={previewSort}
                          onChange={(event) => setPreviewSort(event.target.value)}
                          className="bg-spotify-gray-mid/60 text-white text-sm rounded-lg px-3 py-2 border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                        >
                          <option value="default">Sort: Default</option>
                          <option value="release_date">Sort: Release date</option>
                          <option value="popularity">Sort: Popularity</option>
                          <option value="artist">Sort: Artist</option>
                          <option value="title">Sort: Title</option>
                          <option value="duration">Sort: Duration</option>
                        </select>
                      </div>
                      <div className="flex items-center justify-between text-xs text-spotify-gray-light">
                        <span>{selectedTrackIds.length} selected</span>
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setSelectionMenuOpen((prev) => !prev)}
                            className="px-2 py-1 rounded-lg border border-spotify-gray-mid/60 hover:border-spotify-gray-light"
                          >
                            <span className="icon text-base">more_horiz</span>
                          </button>
                          {selectionMenuOpen && (
                            <div className="absolute right-0 mt-2 w-44 rounded-lg border border-spotify-gray-mid/60 bg-spotify-gray-dark shadow-lg z-10">
                              <button
                                type="button"
                                onClick={() => {
                                  handleSelectAllTracks();
                                  setSelectionMenuOpen(false);
                                }}
                                className="w-full text-left px-3 py-2 text-xs text-spotify-gray-light hover:bg-spotify-gray-mid/40"
                              >
                                Select all
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  handleSelectVisibleTracks();
                                  setSelectionMenuOpen(false);
                                }}
                                className="w-full text-left px-3 py-2 text-xs text-spotify-gray-light hover:bg-spotify-gray-mid/40"
                              >
                                Select visible
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  handleClearTracks();
                                  setSelectionMenuOpen(false);
                                }}
                                className="w-full text-left px-3 py-2 text-xs text-spotify-gray-light hover:bg-spotify-gray-mid/40"
                              >
                                Clear selection
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
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
                        ) : sortedPreviewTracks.length ? (
                          <div className="divide-y divide-spotify-gray-mid/60">
                            {sortedPreviewTracks.map((track) => {
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
                                      <div>
                                        <span className="text-spotify-gray-light">Genres:</span>
                                        <div className="mt-1 flex flex-wrap gap-2">
                                          {(track.genres || []).slice(0, 8).map((genre) => (
                                            <span
                                              key={genre}
                                              className="px-2 py-0.5 rounded-full bg-spotify-gray-mid/60 text-[11px] text-white"
                                            >
                                              {genre}
                                            </span>
                                          ))}
                                          {(track.genres || []).length > 8 && (
                                            <span className="text-[11px] text-spotify-gray-light">
                                              +{track.genres.length - 8} more
                                            </span>
                                          )}
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
                            No matches yet. Adjust tags or sources to preview tracks.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-spotify-gray-dark/95 border-t border-spotify-gray-mid/60 px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={playlistName}
                      onChange={(event) => {
                        setPlaylistName(event.target.value);
                        setNameTouched(true);
                      }}
                      placeholder="Playlist name"
                      className="flex-1 bg-spotify-gray-mid text-white rounded-lg px-3 py-2 text-sm border border-spotify-gray-mid focus:outline-none focus:ring-2 focus:ring-spotify-green"
                    />
                    <button
                      type="button"
                      onClick={handleCreatePlaylist}
                      disabled={creating || !playlistName.trim() || selectedTrackUris.length === 0}
                      className="px-4 py-2 rounded-lg bg-spotify-green hover:bg-spotify-green-dark text-black font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {creating ? 'Creating...' : 'Create'}
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-spotify-gray-light">
                    <span>{selectedTrackIds.length} selected</span>
                    <button
                      type="button"
                      onClick={() => {
                        setPlaylistName(autoName);
                        setNameTouched(false);
                      }}
                      className="text-spotify-gray-light hover:text-white"
                    >
                      Use auto name
                    </button>
                  </div>
                  {createMessage && <p className="text-[11px] text-spotify-green">{createMessage}</p>}
                  {createError && <p className="text-[11px] text-red-400">{createError}</p>}
                </div>

                {filtersOpen && (
                  <div className="fixed inset-0 z-40">
                    <div className="absolute inset-0 bg-black/70" />
                    <div className="absolute inset-0 bg-spotify-black/95 text-white overflow-y-auto">
                      <div className="flex items-center justify-between px-4 py-4 border-b border-spotify-gray-mid/60">
                        <p className="text-sm font-semibold">Filters</p>
                        <button
                          type="button"
                          onClick={() => setFiltersOpen(false)}
                          className="px-3 py-1.5 rounded-lg border border-spotify-gray-mid/60 text-xs text-spotify-gray-light hover:text-white hover:border-spotify-gray-light"
                        >
                          Done
                        </button>
                      </div>
                      <div className="sticky top-0 z-10 px-4 pt-4 bg-spotify-black/95">
                        <ActiveFiltersBar
                          chips={activeFilterChips}
                          onClearAll={handleClearAllFilters}
                          compact
                        />
                      </div>
                      <div className="px-4 py-6 space-y-4">
                        {configPanel}
                        {filteringPanel}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default SmartPlaylistBuilder;
