import { useEffect, useRef, useState } from "react";
import {
  ACCENTS,
  type AccentName,
  type ColorMode,
  type ThemePref,
  accentSwatch,
} from "../lib/theme";
import { DEPTH_OPTIONS, type DepthPref } from "../lib/prefs";
import { LANGS, type Lang, t } from "../lib/i18n";
import { PaletteIcon } from "./icons";

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const MODE_OPTIONS: { value: ColorMode; label: string; title: string }[] = [
  {
    value: "classic",
    label: "Classic",
    title: "One colour for files, one for folders — the accent sets the tone",
  },
  {
    value: "multi",
    label: "Multi",
    title: "A colour per file type, with folders in the accent colour",
  },
];

interface SettingsMenuProps {
  hideSystem: boolean;
  showLabels: boolean;
  depth: DepthPref;
  themePref: ThemePref;
  accent: AccentName;
  mode: ColorMode;
  lang: Lang;
  onToggleHideSystem: () => void;
  onToggleShowLabels: () => void;
  onDepth: (depth: DepthPref) => void;
  onThemePref: (pref: ThemePref) => void;
  onAccent: (accent: AccentName) => void;
  onMode: (mode: ColorMode) => void;
  onLang: (lang: Lang) => void;
}

export function SettingsMenu({
  hideSystem,
  showLabels,
  depth,
  themePref,
  accent,
  mode,
  lang,
  onToggleHideSystem,
  onToggleShowLabels,
  onDepth,
  onThemePref,
  onAccent,
  onMode,
  onLang,
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
        title={t("Appearance")}
        aria-label={t("Appearance")}
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
            {t("View")}
          </div>
          <label
            className="mt-1.5 flex cursor-pointer items-center gap-2 text-[12px] text-ink-2"
            title={t(
              "Hide OS/system files (pagefile, hiberfil, System Volume Information, …)",
            )}
          >
            <input
              type="checkbox"
              className="accent-accent"
              checked={hideSystem}
              onChange={onToggleHideSystem}
            />
            {t("Hide system files")}
          </label>
          <label
            className="mt-1.5 flex cursor-pointer items-center gap-2 text-[12px] text-ink-2"
            title={t("Write each treemap block's name and size inside it")}
          >
            <input
              type="checkbox"
              className="accent-accent"
              checked={showLabels}
              onChange={onToggleShowLabels}
            />
            {t("Show names in treemap")}
          </label>
          <div className="mt-3 text-[11px] font-medium tracking-wide text-ink-4 uppercase">
            {t("Depth")}
          </div>
          <div className="mt-1.5 flex rounded-md border border-edge p-0.5">
            {DEPTH_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => onDepth(opt.value)}
                title={t(
                  opt.value === "auto"
                    ? "As deep as the pixels are worth — folders fold when nothing inside them would be readable"
                    : opt.value === "all"
                      ? "Every level that fits, and nothing folds"
                      : opt.label === "1"
                        ? "Exactly {count} level"
                        : "Exactly {count} levels",
                  { count: opt.label },
                )}
                className={`h-6 flex-1 rounded text-[12px] ${
                  depth === opt.value
                    ? "bg-raised text-ink"
                    : "text-ink-4 hover:text-ink-2"
                }`}
              >
                {t(opt.label)}
              </button>
            ))}
          </div>
          <div className="mt-3 text-[11px] font-medium tracking-wide text-ink-4 uppercase">
            {t("Theme")}
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
                {t(opt.label)}
              </button>
            ))}
          </div>
          <div className="mt-3 text-[11px] font-medium tracking-wide text-ink-4 uppercase">
            {t("Colours")}
          </div>
          <div className="mt-1.5 flex rounded-md border border-edge p-0.5">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onMode(opt.value)}
                title={t(opt.title)}
                className={`h-6 flex-1 rounded text-[12px] ${
                  mode === opt.value
                    ? "bg-raised text-ink"
                    : "text-ink-4 hover:text-ink-2"
                }`}
              >
                {t(opt.label)}
              </button>
            ))}
          </div>
          <div className="mt-3 text-[11px] font-medium tracking-wide text-ink-4 uppercase">
            {t("Accent")}
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
          <div className="mt-3 text-[11px] font-medium tracking-wide text-ink-4 uppercase">
            {t("Language")}
          </div>
          <div className="mt-1.5 flex rounded-md border border-edge p-0.5">
            {LANGS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onLang(opt.value)}
                className={`h-6 flex-1 rounded text-[12px] ${
                  lang === opt.value
                    ? "bg-raised text-ink"
                    : "text-ink-4 hover:text-ink-2"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
