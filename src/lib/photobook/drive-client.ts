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
  const query = `'${folderId}' in parents and trashed=false`;
  const response = await driveFetch(
    token,
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1000`,
  );
  const json = (await response.json()) as { files?: DriveFile[] };
  return json.files ?? [];
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

export async function saveBookToDrive(book: Book, photos: Photo[], readBlob: (id: string) => Promise<Blob | null>) {
  const { accessToken, folderId } = await getDriveAccess();
  const files = await listChildren(accessToken, folderId);
  const byName = new Map(files.map((file) => [file.name, file.id]));
  const listed: BookFile["photos"] = [];
  for (const photo of photos) {
    const filename = `${photo.id}.jpg`;
    listed.push({ id: photo.id, name: photo.name, file: filename, takenAt: photo.takenAt, seq: photo.seq });
    if (byName.has(filename)) continue;
    const blob = await readBlob(photo.id);
    if (!blob) continue;
    await upload(accessToken, folderId, filename, blob);
  }
  const payload: BookFile = { version: 1, updatedAt: Date.now(), book, photos: listed };
  await upload(accessToken, folderId, "book.json", new Blob([JSON.stringify(payload)], { type: "application/json" }), byName.get("book.json"));
  return payload.updatedAt;
}

export async function loadBookFromDrive() {
  const { accessToken, folderId } = await getDriveAccess();
  const files = await listChildren(accessToken, folderId);
  const bookFile = files.find((file) => file.name === "book.json");
  if (!bookFile) throw new Error("Drive folder does not have a photozine book yet.");
  const raw = await driveFetch(accessToken, `https://www.googleapis.com/drive/v3/files/${bookFile.id}?alt=media`);
  const parsed = (await raw.json()) as BookFile;
  if (!parsed || parsed.version !== 1 || !parsed.book) throw new Error("The Drive book file is damaged.");
  const photos = [];
  for (const item of parsed.photos ?? []) {
    const file = files.find((entry) => entry.name === item.file || entry.name === `${item.id}.jpg`);
    if (!file) continue;
    const media = await driveFetch(accessToken, `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
    photos.push({
      id: item.id,
      name: item.name || "Photo",
      blob: await media.blob(),
      takenAt: typeof item.takenAt === "number" ? item.takenAt : null,
      seq: typeof item.seq === "number" ? item.seq : photos.length + 1,
    });
  }
  return { updatedAt: parsed.updatedAt ?? 0, book: parsed.book, photos };
}
