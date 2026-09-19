import { useEffect, useRef, useState } from "react";
import { DEPTH_OPTIONS, type DepthPref } from "../lib/prefs";
import {
  ACCENTS,
  type AccentName,
  type ThemePref,
  accentSwatch,
} from "../lib/theme";
import { PaletteIcon } from "./icons";

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

interface SettingsMenuProps {
  hideSystem: boolean;
  maxDepth: DepthPref;
  themePref: ThemePref;
  accent: AccentName;
  onToggleHideSystem: () => void;
  onMaxDepth: (depth: DepthPref) => void;
  onThemePref: (pref: ThemePref) => void;
  onAccent: (accent: AccentName) => void;
}

export function SettingsMenu({
  hideSystem,
  maxDepth,
  themePref,
  accent,
  onToggleHideSystem,
  onMaxDepth,
  onThemePref,
  onAccent,
}: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Settings"
        aria-label="Settings"
        className={`ml-1 flex h-8 w-8 items-center justify-center rounded-md border ${
          open
            ? "border-edge-strong bg-raised text-ink"
            : "border-edge bg-panel text-ink-4 hover:bg-raised hover:text-ink-2"
        }`}
      >
        <PaletteIcon />
      </button>
      {open && (
        <div className="absolute top-9 right-0 z-50 w-52 rounded-md border border-edge-strong bg-panel p-3 shadow-xl">
          <div className="text-[11px] font-medium tracking-wide text-ink-4 uppercase">
            View
          </div>
          <label
            className="mt-1.5 flex cursor-pointer items-center gap-2 text-[12px] text-ink-2"
            title="Hide OS/system files (pagefile, hiberfil, System Volume Information, …)"
          >
            <input
              type="checkbox"
              className="accent-accent"
              checked={hideSystem}
              onChange={onToggleHideSystem}
            />
            Hide system files
          </label>
          <div
            className="mt-3 text-[11px] font-medium tracking-wide text-ink-4 uppercase"
            title="Levels the treemap expands below the folder in view. Click a block to go deeper."
          >
            Treemap depth
          </div>
          <div className="mt-1.5 flex rounded-md border border-edge p-0.5">
            {DEPTH_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => onMaxDepth(opt.value)}
                title={
                  opt.value === null
                    ? "Expand every level"
                    : `Expand ${opt.label} level${opt.value > 1 ? "s" : ""} below the folder in view`
                }
                className={`h-6 flex-1 rounded text-[12px] ${
                  maxDepth === opt.value
                    ? "bg-raised text-ink"
                    : "text-ink-4 hover:text-ink-2"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="mt-3 text-[11px] font-medium tracking-wide text-ink-4 uppercase">
            Theme
          </div>
          <div className="mt-1.5 flex rounded-md border border-edge p-0.5">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onThemePref(opt.value)}
                className={`h-6 flex-1 rounded text-[12px] ${
                  themePref === opt.value
                    ? "bg-raised text-ink"
                    : "text-ink-4 hover:text-ink-2"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="mt-3 text-[11px] font-medium tracking-wide text-ink-4 uppercase">
            Accent
          </div>
          <div className="mt-1.5 flex gap-2">
            {(Object.keys(ACCENTS) as AccentName[]).map((name) => (
              <button
                key={name}
                onClick={() => onAccent(name)}
                title={name}
                aria-label={`${name} accent`}
                className={`h-5 w-5 rounded-full border-2 ${
                  accent === name ? "border-ink" : "border-transparent"
                }`}
                style={{ background: accentSwatch(name) }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
