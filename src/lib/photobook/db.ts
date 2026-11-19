import type { Book } from "@/lib/photobook/types";

const BOOK_RE = /^[a-z0-9]{8,32}$/;

function databaseName(): string {
  let id = "current";
  if (typeof window !== "undefined") {
    const raw = new URLSearchParams(window.location.search).get("book") ?? "";
    if (BOOK_RE.test(raw)) id = raw;
  }
  return id === "current" ? "folio-press" : `folio-${id}`;
}

export function newBookHref(): string {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const url = new URL(window.location.href);
  url.searchParams.set("book", id);
  return url.toString();
}

const DB_VERSION = 1;

export type ThumbRecord = {
  id: string;
  name: string;
  w: number;
  h: number;
  thumb: Blob;
  takenAt?: number | null;
  seq?: number;
};

export type BlobRecord = { id: string; blob: Blob };

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("This browser cannot store a photobook."));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(databaseName(), DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("thumbs")) db.createObjectStore("thumbs", { keyPath: "id" });
        if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs", { keyPath: "id" });
        if (!db.objectStoreNames.contains("book")) db.createObjectStore("book");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error("Could not open the photobook store."));
      };
    });
  }
  return dbPromise;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Storage request failed."));
  });
}

export async function loadThumbs(): Promise<ThumbRecord[]> {
  const db = await openDb();
  return requestToPromise(db.transaction("thumbs", "readonly").objectStore("thumbs").getAll());
}

export async function loadBook(): Promise<Book | null> {
  const db = await openDb();
  const value = await requestToPromise(db.transaction("book", "readonly").objectStore("book").get("current"));
  return (value as Book | undefined) ?? null;
}

export async function saveBook(book: Book): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("book", "readwrite");
  tx.objectStore("book").put(book, "current");
  await transactionDone(tx);
}

export type LibraryPhoto = {
  id: string;
  name: string;
  w: number;
  h: number;
  takenAt: number | null;
  seq: number;
};

export type RestorePoint = {
  id: string;
  at: number;
  keep: boolean;
  book: Book;
  photos: LibraryPhoto[];
};

export async function loadLibrary(): Promise<LibraryPhoto[] | null> {
  const db = await openDb();
  const value = await requestToPromise(db.transaction("book", "readonly").objectStore("book").get("library"));
  if (!Array.isArray(value)) return null;
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || typeof item.id !== "string") return [];
    return [
      {
        id: item.id,
        name: typeof item.name === "string" ? item.name : "Photo",
        w: Number(item.w) || 0,
        h: Number(item.h) || 0,
        takenAt: typeof item.takenAt === "number" ? item.takenAt : null,
        seq: Number(item.seq) || 0,
      },
    ];
  });
}

export async function saveLibrary(photos: LibraryPhoto[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("book", "readwrite");
  tx.objectStore("book").put(photos, "library");
  await transactionDone(tx);
}

export async function loadRestorePoints(): Promise<RestorePoint[]> {
  const db = await openDb();
  const value = await requestToPromise(db.transaction("book", "readonly").objectStore("book").get("restore-points"));
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item.id === "string" && typeof item.at === "number" && item.book && Array.isArray(item.photos));
}

export async function writeRestorePoint(point: RestorePoint, force: boolean): Promise<RestorePoint[]> {
  const existing = await loadRestorePoints();
  const last = existing[existing.length - 1];
  const same =
    last &&
    last.photos.length === point.photos.length &&
    JSON.stringify(last.book) === JSON.stringify(point.book) &&
    last.photos.every((photo, index) => photo.id === point.photos[index]?.id);
  if (same) return prunePoints(existing);
  if (!force && last && point.at - last.at < 20 * 60 * 1000) return existing;
  const next = prunePoints([...existing, point]);
  const db = await openDb();
  const tx = db.transaction("book", "readwrite");
  tx.objectStore("book").put(next, "restore-points");
  await transactionDone(tx);
  return next;
}

function prunePoints(points: RestorePoint[]): RestorePoint[] {
  const now = Date.now();
  const week = now - 7 * 24 * 60 * 60 * 1000;
  const fresh = points.filter((point) => point.at >= week).sort((a, b) => a.at - b.at);
  const kept: RestorePoint[] = [];
  for (const point of fresh) {
    if (point.keep) {
      kept.push(point);
      continue;
    }
    const age = now - point.at;
    const gap = age < 6 * 60 * 60 * 1000 ? 20 * 60 * 1000 : age < 24 * 60 * 60 * 1000 ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const previous = kept[kept.length - 1];
    if (!previous || previous.keep || point.at - previous.at >= gap) kept.push(point);
    else kept[kept.length - 1] = point;
  }
  const pinned = kept.filter((point) => point.keep);
  const rest = kept.filter((point) => !point.keep);
  const room = Math.max(0, 48 - pinned.length);
  return [...pinned, ...rest.slice(-room)].sort((a, b) => a.at - b.at);
}

export async function loadSyncHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  const value = await requestToPromise(db.transaction("book", "readonly").objectStore("book").get("sync-dir"));
  return value && typeof value === "object" && "getFileHandle" in value ? (value as FileSystemDirectoryHandle) : null;
}

export async function saveSyncHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("book", "readwrite");
  tx.objectStore("book").put(handle, "sync-dir");
  await transactionDone(tx);
}

export async function loadSyncStamp(): Promise<number> {
  const db = await openDb();
  const value = await requestToPromise(db.transaction("book", "readonly").objectStore("book").get("sync-stamp"));
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function saveSyncStamp(stamp: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("book", "readwrite");
  tx.objectStore("book").put(stamp, "sync-stamp");
  await transactionDone(tx);
}

export async function updateThumbMeta(id: string, patch: { takenAt?: number | null; seq?: number; name?: string }): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("thumbs", "readwrite");
    const store = tx.objectStore("thumbs");
    const req = store.get(id) as IDBRequest<ThumbRecord | undefined>;
    req.onsuccess = () => {
      if (req.result) store.put({ ...req.result, ...patch });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not update the photograph."));
  });
}

export async function putThumb(thumb: ThumbRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("thumbs", "readwrite");
  tx.objectStore("thumbs").put(thumb);
  await transactionDone(tx);
}

export async function putBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("blobs", "readwrite");
  tx.objectStore("blobs").put({ id, blob } satisfies BlobRecord);
  await transactionDone(tx);
}

export async function getThumbBlob(id: string): Promise<Blob | null> {
  const db = await openDb();
  const record = await requestToPromise(
    db.transaction("thumbs", "readonly").objectStore("thumbs").get(id) as IDBRequest<ThumbRecord | undefined>,
  );
  return record?.thumb ?? null;
}

export async function listThumbIds(): Promise<string[]> {
  const db = await openDb();
  const keys = await requestToPromise(db.transaction("thumbs", "readonly").objectStore("thumbs").getAllKeys());
  return keys.map((key) => String(key));
}

export async function putPhoto(thumb: ThumbRecord, blob: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["thumbs", "blobs"], "readwrite");
  tx.objectStore("thumbs").put(thumb);
  tx.objectStore("blobs").put({ id: thumb.id, blob } satisfies BlobRecord);
  await transactionDone(tx);
}

export async function listBlobIds(): Promise<string[]> {
  const db = await openDb();
  const keys = await requestToPromise(db.transaction("blobs", "readonly").objectStore("blobs").getAllKeys());
  return keys.map((key) => String(key));
}

export async function getBlob(id: string): Promise<Blob | null> {
  const db = await openDb();
  const record = await requestToPromise(
    db.transaction("blobs", "readonly").objectStore("blobs").get(id) as IDBRequest<BlobRecord | undefined>,
  );
  return record?.blob ?? null;
}

export async function deletePhotoRecord(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["thumbs", "blobs"], "readwrite");
  tx.objectStore("thumbs").delete(id);
  tx.objectStore("blobs").delete(id);
  await transactionDone(tx);
}

export async function deleteAllPhotoRecords(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["thumbs", "blobs"], "readwrite");
  tx.objectStore("thumbs").clear();
  tx.objectStore("blobs").clear();
  await transactionDone(tx);
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save the book."));
    tx.onabort = () => reject(tx.error ?? new Error("Save was cancelled."));
  });
}
