import type { SearchHit } from "../lib/api";
import type { DepthPref } from "../lib/prefs";
import type { AccentName, ColorMode, ThemePref } from "../lib/theme";
import type { Lang } from "../lib/i18n";
import { ExportMenu } from "./ExportMenu";
import { ScanMenu } from "./ScanMenu";
import { SearchBox } from "./SearchBox";
import { SettingsMenu } from "./SettingsMenu";
import { WindowControls } from "./WindowControls";
import { PanelRightIcon } from "./icons";
import { t } from "../lib/i18n";

interface ToolbarProps {
  scanning: boolean;
  generation: number;
  viewRootId: number;
  startError: string | null;
  hideSystem: boolean;
  showLabels: boolean;
  depth: DepthPref;
  filter: string | null;
  typePanelOpen: boolean;
  themePref: ThemePref;
  accent: AccentName;
  mode: ColorMode;
  lang: Lang;
  onScan: (path: string) => void;
  onCancel: () => void;
  onToggleHideSystem: () => void;
  onToggleShowLabels: () => void;
  onDepth: (depth: DepthPref) => void;
  onToggleTypePanel: () => void;
  onSearchSelect: (hit: SearchHit) => void;
  onApplyFilter: (query: string | null) => void;
  onThemePref: (pref: ThemePref) => void;
  onAccent: (accent: AccentName) => void;
  onMode: (mode: ColorMode) => void;
  onLang: (lang: Lang) => void;
}

export function Toolbar({
  scanning,
  generation,
  viewRootId,
  startError,
  hideSystem,
  showLabels,
  depth,
  filter,
  typePanelOpen,
  themePref,
  accent,
  mode,
  lang,
  onScan,
  onCancel,
  onToggleHideSystem,
  onToggleShowLabels,
  onDepth,
  onToggleTypePanel,
  onSearchSelect,
  onApplyFilter,
  onThemePref,
  onAccent,
  onMode,
  onLang,
}: ToolbarProps) {
  return (
    // The toolbar is the title bar (undecorated window): drag-region spacers drag it; children stay interactive.
    <header
      data-tauri-drag-region
      className="flex items-center gap-2 border-b border-edge px-3 py-2"
    >
      {scanning ? (
        <button
          onClick={onCancel}
          className="h-8 rounded-md border border-danger-edge/70 px-3.5 text-[13px] text-danger-ink hover:bg-danger-soft/40"
        >
          {t("Cancel")}
        </button>
      ) : (
        <ScanMenu onScan={onScan} />
      )}
      {startError && (
        <span className="text-xs text-danger-ink">{startError}</span>
      )}
      <div data-tauri-drag-region className="min-w-4 flex-1" />
      <div className="shrink-0">
        <SearchBox
          generation={generation}
          hideSystem={hideSystem}
          activeFilter={filter}
          canFilter={!scanning && generation > 0}
          onSelect={onSearchSelect}
          onApplyFilter={onApplyFilter}
        />
      </div>
      <div data-tauri-drag-region className="min-w-4 flex-1" />
      <button
        onClick={onToggleTypePanel}
        title={t("Show or hide the file-types panel")}
        aria-label={t("File-types panel")}
        className={`ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${
          typePanelOpen
            ? "border-edge-strong bg-raised text-ink"
            : "border-edge bg-panel text-ink-4 hover:bg-raised hover:text-ink-2"
        }`}
      >
        <PanelRightIcon />
      </button>
      <ExportMenu
        generation={generation}
        viewRootId={viewRootId}
        hideSystem={hideSystem}
        disabled={scanning || generation === 0}
      />
      <SettingsMenu
        hideSystem={hideSystem}
        showLabels={showLabels}
        depth={depth}
        themePref={themePref}
        accent={accent}
        mode={mode}
        lang={lang}
        onToggleHideSystem={onToggleHideSystem}
        onToggleShowLabels={onToggleShowLabels}
        onDepth={onDepth}
        onThemePref={onThemePref}
        onAccent={onAccent}
        onMode={onMode}
        onLang={onLang}
      />
      <WindowControls />
    </header>
  );
}
