import { useCallback, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VideoGrid } from '../src/components/VideoGrid';
import type { LibraryViewMode, Video } from '../src/types';
import '../src/themes.css';

// Isolated synthetic records: this fixture never opens the user's library or disk.
const records: Video[] = Array.from({ length: 10_000 }, (_, index) => ({
  id: index + 1, path: `synthetic/clip-${index + 1}.mp4`, name: `Synthetic clip ${index + 1}`,
  ext: '.mp4', size: 1000, duration: 60, width: 1920, height: 1080,
  aspect_ratio: 16 / 9, thumbnail_path: null, folder_id: null,
  added_at: 1, mtime: 1, favorited: 0, marked_for_deletion: 0,
}));
const regenerating = new Set<number>();
const noop = () => {};
const events = { plays: 0, favorites: 0 };
const play = () => { events.plays++; };
const favorite = () => { events.favorites++; };

function Fixture() {
  const [count, setCount] = useState(records.length);
  const [viewMode, setViewMode] = useState<LibraryViewMode>('list');
  const [directory, setDirectory] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set<number>());
  const [hiddenIds, setHiddenIds] = useState(new Set<number>());
  const videos = useMemo(() => records.slice(0, count), [count]);
  const toggleSelect = useCallback((id: number) => setSelectedIds((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }), []);

  Object.assign(window, {
    videoListFixture: {
      events, setViewMode, setSelectionMode,
      getSelected: () => [...selectedIds],
      setHidden: (ids: number[]) => setHiddenIds(new Set(ids)),
      switchDirectory: (nextCount: number) => {
        setCount(nextCount);
        setHiddenIds(new Set());
        setDirectory((value) => value + 1);
      },
    },
  });

  return <VideoGrid
    videos={videos} contentTransitionKey={String(directory)} viewMode={viewMode}
    cardSize={220} cardSizeRange={[120, 420]} onCardSizeChange={noop}
    onPlay={play} onToggleFavorite={favorite} onBatchUnfavorite={noop}
    showFavorited={false} onRegenerateThumbnail={noop} regeneratingThumbnailIds={regenerating}
    selectionMode={selectionMode} selectedIds={selectedIds} onToggleSelect={toggleSelect}
    onSelectedIdsChange={setSelectedIds} onSelectionModeChange={setSelectionMode}
    hiddenVideoIds={hiddenIds}
  />;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
