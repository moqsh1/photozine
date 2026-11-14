import { getBlob, loadSyncHandle, loadSyncStamp, saveSyncHandle, saveSyncStamp } from "@/lib/photobook/db";
import type { Book, Photo } from "@/lib/photobook/types";

const BOOK_FILE = "photozine-book.json";

export type SyncedPhoto = { id: string; name: string; blob: Blob; takenAt: number | null; seq: number };
export type SyncedBook = { updatedAt: number; book: Book; photos: SyncedPhoto[] };

type SyncFile = {
  version: 1;
  updatedAt: number;
  book: Book;
  photos: { id: string; name: string; file: string; takenAt?: number | null; seq?: number }[];
};

let timer = 0;
let writing = false;
let queued: { book: Book; photos: Photo[] } | null = null;

export function syncSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

type SyncDir = FileSystemDirectoryHandle & {
  queryPermission(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
};

function asDir(handle: FileSystemDirectoryHandle): SyncDir {
  return handle as SyncDir;
}

async function allowed(handle: FileSystemDirectoryHandle, ask: boolean): Promise<boolean> {
  const dir = asDir(handle);
  const opts = { mode: "readwrite" } as const;
  if ((await dir.queryPermission(opts)) === "granted") return true;
  if (!ask) return false;
  return (await dir.requestPermission(opts)) === "granted";
}

export async function syncFolderName(): Promise<string | null> {
  const handle = await loadSyncHandle();
  return handle?.name ?? null;
}

export function queueFolderSync(book: Book, photos: Photo[]) {
  queued = { book, photos };
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const next = queued;
    queued = null;
    if (next) void pushFolder(next.book, next.photos);
  }, 700);
}

async function pushFolder(book: Book, photos: Photo[]) {
  if (writing) {
    queued = { book, photos };
    return;
  }
  const handle = await loadSyncHandle();
  if (!handle) return;
  if (!(await allowed(handle, false))) return;
  writing = true;
  try {
    const updatedAt = Date.now();
    const listed: SyncFile["photos"] = [];
    const photosDir = await handle.getDirectoryHandle("photos", { create: true });
    for (const photo of photos) {
      const file = `${photo.id}.jpg`;
      listed.push({ id: photo.id, name: photo.name, file: `photos/${file}`, takenAt: photo.takenAt, seq: photo.seq });
      let exists = true;
      try {
        await photosDir.getFileHandle(file);
      } catch {
        exists = false;
      }
      if (exists) continue;
      const blob = await getBlob(photo.id);
      if (!blob) continue;
      const created = await photosDir.getFileHandle(file, { create: true });
      const writable = await created.createWritable();
      await writable.write(blob);
      await writable.close();
    }
    const payload: SyncFile = { version: 1, updatedAt, book, photos: listed };
    const file = await handle.getFileHandle(BOOK_FILE, { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(payload));
    await writable.close();
    await saveSyncStamp(updatedAt);
  } finally {
    writing = false;
    if (queued) {
      const next = queued;
      queued = null;
      void pushFolder(next.book, next.photos);
    }
  }
}

async function readFolder(handle: FileSystemDirectoryHandle): Promise<SyncedBook | null> {
  let file: File;
  try {
    file = await (await handle.getFileHandle(BOOK_FILE)).getFile();
  } catch {
    return null;
  }
  let parsed: SyncFile;
  try {
    parsed = JSON.parse(await file.text()) as SyncFile;
  } catch {
    throw new Error("The synced book file is damaged.");
  }
  if (!parsed || parsed.version !== 1 || !parsed.book || !Array.isArray(parsed.photos)) {
    throw new Error("This folder is not a photozine book.");
  }
  const photos: SyncedPhoto[] = [];
  for (const item of parsed.photos) {
    if (!item || typeof item.id !== "string" || typeof item.file !== "string") continue;
    const name = item.file.split("/").pop();
    if (!name) continue;
    try {
      const dir = item.file.startsWith("photos/") ? await handle.getDirectoryHandle("photos") : handle;
      const blob = await (await dir.getFileHandle(name)).getFile();
      photos.push({
        id: item.id,
        name: typeof item.name === "string" && item.name.trim() ? item.name.slice(0, 120) : "Photo",
        blob,
        takenAt: typeof item.takenAt === "number" ? item.takenAt : null,
        seq: typeof item.seq === "number" ? item.seq : photos.length + 1,
      });
    } catch {
      continue;
    }
  }
  return { updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0, book: parsed.book, photos };
}

export async function pullNewerBook(): Promise<SyncedBook | null> {
  const handle = await loadSyncHandle();
  if (!handle || !(await allowed(handle, false))) return null;
  const remote = await readFolder(handle);
  if (!remote) return null;
  const stamp = await loadSyncStamp();
  if (remote.updatedAt <= stamp) return null;
  await saveSyncStamp(remote.updatedAt);
  return remote;
}

export async function linkSyncFolder(local: { book: Book; photos: Photo[] }): Promise<{ name: string; remote: SyncedBook | null }> {
  if (!syncSupported()) throw new Error("This browser cannot sync a folder. Use Chrome or Edge on the computer.");
  const picker = (window as Window & { showDirectoryPicker?: (opts: { mode: "readwrite"; id: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) throw new Error("This browser cannot sync a folder. Use Chrome or Edge on the computer.");
  const handle = await picker({ mode: "readwrite", id: "photozine-book" });
  if (!(await allowed(handle, true))) throw new Error("Photozine needs permission to write that folder.");
  await saveSyncHandle(handle);
  const remote = await readFolder(handle);
  const localHasWork = local.photos.length > 0;
  const remoteHasWork = Boolean(remote && (remote.photos.length > 0 || remote.book.pages.some((page) => page.slots.some((slot) => slot.photoId))));
  const stamp = await loadSyncStamp();
  if (remoteHasWork && remote && (!localHasWork || remote.updatedAt >= stamp)) {
    await saveSyncStamp(remote.updatedAt);
    return { name: handle.name, remote };
  }
  await pushFolder(local.book, local.photos);
  return { name: handle.name, remote: null };
}

export async function reloadSyncFolder(): Promise<SyncedBook | null> {
  const handle = await loadSyncHandle();
  if (!handle) throw new Error("Choose a sync folder first.");
  if (!(await allowed(handle, true))) throw new Error("Photozine needs permission to read that folder.");
  const remote = await readFolder(handle);
  if (!remote) throw new Error("That folder does not have a photozine book yet.");
  await saveSyncStamp(remote.updatedAt);
  return remote;
}
