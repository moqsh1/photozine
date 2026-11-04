const MONTHS = [
  "जनवरी",
  "फरवरी",
  "मार्च",
  "अप्रैल",
  "मई",
  "जून",
  "जुलाई",
  "अगस्त",
  "सितंबर",
  "अक्टूबर",
  "नवंबर",
  "दिसंबर",
] as const;

/** Calendar date as UTC midnight, so the Hindi label does not shift a day. */
export function stampFromParts(year: number, monthIndex: number, day: number): number {
  return Date.UTC(year, monthIndex, day);
}

export function formatHindiDate(stamp: number): string {
  const date = new Date(stamp);
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${day} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function stampToIso(stamp: number): string {
  const date = new Date(stamp);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

const HINDI_DATE =
  /^(0[1-9]|[12]\d|3[01]) (जनवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|अक्टूबर|नवंबर|दिसंबर) \d{4}$/;

export function isHindiDate(value: string): boolean {
  return HINDI_DATE.test(value.trim());
}

/** Put the photo date in an empty caption, and replace a caption that is only a date. */
export function captionForDate(caption: string, takenAt: number | null): string {
  if (takenAt == null) return caption;
  const label = formatHindiDate(takenAt);
  if (!caption.trim() || isHindiDate(caption)) return label;
  return caption;
}

/** Taller caption band when the line wraps, so the text stays off the photograph. */
export function captionBandIn(baseIn: number, caption: string, hasExtraDate: boolean): number {
  const text = caption.trim();
  const lines = Math.min(3, Math.max(1, text ? Math.ceil(text.length / 18) : 1)) + (hasExtraDate ? 1 : 0);
  const grown = baseIn * (lines <= 1 ? 1 : 0.55 + lines * 0.5);
  return Math.min(1.2, Math.max(baseIn, grown));
}

/** Camera-style names such as IMG_20250704 or 2005-07-04. */
export function dateFromName(name: string): number | null {
  const checked = (year: number, monthIndex: number, day: number) => {
    const stamp = stampFromParts(year, monthIndex, day);
    const date = new Date(stamp);
    return date.getUTCFullYear() === year && date.getUTCMonth() === monthIndex && date.getUTCDate() === day ? stamp : null;
  };
  const compact = name.match(/(19|20)(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
  if (compact) return checked(Number(compact[1] + compact[2]), Number(compact[3]) - 1, Number(compact[4]));
  const iso = name.match(/(19|20)(\d{2})[.\-_/ ](0[1-9]|1[0-2])[.\-_/ ](0[1-9]|[12]\d|3[01])/);
  if (iso) return checked(Number(iso[1] + iso[2]), Number(iso[3]) - 1, Number(iso[4]));
  const dmy = name.match(/(0[1-9]|[12]\d|3[01])[.\-_/ ](0[1-9]|1[0-2])[.\-_/ ]((?:19|20)\d{2})/);
  if (dmy) return checked(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  return null;
}

export function isoToStamp(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return stampFromParts(year, month - 1, day);
}

function parseExifClock(value: string): number | null {
  const match = /^(\d{4}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return stampFromParts(year, month - 1, day);
}

function asciiField(bytes: Uint8Array, tiff: number, entry: number, little: boolean): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = view.getUint16(tiff + entry + 2, little);
  const count = view.getUint32(tiff + entry + 4, little);
  if (type !== 2 || count < 10 || count > 64) return null;
  const inlineAt = tiff + entry + 8;
  const dataAt = count <= 4 ? inlineAt : tiff + view.getUint32(inlineAt, little);
  if (dataAt < 0 || dataAt + count > bytes.length) return null;
  let text = "";
  for (let i = 0; i < count; i += 1) {
    const code = bytes[dataAt + i];
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text;
}

function ifdDate(bytes: Uint8Array, tiff: number, offset: number, little: boolean, depth = 0): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (offset < 0 || tiff + offset + 2 > bytes.length) return null;
  const count = view.getUint16(tiff + offset, little);
  let fallback: number | null = null;
  let nested: number | null = null;
  for (let index = 0; index < count; index += 1) {
    const entry = offset + 2 + index * 12;
    if (tiff + entry + 12 > bytes.length) break;
    const tag = view.getUint16(tiff + entry, little);
    if (tag === 0x8769) {
      nested = view.getUint32(tiff + entry + 8, little);
      continue;
    }
    if (tag !== 0x0132 && tag !== 0x9003 && tag !== 0x9004) continue;
    const text = asciiField(bytes, tiff, entry, little);
    const stamp = text ? parseExifClock(text) : null;
    if (stamp == null) continue;
    if (tag === 0x9003) return stamp;
    if (fallback == null || tag === 0x9004) fallback = stamp;
  }
  if (nested != null && depth < 2) {
    const original = ifdDate(bytes, tiff, nested, little, depth + 1);
    if (original != null) return original;
  }
  return fallback;
}

/** DateTimeOriginal from a JPEG APP1 block. Other formats return null. */
function scanClock(bytes: Uint8Array, end: number): number | null {
  let last: number | null = null;
  const stop = Math.min(bytes.length - 10, end);
  for (let i = 0; i <= stop; i += 1) {
    if (bytes[i] < 0x30 || bytes[i] > 0x39) continue;
    const colon = bytes[i + 4] === 0x3a && bytes[i + 7] === 0x3a;
    const dash = bytes[i + 4] === 0x2d && bytes[i + 7] === 0x2d;
    if (!colon && !dash) continue;
    let text = "";
    for (let k = 0; k < 10; k += 1) text += String.fromCharCode(bytes[i + k]);
    const stamp = colon ? parseExifClock(text) : isoToStamp(text);
    if (stamp != null) last = stamp;
    i += 9;
  }
  return last;
}

function metadataEnd(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes.length;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 2;
  while (cursor + 4 < bytes.length) {
    if (bytes[cursor] !== 0xff) return cursor;
    const marker = bytes[cursor + 1];
    if (marker === 0xda || marker === 0xd9) return cursor;
    const size = view.getUint16(cursor + 2, false);
    if (size < 2) return cursor;
    cursor += 2 + size;
  }
  return bytes.length;
}

export function jpegTakenAt(bytes: Uint8Array): number | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 2;
  while (cursor + 4 < bytes.length) {
    if (bytes[cursor] !== 0xff) break;
    const marker = bytes[cursor + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const size = view.getUint16(cursor + 2, false);
    if (size < 2) break;
    if (
      marker === 0xe1 &&
      bytes[cursor + 4] === 0x45 &&
      bytes[cursor + 5] === 0x78 &&
      bytes[cursor + 6] === 0x69 &&
      bytes[cursor + 7] === 0x66 &&
      bytes[cursor + 8] === 0x00
    ) {
      const tiff = cursor + 10;
      const little = bytes[tiff] === 0x49;
      if (tiff + 8 < bytes.length && view.getUint16(tiff + 2, little) === 42) {
        const stamp = ifdDate(bytes, tiff, view.getUint32(tiff + 4, little), little);
        if (stamp != null) return stamp;
      }
    }
    cursor += 2 + size;
  }
  return scanClock(bytes, metadataEnd(bytes));
}

export async function readTakenAt(file: Blob): Promise<number | null> {
  const head = new Uint8Array(await file.slice(0, 2 * 1024 * 1024).arrayBuffer());
  const exif = jpegTakenAt(head) ?? scanClock(head, metadataEnd(head));
  if (exif != null) return exif;
  if (file instanceof File && file.lastModified > 24 * 60 * 60 * 1000) {
    const date = new Date(file.lastModified);
    return stampFromParts(date.getFullYear(), date.getMonth(), date.getDate());
  }
  return null;
}
