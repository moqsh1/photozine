import { clamp, emptySlot, LIMITS, type Density, type LayoutId, type Page, type Slot } from "@/lib/photobook/types";
import { captionForDate } from "@/lib/photobook/date";
import { readAdjust } from "@/lib/photobook/adjust";

export type Area = { x: number; y: number; w: number; h: number };

export type LayoutDef = {
  id: LayoutId;
  name: string;
  hint: string;
  slots: number;
  areas: Area[];
};

export const LAYOUTS: LayoutDef[] = [
  {
    id: "one",
    name: "Full",
    hint: "One photograph",
    slots: 1,
    areas: [{ x: 0, y: 0, w: 1, h: 1 }],
  },
  {
    id: "half",
    name: "Half",
    hint: "One landscape on the top half",
    slots: 1,
    areas: [{ x: 0, y: 0, w: 1, h: 0.5 }],
  },
  {
    id: "two-cols",
    name: "Pair",
    hint: "Two side by side",
    slots: 2,
    areas: [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 1 },
    ],
  },
  {
    id: "two-rows",
    name: "Stack",
    hint: "Two stacked",
    slots: 2,
    areas: [
      { x: 0, y: 0, w: 1, h: 0.5 },
      { x: 0, y: 0.5, w: 1, h: 0.5 },
    ],
  },
  {
    id: "three-feature",
    name: "Feature",
    hint: "Large photo and two",
    slots: 3,
    areas: [
      { x: 0, y: 0, w: 0.62, h: 1 },
      { x: 0.62, y: 0, w: 0.38, h: 0.5 },
      { x: 0.62, y: 0.5, w: 0.38, h: 0.5 },
    ],
  },
  {
    id: "three-banner",
    name: "Banner",
    hint: "Wide photo over two",
    slots: 3,
    areas: [
      { x: 0, y: 0, w: 1, h: 0.58 },
      { x: 0, y: 0.58, w: 0.5, h: 0.42 },
      { x: 0.5, y: 0.58, w: 0.5, h: 0.42 },
    ],
  },
  {
    id: "three-cols",
    name: "Columns",
    hint: "Three columns",
    slots: 3,
    areas: [
      { x: 0, y: 0, w: 1 / 3, h: 1 },
      { x: 1 / 3, y: 0, w: 1 / 3, h: 1 },
      { x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
    ],
  },
  {
    id: "four",
    name: "Grid",
    hint: "Four photographs",
    slots: 4,
    areas: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
];

export const LAYOUT_BY_ID: Record<LayoutId, LayoutDef> = Object.fromEntries(
  LAYOUTS.map((layout) => [layout.id, layout]),
) as Record<LayoutId, LayoutDef>;

const DENSITY_LAYOUT: Record<Density, LayoutId> = {
  1: "one",
  2: "two-cols",
  3: "three-feature",
  4: "four",
};

export function areasFor(
  layoutId: LayoutId,
  split: number | null | undefined,
  splitL?: number | null,
  splitR?: number | null,
  splitW?: number | null,
): Area[] {
  const base = LAYOUT_BY_ID[layoutId].areas;
  const has = typeof split === "number" && Number.isFinite(split);
  const hasL = typeof splitL === "number" && Number.isFinite(splitL);
  const hasR = typeof splitR === "number" && Number.isFinite(splitR);
  const hasW = typeof splitW === "number" && Number.isFinite(splitW);
  if (!has && !hasL && !hasR && !hasW) return base;
  const s = clamp(has ? (split as number) : layoutId === "three-banner" ? 0.58 : 0.5, 0.18, 0.82);
  const width = clamp(hasW ? (splitW as number) : 0.5, 0.18, 0.82);
  if (layoutId === "two-cols") {
    return [
      { x: 0, y: 0, w: s, h: 1 },
      { x: s, y: 0, w: 1 - s, h: 1 },
    ];
  }
  if (layoutId === "two-rows") {
    return [
      { x: 0, y: 0, w: 1, h: s },
      { x: 0, y: s, w: 1, h: 1 - s },
    ];
  }
  if (layoutId === "three-banner") {
    const rest = 1 - s;
    const left = rest * clamp(hasL ? (splitL as number) : 1, 0.2, 1);
    const right = rest * clamp(hasR ? (splitR as number) : 1, 0.2, 1);
    return [
      { x: 0, y: 0, w: 1, h: s },
      { x: 0, y: s, w: width, h: left },
      { x: width, y: s, w: 1 - width, h: right },
    ];
  }
  if (layoutId === "four") {
    const right = clamp(hasR ? (splitR as number) : s, 0.18, 0.82);
    return [
      { x: 0, y: 0, w: width, h: s },
      { x: width, y: 0, w: 1 - width, h: right },
      { x: 0, y: s, w: width, h: 1 - s },
      { x: width, y: right, w: 1 - width, h: 1 - right },
    ];
  }
  return base;
}

export function splitAxis(layoutId: LayoutId): "x" | "y" | null {
  if (layoutId === "two-cols") return "x";
  if (layoutId === "two-rows" || layoutId === "three-banner" || layoutId === "four") return "y";
  return null;
}

export function defaultLayout(count: Density): LayoutId {
  return DENSITY_LAYOUT[count];
}

export function makePage(layoutId: LayoutId): Page {
  const layout = LAYOUT_BY_ID[layoutId];
  return {
    id: crypto.randomUUID(),
    layout: layoutId,
    slots: Array.from({ length: layout.slots }, () => emptySlot()),
  };
}

function asSlot(value: unknown): Slot {
  if (!value || typeof value !== "object") return emptySlot();
  const slot = value as Partial<Slot>;
  const taken = typeof slot.takenAt === "number" && Number.isFinite(slot.takenAt) ? slot.takenAt : null;
  const noCaption = slot.noCaption === true;
  const raw = typeof slot.caption === "string" ? slot.caption.slice(0, 140) : "";
  return {
    photoId: typeof slot.photoId === "string" ? slot.photoId : null,
    caption: (noCaption ? "" : captionForDate(raw, taken)).slice(0, 140),
    takenAt: taken,
    zoom: clamp(Number(slot.zoom) || 1, LIMITS.zoom.min, LIMITS.zoom.max),
    panX: clamp(Number(slot.panX) || 0, -1, 1),
    panY: clamp(Number(slot.panY) || 0, -1, 1),
    turn: slot.turn === 1 || slot.turn === 2 || slot.turn === 3 ? slot.turn : 0,
    yearOnly: noCaption ? false : slot.yearOnly === true,
    noCaption,
    adjust: readAdjust(slot.adjust),
  };
}

export function withLayout(page: Page, layoutId: LayoutId): Page {
  const layout = LAYOUT_BY_ID[layoutId];
  const slots = (page.slots ?? []).slice(0, layout.slots).map((slot) => asSlot(slot));
  while (slots.length < layout.slots) slots.push(emptySlot());
  return { ...page, layout: layoutId, slots, split: null, splitL: null, splitR: null, splitW: null };
}
