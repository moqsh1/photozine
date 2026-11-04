import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Search } from "lucide-react";
import { PHOTO_MIME } from "@/components/photobook/PageSheet";
import { MAX_PHOTOS, type Page, type Photo } from "@/lib/photobook/types";
import { cn } from "@/lib/cn";

type LibraryProps = {
  photos: Photo[];
  pages: Page[];
  placedSignature: string;
  placingId: string | null;
  selectedId: string | null;
  query: string;
  filter: "all" | "loose";
  busy: boolean;
  onQuery: (value: string) => void;
  onFilter: (value: "all" | "loose") => void;
  onFocus: (id: string) => void;
  onAdd: () => void;
  onSamples: () => void;
  onDelete: (id: string) => void;
  onReorder: (fromId: string, toId: string) => void;
};

function usedIds(signature: string) {
  const ids = new Set<string>();
  for (const id of signature.split("|")) if (id) ids.add(id);
  return ids;
}

export const Library = memo(function Library({
  photos,
  pages,
  placedSignature,
  placingId,
  selectedId,
  query,
  filter,
  busy,
  onQuery,
  onFilter,
  onFocus,
  onAdd,
  onSamples,
  onDelete,
  onReorder,
}: LibraryProps) {
  const placed = usedIds(placedSignature);
  const ordered = useMemo(() => {
    const rank = new Map<string, number>();
    let cursor = 0;
    for (const page of pages) {
      for (const slot of page.slots) {
        if (slot.photoId && !rank.has(slot.photoId)) rank.set(slot.photoId, cursor++);
      }
    }
    return photos
      .map((photo, index) => ({ photo, index, rank: rank.get(photo.id) ?? Number.POSITIVE_INFINITY }))
      .sort((a, b) => a.rank - b.rank || a.photo.seq - b.photo.seq || a.index - b.index)
      .map((item) => item.photo);
  }, [photos, pages]);
  const loose = ordered.filter((photo) => !placed.has(photo.id)).length;
  const needle = query.trim().toLowerCase();
  const visible = ordered.filter((photo) => {
    if (filter === "loose" && placed.has(photo.id)) return false;
    if (needle && !photo.name.toLowerCase().includes(needle)) return false;
    return true;
  });
  const placing = photos.find((photo) => photo.id === placingId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overId, setOverId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    const root = scrollRef.current;
    if (!root) return;
    const scrollTo = () => {
      if (root.clientHeight === 0) return;
      const node = root.querySelector(`[data-photo-id="${CSS.escape(selectedId)}"]`);
      if (node instanceof HTMLElement) {
        node.scrollIntoView({ block: "center", inline: "nearest" });
        return;
      }
      if (filter === "loose") onFilter("all");
    };
    scrollTo();
    const observer = new ResizeObserver(scrollTo);
    observer.observe(root);
    return () => observer.disconnect();
  }, [selectedId, filter, onFilter]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-end justify-between gap-3 px-4 pt-4 pb-3">
        <div>
          <p className="text-xs tracking-widest text-muted uppercase">Library</p>
          <p className="font-serif text-xl leading-tight">
            <span className="tabular-nums">{photos.length}</span>
            <span className="text-muted"> / {MAX_PHOTOS}</span>
          </p>
        </div>
        <p className="pb-1 text-sm text-muted tabular-nums">{loose} loose</p>
      </div>
      <div className="flex gap-2 px-4">
        <button type="button" className="btn btn-primary min-w-0 flex-1" onClick={onAdd} disabled={busy || photos.length >= MAX_PHOTOS}>
          <ImagePlus className="size-4" aria-hidden="true" />
          Add photos
        </button>
        <button type="button" className="btn btn-quiet" onClick={onSamples} disabled={busy || photos.length >= MAX_PHOTOS}>
          Sample
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2 px-4">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search photos</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            className="field pl-9"
            value={query}
            placeholder="Search"
            onChange={(event) => onQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="mt-3 flex gap-2 px-4" role="group" aria-label="Library filter">
        <FilterButton active={filter === "all"} onClick={() => onFilter("all")}>
          All
        </FilterButton>
        <FilterButton active={filter === "loose"} onClick={() => onFilter("loose")}>
          Not on a page
        </FilterButton>
      </div>
      <p className="mt-2 px-4 text-sm text-muted">Drag a photo onto another to change their order.</p>
      {placing && (
        <p className="mx-4 mt-3 rounded-sm bg-caption px-3 py-2 text-sm">
          Tap a frame to place <span className="font-medium">{placing.name}</span>.
        </p>
      )}
      <div ref={scrollRef} className="scroll-thin mt-3 min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {photos.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center border border-dashed border-line px-4 py-8 text-center">
            <p className="font-serif text-lg">Drop in a whole set</p>
            <p className="mt-2 max-w-56 text-sm text-pretty text-muted">
              Up to 1,000 photos. They flow onto 8×12 pages, one to four a page.
            </p>
            <button type="button" className="btn btn-primary mt-4" onClick={onSamples} disabled={busy}>
              Open sample album
            </button>
          </div>
        ) : visible.length === 0 ? (
          <p className="px-1 py-6 text-sm text-muted">Nothing matches.</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 lg:grid-cols-3">
            {visible.map((photo) => (
              <li key={photo.id} className="thumb-cell" data-photo-id={photo.id}>
                <button
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(PHOTO_MIME, photo.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes(PHOTO_MIME)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (overId !== photo.id) setOverId(photo.id);
                  }}
                  onDragLeave={() => setOverId((current) => (current === photo.id ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOverId(null);
                    const fromId = event.dataTransfer.getData(PHOTO_MIME);
                    if (fromId) onReorder(fromId, photo.id);
                  }}
                  onClick={() => onFocus(photo.id)}
                  className={cn(
                    "relative aspect-square w-full overflow-hidden bg-well",
                    selectedId === photo.id || placingId === photo.id ? "ring-2 ring-accent" : "ring-1 ring-line",
                    overId === photo.id && "ring-2 ring-accent",
                  )}
                  aria-pressed={selectedId === photo.id || placingId === photo.id}
                  aria-label={`Place ${photo.name}`}
                >
                  <img src={photo.thumbUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                  {placed.has(photo.id) && <span className="absolute right-1 bottom-1 size-2 rounded-full bg-accent" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {placing && (
        <div className="border-t border-line px-4 py-3">
          <button type="button" className="btn btn-quiet w-full" onClick={() => onDelete(placing.id)}>
            Remove from library
          </button>
        </div>
      )}
    </div>
  );
});

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-11 flex-1 rounded-sm px-2 text-sm",
        active ? "bg-ink text-page" : "bg-caption text-ink",
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
