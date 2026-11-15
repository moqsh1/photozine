import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { adjustFilter, vignetteStrength } from "@/lib/photobook/adjust";
import { imageBox, orientedSize, placedImageStyle } from "@/lib/photobook/crop";
import { isHindiDate, visibleCaption } from "@/lib/photobook/date";
import { pageFrameRects, rectToPercent } from "@/lib/photobook/geometry";
import { PAGE_INCHES, type Orientation, type Page, type Photo, type Slot } from "@/lib/photobook/types";
import { cn } from "@/lib/cn";

const PHOTO_MIME = "application/x-folio-photo";
const SLOT_MIME = "application/x-folio-slot";

type PageSheetProps = {
  page: Page;
  orientation: Orientation;
  marginIn: number;
  gapIn: number;
  captionIn: number;
  photoById: Map<string, Photo>;
  fullUrls: Record<string, string>;
  pageNumber?: number;
  interactive?: boolean;
  selectedSlot?: number | null;
  pageSelected?: boolean;
  placing?: boolean;
  onSelectSlot?: (index: number) => void;
  onDeselect?: () => void;
  onCommitPan?: (index: number, panX: number, panY: number) => void;
  onDropPhoto?: (index: number, photoId: string) => void;
  onSwap?: (index: number, fromPageId: string, fromIndex: number) => void;
  onImport?: (index: number) => void;
};

export function PageSheet({
  page,
  orientation,
  marginIn,
  gapIn,
  captionIn,
  photoById,
  fullUrls,
  pageNumber,
  interactive = false,
  selectedSlot = null,
  pageSelected = false,
  placing = false,
  onSelectSlot,
  onDeselect,
  onCommitPan,
  onDropPhoto,
  onSwap,
  onImport,
}: PageSheetProps) {
  const inches = PAGE_INCHES[orientation];
  const [hot, setHot] = useState<number | null>(null);
  const rects = pageFrameRects(
    page.layout,
    page.split,
    page.splitL,
    page.splitR,
    page.splitW,
    page.slots.map((slot) => (slot.photoId ? photoById.get(slot.photoId) : undefined)),
    inches.w,
    inches.h,
    marginIn,
    gapIn,
    captionIn,
  );

  return (
    <div
      className={cn("page-sheet relative h-full w-full bg-page", interactive && pageSelected && "ring-4 ring-inset ring-ink")}
      onClick={
        interactive
          ? (event) => {
              if ((event.target as HTMLElement).closest("[data-slot]")) return;
              onDeselect?.();
            }
          : undefined
      }
      onDragOver={
        interactive
          ? (event) => {
              if (event.dataTransfer.types.includes(PHOTO_MIME) || event.dataTransfer.types.includes(SLOT_MIME)) {
                event.preventDefault();
              }
            }
          : undefined
      }
      onDrop={
        interactive
          ? (event) => {
              const slotRef = event.dataTransfer.getData(SLOT_MIME);
              const photoId = event.dataTransfer.getData(PHOTO_MIME);
              if (!slotRef && !photoId) return;
              event.preventDefault();
              const empty = page.slots.findIndex((slot) => !slot.photoId);
              const index = selectedSlot != null && page.slots[selectedSlot] ? selectedSlot : empty >= 0 ? empty : 0;
              if (slotRef) {
                const [fromPageId, fromIndex] = slotRef.split("|");
                if (fromPageId && fromIndex != null) onSwap?.(index, fromPageId, Number(fromIndex));
                return;
              }
              if (photoId) onDropPhoto?.(index, photoId);
            }
          : undefined
      }
    >
      {rects.map((rect, index) => {
        const slot = page.slots[index];
        if (!slot) return null;
        return (
          <Frame
            key={index}
            pageId={page.id}
            index={index}
            rect={rect}
            pageW={inches.w}
            pageH={inches.h}
            captionIn={captionIn}
            slot={slot}
            photo={slot.photoId ? photoById.get(slot.photoId) : undefined}
            src={slot.photoId ? fullUrls[slot.photoId] : undefined}
            interactive={interactive}
            selected={selectedSlot === index}
            placing={placing}
            hot={hot === index}
            onHot={setHot}
            onSelectSlot={onSelectSlot}
            onCommitPan={onCommitPan}
            onDropPhoto={onDropPhoto}
            onSwap={onSwap}
            onImport={onImport}
          />
        );
      })}
      {pageNumber != null && (
        <p className="page-folio pointer-events-none absolute z-20 text-right font-serif text-ink tabular-nums" style={{ right: "2.4%", bottom: "1.1%" }}>
          <span className="bg-page/90 px-1.5">{pageNumber}</span>
        </p>
      )}
    </div>
  );
}

function Frame({
  pageId,
  index,
  rect,
  pageW,
  pageH,
  captionIn,
  slot,
  photo,
  src,
  interactive,
  selected,
  placing,
  hot = false,
  onHot,
  onSelectSlot,
  onCommitPan,
  onDropPhoto,
  onSwap,
  onImport,
}: {
  pageId: string;
  index: number;
  rect: { x: number; y: number; w: number; h: number };
  pageW: number;
  pageH: number;
  captionIn: number;
  slot: Slot;
  photo?: Photo;
  src?: string;
  interactive: boolean;
  selected: boolean;
  placing: boolean;
  hot?: boolean;
  onHot?: (index: number | null) => void;
  onSelectSlot?: (index: number) => void;
  onCommitPan?: (index: number, panX: number, panY: number) => void;
  onDropPhoto?: (index: number, photoId: string) => void;
  onSwap?: (index: number, fromPageId: string, fromIndex: number) => void;
  onImport?: (index: number) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number; mode: "pending" | "pan" | "swap"; to: number | null } | null>(null);
  const liveRef = useRef<{ panX: number; panY: number } | null>(null);
  const [live, setLive] = useState<{ panX: number; panY: number } | null>(null);
  const [over, setOver] = useState(false);
  const shownCaption = visibleCaption(slot.caption, slot.takenAt, Boolean(slot.yearOnly));
  const hindiCaption = /[\u0900-\u097F]/.test(shownCaption);
  const captionFrac = Math.min(0.48, (captionIn * (hindiCaption ? 1.28 : 1)) / rect.h);
  const imageH = rect.h * (1 - captionFrac);
  const frameAspect = rect.w / Math.max(0.05, imageH);
  const pan = live ?? { panX: slot.panX, panY: slot.panY };
  const turn = slot.turn ?? 0;
  const oriented = photo ? orientedSize(photo, turn) : null;
  const zoom = slot.zoom;
  const box = oriented ? imageBox(frameAspect, oriented, zoom, pan.panX, pan.panY) : null;
  const shownSrc = src || photo?.thumbUrl;
  const style = rectToPercent(rect, pageW, pageH);

  function commit() {
    const next = liveRef.current;
    if (next) onCommitPan?.(index, next.panX, next.panY);
    liveRef.current = null;
    setLive(null);
    drag.current = null;
    onHot?.(null);
  }

  function frameUnder(x: number, y: number): number | null {
    const slotEl = frameRef.current?.parentElement;
    const previous = slotEl?.style.pointerEvents ?? "";
    if (slotEl) slotEl.style.pointerEvents = "none";
    const hit = document.elementFromPoint(x, y)?.closest("[data-slot]");
    if (slotEl) slotEl.style.pointerEvents = previous;
    if (!hit) return null;
    if (hit.getAttribute("data-page") !== pageId) return null;
    const slotIndex = Number(hit.getAttribute("data-slot"));
    if (!Number.isInteger(slotIndex) || slotIndex === index) return null;
    return slotIndex;
  }

  return (
    <div
      className={cn(
        "absolute overflow-hidden bg-well",
        interactive && selected && "z-20",
        interactive && (over || hot) && "z-10 ring-2 ring-accent ring-inset",
      )}
      style={style}
      data-page={pageId}
      data-slot={index}
      onDragOver={
        interactive
          ? (event) => {
              if (
                event.dataTransfer.types.includes(PHOTO_MIME) ||
                event.dataTransfer.types.includes(SLOT_MIME)
              ) {
                event.preventDefault();
                setOver(true);
              }
            }
          : undefined
      }
      onDragLeave={interactive ? () => setOver(false) : undefined}
      onDrop={
        interactive
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              setOver(false);
              const photoId = event.dataTransfer.getData(PHOTO_MIME);
              const slotRef = event.dataTransfer.getData(SLOT_MIME);
              if (slotRef) {
                const [fromPageId, fromIndex] = slotRef.split("|");
                if (fromPageId && fromIndex != null) onSwap?.(index, fromPageId, Number(fromIndex));
                return;
              }
              if (photoId) onDropPhoto?.(index, photoId);
            }
          : undefined
      }
    >
      <div
        ref={frameRef}
        className={cn(
          "absolute inset-x-0 top-0 overflow-hidden touch-none",
          interactive && photo && "reframe",
        )}
        style={{ bottom: `${captionFrac * 100}%` }}
        onPointerDown={
          interactive
            ? (event) => {
                if (!photo || event.button !== 0) return;
                onSelectSlot?.(index);
                if (placing) return;
                const frame = frameRef.current;
                if (!frame) return;
                frame.setPointerCapture(event.pointerId);
                drag.current = { x: event.clientX, y: event.clientY, panX: slot.panX, panY: slot.panY, mode: "pending", to: null };
              }
            : undefined
        }
        onPointerMove={
          interactive
            ? (event) => {
                const start = drag.current;
                const frame = frameRef.current;
                if (!start || !frame || !photo) return;
                const dx = event.clientX - start.x;
                const dy = event.clientY - start.y;
                if (start.mode === "pending" && Math.abs(dx) + Math.abs(dy) < 8) return;
                const target = frameUnder(event.clientX, event.clientY);
                if (target != null) {
                  start.mode = "swap";
                  start.to = target;
                  onHot?.(target);
                  if (liveRef.current) {
                    liveRef.current = null;
                    setLive(null);
                  }
                  return;
                }
                if (start.mode === "swap") {
                  start.mode = "pending";
                  start.to = null;
                  onHot?.(null);
                }
                if (!box) return;
                start.mode = "pan";
                const slackPxX = (box.slackX / 100) * frame.clientWidth;
                const slackPxY = (box.slackY / 100) * frame.clientHeight;
                const followX = box.width < 100 ? 1 : -1;
                const followY = box.height < 100 ? 1 : -1;
                const next = {
                  panX: slackPxX > 1 ? Math.min(1, Math.max(-1, start.panX + (followX * dx * 2) / slackPxX)) : start.panX,
                  panY: slackPxY > 1 ? Math.min(1, Math.max(-1, start.panY + (followY * dy * 2) / slackPxY)) : start.panY,
                };
                liveRef.current = next;
                setLive(next);
              }
            : undefined
        }
        onPointerUp={
          interactive
            ? () => {
                const start = drag.current;
                if (start?.mode === "swap" && start.to != null) {
                  onSwap?.(start.to, pageId, index);
                  liveRef.current = null;
                  setLive(null);
                  drag.current = null;
                  onHot?.(null);
                  return;
                }
                commit();
              }
            : undefined
        }
        onPointerCancel={interactive ? () => commit() : undefined}
        onDoubleClick={
          interactive && photo
            ? (event) => {
                event.preventDefault();
                onCommitPan?.(index, 0, 0);
                setLive(null);
              }
            : undefined
        }
      >
        {photo && box && shownSrc ? (
          <>
            <img
              src={shownSrc}
              alt={slot.caption || photo.name}
              draggable={false}
              className="pointer-events-none absolute max-w-none select-none"
              style={{ ...placedImageStyle(box, turn, frameAspect), filter: adjustFilter(slot.adjust) }}
            />
            {vignetteStrength(slot.adjust) > 0 && (
              <span
                className="pointer-events-none absolute inset-0"
                style={{
                  background: `radial-gradient(circle, transparent 42%, rgba(0,0,0,${(vignetteStrength(slot.adjust) * 0.72).toFixed(3)}) 100%)`,
                }}
              />
            )}
          </>
        ) : (
          interactive && (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-2 text-center text-muted">
              <span className="font-serif text-sm italic">{placing ? "Place here" : "Empty frame"}</span>
              {!placing && (
                <button
                  type="button"
                  className="btn btn-quiet px-3 text-sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectSlot?.(index);
                    onImport?.(index);
                  }}
                >
                  Import
                </button>
              )}
            </div>
          )
        )}
        {interactive && photo && (
          <div
            className="absolute top-1.5 left-1.5 z-30 flex size-9 cursor-grab items-center justify-center rounded-sm bg-page/95 text-ink shadow-sm ring-1 ring-line active:cursor-grabbing"
            draggable
            aria-label="Drag to swap with another frame"
            onPointerDown={(event) => event.stopPropagation()}
            onDragStart={(event) => {
              event.dataTransfer.setData(SLOT_MIME, `${pageId}|${index}`);
              event.dataTransfer.setData(PHOTO_MIME, slot.photoId ?? "");
              event.dataTransfer.effectAllowed = "move";
            }}
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="caption-band absolute inset-x-0 bottom-0 border-t border-line bg-caption text-ink" style={{ height: `${captionFrac * 100}%` }}>
        {interactive && photo ? (
          <button
            type="button"
            className="flex h-full w-full items-center justify-center overflow-hidden px-2 text-center"
            onClick={() => onSelectSlot?.(index)}
          >
            <CaptionLines caption={shownCaption} dateLabel="" placeholder={shownCaption ? undefined : "Add a caption"} />
          </button>
        ) : (
          <div className="flex h-full w-full items-center justify-center overflow-hidden px-2 text-center">
            <CaptionLines caption={shownCaption} dateLabel="" />
          </div>
        )}
      </div>
      {interactive && selected && (
        <span className="frame-selected pointer-events-none absolute inset-0 z-40">
          <span className="absolute top-1.5 right-1.5 bg-accent px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-page uppercase">
            Selected
          </span>
        </span>
      )}
    </div>
  );
}

function CaptionLines({ caption, dateLabel, placeholder }: { caption: string; dateLabel: string; placeholder?: string }) {
  const text = [caption || placeholder || "", dateLabel].filter(Boolean).join(" ");
  const hindi = isHindiDate(text) || /[\u0900-\u097F]/.test(text);
  return (
    <span
      className={cn("caption-copy", hindi ? "" : "font-serif italic", !caption && !dateLabel && "text-muted")}
      style={hindi ? { fontFamily: '"Noto Sans Devanagari", sans-serif' } : undefined}
    >
      {text}
    </span>
  );
}

export { PHOTO_MIME, SLOT_MIME };
