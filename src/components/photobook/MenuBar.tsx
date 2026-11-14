import { useEffect, useRef, useState } from "react";
import type { LayoutId, Orientation } from "@/lib/photobook/types";
import { cn } from "@/lib/cn";

type Item = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
};

type MenuBarProps = {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onExport: () => void;
  onSync: () => void;
  onLoadSync: () => void;
  syncName: string | null;
  canSync: boolean;
  onAddPage: () => void;
  onDuplicate: () => void;
  onDeletePage: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLayout: (layout: LayoutId) => void;
  layout: LayoutId | null;
  hasPhoto: boolean;
  canPaste: boolean;
  onRotate: () => void;
  onCenter: () => void;
  onResetCrop: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onClearSlot: () => void;
  orientation: Orientation;
  onOrientation: (orientation: Orientation) => void;
  density: 1 | 2 | 3 | 4;
  onDensity: (density: 1 | 2 | 3 | 4) => void;
  busy: boolean;
};

const LAYOUTS: { id: LayoutId; label: string }[] = [
  { id: "one", label: "Full" },
  { id: "two-cols", label: "Pair" },
  { id: "two-rows", label: "Stack" },
  { id: "three-banner", label: "Banner" },
  { id: "four", label: "Grid" },
];

export function MenuBar(props: MenuBarProps) {
  const [open, setOpen] = useState<string | null>("File");
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!barRef.current?.contains(event.target as Node)) setOpen(null);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const menus: { name: string; items: Item[] }[] = [
    {
      name: "File",
      items: [
        { label: "New book", onClick: props.onNew },
        { label: "Open", onClick: props.onOpen, disabled: props.busy },
        { label: "Save", onClick: props.onSave, disabled: props.busy },
        { label: "Export PDF", onClick: props.onExport, disabled: props.busy },
        { label: props.syncName ? `Sync folder: ${props.syncName}` : "Sync folder", onClick: props.onSync, disabled: !props.canSync || props.busy },
        { label: "Load synced book", onClick: props.onLoadSync, disabled: !props.canSync || props.busy || !props.syncName },
      ],
    },
    {
      name: "Page",
      items: [
        { label: "Add page", onClick: props.onAddPage },
        { label: "Duplicate", onClick: props.onDuplicate },
        { label: "Previous page", onClick: props.onPrev },
        { label: "Next page", onClick: props.onNext },
        { label: "Remove page", onClick: props.onDeletePage },
      ],
    },
    {
      name: "Layout",
      items: LAYOUTS.map((layout) => ({
        label: layout.label,
        active: props.layout === layout.id,
        onClick: () => props.onLayout(layout.id),
      })),
    },
    {
      name: "Photo",
      items: [
        { label: "Rotate", onClick: props.onRotate, disabled: !props.hasPhoto },
        { label: "Center", onClick: props.onCenter, disabled: !props.hasPhoto },
        { label: "Reset crop", onClick: props.onResetCrop, disabled: !props.hasPhoto },
        { label: "Cut", onClick: props.onCut, disabled: !props.hasPhoto },
        { label: "Copy", onClick: props.onCopy, disabled: !props.hasPhoto },
        { label: "Paste", onClick: props.onPaste, disabled: !props.canPaste },
        { label: "Delete", onClick: props.onClearSlot, disabled: !props.hasPhoto },
      ],
    },
    {
      name: "Book",
      items: [
        { label: "12 × 8", active: props.orientation === "landscape", onClick: () => props.onOrientation("landscape") },
        { label: "8 × 12", active: props.orientation === "portrait", onClick: () => props.onOrientation("portrait") },
        { label: "1 photo per new page", active: props.density === 1, onClick: () => props.onDensity(1) },
        { label: "2 photos per new page", active: props.density === 2, onClick: () => props.onDensity(2) },
        { label: "3 photos per new page", active: props.density === 3, onClick: () => props.onDensity(3) },
        { label: "4 photos per new page", active: props.density === 4, onClick: () => props.onDensity(4) },
      ],
    },
  ];

  return (
    <div ref={barRef} className="no-print relative flex gap-1 border-b border-line bg-surface px-2" role="menubar">
      {menus.map((menu) => (
        <div key={menu.name} className="relative">
          <button
            type="button"
            className={cn("min-h-11 px-3 text-sm", open === menu.name ? "bg-ink text-page" : "text-ink")}
            aria-expanded={open === menu.name}
            aria-haspopup="menu"
            onClick={() => setOpen((current) => (current === menu.name ? null : menu.name))}
          >
            {menu.name}
          </button>
          {open === menu.name && (
            <div className="absolute top-full left-0 z-40 min-w-52 border border-line bg-surface py-1 shadow-lg" role="menu">
              {menu.items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={cn(
                    "flex min-h-11 w-full items-center px-3 text-left text-sm",
                    item.disabled ? "text-muted" : "hover:bg-caption",
                    item.active && "font-medium",
                  )}
                  disabled={item.disabled}
                  onClick={() => {
                    item.onClick();
                    setOpen(null);
                  }}
                >
                  {item.active ? "• " : ""}
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
