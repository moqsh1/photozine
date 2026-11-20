import { memo, useEffect, useMemo, useRef, useState } from "react";
import { PHOTO_MIME } from "@/components/photobook/PageSheet";
import { getBlob, getThumbBlob } from "@/lib/photobook/db";
import { duplicateIds, imageHash } from "@/lib/photobook/dupes";
import { stampToIso, isoToStamp, formatHindiDate, formatHindiMonth } from "@/lib/photobook/date";
import { type Page, type Photo } from "@/lib/photobook/types";
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
  onDelete: (id: string) => void;
  onDeleteMany: (ids: string[]) => void;
  onArrangeByDate: (ids: string[]) => void;
  onReorder: (fromId: string, toId: string) => void;
  onCaption: (ids: string[], caption: string) => void;
  onDate: (ids: string[], takenAt: number | null) => void;
  onSelection: (ids: string[]) => void;
  exchanging: boolean;
  exchangePhotoId: string | null;
  onToggleExchange: () => void;
  onExchange: (photoId: string) => void;
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
  onFilter,
  onFocus,
  onDelete,
  onDeleteMany,
  onArrangeByDate,
  onReorder,
  onCaption,
  onDate,
  onSelection,
  exchanging,
  exchangePhotoId,
  onToggleExchange,
  onExchange,
}: LibraryProps) {
  const placed = usedIds(placedSignature);
  const pageOf = useMemo(() => {
    const map = new Map<string, number[]>();
    pages.forEach((page, index) => {
      for (const slot of page.slots) {
        if (!slot.photoId) continue;
        const list = map.get(slot.photoId) ?? [];
        const number = index + 1;
        if (!list.includes(number)) list.push(number);
        map.set(slot.photoId, list);
      }
    });
    return map;
  }, [pages]);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [dateDraft, setDateDraft] = useState("");
  const [dupes, setDupes] = useState<string[]>([]);
  const [dupeReports, setDupeReports] = useState<{ times: number; pages: number[]; loose: number; ids: string[] }[]>([]);
  const [checking, setChecking] = useState<string | null>(null);
  useEffect(() => {
    onSelection(picking ? picked : []);
  }, [onSelection, picking, picked]);
  const dupeNote = useMemo(() => {
    const notes = new Map<string, string>();
    for (const report of dupeReports) {
      const where = report.pages.length > 0 ? report.pages.join(", ") : "not on a page";
      const note = `${report.times}× ${where}`;
      for (const id of report.ids) notes.set(id, note);
    }
    return notes;
  }, [dupeReports]);
  async function checkDuplicates() {
    setChecking("0%");
    setDupes([]);
    setDupeReports([]);
    const items: { id: string; hash: string; placed: boolean; seq: number }[] = [];
    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index];
      const blob = (await getThumbBlob(photo.id)) ?? (await getBlob(photo.id));
      if (blob) {
        try {
          items.push({ id: photo.id, hash: await imageHash(blob), placed: placed.has(photo.id), seq: photo.seq });
        } catch {
          // Skip a photo that cannot be read.
        }
      }
      if (index % 12 === 0) setChecking(`${Math.round((index / Math.max(1, photos.length)) * 100)}%`);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    const found = duplicateIds(items);
    const pagesOf = new Map<string, number[]>();
    pages.forEach((page, index) => {
      for (const slot of page.slots) {
        if (!slot.photoId) continue;
        const list = pagesOf.get(slot.photoId) ?? [];
        const number = index + 1;
        if (!list.includes(number)) list.push(number);
        pagesOf.set(slot.photoId, list);
      }
    });
    setDupes(found.loose);
    const reports = found.groups.map((ids) => {
      const pageHits: number[] = [];
      let looseCount = 0;
      for (const id of ids) {
        const list = pagesOf.get(id) ?? [];
        if (list.length === 0) looseCount += 1;
        else pageHits.push(...list);
      }
      return {
        ids,
        times: pageHits.length + looseCount,
        pages: [...new Set(pageHits)].sort((a, b) => a - b),
        loose: looseCount,
      };
    });
    for (const [id, list] of pagesOf) {
      if (list.length < 2) continue;
      if (reports.some((report) => report.ids.includes(id))) continue;
      reports.push({ ids: [id], times: list.length, pages: [...list].sort((a, b) => a - b), loose: 0 });
    }
    setDupeReports(reports);
    setChecking(null);
  }
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
  const captionOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const page of pages) {
      for (const slot of page.slots) {
        if (!slot.photoId || map.has(slot.photoId)) continue;
        const text = slot.caption.trim();
        const date = slot.takenAt != null ? formatHindiDate(slot.takenAt) : "";
        const year = slot.takenAt != null ? String(new Date(slot.takenAt).getUTCFullYear()) : "";
        map.set(slot.photoId, text && text !== date && text !== year ? text : "");
      }
    }
    return map;
  }, [pages]);
  const needle = query.trim().toLowerCase();
  const visible = ordered.filter((photo) => {
    if (filter === "loose" && placed.has(photo.id)) return false;
    if (needle && !photo.name.toLowerCase().includes(needle)) return false;
    return true;
  });
  const groups = useMemo(() => {
    const buckets = new Map<string, { label: string; sort: number; photos: Photo[] }>();
    for (const photo of visible) {
      const at = photo.takenAt;
      const key = at == null ? "none" : `${new Date(at).getUTCFullYear()}-${new Date(at).getUTCMonth()}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          label: at == null ? "No date" : formatHindiMonth(at),
          sort: at == null ? Number.POSITIVE_INFINITY : Date.UTC(new Date(at).getUTCFullYear(), new Date(at).getUTCMonth(), 1),
          photos: [],
        };
        buckets.set(key, bucket);
      }
      bucket.photos.push(photo);
    }
    return [...buckets.values()]
      .sort((a, b) => a.sort - b.sort)
      .map((bucket) => ({
        ...bucket,
        photos: bucket.photos.slice().sort((a, b) => (a.takenAt ?? 0) - (b.takenAt ?? 0) || a.seq - b.seq),
      }));
  }, [visible]);
  const selectedCaption = useMemo(() => {
    if (!selectedId) return "";
    for (const page of pages) {
      for (const slot of page.slots) {
        if (slot.photoId === selectedId) return slot.caption;
      }
    }
    return "";
  }, [pages, selectedId]);
  const [soloCaption, setSoloCaption] = useState("");
  useEffect(() => {
    setSoloCaption(selectedCaption);
  }, [selectedId, selectedCaption]);
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
    <div className="pane-tight flex h-full min-h-0 flex-col">
      {selectedId && (
        <div className="px-3 pb-1">
          <span className="text-xs text-muted">Caption</span>
          <div className="mt-1 flex items-end gap-1">
            <textarea
              className="field min-h-12 min-w-0 flex-1 py-1 font-serif italic"
              value={soloCaption}
              maxLength={140}
              rows={2}
              placeholder="Caption for this photo"
              onChange={(event) => {
                const value = event.target.value;
                setSoloCaption(value);
                onCaption([selectedId], value);
              }}
            />
            <button type="button" className="btn btn-ink shrink-0 px-3" onClick={() => onCaption([selectedId], soloCaption)}>
              OK
            </button>
          </div>
        </div>
      )}
      <div className="mt-1 flex gap-1 px-3" role="group" aria-label="Library filter">
        <FilterButton active={filter === "all"} onClick={() => onFilter("all")}>
          All
        </FilterButton>
        <FilterButton active={filter === "loose"} onClick={() => onFilter("loose")}>
          Not on a page
        </FilterButton>
      </div>
      <div className="mt-1 flex gap-1 px-3">
        <button
          type="button"
          className="btn btn-quiet min-w-0 flex-1 px-1 py-1 text-center text-[11px] leading-tight whitespace-normal"
          disabled={checking != null || picked.filter((id) => !placed.has(id)).length === 0}
          onClick={() => onArrangeByDate(picked.filter((id) => !placed.has(id)))}
        >
          Arrange selected by date
        </button>
        <button
          type="button"
          className="btn btn-quiet min-w-0 flex-1 px-1 py-1 text-center text-[11px] leading-tight whitespace-normal"
          onClick={() => void checkDuplicates()}
          disabled={busy || checking != null || photos.length < 2}
        >
          {checking != null ? `Checking ${checking}` : "Check duplicates"}
        </button>
        <button
          type="button"
          className={cn("btn min-w-0 flex-1 px-1 py-1 text-center text-[11px] leading-tight whitespace-normal", exchanging ? "btn-ink" : "btn-quiet")}
          aria-pressed={exchanging}
          onClick={onToggleExchange}
        >
          {exchanging ? (exchangePhotoId ? "Pick the other photo" : "Pick the first photo") : "Exchange frames"}
        </button>
      </div>
      {dupes.length > 0 && (
        <button
          type="button"
          className="btn btn-quiet mx-3 mt-1 w-[calc(100%-1.5rem)]"
          disabled={checking != null}
          onClick={() => {
            onDeleteMany(dupes.filter((id) => !placed.has(id)));
            setDupes([]);
          }}
        >
          Remove {dupes.length} extra copies
        </button>
      )}
      <button
        type="button"
        className={cn("btn mx-3 mt-1 w-[calc(100%-1.5rem)]", picking ? "btn-ink" : "btn-quiet")}
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
      {dupeReports.length > 0 && (
        <ul className="mt-1 grid gap-1 px-3 text-xs text-muted">
          {dupeReports.map((report) => (
            <li key={report.ids.join("-")}>
              Same photo, {report.times} times
              {report.pages.length > 0 ? `: pages ${report.pages.join(", ")}` : ""}
              {report.loose > 0 ? `${report.pages.length > 0 ? ", plus" : ":"} ${report.loose} not on a page` : ""}.
            </li>
          ))}
        </ul>
      )}
      {picking && (
        <div className="mt-3 px-4">
          <label className="block">
            <span className="text-sm text-muted">
              {picked.length === 0 ? "Select photos, then type one caption" : `Caption for ${picked.length} photos`}
            </span>
            <div className="mt-1 flex items-end gap-1">
              <textarea
                className="field min-h-16 min-w-0 flex-1 py-2 font-serif italic"
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
              <button
                type="button"
                className="btn btn-ink shrink-0 px-3"
                disabled={picked.length === 0}
                onClick={() => onCaption(picked, draft)}
              >
                OK
              </button>
            </div>
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
      <p className="mt-1 px-3 text-xs text-muted">Drag a photo onto another to change their order.</p>
      {placing && (
        <p className="mx-3 mt-1 rounded-sm bg-caption px-2 py-1 text-xs">
          Tap a frame to place <span className="font-medium">{placing.name}</span>.
        </p>
      )}
      <div ref={scrollRef} className="scroll-library mt-1 min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {photos.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center border border-dashed border-line px-4 py-8 text-center">
            <p className="font-serif text-lg">Drop in a whole set</p>
            <p className="mt-2 max-w-56 text-sm text-pretty text-muted">
              Up to 2,000 photos. Add them from the menu. They flow onto 8×12 pages, one to four a page.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <p className="px-1 py-6 text-sm text-muted">Nothing matches.</p>
        ) : (
          <div className="grid gap-3">
            {groups.map((group) => (
              <section key={group.label}>
                <h3 className="mb-1 font-serif text-sm text-ink">{group.label}</h3>
                <ul className="grid grid-cols-3 gap-1">
                  {group.photos.map((photo) => (
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
                    if (exchanging) {
                      onExchange(photo.id);
                      return;
                    }
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
                    "ring-1 ring-line",
                  )}
                  aria-pressed={picking ? picked.includes(photo.id) : selectedId === photo.id || placingId === photo.id}
                  aria-label={`Place ${photo.name}`}
                >
                  <img src={photo.thumbUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                  {(picking && picked.includes(photo.id)) || selectedId === photo.id || placingId === photo.id || overId === photo.id || exchangePhotoId === photo.id ? (
                    <span className="pointer-events-none absolute inset-0 z-20 border-[3px] border-accent" />
                  ) : null}
                  {photo.takenAt != null && (
                    <span className="absolute inset-x-0 bottom-0 z-10 truncate bg-ink/80 px-0.5 text-center text-[8px] leading-4 text-page">
                      {formatHindiDate(photo.takenAt)}
                    </span>
                  )}
                  <span
                    className={cn(
                      "absolute inset-x-0 z-10 truncate px-0.5 text-center text-[8px] leading-4",
                      photo.takenAt != null ? "bottom-4" : "bottom-0",
                      captionOf.get(photo.id) ? "bg-page/90 text-ink" : "bg-caption text-muted",
                    )}
                  >
                    {captionOf.get(photo.id) || "No caption"}
                  </span>
                  {picking && picked.includes(photo.id) && (
                    <span className="absolute top-1 left-1 flex size-5 items-center justify-center rounded-full bg-accent text-[10px] text-page">✓</span>
                  )}
                  {dupeNote.has(photo.id) && (
                    <span className="absolute top-1 right-1 z-30 max-w-[90%] truncate rounded-sm bg-accent px-1 text-[10px] leading-4 text-page">
                      {dupeNote.get(photo.id)}
                    </span>
                  )}
                  {pageOf.has(photo.id) ? (
                    <span className="absolute top-1 left-1 z-30 rounded-sm bg-ink/80 px-1 text-[10px] leading-4 text-page">
                      {pageOf.get(photo.id)?.join(", ")}
                    </span>
                  ) : null}
                </button>
              </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
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
        "min-h-7 flex-1 rounded-sm px-2 text-xs",
        active ? "bg-ink text-page" : "bg-caption text-ink",
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
