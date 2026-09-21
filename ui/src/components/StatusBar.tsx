import type { Snapshot } from "../lib/api";
import { formatBytes, formatElapsed, formatNumber } from "../lib/format";
import { t } from "../lib/i18n";

interface StatusBarProps {
  snapshot: Snapshot | null;
  selectedPath: string | null;
  uiError: string | null;
}

function stateLabel(snapshot: Snapshot | null): string {
  switch (snapshot?.state) {
    case "scanning":
      return t("Scanning…");
    case "done":
      return t("Scan complete in {elapsed}", {
        elapsed: formatElapsed(snapshot.elapsedMs),
      });
    case "cancelled":
      return t("Scan cancelled");
    case "failed":
      return t("Scan failed: {error}", {
        error: snapshot.rootError ?? t("unknown error"),
      });
    default:
      return t("Ready");
  }
}

export function StatusBar({ snapshot, selectedPath, uiError }: StatusBarProps) {
  const state = snapshot?.state;
  const rate =
    snapshot && snapshot.elapsedMs > 0
      ? Math.round(
          (snapshot.files + snapshot.dirs) / (snapshot.elapsedMs / 1000),
        )
      : 0;
  return (
    <footer className="flex h-7 items-center gap-3 border-t border-edge px-3 text-xs text-ink-4">
      <span
        className={`shrink-0 ${
          state === "failed"
            ? "text-danger-ink"
            : state === "scanning"
              ? "text-accent-ink"
              : ""
        }`}
      >
        {stateLabel(snapshot)}
      </span>
      {snapshot !== null && state !== "idle" && (
        <span className="tnum shrink-0">
          {t("{files} files · {folders} folders · {size}", {
            files: formatNumber(snapshot.files),
            folders: formatNumber(snapshot.dirs),
            size: formatBytes(snapshot.bytes),
          })}
          {state === "scanning" &&
            ` · ${formatElapsed(snapshot.elapsedMs)} · ${formatNumber(rate)}/s`}
        </span>
      )}
      {uiError && (
        <span
          className="max-w-96 shrink-0 truncate text-danger-ink"
          title={uiError}
        >
          {uiError}
        </span>
      )}
      {snapshot !== null && snapshot.errors > 0 && (
        <span className="tnum shrink-0 text-warn/90">
          {t("{count} unreadable", { count: formatNumber(snapshot.errors) })}
        </span>
      )}
      <span
        className="min-w-0 flex-1 truncate text-center text-ink-5"
        title={selectedPath ?? undefined}
      >
        {selectedPath ?? ""}
      </span>
      <span className="tnum shrink-0">
        {t("{count} nodes", { count: formatNumber(snapshot?.nodes ?? 0) })}
      </span>
    </footer>
  );
}
