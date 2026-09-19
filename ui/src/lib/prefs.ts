// View preferences that outlive a scan. Values the back end also has to agree
// on are mirrored here, same as palette.ts mirrors mathom-core's categories.

/** Mirrors `MAX_TREEMAP_DEPTH` in src-tauri/src/scan.rs. */
export const LAYOUT_ALL_DEPTH = 24;

/** Levels the treemap expands below the focused folder; `null` is "all". */
export type DepthPref = number | null;

const DEPTH_KEY = "mathom:treemapDepth";

/** Levels the treemap can be pinned to; the settings menu offers exactly these. */
const DEPTHS = [1, 2, 3];

export const DEPTH_OPTIONS: { value: DepthPref; label: string }[] = [
  { value: null, label: "All" },
  ...DEPTHS.map((depth) => ({ value: depth, label: String(depth) })),
];

/**
 * Total, and its domain is exactly the options above: a stored level that no
 * button can show would leave the control with nothing selected, so anything
 * else reads as "all".
 */
export function parseDepth(raw: string | null): DepthPref {
  const n = Number(raw);
  return DEPTHS.includes(n) ? n : null;
}

/**
 * The cap the back end lays out for `depth`, mirroring its own clamp. The
 * treemap needs it to tell a plate the cap collapsed from one whose children
 * were merely culled by size, and that reading has to match the layout.
 */
export function layoutCap(depth: DepthPref): number {
  if (depth === null) return LAYOUT_ALL_DEPTH;
  return Math.min(Math.max(depth, 1), LAYOUT_ALL_DEPTH);
}

export function loadTreemapDepth(): DepthPref {
  return parseDepth(localStorage.getItem(DEPTH_KEY));
}

export function saveTreemapDepth(depth: DepthPref) {
  localStorage.setItem(DEPTH_KEY, depth === null ? "all" : String(depth));
}
