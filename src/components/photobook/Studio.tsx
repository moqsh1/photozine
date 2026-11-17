import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, FolderOpen, Images, Plus, Printer, Save, Undo2 } from "lucide-react";
import { Inspector } from "@/components/photobook/Inspector";
import { Library } from "@/components/photobook/Library";
import { MenuBar } from "@/components/photobook/MenuBar";
import { PageSheet } from "@/components/photobook/PageSheet";
import { PageStrip } from "@/components/photobook/PageStrip";
import { emptyAdjust } from "@/lib/photobook/adjust";
import { isoToStamp, stampToIso } from "@/lib/photobook/date";
import { getBlob, listBlobIds, listThumbIds, newBookHref } from "@/lib/photobook/db";
import { ensureDriveOriginals, connectDrive, loadBookFromDrive, saveBookToDrive } from "@/lib/photobook/drive-client";
import { deliverFile } from "@/lib/photobook/download";
import { renderBookPdf } from "@/lib/photobook/pdf";
import { buildProjectFile, pdfFilename, projectFilename, readProjectFile } from "@/lib/photobook/project";
import { linkSyncFolder, reloadSyncFolder, syncFolderName, syncSupported } from "@/lib/photobook/sync";
import { onBookCloud, useBook } from "@/lib/photobook/store";
import { MAX_PHOTOS, PAGE_INCHES, type Book, type Page } from "@/lib/photobook/types";
import { cn } from "@/lib/cn";

type ConfirmKind = "pages" | "photos" | "load" | null;
type ExportMode = "current" | "selected" | "all";

export function Studio() {
  const book = useBook();
  const fileRef = useRef<HTMLInputElement>(null);
  const importTarget = useRef<{ pageId: string; index: number } | null>(null);
  const projectRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [pendingProject, setPendingProject] = useState<File | null>(null);
  const [printPages, setPrintPages] = useState<Page[] | null>(null);
  const [driveSavedAt, setDriveSavedAt] = useState<number | null>(null);
  const [driveLoadedAt, setDriveLoadedAt] = useState<number | null>(null);
  useEffect(() => {
    const saved = Number(localStorage.getItem("pz-drive-saved"));
    const loaded = Number(localStorage.getItem("pz-drive-loaded"));
    if (Number.isFinite(saved) && saved > 0) setDriveSavedAt(saved);
    if (Number.isFinite(loaded) && loaded > 0) setDriveLoadedAt(loaded);
  }, []);
  function markDrive(kind: "saved" | "loaded") {
    const now = Date.now();
    localStorage.setItem(kind === "saved" ? "pz-drive-saved" : "pz-drive-loaded", String(now));
    if (kind === "saved") setDriveSavedAt(now);
    else setDriveLoadedAt(now);
  }
  function driveClock(label: string, stamp: number | null) {
    if (!stamp) return `${label} —`;
    const time = new Date(stamp).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
    return `${label} ${time}`;
  }
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<ExportMode>("current");
  const [picked, setPicked] = useState<string[]>([]);
  const [exportNote, setExportNote] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<{ url: string; name: string } | null>(null);
  const [syncName, setSyncName] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pickedPhotos, setPickedPhotos] = useState<string[]>([]);
  const [pagePicking, setPagePicking] = useState(false);
  const [pickedPages, setPickedPages] = useState<string[]>([]);
  const onPhotoSelection = useCallback((ids: string[]) => setPickedPhotos(ids), []);
  const pdfBlob = useRef<Blob | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [paneW, setPaneW] = useState<[number, number, number]>(readPaneWidths);
  const paneWRef = useRef(paneW);
  paneWRef.current = paneW;
  useEffect(() => {
    localStorage.setItem("pz-panes", JSON.stringify(paneW));
  }, [paneW]);
  const openFiles = useCallback(() => {
    importTarget.current = null;
    fileRef.current?.click();
  }, []);

  useEffect(() => {
    void book.hydrate();
  }, [book.hydrate]);

  useEffect(() => {
    document.title = `${book.title || "Untitled book"} · photozine`;
  }, [book.title]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [book.ready]);

  const pagePhotoKey = book.pages
    .map((page) => `${page.id}:${page.slots.map((slot) => slot.photoId ?? "").join(",")}`)
    .join("|");

  useEffect(() => {
    const current = book.pages.find((item) => item.id === book.activePageId);
    if (!current) return;
    for (const slot of current.slots) {
      if (slot.photoId) void book.ensureFull(slot.photoId);
    }
  }, [book.activePageId, book.ensureFull, pagePhotoKey]);

  useEffect(() => {
    const over = (event: DragEvent) => {
      if ([...(event.dataTransfer?.types ?? [])].includes("Files")) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      event.preventDefault();
      void book.importFiles(files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [book.importFiles]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowRight") book.stepPage(1);
      if (event.key === "ArrowLeft") book.stepPage(-1);
      const key = event.key.toLowerCase();
      const command = event.metaKey || event.ctrlKey;
      if (command && key === "z") {
        event.preventDefault();
        if (event.shiftKey) book.redo();
        else book.undo();
        return;
      }
      if (command && key === "c") {
        event.preventDefault();
        book.copySlot();
      }
      if (command && key === "x") {
        event.preventDefault();
        book.cutSlot();
      }
      if (command && key === "v") {
        event.preventDefault();
        book.pasteSlot();
      }
      if (!command && (event.key === "Delete" || event.key === "Backspace")) {
        const pageId = book.activePageId;
        const index = book.selectedSlot;
        if (pageId && index != null) {
          event.preventDefault();
          book.clearSlot(pageId, index);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [book.stepPage, book.copySlot, book.cutSlot, book.pasteSlot, book.clearSlot, book.activePageId, book.selectedSlot, book.undo, book.redo]);

  useEffect(() => {
    const done = () => setPrintPages(null);
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, []);

  const photoById = useMemo(() => new Map(book.photos.map((photo) => [photo.id, photo])), [book.photos]);
  const placedSignature = book.pages
    .flatMap((page) => page.slots.map((slot) => slot.photoId ?? ""))
    .filter(Boolean)
    .join("|");
  const looseCount = book.photos.filter((photo) => !placedSignature.split("|").includes(photo.id)).length;
  const page = book.pages.find((item) => item.id === book.activePageId) ?? book.pages[0] ?? null;
  const pageIndex = page ? Math.max(0, book.pages.findIndex((item) => item.id === page.id)) : 0;
  const inches = PAGE_INCHES[book.orientation];
  const fitted = fitSheet(stage.w, stage.h, inches.w / inches.h);
  const slotIndex = book.selectedSlot;
  const slot = page && slotIndex != null ? page.slots[slotIndex] : null;
  const slotPhoto = slot?.photoId ? photoById.get(slot.photoId) : undefined;
  const progress = book.importing ? Math.round((book.importing.done / Math.max(1, book.importing.total)) * 100) : 0;

  function snapshot(): Book {
    return {
      title: book.title,
      orientation: book.orientation,
      marginIn: book.marginIn,
      gapIn: book.gapIn,
      captionIn: book.captionIn,
      density: book.density,
      pages: book.pages,
    };
  }

  function pagesForExport() {
    if (exportMode === "all") return book.pages;
    if (exportMode === "current") return page ? [page] : [];
    const chosen = new Set(picked);
    return book.pages.filter((item) => chosen.has(item.id));
  }

  function complain(message: string) {
    setProblem(message);
    window.setTimeout(() => {
      setProblem((current) => (current === message ? null : current));
    }, 5000);
  }

  function openExport() {
    setExportMode("current");
    setPicked(page ? [page.id] : []);
    setExportNote("");
    setExportOpen(true);
  }

  function closeExport() {
    setExportOpen(false);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null);
    pdfBlob.current = null;
    setExportNote("");
  }

  async function openProject(file: File) {
    try {
      const project = await readProjectFile(file);
      await book.loadProject(project.book, project.photos);
    } catch (error) {
      complain(error instanceof Error ? error.message : "Could not open that project.");
    }
  }

  useEffect(() => {
    void syncFolderName().then(setSyncName);
  }, []);

  async function onSaveProject() {
    book.setPreparingPrint(true);
    try {
      await ensureDriveOriginals(
        book.photos.map((photo) => photo.id),
        drivePercent("Full photos"),
      );
      const blob = await buildProjectFile(snapshot(), book.photos);
      const name = projectFilename(book.title);
      const url = URL.createObjectURL(blob);
      setHandoff((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return { url, name };
      });
      const how = await deliverFile(blob, name);
      if (how === "cancelled") setProblem(null);
    } catch (error) {
      complain(error instanceof Error ? error.message : "Could not save the project.");
    } finally {
      book.setPreparingPrint(false);
    }
  }

  function drivePercent(label: string) {
    return (done: number, total: number) => {
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      setProblem(`${label} ${pct}%`);
    };
  }

  const driveOn = useRef(false);
  const driveBusy = useRef(false);
  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get("drive");
    if (flag === "connected") {
      driveOn.current = true;
      setProblem("Google Drive connected");
      const url = new URL(window.location.href);
      url.searchParams.delete("drive");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    } else if (flag === "denied") {
      setProblem("Google Drive was not connected.");
    }
    onBookCloud((saved, photos) => {
      if (!driveOn.current || driveBusy.current) return;
      driveBusy.current = true;
      void saveBookToDrive(saved, photos, getBlob, drivePercent("Saving to Drive"))
        .then(() => {
          markDrive("saved");
          setProblem("Saved to Drive");
        })
        .catch((error) => setProblem(error instanceof Error ? error.message : "Could not save to Drive."))
        .finally(() => {
          driveBusy.current = false;
        });
    });
  }, []);

  async function onLinkSync() {
    try {
      const linked = await linkSyncFolder({ book: snapshot(), photos: book.photos });
      setSyncName(linked.name);
      if (linked.remote) await book.loadProject(linked.remote.book, linked.remote.photos);
      else setProblem(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      complain(error instanceof Error ? error.message : "Could not link that folder.");
    }
  }

  async function onDriveSave() {
    if (driveBusy.current) return;
    driveBusy.current = true;
    try {
      await saveBookToDrive(snapshot(), book.photos, getBlob, drivePercent("Saving to Drive"));
      driveOn.current = true;
      markDrive("saved");
      setProblem("Saved to Drive");
    } catch (error) {
      complain(error instanceof Error ? error.message : "Could not save to Drive.");
    } finally {
      driveBusy.current = false;
    }
  }

  async function onDriveLoad() {
    if (driveBusy.current) return;
    driveBusy.current = true;
    try {
      const present = new Set([...(await listThumbIds()), ...(await listBlobIds())]);
      const remote = await loadBookFromDrive(drivePercent("Loading previews"), present);
      driveOn.current = true;
      await book.mergeDriveBook(remote.book, remote.photos, remote.catalog);
      markDrive("loaded");
      setProblem(remote.photos.length === 0 ? "Loaded the book" : `Loaded ${remote.photos.length} new photos`);
    } catch (error) {
      complain(error instanceof Error ? error.message : "Could not load from Drive.");
    } finally {
      driveBusy.current = false;
    }
  }

  async function onLoadSync() {
    try {
      const remote = await reloadSyncFolder();
      if (remote) await book.loadProject(remote.book, remote.photos);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      complain(error instanceof Error ? error.message : "Could not load the synced book.");
    }
  }

  async function onMakePdf() {
    const pages = pagesForExport();
    if (pages.length === 0) {
      setExportNote("Choose at least one page.");
      return;
    }
    book.setPreparingPrint(true);
    const ids: string[] = [];
    for (const page of pages) {
      for (const slot of page.slots) {
        if (slot.photoId && !ids.includes(slot.photoId)) ids.push(slot.photoId);
      }
    }
    setExportNote(ids.length ? `Full photos 0 of ${ids.length}` : `Drawing page 1 of ${pages.length}`);
    try {
      await ensureDriveOriginals(ids, (done, total) => {
        setExportNote(done >= total ? `Drawing page 1 of ${pages.length}` : `Full photos ${done} of ${total}`);
      });
      const blob = await renderBookPdf(snapshot(), pages, book.photos, (done, total) => {
        setExportNote(done >= total ? "PDF ready." : `Drawing page ${done + 1} of ${total}`);
      });
      pdfBlob.current = blob;
      const url = URL.createObjectURL(blob);
      setPdfUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return url;
      });
      setExportNote("PDF ready. Tap Save PDF. On Android, tap Share and send it to Files or Drive.");
    } catch (error) {
      setExportNote(error instanceof Error ? error.message : "Could not make the PDF.");
    } finally {
      book.setPreparingPrint(false);
    }
  }

  async function onSharePdf() {
    const blob = pdfBlob.current;
    if (!blob) return;
    try {
      const how = await deliverFile(blob, pdfFilename(book.title));
      if (how === "cancelled") return;
      setExportNote(how === "shared" ? "Share sheet opened." : "PDF download started.");
    } catch (error) {
      setExportNote(error instanceof Error ? error.message : "Could not share the PDF.");
    }
  }

  async function onSystemPrint() {
    const pages = pagesForExport();
    if (pages.length === 0) {
      setExportNote("Choose at least one page.");
      return;
    }
    book.setPreparingPrint(true);
    try {
      await book.ensureAllFull();
      setPrintPages(pages);
      await new Promise((resolve) => window.setTimeout(resolve, 60));
      const images = [...document.querySelectorAll<HTMLImageElement>(".print-root img")];
      await Promise.all(
        images.map(
          (img) =>
            img.complete && img.naturalWidth > 0
              ? Promise.resolve()
              : new Promise((resolve) => {
                  img.onload = () => resolve(null);
                  img.onerror = () => resolve(null);
                }),
        ),
      );
      await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve(null))));
      const style = document.createElement("style");
      style.setAttribute("data-folio-page", "1");
      style.textContent = `@page { size: ${inches.w}in ${inches.h}in; margin: 0; }`;
      document.head.appendChild(style);
      window.print();
      style.remove();
    } finally {
      book.setPreparingPrint(false);
    }
  }

  const library = (
    <Library
      photos={book.photos}
      pages={book.pages}
      placedSignature={placedSignature}
      placingId={book.placingId}
      selectedId={slot?.photoId ?? null}
      query={book.libraryQuery}
      filter={book.libraryFilter}
      busy={book.importing != null}
      onQuery={book.setQuery}
      onFilter={book.setFilter}
      onFocus={book.showPhoto}
      onDelete={(id) => {
        void book.deletePhoto(id);
      }}
      onDeleteMany={(ids) => {
        void book.deletePhotos(ids);
      }}
      onArrangeByDate={book.arrangeByDate}
      onReorder={book.reorderPhotos}
      onCaption={book.captionPhotos}
      onDate={book.datePhotos}
      onSelection={onPhotoSelection}
    />
  );

  const inspector = (
    <Inspector
      page={page}
      pageCount={Math.max(1, book.pages.length)}
      pageIndex={pageIndex}
      orientation={book.orientation}
      marginIn={book.marginIn}
      gapIn={book.gapIn}
      captionIn={book.captionIn}
      density={book.density}
      photo={slotPhoto}
      caption={slot?.caption ?? ""}
      dateIso={slot?.takenAt != null ? stampToIso(slot.takenAt) : ""}
      zoom={slot?.zoom ?? 1}
      adjust={slot?.adjust ?? emptyAdjust()}
      selectedCount={pickedPhotos.length}
      hasPhoto={Boolean(slot?.photoId)}
      onLayout={book.setPageLayout}
      onSplit={book.setPageSplit}
      onCaption={(value) => page && slotIndex != null && book.setSlotCaption(page.id, slotIndex, value)}
      onDate={(iso) => page && slotIndex != null && book.setSlotDate(page.id, slotIndex, iso ? isoToStamp(iso) : null)}
      onZoom={(zoom) => page && slotIndex != null && book.setSlotCrop(page.id, slotIndex, { zoom })}
      onAdjust={(patch) => page && slotIndex != null && book.setSlotAdjust(page.id, slotIndex, patch)}
      onApplyAdjust={() => page && slot && book.applyAdjustToPhotos(pickedPhotos, slot.adjust)}
      onResetAdjust={() => page && slotIndex != null && book.setSlotAdjust(page.id, slotIndex, emptyAdjust())}
      onResetCrop={() =>
        page && slotIndex != null && book.setSlotCrop(page.id, slotIndex, { zoom: 1, panX: 0, panY: 0 })
      }
      onCenter={() => page && slotIndex != null && book.setSlotCrop(page.id, slotIndex, { panX: 0, panY: 0 })}
      onRotate={() => page && slotIndex != null && book.rotateSlot(page.id, slotIndex)}
      onClearSlot={() => page && slotIndex != null && book.clearSlot(page.id, slotIndex)}
      canPaste={Boolean(book.clipboard?.photoId)}
      onCut={book.cutSlot}
      onCopy={book.copySlot}
      onPaste={book.pasteSlot}
      onMargin={book.setMargin}
      onGap={book.setGap}
      onCaptionSize={book.setCaptionSize}
      onOrientation={book.setOrientation}
      onDensity={book.setDensity}
      onAddPage={book.addPage}
      onDuplicate={book.duplicatePage}
      onDeletePage={book.deletePage}
      onSelectPage={book.clearSlotSelection}
      pageSelected={book.selectedSlot == null}
      onClearPageCaptions={book.clearPageCaptions}
      onClearCaption={() => {
        if (!page || slotIndex == null) return;
        book.setSlotCaption(page.id, slotIndex, "");
        book.setYearOnly(page.id, slotIndex, false);
      }}
      yearOnly={Boolean(slot?.yearOnly)}
      onYearOnly={(yearOnly) => page && slotIndex != null && book.setYearOnly(page.id, slotIndex, yearOnly)}
      onMove={book.stepPage}
      onPlaceAt={book.placePageAt}
      onClearPages={() => setConfirm("pages")}
      onDeletePhotos={() => setConfirm("photos")}
    />
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-ink">
      <header className="no-print flex items-center gap-3 border-b border-line bg-surface px-3 py-2 sm:px-4">
        <div className="flex flex-col leading-none">
          <div className="flex items-center gap-2">
            <img src="/icon-192.png" alt="" className="size-9 rounded-lg" />
            <p className="font-serif text-xl tracking-tight">photozine</p>
          </div>
          <p className="mt-1 text-[11px] text-muted tabular-nums">
            {book.photos.length} / {MAX_PHOTOS} photos · {Math.max(0, looseCount)} loose
          </p>
        </div>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Book title</span>
          <input
            className="w-full min-w-0 bg-transparent font-serif text-lg text-ink outline-none"
            value={book.title}
            maxLength={80}
            aria-label="Book title"
            onChange={(event) => book.setTitle(event.target.value)}
          />
        </label>
        <div className="flex flex-col items-center leading-none">
          <button type="button" className="btn btn-quiet px-3" onClick={() => void onDriveLoad()} aria-label="Load from Google Drive">
            Load Drive
          </button>
          <span className="mt-0.5 text-[10px] text-muted">{driveClock("Last loaded", driveLoadedAt)}</span>
        </div>
        <div className="flex flex-col items-center leading-none">
          <button type="button" className="btn btn-quiet px-3" onClick={() => void onDriveSave()} aria-label="Save to Google Drive">
            Save Drive
          </button>
          <span className="mt-0.5 text-[10px] text-muted">{driveClock("Last saved", driveSavedAt)}</span>
        </div>
        <button type="button" className="btn btn-quiet px-3" onClick={book.undo} disabled={!book.canUndo} aria-label="Undo">
          <Undo2 className="size-4" aria-hidden="true" />
          Undo
        </button>
        <button
          type="button"
          className="btn btn-quiet px-3"
          onClick={() => {
            const opened = window.open(newBookHref(), "_blank");
            if (!opened) setProblem("The new book was blocked. Allow pop-ups, then tap New again.");
          }}
          aria-label="New photobook in a new tab"
        >
          <Plus className="size-4" aria-hidden="true" />
          New
        </button>
        <button type="button" className="btn btn-quiet px-3" onClick={openFiles} disabled={book.importing != null} aria-label="Add photos">
          <span className="hidden sm:inline">Add photos</span>
          <Images className="size-4 sm:hidden" aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-quiet px-3" onClick={() => void onSaveProject()} disabled={book.preparingPrint || !book.ready} aria-label="Save project">
          <Save className="size-4" aria-hidden="true" />
          <span className="hidden md:inline">Save</span>
        </button>
        <button type="button" className="btn btn-quiet px-3" onClick={() => projectRef.current?.click()} disabled={book.importing != null} aria-label="Open project">
          <FolderOpen className="size-4" aria-hidden="true" />
          <span className="hidden md:inline">Open</span>
        </button>
        <button type="button" className="btn btn-primary px-3" onClick={openExport} disabled={book.preparingPrint || !book.ready} aria-label="Export PDF">
          <Printer className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">PDF</span>
        </button>
      </header>
      <MenuBar
        onNew={() => {
          const opened = window.open(newBookHref(), "_blank");
          if (!opened) setProblem("The new book was blocked. Allow pop-ups, then tap New again.");
        }}
        onOpen={() => projectRef.current?.click()}
        onSave={() => void onSaveProject()}
        onExport={openExport}
        onSync={() => void onLinkSync()}
        onLoadSync={() => void onLoadSync()}
        onDriveConnect={() => void connectDrive()}
        onSamples={() => {
          void book.loadSamples();
        }}
        onAddPhotos={openFiles}
        syncName={syncName}
        canSync={syncSupported()}
        status={
          book.importing ? (
            <>
              Adding {book.importing.done} of {book.importing.total} · {progress}%
              <button type="button" className="ml-2 underline" onClick={book.cancelImport}>
                Stop
              </button>
            </>
          ) : (
            <>
              {problem || book.notice}
              {handoff && (
                <a className="ml-2 font-medium text-accent underline" href={handoff.url} download={handoff.name}>
                  Project file ready
                </a>
              )}
            </>
          )
        }
        onAddPage={book.addPage}
        onDuplicate={book.duplicatePage}
        onDeletePage={book.deletePage}
        onPrev={() => book.stepPage(-1)}
        onNext={() => book.stepPage(1)}
        onLayout={book.setPageLayout}
        layout={page?.layout ?? null}
        hasPhoto={Boolean(slot?.photoId)}
        canPaste={Boolean(book.clipboard?.photoId)}
        onRotate={() => page && slotIndex != null && book.rotateSlot(page.id, slotIndex)}
        onCenter={() => page && slotIndex != null && book.setSlotCrop(page.id, slotIndex, { panX: 0, panY: 0 })}
        onResetCrop={() => page && slotIndex != null && book.setSlotCrop(page.id, slotIndex, { zoom: 1, panX: 0, panY: 0 })}
        onCut={book.cutSlot}
        onCopy={book.copySlot}
        onPaste={book.pasteSlot}
        onClearSlot={() => page && slotIndex != null && book.clearSlot(page.id, slotIndex)}
        orientation={book.orientation}
        onOrientation={book.setOrientation}
        density={book.density}
        onDensity={book.setDensity}
        busy={book.preparingPrint || !book.ready || book.importing != null}
      />

      {book.placingId && (
        <div className="no-print flex items-center justify-between gap-3 border-b border-line bg-ink px-4 py-2 text-sm text-page">
          <p>Tap a frame to place this photo.</p>
          <button type="button" className="min-h-11 px-2" onClick={book.cancelPlacing}>
            Cancel
          </button>
        </div>
      )}

      {!book.ready ? (
        <main className="grid flex-1 place-items-center px-6 text-center">
          <p className="font-serif text-2xl">Opening your book…</p>
        </main>
      ) : (
        <div className="no-print flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <aside className="flex h-full min-w-0 shrink-0 flex-col overflow-hidden bg-surface" style={{ width: paneW[0] }}>
            {library}
          </aside>
          <PaneHandle
            label="Resize library"
            min={180}
            max={840}
            get={() => paneWRef.current[0]}
            set={(width) => setPaneW((current) => [width, current[1], current[2]])}
          />
          <aside className="flex h-full shrink-0 flex-col bg-surface" style={{ width: paneW[1] }}>
            <PageStrip
              pages={book.pages}
              activePageId={page?.id ?? null}
              orientation={book.orientation}
              photoById={photoById}
              onSelect={book.selectPage}
              onReorder={book.movePageTo}
              onAddPhoto={book.addPhotoToPage}
              onToggleLock={book.togglePageLock}
              onReorderPhotos={book.reorderPhotos}
              picking={pagePicking}
              pickedIds={pickedPages}
              onTogglePick={(id) => setPickedPages((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))}
              onPickMode={(on) => {
                setPagePicking(on);
                if (!on) setPickedPages([]);
              }}
              onClearPicked={() => {
                book.clearCaptionsOnPages(pickedPages);
                setPickedPages([]);
                setPagePicking(false);
              }}
            />
          </aside>
          <PaneHandle
            label="Resize pages"
            min={220}
            max={720}
            get={() => paneWRef.current[1]}
            set={(width) => setPaneW((current) => [current[0], width, current[2]])}
          />
          <section className="relative flex h-full min-w-48 flex-1 flex-col">
            <div
              ref={stageRef}
              className="relative min-h-0 flex-1"
              onClick={(event) => {
                if (event.target === event.currentTarget) book.clearSlotSelection();
              }}
            >
              {page && fitted.w > 0 && (
                <div
                  className="sheet-shadow absolute top-1/2 left-1/2 bg-page"
                  style={{ width: fitted.w, height: fitted.h, marginLeft: -fitted.w / 2, marginTop: -fitted.h / 2 }}
                >
                  <PageSheet
                    page={page}
                    orientation={book.orientation}
                    marginIn={book.marginIn}
                    gapIn={book.gapIn}
                    captionIn={book.captionIn}
                    photoById={photoById}
                    fullUrls={book.fullUrls}
                    pageNumber={pageIndex + 1}
                    interactive
                    selectedSlot={book.selectedSlot}
                    pageSelected={book.selectedSlot == null}
                    placing={Boolean(book.placingId)}
                    onSelectSlot={book.selectSlot}
                    onDeselect={book.clearSlotSelection}
                    onCommitPan={(index, panX, panY) => book.setSlotCrop(page.id, index, { panX, panY })}
                    onDropPhoto={(index, photoId) => book.assignPhoto(page.id, index, photoId)}
                    onSwap={(index, fromPageId, fromIndex) => book.swapSlots(fromPageId, fromIndex, page.id, index)}
                    onImport={(index) => {
                      importTarget.current = { pageId: page.id, index };
                      fileRef.current?.click();
                    }}
                    onToggleLock={() => book.togglePageLock(page.id)}
                  />
                </div>
              )}
              <p className="pointer-events-none absolute bottom-3 left-4 text-xs tracking-wide text-muted uppercase">
                {inches.w} × {inches.h} in
              </p>
              <button
                type="button"
                className="absolute top-1/2 left-2 z-30 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-page/90 text-ink shadow-sm ring-1 ring-line disabled:opacity-30"
                aria-label="Previous page"
                onClick={() => book.stepPage(-1)}
                disabled={pageIndex <= 0}
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                className="absolute top-1/2 right-2 z-30 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-page/90 text-ink shadow-sm ring-1 ring-line disabled:opacity-30"
                aria-label="Next page"
                onClick={() => book.stepPage(1)}
                disabled={pageIndex >= book.pages.length - 1}
              >
                <ChevronRight className="size-5" />
              </button>
            </div>
          </section>
          <PaneHandle
            label="Resize preview"
            min={220}
            max={560}
            sign={-1}
            get={() => paneWRef.current[2]}
            set={(width) => setPaneW((current) => [current[0], current[1], width])}
          />
          <aside className="relative flex h-full shrink-0 flex-col bg-surface" style={{ width: paneW[2] }}>
            {inspector}
          </aside>
        </div>
      )}

      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          const into = importTarget.current;
          importTarget.current = null;
          event.target.value = "";
          if (files.length) void book.importFiles(files, undefined, into ?? undefined);
        }}
      />

      <input
        ref={projectRef}
        className="sr-only"
        type="file"
        accept=".folio,.zip,application/zip"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const hasWork =
            book.photos.length > 0 ||
            book.pages.length > 1 ||
            book.pages.some((item) => item.slots.some((slot) => slot.photoId || slot.caption));
          if (hasWork) {
            setPendingProject(file);
            setConfirm("load");
            return;
          }
          void openProject(file);
        }}
      />

      {printPages &&
        createPortal(
          <div className="print-root">
            {printPages.map((item) => {
              const number = Math.max(1, book.pages.findIndex((pageItem) => pageItem.id === item.id) + 1);
              return (
                <div key={item.id} className="print-page" style={{ width: `${inches.w}in`, height: `${inches.h}in` }}>
                  <PageSheet
                    page={item}
                    orientation={book.orientation}
                    marginIn={book.marginIn}
                    gapIn={book.gapIn}
                    captionIn={book.captionIn}
                    photoById={photoById}
                    fullUrls={book.fullUrls}
                    pageNumber={number}
                  />
                </div>
              );
            })}
          </div>,
          document.body,
        )}

      {exportOpen && (
        <div className="no-print fixed inset-0 z-40 grid place-items-center bg-ink/40 px-4" role="dialog" aria-modal="true" aria-labelledby="export-title">
          <div className="max-h-[85dvh] w-full max-w-md overflow-y-auto bg-raised p-6">
            <h2 id="export-title" className="font-serif text-2xl">Export PDF</h2>
            <p className="mt-2 text-sm text-pretty text-muted">
              A real PDF file, {inches.w}×{inches.h} in, with a page number on every page. This works in the browser and the Android app.
            </p>
            <fieldset className="mt-4 grid gap-2">
              <legend className="sr-only">Which pages</legend>
              {(
                [
                  ["current", "This page"],
                  ["selected", "Selected pages"],
                  ["all", `All pages (${book.pages.length})`],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="radio"
                    name="export-mode"
                    className="size-4 accent-accent"
                    checked={exportMode === value}
                    onChange={() => setExportMode(value)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            {exportMode === "selected" && (
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Pages to export">
                {book.pages.map((item, index) => {
                  const on = picked.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={cn("btn min-w-11 px-3", on ? "btn-primary" : "btn-quiet")}
                      aria-pressed={on}
                      onClick={() =>
                        setPicked((current) => (current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]))
                      }
                    >
                      {index + 1}
                    </button>
                  );
                })}
              </div>
            )}
            {exportNote && (
              <p className="mt-3 text-sm" aria-live="polite">
                {exportNote}
              </p>
            )}
            <div className="mt-5 grid gap-2">
              <button type="button" className="btn btn-primary" onClick={() => void onMakePdf()} disabled={book.preparingPrint}>
                {book.preparingPrint ? "Making PDF…" : "Download PDF"}
              </button>
              {pdfUrl && (
                <a className="btn btn-ink no-underline" href={pdfUrl} download={pdfFilename(book.title)}>
                  Save PDF
                </a>
              )}
              {pdfUrl && (
                <button type="button" className="btn btn-quiet" onClick={() => void onSharePdf()}>
                  Share
                </button>
              )}
              <button type="button" className="btn btn-quiet" onClick={() => void onSystemPrint()} disabled={book.preparingPrint}>
                Printer dialog
              </button>
              <button type="button" className="btn btn-quiet" onClick={closeExport}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="no-print fixed inset-0 z-50 grid place-items-center bg-ink/40 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm bg-raised p-6">
            <h2 className="font-serif text-2xl">
              {confirm === "photos" ? "Delete every photo?" : confirm === "load" ? "Replace this book?" : "Clear every page?"}
            </h2>
            <p className="mt-2 text-sm text-pretty text-muted">
              {confirm === "photos"
                ? "This removes the library and empties the book on this device."
                : confirm === "load"
                  ? "Opening a project replaces the pages and photos stored on this device."
                  : "Photos stay in the library. Pages go back to a blank spread."}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  setConfirm(null);
                  setPendingProject(null);
                }}
              >
                Keep
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (confirm === "photos") void book.deleteAllPhotos();
                  else if (confirm === "load" && pendingProject) void openProject(pendingProject);
                  else if (confirm === "pages") book.clearPages();
                  setPendingProject(null);
                  setConfirm(null);
                }}
              >
                {confirm === "photos" ? "Delete" : confirm === "load" ? "Open" : "Clear"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function readPaneWidths(): [number, number, number] {
  if (typeof window === "undefined") return [256, 320, 288];
  try {
    const raw = JSON.parse(localStorage.getItem("pz-panes") || "");
    if (Array.isArray(raw) && raw.length === 3 && raw.every((item) => typeof item === "number" && Number.isFinite(item))) {
      return [clampPane(raw[0], 180, 840), clampPane(raw[1], 220, 720), clampPane(raw[2], 220, 560)];
    }
  } catch {
    // Keep the default widths.
  }
  return [256, 320, 288];
}

function clampPane(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function PaneHandle({
  label,
  min,
  max,
  sign = 1,
  get,
  set,
}: {
  label: string;
  min: number;
  max: number;
  sign?: number;
  get: () => number;
  set: (width: number) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      className="group relative z-30 w-4 shrink-0 cursor-col-resize touch-none"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const origin = get();
        const startX = event.clientX;
        const previous = document.body.style.userSelect;
        document.body.style.userSelect = "none";
        const move = (pointer: PointerEvent) => {
          pointer.preventDefault();
          set(clampPane(origin + sign * (pointer.clientX - startX), min, max));
        };
        const end = () => {
          document.body.style.userSelect = previous;
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
      }}
    >
      <span className="absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-line group-hover:bg-accent group-active:bg-accent" />
    </div>
  );
}

function fitSheet(stageW: number, stageH: number, aspect: number) {
  const pad = 28;
  const aw = stageW - pad * 2;
  const ah = stageH - pad * 2;
  if (aw <= 40 || ah <= 40) return { w: 0, h: 0 };
  if (aw / ah > aspect) return { w: ah * aspect, h: ah };
  return { w: aw, h: aw / aspect };
}
