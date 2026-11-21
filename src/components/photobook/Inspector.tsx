import { memo, useEffect, useState, type ReactNode } from "react";
import * as Slider from "@radix-ui/react-slider";
import { ChevronLeft, ChevronRight, ClipboardPaste, Copy, Plus, RotateCw, Scissors, Trash2 } from "lucide-react";
import { ADJUST_FIELDS, type Adjust } from "@/lib/photobook/adjust";
import { LAYOUTS, LAYOUT_BY_ID } from "@/lib/photobook/layouts";
import {
  LIMITS,
  PAGE_INCHES,
  type Density,
  type LayoutId,
  type Orientation,
  type Page,
  type Photo,
} from "@/lib/photobook/types";
import { cn } from "@/lib/cn";

type InspectorProps = {
  page: Page | null;
  pageCount: number;
  pageIndex: number;
  orientation: Orientation;
  marginIn: number;
  gapIn: number;
  captionIn: number;
  density: Density;
  photo?: Photo;
  caption: string;
  dateIso: string;
  zoom: number;
  adjust: Adjust;
  selectedCount: number;
  hasPhoto: boolean;
  onLayout: (layout: LayoutId) => void;
  onGridStack: () => void;
  canGridStack: boolean;
  onSplit: (split: number | null, part?: "top" | "left" | "right" | "width") => void;
  onCaption: (value: string) => void;
  onDate: (iso: string) => void;
  onZoom: (zoom: number) => void;
  onAdjust: (patch: Partial<Adjust>) => void;
  onApplyAdjust: () => void;
  onResetAdjust: () => void;
  onResetCrop: () => void;
  onCenter: () => void;
  onRotate: () => void;
  onClearSlot: () => void;
  canPaste: boolean;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onMargin: (value: number) => void;
  onGap: (value: number) => void;
  onCaptionSize: (value: number) => void;
  onOrientation: (orientation: Orientation) => void;
  onDensity: (density: Density) => void;
  onAddPage: () => void;
  onDuplicate: () => void;
  onDeletePage: () => void;
  onSelectPage: () => void;
  pageSelected: boolean;
  onClearPageCaptions: () => void;
  onClearCaption: () => void;
  yearOnly: boolean;
  onYearOnly: (yearOnly: boolean) => void;
  onMove: (dir: -1 | 1) => void;
  onPlaceAt: (pageNumber: number) => void;
  onClearPages: () => void;
  onDeletePhotos: () => void;
  restorePoints: { id: string; at: number; photos: number; pages: number }[];
  onRestore: (id: string) => void;
};

export const Inspector = memo(function Inspector(props: InspectorProps) {
  const size = PAGE_INCHES[props.orientation];
  const [spot, setSpot] = useState(String(props.pageIndex + 1));
  useEffect(() => {
    setSpot(String(props.pageIndex + 1));
  }, [props.pageIndex, props.page?.id]);
  return (
    <div className="pane-tight scroll-thin flex h-full min-h-0 flex-col overflow-y-auto text-[13px]">
      <section className="px-3 pt-2 pb-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-serif text-lg">This page</h2>
          <p className="text-xs text-muted tabular-nums">
            {props.pageIndex + 1} / {props.pageCount}
          </p>
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {size.w} × {size.h} in · {props.page ? LAYOUT_BY_ID[props.page.layout].slots : 0} frames
          {props.pageSelected ? " · Page selected" : ""}
        </p>
        <button type="button" className={cn("btn mt-1.5 w-full", props.pageSelected ? "btn-ink" : "btn-quiet")} onClick={props.onSelectPage}>
          Select page
        </button>
        <button type="button" className="btn btn-quiet mt-1 w-full" onClick={props.onClearPageCaptions} disabled={!props.page}>
          Clear page captions
        </button>
        <div className="mt-1.5 flex gap-1" role="group" aria-label="Page layout">
          {LAYOUTS.filter((layout) => layout.id !== "three-feature" && layout.id !== "three-cols" && layout.id !== "half").map((layout) => {
            const active = props.page?.layout === layout.id;
            return (
              <button
                key={layout.id}
                type="button"
                aria-pressed={active}
                aria-label={layout.hint}
                onClick={() => props.onLayout(layout.id)}
                className={cn(
                  "flex min-h-8 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-sm px-0.5 py-1",
                  active ? "bg-ink text-page" : "bg-caption text-ink",
                )}
              >
                <LayoutGlyph layoutId={layout.id} active={active} />
                <span className="text-[10px] leading-none">{layout.name}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="btn btn-quiet mt-1.5 w-full" onClick={props.onGridStack} disabled={!props.canGridStack}>
          Two pages: stack + grid
        </button>
        <div className="mt-1.5 flex items-end gap-1">
          <label className="min-w-0 flex-1">
            <span className="text-xs text-muted">Move this page to</span>
            <input
              className="field mt-1"
              type="number"
              inputMode="numeric"
              min={1}
              max={props.pageCount}
              value={spot}
              aria-label="Page number to move to"
              onChange={(event) => setSpot(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                props.onPlaceAt(Number(spot));
              }}
            />
          </label>
          <button type="button" className="btn btn-ink" onClick={() => props.onPlaceAt(Number(spot))}>
            Place
          </button>
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1">
          <IconButton label="Previous page" onClick={() => props.onMove(-1)} disabled={props.pageIndex <= 0}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <IconButton label="Next page" onClick={() => props.onMove(1)} disabled={props.pageIndex >= props.pageCount - 1}>
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
        <div className="mt-1 grid grid-cols-3 gap-1">
          <button type="button" className="btn btn-quiet flex-col gap-0.5 px-1 text-[11px]" onClick={props.onDuplicate}>
            <Copy className="size-3.5" aria-hidden="true" />
            Duplicate
          </button>
          <button type="button" className="btn btn-quiet flex-col gap-0.5 px-1 text-[11px]" onClick={props.onAddPage}>
            <Plus className="size-3.5" aria-hidden="true" />
            Add page
          </button>
          <button type="button" className="btn btn-quiet flex-col gap-0.5 px-1 text-[11px]" onClick={props.onDeletePage}>
            <Trash2 className="size-3.5" aria-hidden="true" />
            Remove page
          </button>
        </div>
      </section>

      <section className="border-t border-line px-4 py-4">
        <h2 className="font-serif text-xl">Frame</h2>
        {props.hasPhoto && (
          <InchSlider
            className="mt-3"
            label="Crop zoom"
            display={`${Math.round(props.zoom * 100)}%`}
            min={LIMITS.zoom.min}
            max={LIMITS.zoom.max}
            step={LIMITS.zoom.step}
            value={props.zoom}
            onChange={props.onZoom}
          />
        )}
        <div className="mt-3 grid grid-cols-4 gap-2">
          <button type="button" className="btn btn-quiet flex-col gap-1 px-1 text-xs" onClick={props.onCut} disabled={!props.hasPhoto}>
            <Scissors className="size-4" aria-hidden="true" />
            Cut
          </button>
          <button type="button" className="btn btn-quiet flex-col gap-1 px-1 text-xs" onClick={props.onCopy} disabled={!props.hasPhoto}>
            <Copy className="size-4" aria-hidden="true" />
            Copy
          </button>
          <button type="button" className="btn btn-quiet flex-col gap-1 px-1 text-xs" onClick={props.onPaste} disabled={!props.canPaste}>
            <ClipboardPaste className="size-4" aria-hidden="true" />
            Paste
          </button>
          <button type="button" className="btn btn-quiet flex-col gap-1 px-1 text-xs" onClick={props.onClearSlot} disabled={!props.hasPhoto}>
            <Trash2 className="size-4" aria-hidden="true" />
            Delete
          </button>
        </div>
        {props.hasPhoto ? (
          <>
            <label className="mt-3 block">
              <span className="text-sm text-muted">Caption along the bottom border</span>
              <textarea
                className="field mt-2 min-h-20 py-2 font-serif italic"
                value={props.caption}
                maxLength={140}
                rows={2}
                placeholder="A line under this photo"
                onChange={(event) => props.onCaption(event.target.value)}
              />
            </label>
            <button type="button" className="btn btn-quiet mt-2 w-full" onClick={props.onClearCaption} disabled={!props.caption.trim() && !props.yearOnly}>
              Clear frame caption
            </button>
            <button
              type="button"
              className={cn("btn mt-2 w-full", props.yearOnly ? "btn-ink" : "btn-quiet")}
              onClick={() => props.onYearOnly(!props.yearOnly)}
              disabled={!props.dateIso && !props.yearOnly}
            >
              {props.yearOnly ? "Full date" : "Year only"}
            </button>
            <label className="mt-3 block">
              <span className="text-sm text-muted">Date on this frame</span>
              <input
                className="field mt-2"
                type="date"
                value={props.dateIso}
                onChange={(event) => props.onDate(event.target.value)}
              />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-quiet" onClick={props.onCenter}>
                Center
              </button>
              <button type="button" className="btn btn-quiet" onClick={props.onRotate}>
                <RotateCw className="size-4" aria-hidden="true" />
                Rotate
              </button>
              <button type="button" className="btn btn-quiet" onClick={props.onResetCrop}>
                Reset crop
              </button>
              <button type="button" className="btn btn-quiet" onClick={props.onClearSlot}>
                Clear frame
              </button>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-pretty text-muted">
            Select a frame, then tap a photo or drop one in. Each photo keeps a caption on its bottom edge.
          </p>
        )}
        {props.page && props.page.layout !== "one" && props.page.layout !== "half" && (
          <div className="mt-4 border-t border-line pt-4">
            <InchSlider
              label={
                props.page.layout === "two-cols"
                  ? "Left frame"
                  : props.page.layout === "four"
                    ? "Left top"
                    : props.page.layout === "three-base"
                      ? "Top row"
                      : "Top frame"
              }
              display={`${Math.round((props.page.split ?? (props.page.layout === "three-banner" ? 0.58 : props.page.layout === "three-base" ? 0.42 : 0.5)) * 100)}%`}
              min={0.18}
              max={0.82}
              step={0.01}
              value={props.page.split ?? (props.page.layout === "three-banner" ? 0.58 : props.page.layout === "three-base" ? 0.42 : 0.5)}
              onChange={(value) => props.onSplit(value, "top")}
            />
            {(props.page.layout === "three-banner" || props.page.layout === "three-base") && (
              <>
                <InchSlider
                  className="mt-2"
                  label={props.page.layout === "three-base" ? "Upper left" : "Lower left"}
                  display={`${Math.round((props.page.splitL ?? 1) * 100)}%`}
                  min={0.2}
                  max={1}
                  step={0.01}
                  value={props.page.splitL ?? 1}
                  onChange={(value) => props.onSplit(value, "left")}
                />
                <InchSlider
                  className="mt-2"
                  label={props.page.layout === "three-base" ? "Upper right" : "Lower right"}
                  display={`${Math.round((props.page.splitR ?? 1) * 100)}%`}
                  min={0.2}
                  max={1}
                  step={0.01}
                  value={props.page.splitR ?? 1}
                  onChange={(value) => props.onSplit(value, "right")}
                />
              </>
            )}
            {props.page.layout === "four" && (
              <InchSlider
                className="mt-2"
                label="Right top"
                display={`${Math.round((props.page.splitR ?? props.page.split ?? 0.5) * 100)}%`}
                min={0.18}
                max={0.82}
                step={0.01}
                value={props.page.splitR ?? props.page.split ?? 0.5}
                onChange={(value) => props.onSplit(value, "right")}
              />
            )}
            {(props.page.layout === "three-banner" || props.page.layout === "three-base" || props.page.layout === "four") && (
              <InchSlider
                className="mt-2"
                label="Left width"
                display={`${Math.round((props.page.splitW ?? 0.5) * 100)}%`}
                min={0.18}
                max={0.82}
                step={0.01}
                value={props.page.splitW ?? 0.5}
                onChange={(value) => props.onSplit(value, "width")}
              />
            )}
            <button
              type="button"
              className="btn btn-quiet mt-2 w-full"
              onClick={() => {
                props.onSplit(null, "top");
                props.onSplit(null, "left");
                props.onSplit(null, "right");
                props.onSplit(null, "width");
              }}
              disabled={props.page.split == null && props.page.splitL == null && props.page.splitR == null && props.page.splitW == null}
            >
              Reset frame sizes
            </button>
          </div>
        )}
      </section>

      <section className="border-t border-line px-4 py-4">
        <h2 className="font-serif text-xl">Book</h2>
        <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Page orientation">
          <button
            type="button"
            className={cn("btn", props.orientation === "landscape" ? "btn-ink" : "btn-quiet")}
            aria-pressed={props.orientation === "landscape"}
            onClick={() => props.onOrientation("landscape")}
          >
            12 × 8
          </button>
          <button
            type="button"
            className={cn("btn", props.orientation === "portrait" ? "btn-ink" : "btn-quiet")}
            aria-pressed={props.orientation === "portrait"}
            onClick={() => props.onOrientation("portrait")}
          >
            8 × 12
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">Same sheet, turned. Both are an 8×12 photobook.</p>
        <InchSlider
          className="mt-4"
          label="Page margin"
          display={`${props.marginIn.toFixed(2)} in`}
          min={LIMITS.margin.min}
          max={LIMITS.margin.max}
          step={LIMITS.margin.step}
          value={props.marginIn}
          onChange={props.onMargin}
        />
        <InchSlider
          className="mt-2"
          label="Space between photos"
          display={`${props.gapIn.toFixed(2)} in`}
          min={LIMITS.gap.min}
          max={LIMITS.gap.max}
          step={LIMITS.gap.step}
          value={props.gapIn}
          onChange={props.onGap}
        />
        <InchSlider
          className="mt-2"
          label="Caption band"
          display={`${props.captionIn.toFixed(2)} in`}
          min={LIMITS.caption.min}
          max={LIMITS.caption.max}
          step={LIMITS.caption.step}
          value={props.captionIn}
          onChange={props.onCaptionSize}
        />
        <p className="mt-4 text-sm text-muted">Photos per new page</p>
        <div className="mt-2 grid grid-cols-4 gap-2" role="group" aria-label="Photos per new page">
          {([1, 2, 3, 4] as Density[]).map((count) => (
            <button
              key={count}
              type="button"
              className={cn("btn", props.density === count ? "btn-ink" : "btn-quiet")}
              aria-pressed={props.density === count}
              onClick={() => props.onDensity(count)}
            >
              {count}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-pretty text-muted">
          New pages added by hand use this count. Added photos pack as two landscapes, four portraits, or one landscape over two portraits. A photo that does not fit goes on the next page, full when it is a portrait and half when it is a landscape. Three portraits never share a page. Changing a page’s frame count keeps what fits and sends the spare photo on. The following pages pack again by those same rules.
        </p>
      </section>

      {props.hasPhoto && (
        <section className="border-t border-line px-4 py-4">
          <h2 className="font-serif text-xl">Adjust</h2>
          <p className="mt-1 text-sm text-muted">Same controls as the iPhone Photos app.</p>
          {ADJUST_FIELDS.map((field) => (
            <InchSlider
              key={field.key}
              className="mt-2"
              label={field.label}
              display={String(Math.round(props.adjust[field.key]))}
              min={field.min}
              max={field.max}
              step={1}
              value={props.adjust[field.key]}
              onChange={(value) => props.onAdjust({ [field.key]: value })}
            />
          ))}
          <button type="button" className="btn btn-quiet mt-3 w-full" onClick={props.onResetAdjust}>
            Reset adjustments
          </button>
          <button type="button" className="btn btn-ink mt-2 w-full" onClick={props.onApplyAdjust} disabled={props.selectedCount === 0}>
            Apply to selected photos{props.selectedCount > 0 ? ` (${props.selectedCount})` : ""}
          </button>
        </section>
      )}

      <section className="mt-auto border-t border-line px-4 py-4">
        <h2 className="font-serif text-xl">Restore</h2>
        <p className="mt-1 text-sm text-muted">
          Earlier positions stay on this device for 7 days. A point is saved as you work, and again just before a delete.
        </p>
        {props.restorePoints.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No restore point yet.</p>
        ) : (
          <ul className="mt-2 grid max-h-52 gap-1 overflow-y-auto">
            {props.restorePoints.map((point) => (
              <li key={point.id}>
                <button type="button" className="btn btn-quiet w-full" onClick={() => props.onRestore(point.id)}>
                  <span className="flex w-full items-center justify-between gap-2">
                    <span>{restoreLabel(point.at)}</span>
                    <span className="text-muted tabular-nums">
                      {point.photos} · {point.pages}p
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn btn-quiet mt-4 w-full" onClick={props.onClearPages}>
          Clear pages
        </button>
        <button type="button" className="btn btn-quiet mt-2 w-full text-accent" onClick={props.onDeletePhotos}>
          Delete all photos
        </button>
      </section>
    </div>
  );
});

function restoreLabel(at: number) {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function LayoutGlyph({ layoutId, active }: { layoutId: LayoutId; active: boolean }) {
  const layout = LAYOUT_BY_ID[layoutId];
  return (
    <span className={cn("relative block h-6 w-9", active ? "bg-page/15" : "bg-page")}>
      {layout.areas.map((area, index) => (
        <span
          key={index}
          className={cn("absolute", active ? "bg-page" : "bg-ink/80")}
          style={{
            left: `${area.x * 100}%`,
            top: `${area.y * 100}%`,
            width: `${area.w * 100}%`,
            height: `${area.h * 100}%`,
            outline: "1px solid transparent",
            transform: "scale(0.86)",
          }}
        />
      ))}
    </span>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" className="btn btn-quiet px-0" aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function InchSlider({
  label,
  display,
  value,
  min,
  max,
  step,
  onChange,
  className,
}: {
  label: string;
  display: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="text-muted tabular-nums">{display}</span>
      </span>
      <Slider.Root
        className="relative flex h-7 w-full touch-none items-center"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) => onChange(next)}
      >
        <Slider.Track className="relative h-1 grow rounded-full bg-line">
          <Slider.Range className="absolute h-full rounded-full bg-accent" />
        </Slider.Track>
        <Slider.Thumb
          className="block size-5 rounded-full border-2 border-accent bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          aria-label={label}
        />
      </Slider.Root>
    </label>
  );
}
