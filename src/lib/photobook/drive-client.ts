import { getBlob, getThumbBlob, putBlob, putThumb } from "@/lib/photobook/db";
import { decodeImage } from "@/lib/photobook/decode";
import { getDriveAccess } from "@/lib/photobook/drive-fns";
import type { Book, Photo } from "@/lib/photobook/types";

type DriveFile = { id: string; name: string };
type BookFile = {
  version: 1;
  updatedAt: number;
  book: Book;
  photos: { id: string; name: string; file: string; takenAt?: number | null; seq?: number }[];
};

async function driveFetch(token: string, url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init?.headers } });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text.slice(0, 180) || "Google Drive refused the request.");
  }
  return response;
}

async function listChildren(token: string, folderId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken = "";
  do {
    const query = `'${folderId}' in parents and trashed=false`;
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", query);
    url.searchParams.set("fields", "nextPageToken,files(id,name)");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await driveFetch(token, url.toString());
    const json = (await response.json()) as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(json.files ?? []));
    pageToken = json.nextPageToken ?? "";
  } while (pageToken);
  return files;
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  if (items.length === 0) return;
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function upload(token: string, folderId: string, name: string, blob: Blob, existingId?: string) {
  if (existingId) {
    await driveFetch(token, `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    });
    return;
  }
  const boundary = "photozine";
  const meta = JSON.stringify({ name, parents: [folderId] });
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const prefix = new TextEncoder().encode(head);
  const suffix = new TextEncoder().encode(tail);
  const body = new Uint8Array(prefix.length + bytes.length + suffix.length);
  body.set(prefix, 0);
  body.set(bytes, prefix.length);
  body.set(suffix, prefix.length + bytes.length);
  await driveFetch(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
}

export async function connectDrive() {
  window.location.assign("/api/drive/start");
}

export type DriveProgress = (done: number, total: number) => void;

async function thumbFor(photo: Photo): Promise<Blob | null> {
  const existing = await getThumbBlob(photo.id);
  if (existing) return existing;
  const full = await getBlob(photo.id);
  if (!full) return null;
  const decoded = await decodeImage(full);
  await putThumb({
    id: photo.id,
    name: photo.name,
    w: decoded.w,
    h: decoded.h,
    thumb: decoded.thumb,
    takenAt: photo.takenAt,
    seq: photo.seq,
  });
  return decoded.thumb;
}

export async function saveBookToDrive(
  book: Book,
  photos: Photo[],
  readBlob: (id: string) => Promise<Blob | null>,
  onProgress?: DriveProgress,
) {
  const { accessToken, folderId } = await getDriveAccess();
  const files = await listChildren(accessToken, folderId);
  const byName = new Map(files.map((file) => [file.name, file.id]));
  const listed: BookFile["photos"] = [];
  const jobs: { name: string; read: () => Promise<Blob | null> }[] = [];
  for (const photo of photos) {
    const filename = `${photo.id}.jpg`;
    listed.push({ id: photo.id, name: photo.name, file: filename, takenAt: photo.takenAt, seq: photo.seq });
    if (!byName.has(filename)) jobs.push({ name: filename, read: () => readBlob(photo.id) });
    const thumbName = `${photo.id}.thumb.jpg`;
    if (!byName.has(thumbName)) jobs.push({ name: thumbName, read: () => thumbFor(photo) });
  }
  const total = jobs.length + 1;
  onProgress?.(0, total);
  let done = 0;
  await pool(jobs, 4, async (job) => {
    const body = await job.read();
    if (body) await upload(accessToken, folderId, job.name, body);
    done += 1;
    onProgress?.(done, total);
  });
  const payload: BookFile = { version: 1, updatedAt: Date.now(), book, photos: listed };
  await upload(
    accessToken,
    folderId,
    "book.json",
    new Blob([JSON.stringify(payload)], { type: "application/json" }),
    byName.get("book.json"),
  );
  onProgress?.(total, total);
  return payload.updatedAt;
}

export type DrivePhoto = {
  id: string;
  name: string;
  blob: Blob;
  takenAt?: number | null;
  seq?: number;
  full: boolean;
};

export async function loadBookFromDrive(onProgress?: DriveProgress, present?: Set<string>) {
  onProgress?.(0, 1);
  const { accessToken, folderId } = await getDriveAccess();
  const files = await listChildren(accessToken, folderId);
  const bookFile = files.find((file) => file.name === "book.json");
  if (!bookFile) throw new Error("Drive folder does not have a photozine book yet.");
  const raw = await driveFetch(accessToken, `https://www.googleapis.com/drive/v3/files/${bookFile.id}?alt=media`);
  const parsed = (await raw.json()) as BookFile;
  if (!parsed || parsed.version !== 1 || !parsed.book) throw new Error("The Drive book file is damaged.");
  const items = parsed.photos ?? [];
  const missing = items.filter((item) => !present?.has(item.id));
  const total = Math.max(1, missing.length);
  if (missing.length === 0) onProgress?.(1, 1);
  const photos: DrivePhoto[] = [];
  let done = 0;
  await pool(missing, 6, async (item) => {
    const thumb = files.find((entry) => entry.name === `${item.id}.thumb.jpg`);
    const full = files.find((entry) => entry.name === item.file || entry.name === `${item.id}.jpg`);
    const file = thumb ?? full;
    if (file) {
      const media = await driveFetch(accessToken, `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
      photos.push({
        id: item.id,
        name: item.name || "Photo",
        blob: await media.blob(),
        takenAt: typeof item.takenAt === "number" ? item.takenAt : null,
        seq: typeof item.seq === "number" ? item.seq : photos.length + 1,
        full: !thumb,
      });
    }
    done += 1;
    onProgress?.(done, total);
  });
  return { updatedAt: parsed.updatedAt ?? 0, book: parsed.book, photos, catalog: items };
}

export async function ensureDriveOriginals(ids: string[], onProgress?: DriveProgress) {
  const missing: string[] = [];
  for (const id of ids) {
    if (!(await getBlob(id))) missing.push(id);
  }
  if (missing.length === 0) {
    onProgress?.(1, 1);
    return;
  }
  const { accessToken, folderId } = await getDriveAccess();
  const files = await listChildren(accessToken, folderId);
  const byName = new Map(files.map((file) => [file.name, file.id]));
  const total = missing.length;
  let done = 0;
  onProgress?.(0, total);
  await pool(missing, 4, async (id) => {
    const fileId = byName.get(`${id}.jpg`);
    if (!fileId) throw new Error("A full-size photo is not on Drive yet. Save the book from the device that still has it.");
    const media = await driveFetch(accessToken, `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    await putBlob(id, await media.blob());
    done += 1;
    onProgress?.(done, total);
  });
}
