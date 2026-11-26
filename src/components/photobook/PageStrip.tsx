import { memo, useEffect, useRef, useState } from "react";
import { GripVertical, Lock, LockOpen } from "lucide-react";
import { adjustFilter } from "@/lib/photobook/adjust";
import { PHOTO_MIME, SLOT_MIME } from "@/components/photobook/PageSheet";
import { pageFrameRects, rectToPercent } from "@/lib/photobook/geometry";
import { PAGE_INCHES, type Orientation, type Page, type Photo } from "@/lib/photobook/types";
import { cn } from "@/lib/cn";

const PAGE_MIME = "application/x-folio-page";

type PageStripProps = {
  pages: Page[];
  activePageId: string | null;
  orientation: Orientation;
  marginIn: number;
  gapIn: number;
  captionIn: number;
  photoById: Map<string, Photo>;
  onSelect: (id: string) => void;
  onReorder: (fromId: string, toId: string) => void;
  onAddPhoto: (pageId: string, photoId: string) => void;
  onToggleLock: (pageId: string) => void;
  onReorderPhotos: (fromId: string, toId: string) => void;
  picking: boolean;
  pickedIds: string[];
  onTogglePick: (id: string) => void;
  onPickMode: (on: boolean) => void;
  onClearPicked: () => void;
  exchanging: boolean;
  exchangeReady: boolean;
  onToggleExchange: () => void;
};

export const PageStrip = memo(function PageStrip({
  pages,
  activePageId,
  orientation,
  marginIn,
  gapIn,
  captionIn,
  photoById,
  onSelect,
  onReorder,
  onAddPhoto,
  onToggleLock,
  onReorderPhotos,
  picking,
  pickedIds,
  onTogglePick,
  onPickMode,
  onClearPicked,
  exchanging,
  exchangeReady,
  onToggleExchange,
}: PageStripProps) {
  const ratio = PAGE_INCHES[orientation];
  const [overPhoto, setOverPhoto] = useState<string | null>(null);
  const [overPage, setOverPage] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = rootRef.current?.querySelector("[aria-current='page']");
    if (node instanceof HTMLElement) node.scrollIntoView({ block: "nearest" });
  }, [activePageId]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 px-2 pt-2">
        <button type="button" className={cn("btn min-w-0 flex-1 px-1", picking ? "btn-ink" : "btn-quiet")} onClick={() => onPickMode(!picking)}>
          {picking ? "Done" : "Select pages"}
        </button>
        <button
          type="button"
          className={cn("btn min-w-0 flex-1 px-1", exchanging ? "btn-ink" : "btn-quiet")}
          aria-pressed={exchanging}
          onClick={onToggleExchange}
        >
          {exchanging ? (exchangeReady ? "Pick the other" : "Pick the first") : "Exchange frames"}
        </button>
      </div>
      {picking && (
        <button type="button" className="btn btn-quiet mx-3 mt-2" disabled={pickedIds.length === 0} onClick={onClearPicked}>
          Clear captions{pickedIds.length > 0 ? ` (${pickedIds.length})` : ""}
        </button>
      )}
      <div ref={rootRef} className="scroll-pages grid min-h-0 flex-1 grid-cols-3 content-start gap-1.5 overflow-x-hidden overflow-y-auto px-2 py-2" aria-label="Pages">
      {pages.map((page, index) => {
        const rects = pageFrameRects(
          page.layout,
          page.split,
          page.splitL,
          page.splitR,
          page.splitW,
          page.slots.map((slot) => (slot.photoId ? photoById.get(slot.photoId) : undefined)),
          ratio.w,
          ratio.h,
          marginIn,
          gapIn,
          captionIn,
        );
        const active = page.id === activePageId;
        return (
          <button
            key={page.id}
            type="button"
            draggable
            onDragStart={(event) => {
              if ((event.target as HTMLElement).closest("[data-frame-photo]")) {
                event.preventDefault();
                return;
              }
              event.dataTransfer.setData(PAGE_MIME, page.id);
              event.dataTransfer.setData("text/plain", String(index + 1));
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              const types = event.dataTransfer.types;
              if (!types.includes(PAGE_MIME) && !types.includes(PHOTO_MIME)) return;
              event.preventDefault();
              event.stopPropagation();
              if (overPage !== page.id) setOverPage(page.id);
            }}
            onDragLeave={() => setOverPage((current) => (current === page.id ? null : current))}
            onDrop={(event) => {
              const fromPage = event.dataTransfer.getData(PAGE_MIME);
              const photoId = event.dataTransfer.getData(PHOTO_MIME);
              const slotRef = event.dataTransfer.getData(SLOT_MIME);
              setOverPage(null);
              if (fromPage) {
                event.preventDefault();
                onReorder(fromPage, page.id);
                return;
              }
              if (photoId && !slotRef) {
                event.preventDefault();
                onAddPhoto(page.id, photoId);
              }
            }}
            onClick={() => (picking ? onTogglePick(page.id) : onSelect(page.id))}
            className={cn(
              "thumb-cell w-full shrink-0 text-left",
              active ? "opacity-100" : "opacity-80",
              overPage === page.id && "ring-2 ring-accent",
            )}
            aria-current={active ? "page" : undefined}
            aria-pressed={picking ? pickedIds.includes(page.id) : undefined}
            aria-label={`Page ${index + 1}`}
          >
            <div
              className={cn(
                "relative bg-page",
                picking && pickedIds.includes(page.id) ? "ring-2 ring-accent" : active ? "ring-2 ring-accent" : "ring-1 ring-line",
              )}
              style={{ aspectRatio: `${ratio.w} / ${ratio.h}` }}
            >
              {rects.map((rect, slotIndex) => {
                const photoId = page.slots[slotIndex]?.photoId;
                const photo = photoId ? photoById.get(photoId) : undefined;
                const box = rectToPercent(rect, ratio.w, ratio.h);
                const captionFrac = Math.min(0.48, captionIn / Math.max(rect.h, 0.05));
                return (
                  <span
                    key={slotIndex}
                    data-frame-photo={photo ? "" : undefined}
                    draggable={Boolean(photo)}
                    title={photo ? "Drag onto the selected page" : undefined}
                    onDragStart={
                      photo
                        ? (event) => {
                            event.stopPropagation();
                            event.dataTransfer.setData(SLOT_MIME, `${page.id}|${slotIndex}`);
                            event.dataTransfer.setData(PHOTO_MIME, photoId ?? "");
                            event.dataTransfer.effectAllowed = "move";
                          }
                        : undefined
                    }
                    onDragOver={
                      photo
                        ? (event) => {
                            if (event.dataTransfer.types.includes(PAGE_MIME)) {
                              event.preventDefault();
                              event.stopPropagation();
                              if (overPage !== page.id) setOverPage(page.id);
                              return;
                            }
                            if (!event.dataTransfer.types.includes(PHOTO_MIME) && !event.dataTransfer.types.includes(SLOT_MIME)) return;
                            event.preventDefault();
                            event.stopPropagation();
                            if (overPhoto !== photo.id) setOverPhoto(photo.id);
                          }
                        : undefined
                    }
                    onDragLeave={photo ? () => setOverPhoto((current) => (current === photo.id ? null : current)) : undefined}
                    onDrop={
                      photo
                        ? (event) => {
                            const movingPage = event.dataTransfer.getData(PAGE_MIME);
                            const slotRef = event.dataTransfer.getData(SLOT_MIME);
                            if (movingPage) {
                              event.preventDefault();
                              event.stopPropagation();
                              setOverPage(null);
                              onReorder(movingPage, page.id);
                              return;
                            }
                            event.preventDefault();
                            event.stopPropagation();
                            setOverPhoto(null);
                            const fromId = event.dataTransfer.getData(PHOTO_MIME);
                            if (fromId && !slotRef) {
                              onAddPhoto(page.id, fromId);
                              return;
                            }
                            if (fromId) onReorderPhotos(fromId, photo.id);
                          }
                        : undefined
                    }
                    className={cn(
                      "absolute overflow-hidden bg-page",
                      photo && "cursor-grab active:cursor-grabbing",
                      photo && overPhoto === photo.id && "ring-2 ring-accent ring-inset",
                    )}
                    style={box}
                  >
                    {photo && (
                      <img
                        src={photo.thumbUrl}
                        alt=""
                        className="pointer-events-none absolute inset-x-0 top-0 w-full object-cover"
                        style={{
                          height: `${(1 - captionFrac) * 100}%`,
                          objectPosition: `${((page.slots[slotIndex].panX + 1) / 2) * 100}% ${((page.slots[slotIndex].panY + 1) / 2) * 100}%`,
                          transform: `rotate(${(page.slots[slotIndex].turn ?? 0) * 90}deg) scale(${page.slots[slotIndex].zoom})`,
                          filter: adjustFilter(page.slots[slotIndex].adjust),
                        }}
                      />
                    )}
                  </span>
                );
              })}
              <span
                role="button"
                tabIndex={0}
                className="absolute top-1 left-1 z-10 flex size-6 items-center justify-center rounded-full bg-page/95 text-ink ring-1 ring-line"
                aria-label={page.locked ? "Unlock page" : "Lock page"}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleLock(page.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  onToggleLock(page.id);
                }}
              >
                {page.locked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
              </span>
            </div>
            <span className="mt-1 flex cursor-grab items-center justify-center gap-1 text-xs text-muted tabular-nums active:cursor-grabbing">
              <GripVertical className="size-3.5" aria-hidden="true" />
              {index + 1}
              {picking && pickedIds.includes(page.id) ? " ✓" : ""}
            </span>
          </button>
        );
      })}
      </div>
    </div>
  );
});
