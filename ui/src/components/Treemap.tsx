// Canvas treemap. Bake layout once, draw hover/selection on an overlay.
// The rect list arrives parents-before-children: forward = paint order,
// reverse = deepest-first hit-testing.
//
// INVARIANT: pipeline callbacks stay identity-stable; prop values are
// mirrored into refs, and effects depend only on values whose change
// genuinely requires them. A hover-dependent callback once cascaded into
// the reset/resize effects — every hover refetched the layout (IPC flood,
// webview crash).

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  api,
  type Crumb,
  type Row,
  type Snapshot,
  type TreemapRect,
} from "../lib/api";
import { isStale, reportUnlessStale } from "../lib/errors";
import { formatBytes, formatPercent } from "../lib/format";
import {
  FOLDER_GRAIN,
  FOLDER_PLATE,
  FOLDER_SEAM,
  PALETTE,
  canvasColors,
  textOn,
} from "../lib/palette";

const SCAN_REFRESH_MS = 400;
const ZOOM_MS = 220;
const TOOLTIP_DELAY_MS = 120;
/**
 * How long a click on a plate waits to find out whether it was half of a
 * double click. Chromium reports the second click at the platform's interval,
 * which defaults to 500ms — too long to hold every open for, so this is the
 * compromise: a slow double click opens first and then zooms.
 */
const DOUBLE_CLICK_MS = 300;

// Grain tile for directory plates. By the layout's contract, culled children
// still consume their share of space, so every bare plate pixel is real bytes
// too small to draw — the grain makes that read as "many small files" instead
// of dead space. Drawn tiles paint over it, so it shows only where content
// was culled.
const GRAIN_PITCH = 4;

let grainTile: { key: string; canvas: HTMLCanvasElement } | null = null;

function getGrainTile(plate: string, grain: string): HTMLCanvasElement {
  const key = `${plate}|${grain}`;
  if (grainTile?.key === key) return grainTile.canvas;
  const c = document.createElement("canvas");
  c.width = GRAIN_PITCH;
  c.height = GRAIN_PITCH;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = plate;
  ctx.fillRect(0, 0, GRAIN_PITCH, GRAIN_PITCH);
  ctx.fillStyle = grain;
  ctx.fillRect(1, 1, 1, 1);
  grainTile = { key, canvas: c };
  return c;
}

/** Mirrors the body font stack in index.css so canvas text matches the DOM's. */
const LABEL_FONT = 'ui-sans-serif, system-ui, "Segoe UI", sans-serif';
const LABEL_SIZE_PX = 11;
/**
 * Only blocks with room to say something useful get a name. These are what
 * "useful" costs: narrower and the name is cut down to two letters, shorter
 * and the size has nowhere to go but over the edge. Deliberately generous —
 * the point of the mode is the handful of blocks that dominate the map, and
 * a wall of captions reads as noise.
 */
const LABEL_MIN_W_PX = 46;
/** Taller than this and the size gets a line of its own under the name. */
const LABEL_TWO_LINE_H_PX = 30;
/** …and shorter than this and it is not worth writing at all. */
const LABEL_MIN_H_PX = 18;
const LABEL_PAD_PX = 4;

/**
 * Shortens `text` to `maxW`, with an ellipsis when it had to cut. Binary
 * search rather than a walk in from the end: this runs for every block on
 * every bake, and a bake runs on each scan tick.
 */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : "";
}

/**
 * Names, drawn into the blocks themselves, when the view asks for them. A map
 * of coloured rectangles tells you where the space went; it does not tell you
 * what any of it is without hovering each one, and hovering every block is the
 * work this saves. It is off by default because the blocks are also the map,
 * and writing in all of them changes what the map reads like.
 *
 * A pure overlay: it reads the rects the layout already produced and writes
 * text into the boxes, so the geometry with this on is the geometry with it
 * off, to the pixel. That rules out reserving a strip for a directory's name —
 * which is why only *solid* blocks get one. A block the layout subdivided is
 * covered by its children, so a name centred in it would land on top of them;
 * its children carry the names instead, and a directory you can see into does
 * not need to say its own.
 */
function drawLabels(
  ctx: CanvasRenderingContext2D,
  rects: TreemapRect[],
  dpr: number,
) {
  ctx.font = `${LABEL_SIZE_PX * dpr}px ${LABEL_FONT}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  const minW = LABEL_MIN_W_PX * dpr;
  const pad = LABEL_PAD_PX * dpr;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    // Rects come out parents before children, so a parent's first child is the
    // very next entry: a deeper neighbour means the layout subdivided this one.
    if ((rects[i + 1]?.depth ?? 0) > r.depth) continue;
    const s = snap(r, dpr, 1);
    if (s.w < minW || s.h < LABEL_MIN_H_PX * dpr) continue;
    ctx.fillStyle = textOn(
      r.isDir ? FOLDER_PLATE : (PALETTE[r.category] ?? PALETTE[10]),
    );
    const name = fitText(ctx, r.name, s.w - 2 * pad);
    if (!name) continue;
    const cx = s.x + s.w / 2;
    if (s.h >= LABEL_TWO_LINE_H_PX * dpr) {
      ctx.fillText(name, cx, s.y + s.h / 2 - 6 * dpr);
      ctx.fillText(formatBytes(r.size), cx, s.y + s.h / 2 + 8 * dpr);
    } else {
      ctx.fillText(name, cx, s.y + s.h / 2);
    }
  }
}

let highlightSprite: HTMLCanvasElement | null = null;

function getHighlightSprite(): HTMLCanvasElement {
  if (highlightSprite) return highlightSprite;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(40, 32, 0, 64, 64, 120);
  g.addColorStop(0, "rgba(255,255,255,0.30)");
  g.addColorStop(0.55, "rgba(255,255,255,0.03)");
  g.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  highlightSprite = c;
  return c;
}

interface Snapped {
  x: number;
  y: number;
  w: number;
  h: number;
}

function snap(r: TreemapRect, dpr: number, gap: number): Snapped {
  const x0 = Math.round(r.x * dpr);
  const y0 = Math.round(r.y * dpr);
  const x1 = Math.round((r.x + r.w) * dpr);
  const y1 = Math.round((r.y + r.h) * dpr);
  return { x: x0, y: y0, w: x1 - x0 - gap, h: y1 - y0 - gap };
}

/** Rects with no children of their own — the ones a click can open. */
function solidPlates(rects: TreemapRect[]): Set<number> {
  const plates = new Set<number>();
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    // Rects come out parents before children, so the next entry is a child
    // exactly when it is deeper.
    if (r.isDir && !((rects[i + 1]?.depth ?? 0) > r.depth)) plates.add(r.id);
  }
  return plates;
}

/**
 * How big the biggest thing inside an opened folder has to come out to be
 * worth showing in place. This is the layout's own legibility line — twice the
 * minimum block — not a new number: below it the layout would have refused to
 * subdivide for the same reason, and drawing it anyway is the mosaic of specks
 * this whole corner of the map exists to avoid.
 */
const AUTO_ZOOM_PX = 12;

/**
 * Did opening `id` reveal anything worth looking at?
 *
 * `rects[i + 1]` is the folder's biggest child: rows are laid out in
 * descending size and the list is pre-order, so the first child emitted is the
 * largest. No child at all is not "too small" — there is nothing to zoom to.
 */
function revealedTooSmall(rects: TreemapRect[], id: number): boolean {
  const at = rects.findIndex((r) => r.id === id);
  if (at < 0) return false;
  const first = rects[at + 1];
  if (!first || first.depth <= rects[at].depth) return false;
  return Math.min(first.w, first.h) < AUTO_ZOOM_PX;
}

interface TooltipData {
  name: string;
  size: string;
  pct: string;
  path: string;
}

export interface TreemapProps {
  snapshot: Snapshot | null;
  generation: number;
  rootId: number;
  /** Bumped by App on an out-of-band tree change (a delete) to force relayout. */
  revision: number;
  /** Bumped by useTheme after a theme/accent change to force a re-bake. */
  themeRev: number;
  hideSystem: boolean;
  /** Active view filter (search grammar) or null. */
  filter: string | null;
  /** Draw each block's name and size inside it. Off by default. */
  labels: boolean;
  selected: number | null;
  hoveredId: number | null;
  onSelect: (rect: TreemapRect) => void;
  onHover: (id: number | null) => void;
  onNavigate: (id: number) => void;
  onContext: (id: number, x: number, y: number, zoom: ZoomTargets) => void;
}

/** Right-click zoom targets: null = that direction isn't available here. */
export interface ZoomTargets {
  inId: number | null;
  outId: number | null;
}

export function Treemap({
  snapshot,
  generation,
  rootId,
  revision,
  themeRev,
  hideSystem,
  filter,
  labels,
  selected,
  hoveredId,
  onSelect,
  onHover,
  onNavigate,
  onContext,
}: TreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const rectsRef = useRef<TreemapRect[]>([]);
  const byIdRef = useRef<Map<number, TreemapRect>>(new Map());
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const rootIdRef = useRef(0);
  // During drill, old rects are stale geometry.
  const hitFrozenRef = useRef(false);
  const crumbsRootRef = useRef<number | null>(null);
  const crumbIdsRef = useRef<Set<number>>(new Set());
  const lastFetchRef = useRef(0);
  const fetchSeqRef = useRef(0);
  const zoomRafRef = useRef(0);
  const mouseOverRef = useRef<number | null>(null);
  const tooltipSeqRef = useRef(0);
  const tooltipTimerRef = useRef(0);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  /** Ids of the plates the layout did not subdivide — the ones a click can
   *  open. Rebuilt with each response, same one-pass test `drawLabels` uses. */
  const platesRef = useRef<Set<number>>(new Set());
  /** The one directory the user opened by hand. Mirrors `forceOpenId`. */
  const forceOpenRef = useRef<number | null>(null);
  /** A click waiting out the double-click window, and its sequence number. */
  const pendingRef = useRef<{ id: number; collapse: boolean } | null>(null);
  const pendingSeqRef = useRef(0);
  const pendingTimerRef = useRef(0);

  const generationRef = useRef(generation);
  generationRef.current = generation;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const hoveredIdRef = useRef(hoveredId);
  hoveredIdRef.current = hoveredId;
  const hideSystemRef = useRef(hideSystem);
  hideSystemRef.current = hideSystem;
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [hasRects, setHasRects] = useState(false);
  const [forceOpenId, setForceOpenId] = useState<number | null>(null);
  forceOpenRef.current = forceOpenId;

  const drawOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d")!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (hitFrozenRef.current) return;
    const dpr = window.devicePixelRatio || 1;
    const theme = canvasColors();
    const outline = (id: number | null, color: string, width: number) => {
      if (id === null || id === rootIdRef.current) return;
      const r = byIdRef.current.get(id);
      if (!r) return;
      const s = snap(r, dpr, 0);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(
        s.x + width / 2,
        s.y + width / 2,
        s.w - width,
        s.h - width,
      );
    };
    outline(selectedRef.current, theme.selection, 2);
    const hovered = hoveredIdRef.current;
    if (hovered !== null && hovered !== selectedRef.current) {
      if (hovered === rootIdRef.current || crumbIdsRef.current.has(hovered)) {
        ctx.strokeStyle = theme.hoverRing;
        ctx.lineWidth = 3;
        ctx.strokeRect(1.5, 1.5, overlay.width - 3, overlay.height - 3);
      } else {
        outline(hovered, theme.hoverRing, 2);
      }
    }
  }, []);

  const blit = useCallback(() => {
    const base = baseRef.current;
    const off = offscreenRef.current;
    if (!base || !off || off.width === 0 || off.height === 0) return;
    const ctx = base.getContext("2d")!;
    ctx.clearRect(0, 0, base.width, base.height);
    ctx.drawImage(
      off,
      0,
      0,
      off.width,
      off.height,
      0,
      0,
      base.width,
      base.height,
    );
    drawOverlay();
  }, [drawOverlay]);

  const bake = useCallback(() => {
    const base = baseRef.current;
    if (!base || base.width === 0) return;
    let off = offscreenRef.current;
    if (!off) {
      off = document.createElement("canvas");
      offscreenRef.current = off;
    }
    off.width = base.width;
    off.height = base.height;
    const ctx = off.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const rects = rectsRef.current;
    const theme = canvasColors();

    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, off.width, off.height);

    ctx.fillStyle = ctx.createPattern(
      getGrainTile(FOLDER_PLATE, FOLDER_GRAIN),
      "repeat",
    )!;
    ctx.beginPath();
    for (const r of rects) {
      if (!r.isDir) continue;
      const s = snap(r, dpr, 0);
      if (s.w > 0 && s.h > 0) ctx.rect(s.x, s.y, s.w, s.h);
    }
    ctx.fill();

    // A plate with no children is the final answer for the space it covers,
    // and it needs a seam — the grain under it is one continuous pattern, so
    // thirty folders of equal size would otherwise draw as a single flat
    // field with nothing to say where one ends. The seam has to be painted:
    // the parent's plate is underneath, and a gap alone would just show more
    // of the same texture. Plates that *do* have children are only backing
    // for them and get nothing, or every subdivided directory would ring
    // itself in a hairline frame.
    ctx.fillStyle = FOLDER_SEAM;
    ctx.beginPath();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      // Rects come out parents before children, so the next entry is a child
      // exactly when it is deeper — the test for "subdivided".
      if (!r.isDir || (rects[i + 1]?.depth ?? 0) > r.depth) continue;
      const s = snap(r, dpr, 1);
      if (s.w <= 0 || s.h <= 0) continue;
      ctx.rect(s.x + s.w, s.y, dpr, s.h + dpr);
      ctx.rect(s.x, s.y + s.h, s.w, dpr);
    }
    ctx.fill();

    const buckets: TreemapRect[][] = PALETTE.map(() => []);
    for (const r of rects) {
      if (!r.isDir) buckets[r.category]?.push(r);
    }
    for (let c = 0; c < buckets.length; c++) {
      const bucket = buckets[c];
      if (bucket.length === 0) continue;
      ctx.fillStyle = PALETTE[c];
      ctx.beginPath();
      for (const r of bucket) {
        const s = snap(r, dpr, 1);
        if (s.w > 0 && s.h > 0) ctx.rect(s.x, s.y, s.w, s.h);
      }
      ctx.fill();
    }

    const sprite = getHighlightSprite();
    for (const r of rects) {
      if (r.isDir) continue;
      const s = snap(r, dpr, 1);
      if (s.w > 3 && s.h > 3) ctx.drawImage(sprite, s.x, s.y, s.w, s.h);
    }

    if (labelsRef.current) drawLabels(ctx, rects, dpr);

    if (zoomRafRef.current === 0) blit();
  }, [blit]);

  const refreshCrumbs = useCallback(() => {
    const generation = generationRef.current;
    if (generation === 0) return;
    const forRoot = rootIdRef.current;
    api
      .getAncestors(generation, forRoot)
      .then((crumbs) => {
        crumbsRootRef.current = forRoot;
        crumbIdsRef.current = new Set(crumbs.map((c) => c.id));
        setCrumbs(crumbs);
        drawOverlay(); // the current hover may have just become an ancestor
      })
      .catch((e) => {
        // The tree can still be empty at scan start; layout retries crumbs.
        if (!isStale(e) && !String(e).includes("unknown node")) {
          reportUnlessStale("loading breadcrumbs", e);
        }
      });
  }, [drawOverlay]);

  const fetchLayout = useCallback(async () => {
    const container = containerRef.current;
    const generation = generationRef.current;
    if (!container || generation === 0) {
      hitFrozenRef.current = false;
      return;
    }
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w < 10 || h < 10) {
      hitFrozenRef.current = false;
      return;
    }

    const seq = ++fetchSeqRef.current;
    const forRoot = rootIdRef.current;
    lastFetchRef.current = performance.now();
    try {
      const rects = await api.getTreemap(
        generation,
        forRoot,
        w,
        h,
        hideSystemRef.current,
        filterRef.current,
        forceOpenRef.current,
      );
      if (seq !== fetchSeqRef.current || forRoot !== rootIdRef.current) return;
      rectsRef.current = rects;
      byIdRef.current = new Map(rects.map((r) => [r.id, r]));
      platesRef.current = solidPlates(rects);
      hitFrozenRef.current = false;
      setHasRects(rects.length > 0);
      bake();
      if (crumbsRootRef.current !== forRoot) refreshCrumbs();
      // The folder the user opened is open — but if the biggest thing in it
      // still came out too small to read, opening it in place achieved
      // nothing. Zoom it instead: at that point the only useful thing to do
      // with it is fill the view and look inside properly.
      const opened = forceOpenRef.current;
      if (
        opened !== null &&
        opened !== forRoot &&
        revealedTooSmall(rects, opened)
      ) {
        // Through the prop, not `drillTo`: that is declared below this one and
        // calls it back, so depending on it here would be a cycle. App's
        // handler is a stable useCallback either way.
        onNavigate(opened);
      }
    } catch (e) {
      reportUnlessStale("loading treemap", e);
      if (seq === fetchSeqRef.current) hitFrozenRef.current = false;
    }
  }, [bake, refreshCrumbs, onNavigate]);

  /**
   * A click on a plate is ambiguous until the double-click window closes: it
   * could be "open this" or the first half of "zoom into this". So that one
   * action waits, and only that one — everything else acts on the spot, and
   * `handleDoubleClick` cancels what is waiting. `pendingRef` doubles as the
   * flag: it is non-null exactly while a click has yet to be acted on.
   */
  const arm = useCallback((id: number, collapse: boolean) => {
    window.clearTimeout(pendingTimerRef.current);
    const seq = ++pendingSeqRef.current;
    const generation = generationRef.current;
    const forRoot = rootIdRef.current;
    pendingRef.current = { id, collapse };
    pendingTimerRef.current = window.setTimeout(() => {
      if (seq !== pendingSeqRef.current) return;
      // A scan tick re-fetching underneath us is not a reason to drop the
      // click — the id is what the action applies to, and those are stable
      // within a generation. Leaving the tree or starting a new scan is.
      if (generation !== generationRef.current) return;
      if (forRoot !== rootIdRef.current) return;
      if (!byIdRef.current.has(id)) return;
      setForceOpenId(collapse ? null : id);
    }, DOUBLE_CLICK_MS);
  }, []);

  const cancelPending = useCallback(() => {
    pendingRef.current = null;
    window.clearTimeout(pendingTimerRef.current);
    pendingSeqRef.current++;
  }, []);

  const drillTo = useCallback(
    (id: number) => {
      if (id === rootIdRef.current) return;
      const zoomFrom = byIdRef.current.get(id);
      rootIdRef.current = id;
      hitFrozenRef.current = true;
      setTooltip(null);
      mouseOverRef.current = null;
      cancelPending();
      // The open folder follows the view only into itself. Zooming into it
      // should show what is inside — without this it would arrive as the root
      // and be folded back into one plate by the same rule that folded it
      // here. Anywhere else, the accordion is about a view you have left.
      setForceOpenId((open) => (open === id ? open : null));
      drawOverlay(); // clear rings: they describe the view being left

      const base = baseRef.current;
      const off = offscreenRef.current;
      if (zoomFrom && zoomFrom.isDir && base && off) {
        const dpr = window.devicePixelRatio || 1;
        const target = snap(zoomFrom, dpr, 0);
        const frozen = document.createElement("canvas");
        frozen.width = off.width;
        frozen.height = off.height;
        frozen.getContext("2d")!.drawImage(off, 0, 0);
        const start = performance.now();
        const ctx = base.getContext("2d")!;
        const step = () => {
          const t = Math.min(1, (performance.now() - start) / ZOOM_MS);
          const ease = 1 - (1 - t) * (1 - t);
          const sx = target.x * ease;
          const sy = target.y * ease;
          const sw = frozen.width + (target.w - frozen.width) * ease;
          const sh = frozen.height + (target.h - frozen.height) * ease;
          ctx.clearRect(0, 0, base.width, base.height);
          ctx.drawImage(frozen, sx, sy, sw, sh, 0, 0, base.width, base.height);
          if (t < 1) {
            zoomRafRef.current = requestAnimationFrame(step);
          } else {
            zoomRafRef.current = 0;
            blit();
          }
        };
        cancelAnimationFrame(zoomRafRef.current);
        zoomRafRef.current = requestAnimationFrame(step);
      }

      void fetchLayout();
    },
    [blit, drawOverlay, fetchLayout, cancelPending],
  );

  useEffect(() => {
    drillTo(rootId);
  }, [rootId, drillTo]);

  useEffect(() => {
    rootIdRef.current = 0;
    rectsRef.current = [];
    byIdRef.current = new Map();
    platesRef.current = new Set();
    setHasRects(false);
    setCrumbs([]);
    setTooltip(null);
    mouseOverRef.current = null;
    hitFrozenRef.current = false;
    crumbsRootRef.current = null;
    crumbIdsRef.current = new Set();
    offscreenRef.current = null;
    // Ids belong to a tree, and this is a different one. Holding an open
    // folder across scans would open whatever now happens to have that id.
    cancelPending();
    setForceOpenId(null);
    const base = baseRef.current;
    if (base) base.getContext("2d")!.clearRect(0, 0, base.width, base.height);
    if (generation !== 0) void fetchLayout();
  }, [generation, fetchLayout, cancelPending]);

  useEffect(() => cancelPending, [cancelPending]);

  useEffect(() => {
    drawOverlay();
  }, [selected, hoveredId, drawOverlay]);

  useEffect(() => {
    if (revision === 0) return;
    void fetchLayout();
  }, [revision, fetchLayout]);

  useEffect(() => {
    bake(); // repaint the baked layout with the new theme's canvas colors
  }, [themeRev, bake]);

  useEffect(() => {
    void fetchLayout();
  }, [hideSystem, filter, fetchLayout]);

  useEffect(() => {
    // The open folder is a layout input, not a paint-time one: only the
    // backend can decide what a directory hides. Read through the ref inside
    // `fetchLayout`, keyed on the value here — the callback's identity has to
    // stay put, or this cascades into the size effect and double-fetches.
    void fetchLayout();
  }, [forceOpenId, fetchLayout]);

  useEffect(() => {
    // Labels are painted over the baked layout, never into it: toggling them
    // is a repaint of the same rects, not a new query.
    bake();
  }, [labels, bake]);

  const prevStateRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!snapshot || snapshot.generation !== generation) return;
    const prev = prevStateRef.current;
    prevStateRef.current = snapshot.state;
    if (snapshot.state === "scanning") {
      if (performance.now() - lastFetchRef.current >= SCAN_REFRESH_MS) {
        void fetchLayout();
      }
    } else if (prev === "scanning") {
      void fetchLayout();
    }
  }, [snapshot, generation, fetchLayout]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timer = 0;
    const applySize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(container.clientWidth * dpr);
      const h = Math.round(container.clientHeight * dpr);
      for (const c of [baseRef.current, overlayRef.current]) {
        if (c && (c.width !== w || c.height !== h)) {
          c.width = w;
          c.height = h;
        }
      }
      blit();
      void fetchLayout();
    };
    applySize();
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(applySize, 150);
    });
    ro.observe(container);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [blit, fetchLayout]);

  const hitTest = useCallback(
    (cssX: number, cssY: number): TreemapRect | null => {
      if (hitFrozenRef.current) return null;
      const rects = rectsRef.current;
      for (let i = rects.length - 1; i >= 0; i--) {
        const r = rects[i];
        if (
          cssX >= r.x &&
          cssX < r.x + r.w &&
          cssY >= r.y &&
          cssY < r.y + r.h
        ) {
          return r;
        }
      }
      return null;
    },
    [],
  );

  const regionAt = useCallback(
    (cssX: number, cssY: number): TreemapRect | null => {
      if (hitFrozenRef.current) return null;
      for (const r of rectsRef.current) {
        if (
          r.depth === 1 &&
          r.isDir &&
          cssX >= r.x &&
          cssX < r.x + r.w &&
          cssY >= r.y &&
          cssY < r.y + r.h
        ) {
          return r;
        }
      }
      return null;
    },
    [],
  );

  // Also called at mount: the div appears after the debounce with the cursor
  // already at rest, and would otherwise render at (0,0).
  const placeTooltip = useCallback(() => {
    const container = containerRef.current;
    const tip = tooltipRef.current;
    if (!container || !tip) return;
    const bounds = container.getBoundingClientRect();
    const { x, y } = lastMouseRef.current;
    const tx = Math.min(x + 14, bounds.width - 260);
    const ty = Math.min(y + 16, bounds.height - 70);
    tip.style.transform = `translate(${Math.max(0, tx)}px, ${Math.max(0, ty)}px)`;
  }, []);

  useLayoutEffect(() => {
    if (tooltip) placeTooltip();
  }, [tooltip, placeTooltip]);

  const handleMove = useCallback(
    (e: React.MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      const x = e.clientX - bounds.left;
      const y = e.clientY - bounds.top;
      lastMouseRef.current = { x, y };
      placeTooltip();

      const hit = hitTest(x, y);
      const id = hit?.id ?? null;
      if (id === mouseOverRef.current) return;
      mouseOverRef.current = id;
      onHover(id);

      window.clearTimeout(tooltipTimerRef.current);
      tooltipSeqRef.current++;
      if (id === null) {
        setTooltip(null);
        return;
      }
      setTooltip(null);
      const seq = tooltipSeqRef.current;
      tooltipTimerRef.current = window.setTimeout(() => {
        const generation = generationRef.current;
        if (generation === 0 || seq !== tooltipSeqRef.current) return;
        Promise.all([api.getNode(generation, id), api.getPath(generation, id)])
          .then(([node, path]: [Row | null, string]) => {
            if (seq !== tooltipSeqRef.current || !node) return;
            setTooltip({
              name: node.name,
              size: formatBytes(node.size),
              pct: formatPercent(node.pct),
              path,
            });
          })
          .catch(() => {});
      }, TOOLTIP_DELAY_MS);
    },
    [hitTest, onHover, placeTooltip],
  );

  const handleLeave = useCallback(() => {
    mouseOverRef.current = null;
    tooltipSeqRef.current++;
    window.clearTimeout(tooltipTimerRef.current);
    setTooltip(null);
    onHover(null);
  }, [onHover]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const bounds = containerRef.current!.getBoundingClientRect();
      const hit = hitTest(e.clientX - bounds.left, e.clientY - bounds.top);
      if (!hit) return;
      // The folder that is open is the one case a click closes: it has
      // children now, so nothing below would offer to.
      if (hit.id === forceOpenRef.current) {
        arm(hit.id, true);
        return;
      }
      onSelect(hit);
      // A plate has nothing to zoom into without opening first, so the click
      // opens it — unless it turns out to be too small to be worth showing in
      // place, which `fetchLayout` answers by zooming instead.
      if (hit.isDir && platesRef.current.has(hit.id)) {
        arm(hit.id, false);
        return;
      }
      // A directory the layout did choose to subdivide: single click zooms, as
      // it always has.
      if (hit.isDir) onNavigate(hit.id);
    },
    [hitTest, onSelect, onNavigate, arm],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const bounds = containerRef.current!.getBoundingClientRect();
      const cssX = e.clientX - bounds.left;
      const cssY = e.clientY - bounds.top;
      const hit = hitTest(cssX, cssY);
      if (!hit) return;
      onContext(hit.id, e.clientX, e.clientY, {
        inId: regionAt(cssX, cssY)?.id ?? null,
        outId: crumbs.length >= 2 ? crumbs[crumbs.length - 2].id : null,
      });
    },
    [hitTest, regionAt, crumbs, onContext],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const bounds = containerRef.current!.getBoundingClientRect();
      const hit = hitTest(e.clientX - bounds.left, e.clientY - bounds.top);
      if (!hit?.isDir || hit.id === rootIdRef.current) return;
      // Nothing waiting means the first click already acted — it zoomed, or it
      // selected a file — and a second zoom on top of that is not what anyone
      // asked for.
      if (pendingRef.current === null) return;
      cancelPending();
      onNavigate(hit.id);
    },
    [hitTest, onNavigate, cancelPending],
  );

  const zoomOut = useCallback(() => {
    if (crumbs.length < 2 || hitFrozenRef.current) return;
    onNavigate(crumbs[crumbs.length - 2].id);
  }, [crumbs, onNavigate]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.deltaY > 0) {
        zoomOut();
        return;
      }
      const bounds = containerRef.current!.getBoundingClientRect();
      const region = regionAt(e.clientX - bounds.left, e.clientY - bounds.top);
      if (region) onNavigate(region.id);
    },
    [zoomOut, regionAt, onNavigate],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Backspace" || (e.altKey && e.key === "ArrowUp")) {
        e.preventDefault();
        zoomOut();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomOut]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 overflow-hidden border-b border-edge px-3 text-xs">
        {crumbs.length === 0 ? (
          <span className="text-ink-5">Treemap</span>
        ) : (
          crumbs.map((c, i) => (
            <Fragment key={c.id}>
              {i > 0 && <span className="shrink-0 text-ink-5">›</span>}
              <button
                className={`max-w-56 truncate ${
                  i === crumbs.length - 1
                    ? "text-ink"
                    : "text-ink-4 hover:text-ink"
                }`}
                onClick={() => onNavigate(c.id)}
                title={c.name}
              >
                {c.name}
              </button>
            </Fragment>
          ))
        )}
      </div>
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onWheel={handleWheel}
      >
        <canvas ref={baseRef} className="absolute inset-0 h-full w-full" />
        <canvas ref={overlayRef} className="absolute inset-0 h-full w-full" />
        {!hasRects && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-ink-5">
            {generation === 0
              ? "Treemap appears here during a scan"
              : filter
                ? "Nothing here matches the filter — Esc clears it"
                : snapshot?.state === "scanning"
                  ? "Waiting for data…"
                  : "Nothing to show here"}
          </div>
        )}
        {tooltip && (
          <div
            ref={tooltipRef}
            className="pointer-events-none absolute top-0 left-0 z-10 max-w-64 rounded-md border border-edge-strong bg-panel/95 px-2.5 py-1.5 text-xs shadow-lg"
          >
            <div className="truncate font-medium text-ink">{tooltip.name}</div>
            <div className="tnum text-ink-3">
              {tooltip.size} · {tooltip.pct} of parent
            </div>
            <div className="truncate text-[11px] text-ink-4">
              {tooltip.path}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
