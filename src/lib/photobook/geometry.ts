import type { Area } from "@/lib/photobook/layouts";

export type Rect = { x: number; y: number; w: number; h: number };

/** Cell rectangles in inches. Gap is physical inches between neighbors. */
export function cellRects(
  areas: Area[],
  pageW: number,
  pageH: number,
  margin: number,
  gap: number,
): Rect[] {
  const content: Rect = {
    x: margin,
    y: margin,
    w: Math.max(0.4, pageW - margin * 2),
    h: Math.max(0.4, pageH - margin * 2),
  };
  return areas.map((area) => {
    let x = content.x + area.x * content.w;
    let y = content.y + area.y * content.h;
    let w = area.w * content.w;
    let h = area.h * content.h;
    if (area.x > 0.001) {
      x += gap / 2;
      w -= gap / 2;
    }
    if (area.x + area.w < 0.999) w -= gap / 2;
    if (area.y > 0.001) {
      y += gap / 2;
      h -= gap / 2;
    }
    if (area.y + area.h < 0.999) h -= gap / 2;
    return { x, y, w: Math.max(0.2, w), h: Math.max(0.2, h) };
  });
}

export function rectToPercent(rect: Rect, pageW: number, pageH: number) {
  return {
    left: `${(rect.x / pageW) * 100}%`,
    top: `${(rect.y / pageH) * 100}%`,
    width: `${(rect.w / pageW) * 100}%`,
    height: `${(rect.h / pageH) * 100}%`,
  };
}

/**
 * Aspects for a banner page whose first photo is landscape and the next two are portraits.
 */
export function landscapeOverPortraitAspects(
  photos: Array<{ w: number; h: number } | undefined>,
): [number, number, number] | null {
  if (photos.length < 3) return null;
  const [top, left, right] = photos;
  if (!top || !left || !right) return null;
  if (top.w < 1 || top.h < 1 || left.w < 1 || left.h < 1 || right.w < 1 || right.h < 1) return null;
  if (!(top.w > top.h && left.w <= left.h && right.w <= right.h)) return null;
  return [top.w / top.h, left.w / left.h, right.w / right.h];
}

/**
 * One landscape over two portraits. Each frame matches its photo, so nothing is cropped.
 */
export function fitLandscapeOverPortraits(
  pageW: number,
  pageH: number,
  margin: number,
  gap: number,
  captionIn: number,
  aspects: [number, number, number],
): Rect[] {
  const contentW = Math.max(0.4, pageW - margin * 2);
  const contentH = Math.max(0.4, pageH - margin * 2);
  const caption = Math.max(0.12, Math.min(captionIn, contentH * 0.18));
  const safe = aspects.map((aspect) => Math.max(0.2, aspect)) as [number, number, number];
  let low = 0.05;
  let high = 1;
  let scale = 0.05;
  for (let step = 0; step < 28; step += 1) {
    const mid = (low + high) / 2;
    if (trioHeight(contentW, gap, caption, safe, mid) <= contentH) {
      scale = mid;
      low = mid;
    } else high = mid;
  }
  const innerW = contentW * scale;
  const topImg = innerW / safe[0];
  const botW = Math.max(0.2, (innerW - gap) / 2);
  const botImg = [botW / safe[1], botW / safe[2]];
  const total = topImg + caption + gap + Math.max(botImg[0], botImg[1]) + caption;
  const x0 = margin + (contentW - innerW) / 2;
  const y0 = margin + Math.max(0, (contentH - total) / 2);
  const rowY = y0 + topImg + caption + gap;
  return [
    { x: x0, y: y0, w: innerW, h: topImg + caption },
    { x: x0, y: rowY, w: botW, h: botImg[0] + caption },
    { x: x0 + botW + gap, y: rowY, w: botW, h: botImg[1] + caption },
  ];
}

function trioHeight(contentW: number, gap: number, caption: number, aspects: [number, number, number], scale: number) {
  const innerW = contentW * scale;
  const topImg = innerW / aspects[0];
  const botW = Math.max(0.2, (innerW - gap) / 2);
  const botImg = Math.max(botW / aspects[1], botW / aspects[2]);
  return topImg + caption + gap + botImg + caption;
}
