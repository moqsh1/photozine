import { clamp, LIMITS } from "@/lib/photobook/types";

export type ImageSize = { w: number; h: number };

/**
 * Placement as percentages of the frame.
 * Zoom 1 covers the frame. Above 1 crops. Below 1 shrinks the photo and leaves padding.
 * The picture is never stretched.
 */
export function imageBox(frameAspect: number, image: ImageSize, zoom: number, panX: number, panY: number) {
  const safeZoom = clamp(Number.isFinite(zoom) ? zoom : 1, LIMITS.zoom.min, 4);
  const ir = image.w / Math.max(1, image.h);
  const fr = Math.max(0.05, frameAspect);
  let baseW: number;
  let baseH: number;
  if (ir > fr) {
    baseH = 100;
    baseW = (ir / fr) * 100;
  } else {
    baseW = 100;
    baseH = (fr / ir) * 100;
  }
  const width = baseW * safeZoom;
  const height = baseH * safeZoom;
  const px = clamp(panX, -1, 1);
  const py = clamp(panY, -1, 1);
  return {
    left: ((100 - width) * (px + 1)) / 2,
    top: ((100 - height) * (py + 1)) / 2,
    width,
    height,
    slackX: Math.abs(width - 100),
    slackY: Math.abs(height - 100),
  };
}

/** Zoom that fits the whole photo inside the frame. 1 when the shapes already match. */
export function containZoom(frameAspect: number, image: ImageSize): number {
  const ir = image.w / Math.max(1, image.h);
  const fr = Math.max(0.05, frameAspect);
  return clamp(ir > fr ? fr / ir : ir / fr, LIMITS.zoom.min, 1);
}