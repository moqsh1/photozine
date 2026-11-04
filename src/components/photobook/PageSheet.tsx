import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { containZoom, imageBox } from "@/lib/photobook/crop";
import { formatHindiDate, isHindiDate } from "@/lib/photobook/date";
import { cellRects, fitLandscapeOverPortraits, landscapeOverPortraitAspects, rectToPercent } from "@/lib/photobook/geometry";
import { LAYOUT_BY_ID } from "@/lib/photobook/layouts";
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
  placing?: boolean;
  onSelectSlot?: (index: number) => void;
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
  placing = false,
  onSelectSlot,
  onCommitPan,
  onDropPhoto,
  onSwap,
  onImport,
}: PageSheetProps) {
  const inches = PAGE_INCHES[orientation];
  const layout = LAYOUT_BY_ID[page.layout];
  const trio =
    page.layout === "three-banner"
      ? landscapeOverPortraitAspects(page.slots.map((slot) => (slot.photoId ? photoById.get(slot.photoId) : undefined)))
      : null;
  const rects = trio
    ? fitLandscapeOverPortraits(inches.w, inches.h, marginIn, gapIn, captionIn, trio)
    : cellRects(layout.areas, inches.w, inches.h, marginIn, gapIn);

  return (
    <div
      className="page-sheet relative h-full w-full bg-page"
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
            uncropped={Boolean(trio)}
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
  uncropped = false,
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
  uncropped?: boolean;
  onSelectSlot?: (index: number) => void;
  onCommitPan?: (index: number, panX: number, panY: number) => void;
  onDropPhoto?: (index: number, photoId: string) => void;
  onSwap?: (index: number, fromPageId: string, fromIndex: number) => void;
  onImport?: (index: number) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const liveRef = useRef<{ panX: number; panY: number } | null>(null);
  const [live, setLive] = useState<{ panX: number; panY: number } | null>(null);
  const [over, setOver] = useState(false);
  const formatted = slot.takenAt != null ? formatHindiDate(slot.takenAt) : "";
  const dateInCaption = Boolean(formatted) && slot.caption.includes(formatted);
  const dateLabel = formatted && !dateInCaption ? formatted : "";
  const captionFrac = Math.min(0.42, captionIn / rect.h);
  const imageH = rect.h * (1 - captionFrac);
  const frameAspect = rect.w / Math.max(0.05, imageH);
  const pan = uncropped ? { panX: 0, panY: 0 } : (live ?? { panX: slot.panX, panY: slot.panY });
  const zoom = uncropped && photo ? containZoom(frameAspect, photo) : slot.zoom;
  const box = photo ? imageBox(frameAspect, photo, zoom, pan.panX, pan.panY) : null;
  const shownSrc = src || photo?.thumbUrl;
  const style = rectToPercent(rect, pageW, pageH);

  function commit() {
    const next = liveRef.current;
    if (next) onCommitPan?.(index, next.panX, next.panY);
    liveRef.current = null;
    setLive(null);
    drag.current = null;
  }

  return (
    <div
      className={cn(
        "absolute overflow-hidden bg-well",
        interactive && selected && "z-10 ring-2 ring-accent ring-inset",
        interactive && over && "ring-2 ring-accent ring-inset",
      )}
      style={style}
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
        className={cn("absolute inset-x-0 top-0 overflow-hidden", interactive && photo && !uncropped && "reframe")}
        style={{ bottom: `${captionFrac * 100}%` }}
        onPointerDown={
          interactive
            ? (event) => {
                if (!photo || event.button !== 0) return;
                onSelectSlot?.(index);
                if (uncropped || placing) return;
                const frame = frameRef.current;
                if (!frame || !box) return;
                frame.setPointerCapture(event.pointerId);
                drag.current = { x: event.clientX, y: event.clientY, panX: slot.panX, panY: slot.panY };
              }
            : undefined
        }
        onPointerMove={
          interactive
            ? (event) => {
                const start = drag.current;
                const frame = frameRef.current;
                if (!start || !frame || !box || !photo) return;
                const dx = event.clientX - start.x;
                const dy = event.clientY - start.y;
                if (Math.abs(dx) + Math.abs(dy) < 3 && !liveRef.current) return;
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
        onPointerUp={interactive ? () => commit() : undefined}
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
          <img
            src={shownSrc}
            alt={slot.caption || photo.name}
            draggable={false}
            className="absolute max-w-none select-none"
            style={{
              left: `${box.left}%`,
              top: `${box.top}%`,
              width: `${box.width}%`,
              height: `${box.height}%`,
            }}
          />
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
            className="absolute top-1 left-1 z-10 flex size-8 cursor-grab items-center justify-center rounded-sm bg-page/90 text-ink active:cursor-grabbing"
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
            <CaptionLines caption={slot.caption} dateLabel={dateLabel} placeholder={dateLabel ? undefined : "Add a caption"} />
          </button>
        ) : (
          <div className="flex h-full w-full items-center justify-center overflow-hidden px-2 text-center">
            <CaptionLines caption={slot.caption} dateLabel={dateLabel} />
          </div>
        )}
      </div>
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
