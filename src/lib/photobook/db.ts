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

export async function updateThumbMeta(id: string, patch: { takenAt?: number | null; seq?: number }): Promise<void> {
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

export async function putPhoto(thumb: ThumbRecord, blob: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["thumbs", "blobs"], "readwrite");
  tx.objectStore("thumbs").put(thumb);
  tx.objectStore("blobs").put({ id: thumb.id, blob } satisfies BlobRecord);
  await transactionDone(tx);
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
