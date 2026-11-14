import { clamp } from "@/lib/photobook/types";

export const ADJUST_FIELDS = [
  { key: "exposure", label: "Exposure", min: -100, max: 100 },
  { key: "brilliance", label: "Brilliance", min: -100, max: 100 },
  { key: "highlights", label: "Highlights", min: -100, max: 100 },
  { key: "shadows", label: "Shadows", min: -100, max: 100 },
  { key: "brightness", label: "Brightness", min: -100, max: 100 },
  { key: "contrast", label: "Contrast", min: -100, max: 100 },
  { key: "blackPoint", label: "Black point", min: -100, max: 100 },
  { key: "saturation", label: "Saturation", min: -100, max: 100 },
  { key: "vibrance", label: "Vibrance", min: -100, max: 100 },
  { key: "warmth", label: "Warmth", min: -100, max: 100 },
  { key: "tint", label: "Tint", min: -100, max: 100 },
  { key: "sharpness", label: "Sharpness", min: 0, max: 100 },
  { key: "definition", label: "Definition", min: 0, max: 100 },
  { key: "noise", label: "Noise reduction", min: 0, max: 100 },
  { key: "vignette", label: "Vignette", min: 0, max: 100 },
] as const;

export type AdjustKey = (typeof ADJUST_FIELDS)[number]["key"];
export type Adjust = Record<AdjustKey, number>;

export function emptyAdjust(): Adjust {
  return {
    exposure: 0,
    brilliance: 0,
    highlights: 0,
    shadows: 0,
    brightness: 0,
    contrast: 0,
    blackPoint: 0,
    saturation: 0,
    vibrance: 0,
    warmth: 0,
    tint: 0,
    sharpness: 0,
    definition: 0,
    noise: 0,
    vignette: 0,
  };
}

export function readAdjust(value: unknown): Adjust | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<Record<AdjustKey, unknown>>;
  const next = emptyAdjust();
  let used = false;
  for (const field of ADJUST_FIELDS) {
    const n = Number(raw[field.key]);
    if (!Number.isFinite(n) || n === 0) continue;
    next[field.key] = clamp(n, field.min, field.max);
    used = true;
  }
  return used ? next : undefined;
}

export function mergeAdjust(current: Adjust | undefined, patch: Partial<Adjust>): Adjust | undefined {
  const next = { ...(current ?? emptyAdjust()), ...patch };
  for (const field of ADJUST_FIELDS) next[field.key] = clamp(Number(next[field.key]) || 0, field.min, field.max);
  return readAdjust(next);
}

/** CSS filter approximating the iPhone Photos adjustment stack. */
export function adjustFilter(adjust: Adjust | undefined): string | undefined {
  const a = adjust ?? emptyAdjust();
  if (!readAdjust(a)) return undefined;
  const brightness =
    1 + a.brightness / 180 + a.exposure / 140 + a.brilliance / 220 + a.shadows / 280 - a.highlights / 400 - a.blackPoint / 500;
  const contrast = 1 + a.contrast / 160 + a.blackPoint / 220 + a.definition / 240 + a.sharpness / 280 - Math.abs(a.brilliance) / 900;
  const saturate = Math.max(0, 1 + a.saturation / 100 + a.vibrance / 180 + a.brilliance / 260);
  const sepia = Math.max(0, a.warmth) / 260;
  const hue = a.tint * 0.45 - Math.max(0, a.warmth) * 0.12;
  const blur = a.noise / 70;
  const parts = [`brightness(${brightness.toFixed(3)})`, `contrast(${Math.max(0, contrast).toFixed(3)})`, `saturate(${saturate.toFixed(3)})`];
  if (sepia > 0.01) parts.push(`sepia(${sepia.toFixed(3)})`);
  if (Math.abs(hue) > 0.3) parts.push(`hue-rotate(${hue.toFixed(2)}deg)`);
  if (blur > 0.04) parts.push(`blur(${blur.toFixed(2)}px)`);
  return parts.join(" ");
}

export function vignetteStrength(adjust: Adjust | undefined): number {
  return Math.max(0, Math.min(100, adjust?.vignette ?? 0)) / 100;
}
