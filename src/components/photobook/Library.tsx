import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { PHOTO_MIME } from "@/components/photobook/PageSheet";
import { stampToIso, isoToStamp } from "@/lib/photobook/date";
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
  onCaption: (ids: string[], caption: string) => void;
  onDate: (ids: string[], takenAt: number | null) => void;
  onSelection: (ids: string[]) => void;
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
  onCaption,
  onDate,
  onSelection,
}: LibraryProps) {
  const placed = usedIds(placedSignature);
  const pageOf = useMemo(() => {
    const map = new Map<string, number>();
    pages.forEach((page, index) => {
      for (const slot of page.slots) {
        if (slot.photoId && !map.has(slot.photoId)) map.set(slot.photoId, index + 1);
      }
    });
    return map;
  }, [pages]);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [dateDraft, setDateDraft] = useState("");
  useEffect(() => {
    onSelection(picking ? picked : []);
  }, [onSelection, picking, picked]);
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
          <input
            className="field"
            value={query}
            placeholder="Search"
            onChange={(event) => onQuery(event.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        className={cn("btn mx-4 mt-3 w-[calc(100%-2rem)]", picking ? "btn-ink" : "btn-quiet")}
        aria-pressed={picking}
        onClick={() => {
          setPicking((on) => !on);
          setPicked([]);
          setDraft("");
          setDateDraft("");
        }}
      >
        {picking ? "Done selecting" : "Select photos"}
      </button>
      <div className="mt-3 flex gap-2 px-4" role="group" aria-label="Library filter">
        <FilterButton active={filter === "all"} onClick={() => onFilter("all")}>
          All
        </FilterButton>
        <FilterButton active={filter === "loose"} onClick={() => onFilter("loose")}>
          Not on a page
        </FilterButton>
      </div>
      {picking && (
        <div className="mt-3 px-4">
          <label className="block">
            <span className="text-sm text-muted">
              {picked.length === 0 ? "Select photos, then type one caption" : `Caption for ${picked.length} photos`}
            </span>
            <textarea
              className="field mt-2 min-h-16 py-2 font-serif italic"
              value={draft}
              maxLength={140}
              rows={2}
              placeholder="One caption for every selected photo"
              disabled={picked.length === 0}
              onChange={(event) => {
                const value = event.target.value;
                setDraft(value);
                onCaption(picked, value);
              }}
            />
          </label>
          <label className="mt-2 block">
            <span className="text-sm text-muted">
              {picked.length === 0 ? "Date for the selected photos" : `Date for ${picked.length} photos`}
            </span>
            <input
              className="field mt-2"
              type="date"
              value={dateDraft}
              disabled={picked.length === 0}
              onChange={(event) => {
                const value = event.target.value;
                setDateDraft(value);
                onDate(picked, value ? isoToStamp(value) : null);
              }}
            />
          </label>
        </div>
      )}
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
          <ul className="grid grid-cols-2 gap-2">
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
                  onClick={() => {
                    if (!picking) {
                      onFocus(photo.id);
                      return;
                    }
                    setPicked((current) => {
                      const next = current.includes(photo.id) ? current.filter((id) => id !== photo.id) : [...current, photo.id];
                      const captions = new Set<string>();
                      const dates = new Set<string>();
                      const chosen = new Set(next);
                      for (const page of pages) {
                        for (const slot of page.slots) {
                          if (slot.photoId && chosen.has(slot.photoId)) captions.add(slot.caption);
                        }
                      }
                      for (const item of photos) {
                        if (chosen.has(item.id)) dates.add(item.takenAt != null ? stampToIso(item.takenAt) : "");
                      }
                      setDraft(captions.size === 1 ? [...captions][0] : "");
                      setDateDraft(dates.size === 1 ? [...dates][0] : "");
                      return next;
                    });
                  }}
                  className={cn(
                    "relative aspect-square w-full overflow-hidden bg-well",
                    picking && picked.includes(photo.id)
                      ? "ring-2 ring-accent"
                      : selectedId === photo.id || placingId === photo.id
                        ? "ring-2 ring-accent"
                        : "ring-1 ring-line",
                    overId === photo.id && "ring-2 ring-accent",
                  )}
                  aria-pressed={picking ? picked.includes(photo.id) : selectedId === photo.id || placingId === photo.id}
                  aria-label={`Place ${photo.name}`}
                >
                  <img src={photo.thumbUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                  {picking && picked.includes(photo.id) && (
                    <span className="absolute top-1 left-1 flex size-5 items-center justify-center rounded-full bg-accent text-[10px] text-page">✓</span>
                  )}
                  {pageOf.has(photo.id) ? (
                    <span className="absolute right-1 bottom-1 rounded-sm bg-ink/80 px-1 text-[10px] leading-4 text-page">
                      {pageOf.get(photo.id)}
                    </span>
                  ) : null}
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
