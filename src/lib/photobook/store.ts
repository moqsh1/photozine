import { create } from "zustand";
import { mergeAdjust, readAdjust, type Adjust } from "@/lib/photobook/adjust";
import { captionForDate, dateFromName, formatHindiDate, readTakenAt } from "@/lib/photobook/date";
import { decodeImage, prettyName } from "@/lib/photobook/decode";
import { pullNewerBook, queueFolderSync } from "@/lib/photobook/sync";
import {
  deleteAllPhotoRecords,
  deletePhotoRecord,
  getBlob,
  loadBook,
  loadThumbs,
  putPhoto,
  saveBook,
  updateThumbMeta,
} from "@/lib/photobook/db";
import { defaultLayout, makePage, withLayout, LAYOUT_BY_ID } from "@/lib/photobook/layouts";
import { SAMPLE_ALBUM } from "@/lib/photobook/samples";
import {
  clamp,
  emptySlot,
  LIMITS,
  MAX_PHOTOS,
  type Book,
  type Density,
  type LayoutId,
  type Orientation,
  type Page,
  type Photo,
  type Slot,
} from "@/lib/photobook/types";

type LibraryFilter = "all" | "loose";

type BookState = {
  ready: boolean;
  notice: string | null;
  importing: { done: number; total: number } | null;
  preparingPrint: boolean;
  photos: Photo[];
  fullUrls: Record<string, string>;
  title: string;
  orientation: Orientation;
  marginIn: number;
  gapIn: number;
  captionIn: number;
  density: Density;
  pages: Page[];
  activePageId: string | null;
  selectedSlot: number | null;
  placingId: string | null;
  clipboard: Slot | null;
  canUndo: boolean;
  canRedo: boolean;
  libraryQuery: string;
  libraryFilter: LibraryFilter;
  hydrate: () => Promise<void>;
  backfillDates: () => Promise<void>;
  setTitle: (title: string) => void;
  setOrientation: (orientation: Orientation) => void;
  setMargin: (marginIn: number) => void;
  setGap: (gapIn: number) => void;
  setCaptionSize: (captionIn: number) => void;
  setDensity: (density: Density) => void;
  setQuery: (libraryQuery: string) => void;
  setFilter: (libraryFilter: LibraryFilter) => void;
  selectPage: (id: string) => void;
  selectSlot: (index: number) => void;
  clearSlotSelection: () => void;
  focusPhoto: (id: string) => void;
  cancelPlacing: () => void;
  importFiles: (files: File[], captions?: Record<string, string>, into?: { pageId: string; index: number }) => Promise<void>;
  cancelImport: () => void;
  loadSamples: () => Promise<void>;
  addPage: () => void;
  duplicatePage: () => void;
  deletePage: () => void;
  movePage: (dir: -1 | 1) => void;
  stepPage: (dir: -1 | 1) => void;
  movePageTo: (fromId: string, toId: string) => void;
  placePageAt: (pageNumber: number) => void;
  setPageLayout: (layout: LayoutId) => void;
  setPageSplit: (split: number | null, part?: "top" | "left" | "right" | "width") => void;
  assignPhoto: (pageId: string, index: number, photoId: string) => void;
  clearSlot: (pageId: string, index: number) => void;
  copySlot: () => void;
  cutSlot: () => void;
  pasteSlot: () => void;
  undo: () => void;
  redo: () => void;
  swapSlots: (fromPageId: string, fromIndex: number, toPageId: string, toIndex: number) => void;
  reorderPhotos: (fromId: string, toId: string) => void;
  setSlotCaption: (pageId: string, index: number, caption: string) => void;
  clearPageCaptions: () => void;
  clearCaptionsOnPages: (ids: string[]) => void;
  setYearOnly: (pageId: string, index: number, yearOnly: boolean) => void;
  captionPhotos: (ids: string[], caption: string) => void;
  datePhotos: (ids: string[], takenAt: number | null) => void;
  setSlotDate: (pageId: string, index: number, takenAt: number | null) => void;
  setSlotCrop: (pageId: string, index: number, crop: Partial<Pick<Slot, "zoom" | "panX" | "panY">>) => void;
  setSlotAdjust: (pageId: string, index: number, patch: Partial<Adjust>) => void;
  applyAdjustToPhotos: (ids: string[], adjust: Adjust | undefined) => void;
  rotateSlot: (pageId: string, index: number) => void;
  deletePhoto: (id: string) => Promise<void>;
  clearPages: () => void;
  deleteAllPhotos: () => Promise<void>;
  loadProject: (book: Book, incoming: { id: string; name: string; blob: Blob; takenAt?: number | null; seq?: number }[]) => Promise<void>;
  ensureFull: (id: string) => Promise<void>;
  ensureAllFull: () => Promise<void>;
  setPreparingPrint: (preparingPrint: boolean) => void;
};

let canSave = false;
let saveTimer = 0;
let importCancelled = false;
let booted = false;
let dirty = false;
let nextSeq = 1;
const fullLoads = new Map<string, Promise<void>>();

function snapshot(s: BookState): Book {
  return {
    title: s.title,
    orientation: s.orientation,
    marginIn: s.marginIn,
    gapIn: s.gapIn,
    captionIn: s.captionIn,
    density: s.density,
    pages: s.pages,
  };
}

function defaultBook(): Book {
  return {
    title: "Untitled book",
    orientation: "landscape",
    marginIn: 0.4,
    gapIn: 0.12,
    captionIn: 0.2,
    density: 2,
    pages: [makePage("two-cols")],
  };
}

function isDensity(n: number): n is Density {
  return n === 1 || n === 2 || n === 3 || n === 4;
}

function sanitizeBook(raw: Book | null): Book {
  const base = defaultBook();
  if (!raw || !Array.isArray(raw.pages) || raw.pages.length === 0) return base;
  const density = isDensity(raw.density) ? raw.density : 2;
  const pages = raw.pages.flatMap((page) => {
    if (!page || !LAYOUT_BY_ID[page.layout]) return [];
    return [withLayout({ ...page, slots: Array.isArray(page.slots) ? page.slots : [] }, page.layout)];
  });
  if (pages.length === 0) return base;
  return {
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.slice(0, 80) : base.title,
    orientation: raw.orientation === "portrait" ? "portrait" : "landscape",
    marginIn: clamp(Number(raw.marginIn) || base.marginIn, 0, 1.25),
    gapIn: clamp(Number(raw.gapIn) || base.gapIn, 0.04, 0.45),
    captionIn: clamp(Number(raw.captionIn) || base.captionIn, 0.2, 0.7),
    density,
    pages,
  };
}

function bookIsEmpty(pages: Page[]) {
  return pages.every((page) => page.slots.every((slot) => !slot.photoId));
}

let cloudTimer = 0;
let cloudPush: ((book: Book, photos: Photo[]) => void) | null = null;

export function onBookCloud(push: (book: Book, photos: Photo[]) => void) {
  cloudPush = push;
}

function persistLater() {
  noteHistory();
  dirty = true;
  if (!canSave) return;
  window.clearTimeout(saveTimer);
  const book = snapshot(useBook.getState());
  saveTimer = window.setTimeout(() => {
    const latest = snapshot(useBook.getState());
    void saveBook(latest).then(() => {
      queueFolderSync(latest, useBook.getState().photos);
      if (!cloudPush) return;
      window.clearTimeout(cloudTimer);
      cloudTimer = window.setTimeout(() => cloudPush?.(latest, useBook.getState().photos), 1500);
    });
  }, 220);
}

const past: Book[] = [];
const future: Book[] = [];
let historyReady = false;
let currentKey = "";

function bookKey(book: Book) {
  return JSON.stringify(book);
}

function noteHistory() {
  if (!historyReady) return;
  const book = snapshot(useBook.getState());
  const key = bookKey(book);
  if (key === currentKey) return;
  if (currentKey) {
    past.push(JSON.parse(currentKey) as Book);
    if (past.length > 40) past.shift();
    future.length = 0;
  }
  currentKey = key;
  useBook.setState({ canUndo: past.length > 0, canRedo: future.length > 0 });
}

function armHistory() {
  historyReady = true;
  currentKey = bookKey(snapshot(useBook.getState()));
  useBook.setState({ canUndo: past.length > 0, canRedo: future.length > 0 });
}

function restoreBook(book: Book) {
  currentKey = bookKey(book);
  const active = useBook.getState().activePageId;
  const still = book.pages.some((page) => page.id === active);
  useBook.setState({
    title: book.title,
    orientation: book.orientation,
    marginIn: book.marginIn,
    gapIn: book.gapIn,
    captionIn: book.captionIn,
    density: book.density,
    pages: book.pages,
    activePageId: still ? active : (book.pages[0]?.id ?? null),
    selectedSlot: 0,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  });
  dirty = true;
  if (!canSave) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void saveBook(book);
  }, 220);
}

function flash(notice: string) {
  useBook.setState({ notice });
  window.setTimeout(() => {
    if (useBook.getState().notice === notice) useBook.setState({ notice: null });
  }, 4600);
}

function sortIdsByDate(ids: string[], takenAt: Map<string, number | null>): string[] {
  return ids
    .map((id, index) => ({ id, index, at: takenAt.get(id) ?? null }))
    .sort((a, b) => {
      if (a.at == null && b.at == null) return a.index - b.index;
      if (a.at == null) return 1;
      if (b.at == null) return -1;
      return a.at - b.at || a.index - b.index;
    })
    .map((item) => item.id);
}

function pagesInDateOrder(
  existing: Page[],
  ids: string[],
  pageIsLandscape: boolean,
  isLandscape: (id: string) => boolean,
): Page[] {
  const byPhoto = new Map<string, Slot>();
  for (const page of existing) {
    for (const slot of page.slots) {
      if (slot.photoId) byPhoto.set(slot.photoId, slot);
    }
  }
  return packGroups(ids, isLandscape, pageIsLandscape).map((group) => {
    const page = makePage(group.layout);
    page.slots = page.slots.map((slot, index) => {
      const id = group.ids[index];
      if (!id) return slot;
      const source = byPhoto.get(id);
      return source ? { ...source } : { ...slot, photoId: id };
    });
    return page;
  });
}

function placeIds(
  pages: Page[],
  ids: string[],
  replaceEmpty: boolean,
  pageIsLandscape: boolean,
  isLandscape: (id: string) => boolean,
): Page[] {
  if (ids.length === 0) return pages;
  const next = replaceEmpty ? [] : pages.slice();
  const queue = ids.slice();
  for (const group of packGroups(queue, isLandscape, pageIsLandscape)) {
    next.push(fillPage(group.layout, group.ids));
  }
  return next;
}

function packGroups(
  ids: string[],
  isLandscape: (id: string) => boolean,
  pageIsLandscape: boolean,
): { ids: string[]; layout: LayoutId }[] {
  const queue = ids.slice();
  const groups: { ids: string[]; layout: LayoutId }[] = [];
  while (queue.length > 0) groups.push(takeGroup(queue, isLandscape, pageIsLandscape));
  return groups;
}

function fillPage(layout: LayoutId, ids: string[]): Page {
  const page = makePage(layout);
  page.slots = page.slots.map((slot, index) => {
    const id = ids[index];
    return id ? { ...slot, photoId: id } : slot;
  });
  return page;
}

function takeGroup(
  queue: string[],
  isLandscape: (id: string) => boolean,
  pageIsLandscape: boolean,
): { ids: string[]; layout: LayoutId } {
  const land = (index: number) => index < queue.length && isLandscape(queue[index]);
  const pair: LayoutId = pageIsLandscape ? "two-cols" : "two-rows";
  if (queue.length >= 4 && !land(0) && !land(1) && !land(2) && !land(3)) {
    return { ids: queue.splice(0, 4), layout: "four" };
  }
  if (land(0) && land(1)) return { ids: queue.splice(0, 2), layout: pair };
  if (land(0) && !land(1) && land(2)) {
    const first = queue[0];
    const portrait = queue[1];
    const second = queue[2];
    queue.splice(0, 3);
    queue.unshift(portrait);
    return { ids: [first, second], layout: pair };
  }
  if (land(0) && !land(1) && !land(2) && queue.length >= 3) {
    return { ids: queue.splice(0, 3), layout: "three-banner" };
  }
  if (!land(0) && !land(1) && land(2)) {
    const first = queue[0];
    const second = queue[1];
    const landscape = queue[2];
    queue.splice(0, 3);
    return { ids: [landscape, first, second], layout: "three-banner" };
  }
  if (!land(0) && land(1) && !land(2) && queue.length >= 3) {
    const first = queue[0];
    const landscape = queue[1];
    const second = queue[2];
    queue.splice(0, 3);
    return { ids: [landscape, first, second], layout: "three-banner" };
  }
  const id = queue.shift() ?? "";
  return { ids: [id], layout: isLandscape(id) ? "half" : "one" };
}

function selectedFrame(state: { pages: Page[]; activePageId: string | null; selectedSlot: number | null }): Slot | null {
  const page = state.pages.find((item) => item.id === state.activePageId);
  if (!page || state.selectedSlot == null) return null;
  return page.slots[state.selectedSlot] ?? null;
}

function patchSlot(pages: Page[], pageId: string, index: number, recipe: (slot: Slot) => Slot): Page[] {
  return pages.map((page) => {
    if (page.id !== pageId || !page.slots[index]) return page;
    const slots = page.slots.slice();
    slots[index] = recipe(slots[index]);
    return { ...page, slots };
  });
}

export const useBook = create<BookState>((set, get) => {
  const seed = defaultBook();
  return {
  ready: true,
  notice: null,
  importing: null,
  preparingPrint: false,
  photos: [],
  fullUrls: {},
  title: seed.title,
  orientation: seed.orientation,
  marginIn: seed.marginIn,
  gapIn: seed.gapIn,
  captionIn: seed.captionIn,
  density: seed.density,
  pages: seed.pages,
  activePageId: seed.pages[0]?.id ?? null,
  selectedSlot: 0,
  placingId: null,
  clipboard: null,
  canUndo: false,
  canRedo: false,
  libraryQuery: "",
  libraryFilter: "all",

  hydrate: async () => {
    if (booted) {
      await get().backfillDates();
      return;
    }
    booted = true;
    try {
      const [thumbs, stored] = await Promise.all([loadThumbs(), loadBook()]);
      const photos: Photo[] = thumbs
        .map((thumb) => ({
          id: thumb.id,
          name: thumb.name,
          w: thumb.w,
          h: thumb.h,
          thumbUrl: URL.createObjectURL(thumb.thumb),
          takenAt: typeof thumb.takenAt === "number" ? thumb.takenAt : null,
          seq: typeof thumb.seq === "number" ? thumb.seq : 0,
        }))
        .sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
      nextSeq = photos.reduce((max, photo) => Math.max(max, photo.seq), 0) + 1;
      if (dirty) {
        set({ photos });
      } else if (stored || photos.length > 0) {
      const book = sanitizeBook(stored);
      const pages = stored
        ? book.pages
        : placeIds(
            book.pages,
            photos.map((photo) => photo.id),
            true,
            book.orientation === "landscape",
            (id) => {
              const photo = photos.find((item) => item.id === id);
              return Boolean(photo && photo.w > photo.h);
            },
          );
      set({
        photos,
        ...book,
        pages,
        activePageId: pages[0]?.id ?? null,
        selectedSlot: 0,
      });
      }
    } catch (error) {
      set({
        notice: error instanceof Error ? error.message : "Could not open the saved book.",
      });
    } finally {
      canSave = true;
      if (dirty) persistLater();
    }
    await get().backfillDates();
    armHistory();
    try {
      const remote = await pullNewerBook();
      if (remote) await get().loadProject(remote.book, remote.photos);
    } catch {
      // The folder can be read the next time the user opens Sync.
    }
  },

  backfillDates: async () => {
    const photos = get().photos.slice();
    let changed = false;
    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index];
      if (photo.takenAt != null) continue;
      let takenAt: number | null = null;
      try {
        const blob = await getBlob(photo.id);
        if (blob) takenAt = await readTakenAt(blob);
      } catch {
        takenAt = null;
      }
      if (takenAt == null) takenAt = dateFromName(photo.name);
      if (takenAt == null) continue;
      photos[index] = { ...photo, takenAt };
      changed = true;
      void updateThumbMeta(photo.id, { takenAt });
    }
    const byId = new Map(photos.map((photo) => [photo.id, photo.takenAt]));
    const pages = get().pages.map((page) => ({
      ...page,
      slots: page.slots.map((slot) => {
        if (!slot.photoId) return slot;
        const takenAt = slot.takenAt ?? byId.get(slot.photoId) ?? null;
        if (takenAt == null) return slot;
        const caption = captionForDate(slot.caption, takenAt).slice(0, 140);
        if (caption === slot.caption && slot.takenAt === takenAt) return slot;
        changed = true;
        return { ...slot, takenAt, caption };
      }),
    }));
    if (!changed) return;
    set({ photos, pages });
    persistLater();
  },

  setTitle: (title) => {
    set({ title: title.slice(0, 80) });
    persistLater();
  },
  setOrientation: (orientation) => {
    set({ orientation });
    persistLater();
  },
  setMargin: (marginIn) => {
    set({ marginIn: clamp(marginIn, 0, 1.25) });
    persistLater();
  },
  setGap: (gapIn) => {
    set({ gapIn: clamp(gapIn, 0.04, 0.45) });
    persistLater();
  },
  setCaptionSize: (captionIn) => {
    set({ captionIn: clamp(captionIn, 0.2, 0.7) });
    persistLater();
  },
  setDensity: (density) => {
    set({ density });
    persistLater();
  },
  setQuery: (libraryQuery) => set({ libraryQuery }),
  setFilter: (libraryFilter) => set({ libraryFilter }),
  selectPage: (id) => set({ activePageId: id, selectedSlot: null }),
  selectSlot: (index) => {
    const placingId = get().placingId;
    const pageId = get().activePageId;
    set({ selectedSlot: index });
    if (placingId && pageId) {
      get().assignPhoto(pageId, index, placingId);
      set({ placingId: null });
    }
  },
  clearSlotSelection: () => {
    if (get().selectedSlot == null) return;
    set({ selectedSlot: null });
  },
  focusPhoto: (id) => set({ placingId: get().placingId === id ? null : id }),
  cancelPlacing: () => set({ placingId: null }),
  cancelImport: () => {
    importCancelled = true;
  },

  importFiles: async (files, captions, into) => {
    if (get().importing) return;
    const images = files.filter((file) => file.type.startsWith("image/"));
    const room = MAX_PHOTOS - get().photos.length;
    if (room <= 0) {
      flash("This book already holds 1,000 photos.");
      return;
    }
    if (images.length === 0) {
      flash("Choose image files — JPEG, PNG, or WebP.");
      return;
    }
    const batch = images.slice(0, room);
    const overflow = images.length - batch.length;
    importCancelled = false;
    set({ importing: { done: 0, total: batch.length } });
    const fresh: Photo[] = [];
    const ids: string[] = [];
    let failed = 0;
    for (let i = 0; i < batch.length; i += 1) {
      if (importCancelled) break;
      const file = batch[i];
      try {
        const decoded = await decodeImage(file);
        const takenAt = await readTakenAt(file);
        const id = crypto.randomUUID();
        const name = prettyName(file.name);
        const seq = nextSeq;
        nextSeq += 1;
        await putPhoto({ id, name, w: decoded.w, h: decoded.h, thumb: decoded.thumb, takenAt, seq }, decoded.blob);
        const photo: Photo = {
          id,
          name,
          w: decoded.w,
          h: decoded.h,
          thumbUrl: URL.createObjectURL(decoded.thumb),
          takenAt,
          seq,
        };
        fresh.push(photo);
        ids.push(id);
      } catch {
        failed += 1;
      }
      if (fresh.length > 0 && (fresh.length % 3 === 0 || i === batch.length - 1)) {
        const chunk = fresh.splice(0);
        set((state) => ({ photos: state.photos.concat(chunk), importing: { done: i + 1, total: batch.length } }));
      } else {
        set({ importing: { done: i + 1, total: batch.length } });
      }
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    if (fresh.length) {
      set((state) => ({ photos: state.photos.concat(fresh) }));
    }
    const takenOf = new Map(get().photos.map((photo) => [photo.id, photo.takenAt]));
    const ordered = sortIdsByDate(ids, takenOf);
    const target =
      into && get().pages.some((page) => page.id === into.pageId && page.slots[into.index]) ? into : null;
    let pages: Page[];
    let replaceEmpty = false;
    if (target && ordered[0]) {
      const takenAt = takenOf.get(ordered[0]) ?? null;
      set({
        pages: patchSlot(get().pages, target.pageId, target.index, (slot) => ({
          ...slot,
          photoId: ordered[0],
          takenAt,
          caption: captionForDate("", takenAt).slice(0, 140),
          zoom: 1,
          panX: 0,
          panY: 0,
        })),
        activePageId: target.pageId,
        selectedSlot: target.index,
      });
      const shape = new Map(get().photos.map((photo) => [photo.id, photo.w > photo.h]));
      pages = placeIds(
        get().pages,
        ordered.slice(1),
        false,
        get().orientation === "landscape",
        (id) => shape.get(id) === true,
      );
    } else {
      const seen = new Set(ordered);
      const placed: string[] = [];
      for (const page of get().pages) {
        for (const slot of page.slots) {
          if (slot.photoId && !seen.has(slot.photoId)) {
            seen.add(slot.photoId);
            placed.push(slot.photoId);
          }
        }
      }
      const sequence = sortIdsByDate([...placed, ...ordered], takenOf);
      const shape = new Map(get().photos.map((photo) => [photo.id, photo.w > photo.h]));
      replaceEmpty = bookIsEmpty(get().pages);
      pages = pagesInDateOrder(get().pages, sequence, get().orientation === "landscape", (id) => shape.get(id) === true);
    }
    const captioned = captions
      ? pages.map((page) => ({
          ...page,
          slots: page.slots.map((slot) => {
            if (!slot.photoId || slot.caption) return slot;
            const photo = get().photos.find((item) => item.id === slot.photoId);
            const caption = photo ? captions[photo.name] : undefined;
            return caption ? { ...slot, caption } : slot;
          }),
        }))
      : pages;
    const known = new Map(get().photos.map((photo) => [photo.id, photo.takenAt]));
    const dated = captioned.map((page) => ({
      ...page,
      slots: page.slots.map((slot) => {
        if (!slot.photoId) return slot;
        const takenAt = slot.takenAt ?? known.get(slot.photoId) ?? null;
        if (takenAt == null) return slot;
        return { ...slot, takenAt, caption: captionForDate(slot.caption, takenAt).slice(0, 140) };
      }),
    }));
    set({
      pages: dated,
      activePageId: target ? target.pageId : (dated[0]?.id ?? null),
      importing: null,
      selectedSlot: target ? target.index : 0,
    });
    persistLater();
    const notes: string[] = [];
    if (importCancelled) notes.push("Import stopped.");
    else notes.push(`${ids.length} photo${ids.length === 1 ? "" : "s"} added.`);
    if (overflow > 0) notes.push(`${overflow} left out — the limit is 1,000.`);
    if (failed > 0) notes.push(`${failed} could not be read.`);
    flash(notes.join(" "));
    for (const id of ids.slice(0, 8)) void get().ensureFull(id);
  },

  loadSamples: async () => {
    if (get().importing) return;
    try {
      const captions: Record<string, string> = {};
      const files: File[] = [];
      for (const sample of SAMPLE_ALBUM) {
        const response = await fetch(`/samples/${sample.file}`);
        if (!response.ok) throw new Error("Sample photographs are missing.");
        const blob = await response.blob();
        files.push(new File([blob], `${sample.name}.jpg`, { type: "image/jpeg", lastModified: 0 }));
        captions[sample.name] = sample.caption;
      }
      if (bookIsEmpty(get().pages)) {
        set({
          title: get().title === "Untitled book" ? "Studio sample" : get().title,
          density: 2,
          orientation: "landscape",
        });
      }
      await get().importFiles(files, captions);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not open the sample album.");
    }
  },

  addPage: () => {
    const page = makePage(defaultLayout(get().density));
    const pages = get().pages.slice();
    const index = pages.findIndex((item) => item.id === get().activePageId);
    pages.splice(index < 0 ? pages.length : index + 1, 0, page);
    set({ pages, activePageId: page.id, selectedSlot: null });
    persistLater();
  },
  duplicatePage: () => {
    const current = get().pages.find((page) => page.id === get().activePageId);
    if (!current) return;
    const copy: Page = {
      ...current,
      id: crypto.randomUUID(),
      slots: current.slots.map((slot) => ({ ...slot })),
    };
    const index = get().pages.findIndex((page) => page.id === current.id);
    const pages = get().pages.slice();
    pages.splice(index + 1, 0, copy);
    set({ pages, activePageId: copy.id });
    persistLater();
  },
  deletePage: () => {
    if (get().pages.length <= 1) {
      const page = makePage(defaultLayout(get().density));
      set({ pages: [page], activePageId: page.id, selectedSlot: null });
      persistLater();
      return;
    }
    const id = get().activePageId;
    const index = get().pages.findIndex((page) => page.id === id);
    const pages = get().pages.filter((page) => page.id !== id);
    const next = pages[Math.max(0, index - 1)] ?? pages[0];
    set({ pages, activePageId: next?.id ?? null, selectedSlot: null });
    persistLater();
  },
  movePage: (dir) => {
    const pages = get().pages.slice();
    const index = pages.findIndex((page) => page.id === get().activePageId);
    const target = index + dir;
    if (index < 0 || target < 0 || target >= pages.length) return;
    const [page] = pages.splice(index, 1);
    pages.splice(target, 0, page);
    set({ pages });
    persistLater();
  },
  stepPage: (dir) => {
    const pages = get().pages;
    const index = pages.findIndex((page) => page.id === get().activePageId);
    const next = pages[index + dir];
    if (!next) return;
    set({ activePageId: next.id, selectedSlot: 0 });
  },
  movePageTo: (fromId, toId) => {
    if (fromId === toId) return;
    const pages = get().pages.slice();
    const from = pages.findIndex((page) => page.id === fromId);
    const to = pages.findIndex((page) => page.id === toId);
    if (from < 0 || to < 0) return;
    const [page] = pages.splice(from, 1);
    pages.splice(to, 0, page);
    set({ pages, activePageId: fromId });
    persistLater();
  },
  placePageAt: (pageNumber) => {
    const pages = get().pages.slice();
    const from = pages.findIndex((page) => page.id === get().activePageId);
    if (from < 0 || !Number.isFinite(pageNumber)) return;
    const wanted = Math.min(pages.length - 1, Math.max(0, Math.round(pageNumber) - 1));
    if (wanted === from) return;
    const [page] = pages.splice(from, 1);
    pages.splice(wanted, 0, page);
    set({ pages, activePageId: page.id });
    persistLater();
  },
  setPageLayout: (layout) => {
    const id = get().activePageId;
    if (!id) return;
    const current = get().pages;
    const index = current.findIndex((page) => page.id === id);
    if (index < 0) return;
    const nextCount = LAYOUT_BY_ID[layout].slots;
    const prevCount = LAYOUT_BY_ID[current[index].layout]?.slots ?? current[index].slots.length;
    let pages: Page[];
    if (nextCount === prevCount) {
      pages = current.map((page) => (page.id === id ? withLayout(page, layout) : page));
    } else {
      const later: Slot[] = [];
      for (let cursor = index + 1; cursor < current.length; cursor += 1) {
        for (const slot of current[cursor].slots) {
          if (slot.photoId) later.push({ ...slot });
        }
      }
      let headSlots: Slot[];
      let rest: Slot[];
      if (nextCount === 1) {
        const here = current[index].slots;
        const picked = get().selectedSlot;
        const keepAt = here[picked ?? -1]?.photoId ? picked! : here.findIndex((slot) => slot.photoId);
        const kept = keepAt >= 0 ? { ...here[keepAt] } : null;
        const overflow = here.flatMap((slot, slotIndex) => (slot.photoId && slotIndex !== keepAt ? [{ ...slot }] : []));
        headSlots = [kept ?? emptySlot()];
        rest = [...overflow, ...later];
      } else {
        const carried = [
          ...current[index].slots.flatMap((slot) => (slot.photoId ? [{ ...slot }] : [])),
          ...later,
        ];
        headSlots = Array.from({ length: nextCount }, (_, slotIndex) => carried[slotIndex] ?? emptySlot());
        rest = carried.slice(nextCount);
      }
      const head: Page = { ...current[index], layout, slots: headSlots, split: null, splitL: null, splitR: null, splitW: null };
      const shape = new Map(get().photos.map((photo) => [photo.id, photo.w > photo.h]));
      const groups = packGroups(
        rest.flatMap((slot) => (slot.photoId ? [slot.photoId] : [])),
        (photoId) => shape.get(photoId) === true,
        get().orientation === "landscape",
      );
      const byPhoto = new Map(rest.map((slot) => [slot.photoId, slot]));
      const tail = groups.map((group) => {
        const page = makePage(group.layout);
        page.slots = page.slots.map((slot, slotIndex) => {
          const source = byPhoto.get(group.ids[slotIndex] ?? "");
          return source ? { ...source } : slot;
        });
        return page;
      });
      pages = [...current.slice(0, index), head, ...tail];
    }
    const page = pages.find((item) => item.id === id);
    const selected = get().selectedSlot;
    set({
      pages,
      selectedSlot: selected != null && page && selected < page.slots.length ? selected : 0,
    });
    persistLater();
  },
  setPageSplit: (split, part = "top") => {
    const id = get().activePageId;
    if (!id) return;
    const key = part === "left" ? "splitL" : part === "right" ? "splitR" : part === "width" ? "splitW" : "split";
    const band = key === "split" || key === "splitW";
    const next = split == null || !Number.isFinite(split) ? null : clamp(split, band ? 0.18 : 0.2, band ? 0.82 : 1);
    set({
      pages: get().pages.map((page) => (page.id === id ? { ...page, [key]: next } : page)),
    });
    persistLater();
  },
  assignPhoto: (pageId, index, photoId) => {
    const takenAt = get().photos.find((photo) => photo.id === photoId)?.takenAt ?? null;
    set({
      pages: patchSlot(get().pages, pageId, index, (slot) => ({
        ...slot,
        photoId,
        takenAt,
        caption: captionForDate(slot.caption, takenAt).slice(0, 140),
        zoom: 1,
        panX: 0,
        panY: 0,
      })),
      activePageId: pageId,
      selectedSlot: index,
    });
    persistLater();
    void get().ensureFull(photoId);
  },
  clearSlot: (pageId, index) => {
    set({ pages: patchSlot(get().pages, pageId, index, () => emptySlot()) });
    persistLater();
  },
  copySlot: () => {
    const slot = selectedFrame(get());
    if (!slot?.photoId) return;
    set({ clipboard: { ...slot } });
  },
  cutSlot: () => {
    const pageId = get().activePageId;
    const index = get().selectedSlot;
    const slot = selectedFrame(get());
    if (!pageId || index == null || !slot?.photoId) return;
    set({
      clipboard: { ...slot },
      pages: patchSlot(get().pages, pageId, index, () => emptySlot()),
    });
    persistLater();
  },
  pasteSlot: () => {
    const clip = get().clipboard;
    const pageId = get().activePageId;
    const index = get().selectedSlot;
    if (!clip?.photoId || !pageId || index == null) return;
    if (!get().photos.some((photo) => photo.id === clip.photoId)) return;
    set({ pages: patchSlot(get().pages, pageId, index, () => ({ ...clip })) });
    persistLater();
    void get().ensureFull(clip.photoId);
  },
  undo: () => {
    const previous = past.pop();
    if (!previous) return;
    future.push(snapshot(get()));
    restoreBook(previous);
  },
  redo: () => {
    const next = future.pop();
    if (!next) return;
    past.push(snapshot(get()));
    restoreBook(next);
  },
  swapSlots: (fromPageId, fromIndex, toPageId, toIndex) => {
    const pages = get().pages.map((page) => ({ ...page, slots: page.slots.map((slot) => ({ ...slot })) }));
    const from = pages.find((page) => page.id === fromPageId);
    const to = pages.find((page) => page.id === toPageId);
    if (!from?.slots[fromIndex] || !to?.slots[toIndex]) return;
    const temp = from.slots[fromIndex];
    from.slots[fromIndex] = to.slots[toIndex];
    to.slots[toIndex] = temp;
    set({ pages, activePageId: toPageId, selectedSlot: toIndex });
    persistLater();
  },
  reorderPhotos: (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const pages = get().pages.map((page) => ({ ...page, slots: page.slots.map((slot) => ({ ...slot })) }));
    const placed: Slot[] = [];
    const homes: { page: number; index: number }[] = [];
    pages.forEach((page, pageIndex) => {
      page.slots.forEach((slot, index) => {
        if (!slot.photoId) return;
        placed.push(slot);
        homes.push({ page: pageIndex, index });
      });
    });
    const from = placed.findIndex((slot) => slot.photoId === fromId);
    const to = placed.findIndex((slot) => slot.photoId === toId);
    if (from >= 0 && to >= 0) {
      const [moving] = placed.splice(from, 1);
      placed.splice(to, 0, moving);
      homes.forEach((home, index) => {
        pages[home.page].slots[home.index] = placed[index];
      });
      set({ pages });
      persistLater();
      return;
    }
    const list = get().photos.slice().sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
    const fromIndex = list.findIndex((photo) => photo.id === fromId);
    const toIndex = list.findIndex((photo) => photo.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    const photos = list.map((photo, index) => ({ ...photo, seq: index + 1 }));
    set({ photos });
    for (const photo of photos) void updateThumbMeta(photo.id, { seq: photo.seq });
  },
  setSlotCaption: (pageId, index, caption) => {
    set({
      pages: patchSlot(get().pages, pageId, index, (slot) => ({ ...slot, caption: caption.slice(0, 140) })),
    });
    persistLater();
  },
  clearPageCaptions: () => {
    const id = get().activePageId;
    if (!id) return;
    set({
      pages: get().pages.map((page) =>
        page.id === id ? { ...page, slots: page.slots.map((slot) => ({ ...slot, caption: "" })) } : page,
      ),
    });
    persistLater();
  },
  clearCaptionsOnPages: (ids) => {
    const wanted = new Set(ids);
    if (wanted.size === 0) return;
    set({
      pages: get().pages.map((page) =>
        wanted.has(page.id) ? { ...page, slots: page.slots.map((slot) => ({ ...slot, caption: "", yearOnly: false })) } : page,
      ),
    });
    persistLater();
  },
  setYearOnly: (pageId, index, yearOnly) => {
    set({
      pages: patchSlot(get().pages, pageId, index, (slot) => ({ ...slot, yearOnly })),
    });
    persistLater();
  },
  captionPhotos: (ids, caption) => {
    const wanted = new Set(ids);
    if (wanted.size === 0) return;
    const text = caption.slice(0, 140);
    set({
      pages: get().pages.map((page) => ({
        ...page,
        slots: page.slots.map((slot) => (slot.photoId && wanted.has(slot.photoId) ? { ...slot, caption: text } : slot)),
      })),
    });
    persistLater();
  },
  datePhotos: (ids, takenAt) => {
    const wanted = new Set(ids);
    if (wanted.size === 0) return;
    const label = takenAt != null ? formatHindiDate(takenAt) : "";
    const photos = get().photos.map((photo) => (wanted.has(photo.id) ? { ...photo, takenAt } : photo));
    const updated = get().pages.map((page) => ({
      ...page,
      slots: page.slots.map((slot) => {
        if (!slot.photoId || !wanted.has(slot.photoId)) return slot;
        const previous = slot.takenAt != null ? formatHindiDate(slot.takenAt) : "";
        const caption =
          previous && slot.caption.includes(previous)
            ? slot.caption.replaceAll(previous, label).replace(/\s+/g, " ").trim()
            : captionForDate(slot.caption, takenAt);
        return { ...slot, takenAt, caption: caption.slice(0, 140) };
      }),
    }));
    const placed: string[] = [];
    for (const page of updated) {
      for (const slot of page.slots) {
        if (slot.photoId && !placed.includes(slot.photoId)) placed.push(slot.photoId);
      }
    }
    const takenOf = new Map(photos.map((photo) => [photo.id, photo.takenAt]));
    const ordered = sortIdsByDate(placed, takenOf);
    const shape = new Map(photos.map((photo) => [photo.id, photo.w > photo.h]));
    const pages =
      ordered.length > 0
        ? pagesInDateOrder(updated, ordered, get().orientation === "landscape", (id) => shape.get(id) === true)
        : updated;
    const active = pages.find((page) => page.slots.some((slot) => slot.photoId && wanted.has(slot.photoId)));
    set({
      photos,
      pages,
      activePageId: active?.id ?? get().activePageId,
      selectedSlot: active ? 0 : get().selectedSlot,
    });
    persistLater();
    for (const id of ids) void updateThumbMeta(id, { takenAt });
  },
  setSlotDate: (pageId, index, takenAt) => {
    const page = get().pages.find((item) => item.id === pageId);
    const photoId = page?.slots[index]?.photoId ?? null;
    if (photoId) {
      get().datePhotos([photoId], takenAt);
      return;
    }
    set({
      pages: patchSlot(get().pages, pageId, index, (slot) => ({
        ...slot,
        takenAt,
        caption: captionForDate(slot.caption, takenAt).slice(0, 140),
      })),
    });
    persistLater();
  },
  setSlotCrop: (pageId, index, crop) => {
    set({
      pages: patchSlot(get().pages, pageId, index, (slot) => ({
        ...slot,
        zoom: crop.zoom == null ? slot.zoom : clamp(crop.zoom, LIMITS.zoom.min, LIMITS.zoom.max),
        panX: crop.panX == null ? slot.panX : clamp(crop.panX, -1, 1),
        panY: crop.panY == null ? slot.panY : clamp(crop.panY, -1, 1),
      })),
    });
    persistLater();
  },
  setSlotAdjust: (pageId, index, patch) => {
    set({
      pages: patchSlot(get().pages, pageId, index, (slot) => ({ ...slot, adjust: mergeAdjust(slot.adjust, patch) })),
    });
    persistLater();
  },
  applyAdjustToPhotos: (ids, adjust) => {
    const wanted = new Set(ids);
    if (wanted.size === 0) return;
    const next = readAdjust(adjust);
    set({
      pages: get().pages.map((page) => ({
        ...page,
        slots: page.slots.map((slot) => (slot.photoId && wanted.has(slot.photoId) ? { ...slot, adjust: next } : slot)),
      })),
    });
    persistLater();
  },
  rotateSlot: (pageId, index) => {
    set({
      pages: patchSlot(get().pages, pageId, index, (slot) => ({
        ...slot,
        turn: (((slot.turn ?? 0) + 1) % 4) as 0 | 1 | 2 | 3,
        panX: 0,
        panY: 0,
      })),
    });
    persistLater();
  },
  deletePhoto: async (id) => {
    const photo = get().photos.find((item) => item.id === id);
    if (photo) URL.revokeObjectURL(photo.thumbUrl);
    const full = get().fullUrls[id];
    if (full) URL.revokeObjectURL(full);
    const { [id]: _removed, ...fullUrls } = get().fullUrls;
    set({
      photos: get().photos.filter((item) => item.id !== id),
      fullUrls,
      placingId: get().placingId === id ? null : get().placingId,
      pages: get().pages.map((page) => ({
        ...page,
        slots: page.slots.map((slot) => (slot.photoId === id ? emptySlot() : slot)),
      })),
    });
    persistLater();
    await deletePhotoRecord(id);
  },
  clearPages: () => {
    const page = makePage(defaultLayout(get().density));
    set({ pages: [page], activePageId: page.id, selectedSlot: null });
    persistLater();
    flash("Pages cleared. Photos are still in the library.");
  },
  deleteAllPhotos: async () => {
    for (const photo of get().photos) URL.revokeObjectURL(photo.thumbUrl);
    for (const url of Object.values(get().fullUrls)) URL.revokeObjectURL(url);
    const page = makePage(defaultLayout(get().density));
    set({
      photos: [],
      fullUrls: {},
      placingId: null,
      pages: [page],
      activePageId: page.id,
      selectedSlot: null,
    });
    persistLater();
    await deleteAllPhotoRecords();
    flash("All photos removed.");
  },
  loadProject: async (book, incoming) => {
    set({ importing: incoming.length ? { done: 0, total: incoming.length } : null, notice: null });
    try {
      const nextPhotos: Photo[] = [];
      for (let index = 0; index < incoming.length; index += 1) {
        const item = incoming[index];
        const decoded = await decodeImage(item.blob);
        const takenAt = typeof item.takenAt === "number" ? item.takenAt : null;
        const seq = typeof item.seq === "number" ? item.seq : index + 1;
        await putPhoto(
          { id: item.id, name: item.name, w: decoded.w, h: decoded.h, thumb: decoded.thumb, takenAt, seq },
          decoded.blob,
        );
        nextPhotos.push({
          id: item.id,
          name: item.name,
          w: decoded.w,
          h: decoded.h,
          thumbUrl: URL.createObjectURL(decoded.thumb),
          takenAt,
          seq,
        });
        set({ importing: { done: index + 1, total: incoming.length } });
      }
      const kept = new Set(nextPhotos.map((photo) => photo.id));
      for (const photo of get().photos) {
        URL.revokeObjectURL(photo.thumbUrl);
        if (!kept.has(photo.id)) await deletePhotoRecord(photo.id);
      }
      for (const url of Object.values(get().fullUrls)) URL.revokeObjectURL(url);
      const clean = sanitizeBook(book);
      nextSeq = nextPhotos.reduce((max, photo) => Math.max(max, photo.seq), 0) + 1;
      set({
        ...clean,
        photos: nextPhotos,
        fullUrls: {},
        placingId: null,
        activePageId: clean.pages[0]?.id ?? null,
        selectedSlot: 0,
        importing: null,
        libraryQuery: "",
        libraryFilter: "all",
      });
      dirty = true;
      await saveBook(clean);
      flash(`Opened “${clean.title}”.`);
    } catch (error) {
      set({ importing: null });
      flash(error instanceof Error ? error.message : "Could not open that project.");
    }
  },
  ensureFull: async (id) => {
    if (get().fullUrls[id]) return;
    const pending = fullLoads.get(id);
    if (pending) return pending;
    const job = (async () => {
      const blob = await getBlob(id);
      if (!blob) return;
      if (get().fullUrls[id]) return;
      const url = URL.createObjectURL(blob);
      set((state) => ({ fullUrls: { ...state.fullUrls, [id]: url } }));
    })().finally(() => {
      fullLoads.delete(id);
    });
    fullLoads.set(id, job);
    return job;
  },
  ensureAllFull: async () => {
    const ids = new Set<string>();
    for (const page of get().pages) {
      for (const slot of page.slots) if (slot.photoId) ids.add(slot.photoId);
    }
    const missing = [...ids].filter((id) => !get().fullUrls[id]);
    for (let i = 0; i < missing.length; i += 6) {
      await Promise.all(missing.slice(i, i + 6).map((id) => get().ensureFull(id)));
    }
  },
  setPreparingPrint: (preparingPrint) => set({ preparingPrint }),
  };
});
