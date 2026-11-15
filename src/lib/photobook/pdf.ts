import { adjustFilter, vignetteStrength } from "@/lib/photobook/adjust";
import { imageBox, orientedSize } from "@/lib/photobook/crop";
import { isHindiDate, visibleCaption } from "@/lib/photobook/date";
import { pageFrameRects } from "@/lib/photobook/geometry";
import { getBlob } from "@/lib/photobook/db";
import { PAGE_INCHES, type Book, type Page, type Photo } from "@/lib/photobook/types";

const DPI = 300;
const JPEG_QUALITY = 1;
const PAPER = "#fffdf8";
const WELL = "#e5ddd0";
const CAPTION = "#f3eee4";
const INK = "#1c1814";
const LINE = "#d9d0c3";

export type PdfProgress = (done: number, total: number) => void;

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function jpegSize(data: Uint8Array): { w: number; h: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let i = 2;
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) break;
    const marker = data[i + 1];
    if (marker === 0xd8 || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xd9) break;
    const length = view.getUint16(i + 2, false);
    if (marker >= 0xc0 && marker <= 0xc2 && marker !== 0xc1) {
      return { h: view.getUint16(i + 5, false), w: view.getUint16(i + 7, false) };
    }
    i += 2 + length;
  }
  throw new Error("Could not read a page image.");
}

/** One JPEG per page, sized in inches. No library, so it runs in the Android web view. */
export function buildPdf(pages: { jpeg: Uint8Array; widthIn: number; heightIn: number }[]): Uint8Array {
  if (pages.length === 0) throw new Error("There is no page to export.");
  const encoder = new TextEncoder();
  const objects: Uint8Array[] = [];
  const add = (body: string | Uint8Array) => {
    objects.push(typeof body === "string" ? encoder.encode(body) : body);
  };
  const kids = pages.map((_, index) => `${3 + index * 3} 0 R`).join(" ");
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`);
  pages.forEach((page, index) => {
    const { w, h } = jpegSize(page.jpeg);
    const pageId = 3 + index * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const widthPt = (page.widthIn * 72).toFixed(2);
    const heightPt = (page.heightIn * 72).toFixed(2);
    const content = `q ${widthPt} 0 0 ${heightPt} 0 0 cm /Im0 Do Q\n`;
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] /Contents ${contentId} 0 R /Resources << /XObject << /Im0 ${imageId} 0 R >> >> >>`,
    );
    add(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
    const header = encoder.encode(
      `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length + 1} >>\nstream\n`,
    );
    const footer = encoder.encode("\nendstream");
    add(concat([header, page.jpeg, footer]));
  });

  const chunks: Uint8Array[] = [encoder.encode("%PDF-1.4\n")];
  let cursor = chunks[0].length;
  const offsets = [0];
  objects.forEach((body, index) => {
    const head = encoder.encode(`${index + 1} 0 obj\n`);
    const tail = encoder.encode("\nendobj\n");
    offsets.push(cursor);
    chunks.push(head, body, tail);
    cursor += head.length + body.length + tail.length;
  });
  const xrefAt = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  chunks.push(encoder.encode(xref));
  return concat(chunks);
}

async function loadBitmap(id: string): Promise<ImageBitmap | null> {
  const blob = await getBlob(id);
  if (!blob) return null;
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

async function drawPage(
  page: Page,
  pageNumber: number,
  book: Book,
  photos: Map<string, Photo>,
): Promise<Uint8Array> {
  const inches = PAGE_INCHES[book.orientation];
  const width = Math.round(inches.w * DPI);
  const height = Math.round(inches.h * DPI);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw the page.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);

  const rects = pageFrameRects(
    page.layout,
    page.split,
    page.splitL,
    page.splitR,
    page.splitW,
    page.slots.map((slot) => (slot.photoId ? photos.get(slot.photoId) : undefined)),
    inches.w,
    inches.h,
    book.marginIn,
    book.gapIn,
    book.captionIn,
  );
  const bitmaps: ImageBitmap[] = [];
  try {
    for (let index = 0; index < rects.length; index += 1) {
      const rect = rects[index];
      const slot = page.slots[index];
      if (!slot) continue;
      const x = rect.x * DPI;
      const y = rect.y * DPI;
      const w = rect.w * DPI;
      const h = rect.h * DPI;
      const line = visibleCaption(slot.caption, slot.takenAt, Boolean(slot.yearOnly));
      const hindi = isHindiDate(line) || /[\u0900-\u097F]/.test(line);
      const captionH = Math.min(h * 0.48, book.captionIn * DPI * (hindi ? 1.28 : 1));
      const imageH = Math.max(1, h - captionH);
      ctx.fillStyle = WELL;
      ctx.fillRect(x, y, w, imageH);
      const photo = slot.photoId ? photos.get(slot.photoId) : undefined;
      if (photo && slot.photoId) {
        const bitmap = await loadBitmap(slot.photoId);
        if (bitmap) {
          bitmaps.push(bitmap);
          const frameAspect = w / imageH;
          const turn = slot.turn ?? 0;
          const oriented = orientedSize({ w: bitmap.width, h: bitmap.height }, turn);
          const zoom = slot.zoom;
          const box = imageBox(frameAspect, oriented, zoom, slot.panX, slot.panY);
          const dw = (box.width / 100) * w;
          const dh = (box.height / 100) * imageH;
          const dx = x + (box.left / 100) * w;
          const dy = y + (box.top / 100) * imageH;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, w, imageH);
          ctx.clip();
          const filter = adjustFilter(slot.adjust);
          if (filter) ctx.filter = filter;
          ctx.translate(dx + dw / 2, dy + dh / 2);
          ctx.rotate((turn * Math.PI) / 2);
          if (turn % 2 === 1) ctx.drawImage(bitmap, -dh / 2, -dw / 2, dh, dw);
          else ctx.drawImage(bitmap, -dw / 2, -dh / 2, dw, dh);
          ctx.filter = "none";
          const shade = vignetteStrength(slot.adjust);
          if (shade > 0) {
            const g = ctx.createRadialGradient(x + w / 2, y + imageH / 2, Math.min(w, imageH) * 0.28, x + w / 2, y + imageH / 2, Math.max(w, imageH) * 0.72);
            g.addColorStop(0, "rgba(0,0,0,0)");
            g.addColorStop(1, `rgba(0,0,0,${(shade * 0.72).toFixed(3)})`);
            ctx.fillStyle = g;
            ctx.fillRect(x, y, w, imageH);
          }
          ctx.restore();
        }
      }
      ctx.fillStyle = CAPTION;
      ctx.fillRect(x, y + imageH, w, captionH);
      ctx.fillStyle = LINE;
      ctx.fillRect(x, y + imageH, w, Math.max(1, DPI * 0.01));
      const caption = line;
      if (caption) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y + imageH, w, captionH);
        ctx.clip();
        const fontPx = captionH * (hindi ? 0.52 : 0.62);
        ctx.font = hindi
          ? `500 ${fontPx}px "Noto Sans Devanagari", sans-serif`
          : `italic 500 ${fontPx}px Fraunces, Georgia, serif`;
        ctx.fillStyle = INK;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(caption, x + w / 2, y + imageH + captionH * (hindi ? 0.78 : 0.72));
        ctx.restore();
      }
    }
  } finally {
    for (const bitmap of bitmaps) bitmap.close();
  }

  const label = String(pageNumber);
  const fontPx = Math.round(Math.min(width, height) * 0.0144);
  ctx.font = `500 ${fontPx}px Fraunces, Georgia, serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const textW = ctx.measureText(label).width;
  const marginPx = book.marginIn * DPI;
  const inset = Math.max(DPI * 0.16, marginPx * 0.45);
  const right = width - inset;
  const cy = height - Math.max(DPI * 0.16, marginPx * 0.42);
  const padX = DPI * 0.08;
  const chipH = fontPx * 1.35;
  ctx.fillStyle = "rgba(255,253,248,0.94)";
  ctx.fillRect(right - textW - padX, cy - chipH / 2, textW + padX * 2, chipH);
  ctx.fillStyle = INK;
  ctx.fillText(label, right, cy);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((file) => (file ? resolve(file) : reject(new Error("Could not encode the page."))), "image/jpeg", JPEG_QUALITY);
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function renderBookPdf(book: Book, pages: Page[], photos: Photo[], onProgress?: PdfProgress): Promise<Blob> {
  if (typeof document === "undefined") throw new Error("PDF export needs a browser.");
  if (document.fonts?.ready) await document.fonts.ready;
  const photoById = new Map(photos.map((photo) => [photo.id, photo]));
  const inches = PAGE_INCHES[book.orientation];
  const rendered: { jpeg: Uint8Array; widthIn: number; heightIn: number }[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    onProgress?.(index, pages.length);
    const bookIndex = book.pages.findIndex((item) => item.id === pages[index].id);
    rendered.push({
      jpeg: await drawPage(pages[index], bookIndex >= 0 ? bookIndex + 1 : index + 1, book, photoById),
      widthIn: inches.w,
      heightIn: inches.h,
    });
  }
  onProgress?.(pages.length, pages.length);
  const bytes = buildPdf(rendered);
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}
