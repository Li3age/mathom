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
import { activeTheme, type AccentName, type ColorMode } from "../lib/theme";
import {
  api,
  type Crumb,
  type Row,
  type Snapshot,
  type TreemapRect,
} from "../lib/api";
import { EASE } from "../lib/ease";
import { isStale, reportUnlessStale } from "../lib/errors";
import { formatBytes, formatPercent } from "../lib/format";
import {
  type BlockColors,
  blockColor,
  blockColors,
  canvasColors,
  textOn,
} from "../lib/palette";

const SCAN_REFRESH_MS = 400;
const TOOLTIP_DELAY_MS = 120;

/**
 * How long each kind of change takes. One place, because a map whose blocks
 * move at one speed and whose view zooms at another reads as two things
 * happening rather than one. The curves live next to each other in `EASE`.
 */
const MOTION = {
  /** Changing the view root — the camera moving between two layouts. */
  zoom: 300,
  /** A folder opening or closing inside the view. */
  open: 200,
  /** The same map refitted: a resize, a filter, another scan tick. */
  move: 170,
  /** The same map in different colours: another accent, another mode. */
  recolor: 200,
  /** Refits smaller than this are the scan breathing, not the map moving. */
  moveMinPx: 2,
} as const;

/** Names step aside quickly when the map moves, and return unhurriedly. */
const LABEL_FADE_OUT_MS = 80;
const LABEL_FADE_IN_MS = 140;

/** How many view roots back Backspace remembers. */
const BACK_HISTORY_MAX = 64;

/** The system asking for less motion is not a suggestion. */
function reducedMotion(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
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
 * Names, written into the blocks themselves, when the view asks for them. A
 * map of coloured rectangles tells you where the space went; it does not tell
 * you what any of it is without hovering each one, and hovering every block is
 * the work this saves. On by default, because the colours are deliberately
 * quiet and the names are what carry the reading.
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
  colors: BlockColors,
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
    ctx.fillStyle = textOn(blockColor(colors, r.isDir, r.category, r.depth));
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

/** The same rect in device pixels, fractional — the camera's unit. */
function frame(r: TreemapRect, dpr: number): Snapped {
  return { x: r.x * dpr, y: r.y * dpr, w: r.w * dpr, h: r.h * dpr };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function lerpRect(a: Snapped, b: Snapped, t: number): Snapped {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    w: lerp(a.w, b.w, t),
    h: lerp(a.h, b.h, t),
  };
}

/**
 * Where `box` lands when a picture is moved so that its `from` rectangle sits
 * on `to` — the picture's whole frame going along for the ride.
 *
 * This one function is the whole zoom. Two pictures are drawn with it at
 * every frame — the layout being left, mapped `from → u`, and the layout
 * arriving, mapped `to → u` — so at any instant both have the folder being
 * entered or left lying on exactly the same patch of screen. That is what
 * makes the two layers read as one movement instead of two pictures ghosted
 * over each other, and it is why zooming out is not a second animation to
 * write: the same two lines run, with `from` and `to` swapped.
 *
 * Both ends are exact. When `from` and `to` are the same rectangle this is the
 * identity, so at `t = 0` the picture being left is drawn as it stands, and at
 * `t = 1` the one arriving is (its `to` has become `u` itself) — the last frame
 * is the settled map, pixel for pixel, and nothing snaps when the animation
 * ends.
 */
function rectMap(box: Snapped, from: Snapped, to: Snapped): Snapped {
  const sx = to.w / Math.max(1, from.w);
  const sy = to.h / Math.max(1, from.h);
  return {
    x: to.x - from.x * sx,
    y: to.y - from.y * sy,
    w: box.w * sx,
    h: box.h * sy,
  };
}

/**
 * Draw one folder's own patch of `pic` onto itself, scaled about the middle
 * of its frame and clipped to it — the patch, not the whole picture, which
 * would drag the rest of the map in towards this centre along with it.
 */
function scaleAbout(
  ctx: CanvasRenderingContext2D,
  pic: CanvasImageSource,
  box: Snapped,
  k: number,
) {
  if (k <= 0.002) return;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  ctx.translate(-cx, -cy);
  ctx.drawImage(pic, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
  ctx.restore();
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

/** Directories the layout subdivided — the ones showing what is inside. */
function dirsWithChildren(rects: TreemapRect[]): Set<number> {
  const open = new Set<number>();
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (r.isDir && (rects[i + 1]?.depth ?? 0) > r.depth) open.add(r.id);
  }
  return open;
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
  /** Draw each block's name and size inside it. On by default. */
  labels: boolean;
  /** Which colour scheme the map paints in — the same choice as the accent. */
  accent: AccentName;
  /**
   * Multi: a hue per file category. Classic: one colour for files, one for
   * folders, both from the accent.
   */
  mode: ColorMode;
  /**
   * Depth setting: null is Auto, where the layout decides how deep to go.
   * A number is a fixed cap, which is a *different* layout rule, not just a
   * shorter one — see `TreemapOptions::adaptive_depth`.
   */
  maxDepth: number | null;
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
  accent,
  mode,
  maxDepth,
  selected,
  hoveredId,
  onSelect,
  onHover,
  onNavigate,
  onContext,
}: TreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLCanvasElement>(null);
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
  const wasRef = useRef<HTMLCanvasElement | null>(null);
  const morphRef = useRef(false);
  const morphRafRef = useRef(0);
  const moveRafRef = useRef(0);
  const recolorRafRef = useRef(0);
  /**
   * A view change owns the canvas from the moment it starts fetching until
   * its animation lands. Without this the fetch's own arrival would start a
   * refit animation underneath the zoom — the two loops fight over the
   * canvas, and the refit's last frame (it is the shorter of the two) paints
   * the settled map straight through the middle of the zoom.
   */
  const pendingZoomRef = useRef(false);
  /**
   * The camera the picture on screen is being seen through: the layout rect
   * `from` that the screen rect `u` currently holds. `null` is the camera at
   * rest, where `rectMap` is the identity.
   *
   * A zoom that interrupts another one starts from *this* — where the node it
   * pivots on is being drawn right now — rather than from the layout, which
   * is not what is on screen. Scrolling three notches fast is then three
   * continuous moves, not a snap back to where the first one started.
   */
  const camRef = useRef<{ from: Snapped; u: Snapped } | null>(null);

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
  const maxDepthRef = useRef(maxDepth);
  maxDepthRef.current = maxDepth;
  const accentRef = useRef(accent);
  accentRef.current = accent;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  /**
   * The block colours in force right now — the colour mode the setting asks
   * for, the accent, and the theme the document actually resolved to. Read at
   * paint time rather than passed around, because a bake happens long after
   * the render that asked for it and only the current values matter.
   */
  const colorsNow = useCallback(
    () => blockColors(modeRef.current, accentRef.current, activeTheme()),
    [],
  );

  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [hasRects, setHasRects] = useState(false);
  const [forceOpenId, setForceOpenId] = useState<number | null>(null);
  forceOpenRef.current = forceOpenId;

  /** Where a step back lands: the way in, or the tree's own parent. */
  const backTarget = useCallback(
    () => backRef.current.at(-1) ?? crumbs.at(-2)?.id ?? null,
    [crumbs],
  );

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
      const s = snap(r, dpr, 1);
      const half = width / 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(s.x + half, s.y + half, s.w - width, s.h - width);
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

  /**
   * Names, on a canvas of their own above the blocks and below the rings.
   *
   * Not baked into the picture, because every animation here is a *transform
   * of a picture*: text inside one gets stretched, and a name stretched to
   * three times its size is a smear. On its own layer the map can be thrown
   * around underneath and the names simply step out of the way (a fade, see
   * `fadeLabels`) and back in when it settles — which is also what the system
   * this map is imitating does with its own labels.
   */
  const paintLabels = useCallback(
    (rects: TreemapRect[]) => {
      const label = labelRef.current;
      if (!label || label.width === 0) return;
      const ctx = label.getContext("2d")!;
      ctx.clearRect(0, 0, label.width, label.height);
      if (!labelsRef.current) return;
      drawLabels(ctx, rects, window.devicePixelRatio || 1, colorsNow());
    },
    [colorsNow],
  );

  const fadeLabels = useCallback((to: 0 | 1, ms: number) => {
    const label = labelRef.current;
    if (!label) return;
    const instant = ms === 0 || reducedMotion();
    label.style.transition = instant ? "none" : `opacity ${ms}ms linear`;
    label.style.opacity = String(to);
  }, []);

  /**
   * Paint the layout into the offscreen picture, and the names onto their own
   * layer. `bake` is this plus showing it; the two are separate because a view
   * change has to paint the layout it is arriving at *without* showing it —
   * its frames are the only thing that may touch the canvas from the moment
   * the fetch starts, or the settled map flashes through the middle of the
   * zoom.
   */
  const render = useCallback(
    (drawn: TreemapRect[] = rectsRef.current, withLabels = true) => {
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
      const rects = drawn;
      const theme = canvasColors();

      // The map's own surface, behind every block: a folder that subdivided is
      // only the backdrop for what it contains, so it is not painted at all —
      // this is what shows through where it would have been, and through the
      // gaps between blocks. Its own colour, not the window's: the map is a
      // surface with blocks on it, and it keeps that colour in both themes.
      ctx.fillStyle = theme.plate;
      ctx.fillRect(0, 0, off.width, off.height);

      // Folders are drawn exactly like files — one flat colour, a 1px gap, the
      // same light over the top — and differ only in the colour. Anything more
      // than that (a texture, a seam, a reserved strip) makes a folder read as
      // a surface rather than as a block, which is what a plate full of small
      // files should look like.
      const colors = colorsNow();
      const plates = solidPlates(rects);
      // Bucketed by the colour each block actually wears, rather than by
      // category: the colour mode decides what a block's colour is, and the
      // level ramp means two folders can be two shades of it. Grouping by the
      // colour itself keeps this loop and the one fill per group the same in
      // every mode, and the blocks do not overlap, so the order is free.
      const buckets = new Map<string, TreemapRect[]>();
      for (const r of rects) {
        if (r.isDir && !plates.has(r.id)) continue; // subdivided: covered by its children
        const colour = blockColor(colors, r.isDir, r.category, r.depth);
        const bucket = buckets.get(colour);
        if (bucket) bucket.push(r);
        else buckets.set(colour, [r]);
      }
      for (const [colour, bucket] of buckets) {
        ctx.fillStyle = colour;
        ctx.beginPath();
        for (const r of bucket) {
          const s = snap(r, dpr, 1);
          if (s.w > 0 && s.h > 0) ctx.rect(s.x, s.y, s.w, s.h);
        }
        ctx.fill();
      }

      if (withLabels) paintLabels(rects);
    },
    [colorsNow, paintLabels],
  );

  const bake = useCallback(
    (drawn: TreemapRect[] = rectsRef.current, withLabels = true) => {
      render(drawn, withLabels);
      // A zoom or a recolour in flight is drawing its own frames onto the same
      // canvas, and this would land on top of one of them.
      if (zoomRafRef.current === 0 && recolorRafRef.current === 0) blit();
    },
    [render, blit],
  );

  /**
   * The same map in different colours — another accent, another colour mode,
   * another theme.
   *
   * Nothing about the geometry changes, which makes this the one change a
   * dissolve is exactly right for: the picture going out and the picture
   * coming in are identical to the pixel apart from the colour, so there is
   * nothing to ghost and no shape to move. Cross-fading is what a dissolve
   * does *badly* when the two frames are different layouts — that is a
   * flicker — and perfectly when they are the same one.
   *
   * If something else is already animating, this only repaints: that
   * animation is drawing the canvas, it is drawing the *old* colours out of
   * its own frozen picture, and it will land on the new ones — which is the
   * right answer and one nobody has to wait for.
   */
  const recolour = useCallback(() => {
    const base = baseRef.current;
    const off = offscreenRef.current;
    const busy =
      zoomRafRef.current !== 0 ||
      morphRafRef.current !== 0 ||
      moveRafRef.current !== 0;
    if (busy || !base || !off || off.width === 0 || reducedMotion()) {
      render();
      if (!busy) blit();
      return;
    }
    let was = wasRef.current;
    if (!was) {
      was = document.createElement("canvas");
      wasRef.current = was;
    }
    was.width = off.width;
    was.height = off.height;
    was.getContext("2d")!.drawImage(base, 0, 0);
    render();
    const start = performance.now();
    const ctx = base.getContext("2d")!;
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / MOTION.recolor);
      const e = EASE.move(t);
      ctx.globalAlpha = 1;
      ctx.drawImage(off, 0, 0);
      ctx.globalAlpha = 1 - e;
      ctx.drawImage(was!, 0, 0);
      ctx.globalAlpha = 1;
      if (t < 1) {
        recolorRafRef.current = requestAnimationFrame(step);
      } else {
        recolorRafRef.current = 0;
        blit();
        fadeLabels(1, LABEL_FADE_IN_MS);
        drawOverlay();
      }
    };
    fadeLabels(0, LABEL_FADE_OUT_MS);
    cancelAnimationFrame(recolorRafRef.current);
    recolorRafRef.current = requestAnimationFrame(step);
  }, [blit, drawOverlay, fadeLabels, render]);

  /**
   * A folder opening or closing inside the view: the folder that was clicked
   * keeps its frame, and what is inside it grows out of that frame's centre —
   * or shrinks back into it.
   *
   * This is the one animation that fits the change. Opening a folder adds
   * rects *inside* the one that was clicked and moves nothing else, so there
   * is no travel to show between the old layout and the new — and the two
   * obvious alternatives both look wrong. Moving each child out of the plate's
   * centre stacks three hundred blocks on one point until the middle goes
   * white (the reason the blocks no longer carry a stretched sheen, which is
   * what turned that into a flashbulb); cross-fading the two pictures leaves
   * two different layouts ghosted over each other, which is a flicker rather
   * than a transition, because consecutive frames share no motion.
   *
   * Scaling the plate's contents out of its own centre is one continuous
   * transform: every frame is the last one, slightly larger, and nothing
   * overlaps anything it did not already overlap. It is also the same visual
   * language as the zoom, which is the animation this one sits next to.
   *
   * Both lists run in the same pass. Only one directory can be open at a time
   * — opening a second closes the first — and a close that waits for the open
   * to finish, or worse happens as a cut when the frames stop, is the change
   * happening twice. Which folder is which comes from the two layouts, not
   * from what the click said: a folder that showed children a moment ago and
   * does not now is closing, whatever the reason.
   *
   * The old picture is the canvas as it stands, so this has to run before the
   * new one is baked over it.
   *
   * Names are *not* faded out for this one, unlike a zoom. Nothing on the label
   * layer is being transformed — the two frames here differ only inside the
   * folder's own frame, and the names that are neither inside the one opening
   * nor inside the one closing are identical before and after — so fading them
   * would blink the whole map's text for a change that touched two folders.
   * They are repainted for the layout arriving, which is what the map is about
   * to become.
   */
  const morph = useCallback(
    (to: TreemapRect[], opens: number[], closes: number[]) => {
      const base = baseRef.current;
      const off = offscreenRef.current;
      const dpr = window.devicePixelRatio || 1;
      // The frames to open out of and close into are the folders' own, looked
      // up in the layout just received: opening leaves the folder's rect in
      // place (its children go inside it) and closing puts the plate back, so
      // they are there either way, and they are the frames they always had.
      const framesOf = (ids: number[]) =>
        ids
          .map((id) => byIdRef.current.get(id))
          .filter((r): r is TreemapRect => r !== undefined)
          .map((r) => frame(r, dpr));
      const opening = framesOf(opens);
      const closing = framesOf(closes);
      if (
        !base ||
        !off ||
        off.width === 0 ||
        (opening.length === 0 && closing.length === 0) ||
        reducedMotion()
      ) {
        bake(to);
        return;
      }
      let was = wasRef.current;
      if (!was) {
        was = document.createElement("canvas");
        wasRef.current = was;
      }
      was.width = off.width;
      was.height = off.height;
      was.getContext("2d")!.drawImage(off, 0, 0);

      bake(to);
      const start = performance.now();
      const ctx = base.getContext("2d")!;
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / MOTION.open);
        const e = EASE.open(t);
        ctx.clearRect(0, 0, base.width, base.height);
        ctx.drawImage(was!, 0, 0);
        // Closing first, so that what is opening wins where the two overlap
        // (a folder can close around one that opens only if the layout closed
        // it too, which it does not — the open chain keeps its ancestors —
        // but the order costs nothing and the alternative is a surprise).
        for (const b of closing) {
          // Put back what stands there now — the plate, with the name on it
          // again — and shrink the old contents away towards the middle of it.
          ctx.drawImage(off, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
          scaleAbout(ctx, was!, b, 1 - e);
        }
        for (const b of opening) scaleAbout(ctx, off, b, e);
        if (t < 1) {
          morphRafRef.current = requestAnimationFrame(step);
        } else {
          morphRafRef.current = 0;
          blit();
          hitFrozenRef.current = false;
          drawOverlay();
        }
      };
      hitFrozenRef.current = true;
      cancelAnimationFrame(morphRafRef.current);
      morphRafRef.current = requestAnimationFrame(step);
    },
    [bake, blit, drawOverlay],
  );

  /**
   * The same map, refitted: a resize, a filter, another scan tick. Every block
   * that was already there keeps its identity and slides to its new frame.
   *
   * Blocks that only exist in the new layout do *not* animate in — they appear
   * where they belong. Growing a few hundred of them out of one rect stacks
   * them all on the same spot, and stacked blocks are what turned this into a
   * flashbulb the first time it was tried; the flare was never about the
   * animation being absent.
   *
   * Hit testing follows the frames as drawn: `rectsRef` is what the map is
   * showing, so a click during a refit lands on the block under the cursor
   * rather than on where that block is going. That also means the next change
   * reads its starting point off the current frame, which is what keeps two
   * changes in a row from snapping back.
   */
  const moveTo = useCallback(
    (from: TreemapRect[], to: TreemapRect[]) => {
      const prev = new Map(from.map((r) => [r.id, r]));
      const start = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / MOTION.move);
        const ease = EASE.move(t);
        const drawn = to.map((r) => {
          const was = prev.get(r.id);
          if (!was) return r;
          return {
            ...r,
            x: was.x + (r.x - was.x) * ease,
            y: was.y + (r.y - was.y) * ease,
            w: was.w + (r.w - was.w) * ease,
            h: was.h + (r.h - was.h) * ease,
          };
        });
        rectsRef.current = drawn;
        // Labels ride along here — a block sliding is a block sliding, and
        // its name should stay on it. They are only taken off for the two
        // changes that transform the picture itself, where a name would be
        // stretched with it.
        bake(drawn, true);
        if (t < 1) {
          moveRafRef.current = requestAnimationFrame(step);
        } else {
          moveRafRef.current = 0;
          rectsRef.current = to;
          bake();
          drawOverlay();
        }
      };
      moveRafRef.current = requestAnimationFrame(step);
    },
    [bake, drawOverlay],
  );

  /** Did anything move enough to be worth showing? */
  function moved(a: TreemapRect[], b: TreemapRect[]): boolean {
    const prev = new Map(a.map((r) => [r.id, r]));
    for (const r of b) {
      const was = prev.get(r.id);
      if (!was) return true;
      if (
        Math.abs(was.x - r.x) > MOTION.moveMinPx ||
        Math.abs(was.y - r.y) > MOTION.moveMinPx ||
        Math.abs(was.w - r.w) > MOTION.moveMinPx ||
        Math.abs(was.h - r.h) > MOTION.moveMinPx
      ) {
        return true;
      }
    }
    return false;
  }

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
        maxDepthRef.current,
      );
      if (seq !== fetchSeqRef.current || forRoot !== rootIdRef.current) {
        morphRef.current = false;
        return;
      }
      const was = rectsRef.current;
      byIdRef.current = new Map(rects.map((r) => [r.id, r]));
      platesRef.current = solidPlates(rects);
      setHasRects(rects.length > 0);
      cancelAnimationFrame(moveRafRef.current);
      moveRafRef.current = 0;
      const animating = !reducedMotion() && was.length > 0;
      if (pendingZoomRef.current) {
        // A view change is in flight and owns the canvas from here; it reads
        // the layout off the refs itself. Starting a refit underneath it puts
        // two animations on one canvas, and the refit is the shorter of the
        // two — its last frame paints the settled map through the middle of
        // the zoom.
        rectsRef.current = rects;
      } else if (morphRef.current) {
        morphRef.current = false;
        rectsRef.current = rects;
        // Which folders are opening and which are closing is read off the two
        // layouts rather than off what the click asked for: a second click
        // both opens one folder and closes another, and the close has to run
        // in the same pass as the open.
        const before = dirsWithChildren(was);
        const after = dirsWithChildren(rects);
        morph(
          rects,
          [...after].filter((id) => !before.has(id)),
          [...before].filter((id) => !after.has(id)),
        );
      } else if (animating && moved(was, rects)) {
        moveTo(was, rects);
      } else {
        rectsRef.current = rects;
        hitFrozenRef.current = false;
        bake();
      }
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
  }, [bake, refreshCrumbs, onNavigate, morph, moveTo]);

  /**
   * What the last click did, for the double click to read. There is no timer
   * any more: a click on a plate opens it right away, and the *second* click
   * of a double click zooms instead of waiting to find out. Waiting was worse
   * than either — the open felt slow, and the zoom that followed had a pause
   * in front of it that read as nothing having happened.
   */
  const lastClickRef = useRef<number | null>(null);
  /**
   * The view roots the user has been at, most recent last. Backspace and the
   * wheel walk back down it, because "where I was" is not the same thing as
   * the breadcrumb's parent: a plate in the root view can be four levels deep,
   * and coming back out of it should land in the root view, not in that
   * folder's parent. The breadcrumb stays the tree's own path — clicking it is
   * a move like any other, and it goes on the history too.
   */
  const backRef = useRef<number[]>([]);
  /**
   * The root a step back is on its way to. Held as the destination rather than
   * as a flag so that it cannot go stale: the effect below only skips the push
   * when the root it is reacting to is exactly this one.
   */
  const backJumpRef = useRef<number | null>(null);

  /** Open (or close) the folder the click landed on, right away. */
  const setOpen = useCallback((id: number | null) => {
    lastClickRef.current = id;
    setForceOpenId(id);
  }, []);

  /**
   * Change the view root, showing the move.
   *
   * One camera, two pictures. The pivot is the node both layouts have in
   * common — the folder being entered (it is drawn in the layout being left)
   * or the folder being left (it is drawn in the layout arriving) — and it
   * occupies `from` in one and `to` in the other. Every frame draws both
   * layouts through the same camera, placed so that the pivot's patch of each
   * covers the *same* screen rectangle: both are put where the two layouts
   * agree. They cross-dissolve across it.
   *
   * Zooming out is not a second animation. It is these same two lines with
   * `from` and `to` swapped — which is what was wrong before: there was one
   * drawing (magnify towards the pivot's frame) and it ran in both directions,
   * so going out magnified its way into a corner and then cut to the map.
   *
   * The picture frozen is the canvas as it stands rather than the last settled
   * bake, so a second notch of the wheel continues from the frame on screen
   * instead of snapping back to where the first one started. Where that frame
   * is seen from is `camRef`, and a gesture that interrupts one still running
   * asks it where the pivot is *now*, not where the layout says it is.
   */
  const drillTo = useCallback(
    async (id: number) => {
      if (id === rootIdRef.current) return;
      const leaving = rootIdRef.current;
      const dpr = window.devicePixelRatio || 1;
      const base = baseRef.current;
      const prevCam = camRef.current;
      const into = byIdRef.current.get(id);
      /** Where a rect of the layout being left is on screen right now. */
      const onScreen = (f: Snapped) =>
        prevCam ? rectMap(f, prevCam.from, prevCam.u) : f;
      let frozen: HTMLCanvasElement | null = null;
      if (base && base.width > 0) {
        frozen = document.createElement("canvas");
        frozen.width = base.width;
        frozen.height = base.height;
        frozen.getContext("2d")!.drawImage(base, 0, 0);
      }
      rootIdRef.current = id;
      cancelAnimationFrame(morphRafRef.current);
      cancelAnimationFrame(zoomRafRef.current);
      morphRafRef.current = 0;
      zoomRafRef.current = 0;
      morphRef.current = false;
      pendingZoomRef.current = true;
      hitFrozenRef.current = true;
      setTooltip(null);
      mouseOverRef.current = null;
      // The open folder follows the view only into itself. Zooming into it
      // should show what is inside — without this it would arrive as the root
      // and be folded back into one plate by the same rule that folded it
      // here. Anywhere else, the accordion is about a view you have left.
      setForceOpenId((open) => (open === id ? open : null));
      drawOverlay(); // clear rings: they describe the view being left
      fadeLabels(0, LABEL_FADE_OUT_MS);

      await fetchLayout();
      // Superseded by a later view change, which owns the flags from here.
      if (rootIdRef.current !== id) return;
      pendingZoomRef.current = false;
      // The fetch only recorded the layout; paint it, but do not show it yet.
      // It arrives as the second of the two pictures below.
      render();

      const off = offscreenRef.current;
      const view: Snapped = {
        x: 0,
        y: 0,
        w: base?.width ?? 0,
        h: base?.height ?? 0,
      };
      // Coming in, the pivot is the folder being entered and it lands filling
      // the view; going out, it is the one being left, and it is where it
      // lands in the layout arriving. Either way the two layouts are the only
      // things it has to be read from, and the second one is only here now.
      const landing = byIdRef.current.get(into ? id : leaving);
      const pivotNew = into ? view : landing ? frame(landing, dpr) : view;
      // Going out, the pivot is the folder being left, and in the layout being
      // left that folder *is* the viewport. Both ends therefore go through the
      // same question — where is this rect on screen right now — which is what
      // makes a gesture that interrupts one still running carry on from the
      // frame on screen rather than from a layout it is no longer showing.
      const pivotOld = onScreen(into ? frame(into, dpr) : view);
      if (
        !view.w ||
        !frozen ||
        !off ||
        !pivotOld.w ||
        !pivotOld.h ||
        !pivotNew.w ||
        !pivotNew.h ||
        reducedMotion()
      ) {
        bake();
        hitFrozenRef.current = false;
        fadeLabels(1, LABEL_FADE_IN_MS);
        drawOverlay();
        return;
      }
      const was = frozen;
      const start = performance.now();
      const ctx = base!.getContext("2d")!;
      const paint = (pic: CanvasImageSource, box: Snapped, alpha: number) => {
        if (alpha <= 0.002) return;
        ctx.globalAlpha = alpha;
        ctx.drawImage(pic, box.x, box.y, box.w, box.h);
        ctx.globalAlpha = 1;
      };
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / MOTION.zoom);
        const e = EASE.zoom(t);
        const u = lerpRect(pivotOld, pivotNew, e);
        const oldBox = rectMap(view, pivotOld, u);
        const newBox = rectMap(view, pivotNew, u);
        camRef.current = { from: pivotNew, u };
        ctx.clearRect(0, 0, base!.width, base!.height);
        // Whichever picture owns the smaller frame goes on top and fades
        // across the other. That is the whole of the difference between going
        // in and coming out: entering, the new picture is the small one and
        // grows; leaving, the old one is, and shrinks away under it.
        if (oldBox.w * oldBox.h < newBox.w * newBox.h) {
          paint(off, newBox, 1);
          paint(was, oldBox, 1 - e);
        } else {
          paint(was, oldBox, 1);
          paint(off, newBox, e);
        }
        if (t < 1) {
          zoomRafRef.current = requestAnimationFrame(step);
        } else {
          zoomRafRef.current = 0;
          camRef.current = null;
          blit();
          hitFrozenRef.current = false;
          fadeLabels(1, LABEL_FADE_IN_MS);
          drawOverlay();
        }
      };
      zoomRafRef.current = requestAnimationFrame(step);
    },
    [bake, blit, drawOverlay, fetchLayout, fadeLabels, render],
  );

  useEffect(() => {
    // Every way of changing the view comes through here, so this is where the
    // way back is kept. Going back is not one of them: it is the history
    // being walked, and pushing it again would make Backspace bounce between
    // two folders instead of retracing the way in.
    const prev = rootIdRef.current;
    if (backJumpRef.current !== rootId && rootId !== prev) {
      backRef.current.push(prev);
      if (backRef.current.length > BACK_HISTORY_MAX) backRef.current.shift();
    }
    backJumpRef.current = null;
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
    backRef.current = [];
    backJumpRef.current = null;
    pendingZoomRef.current = false;
    camRef.current = null;
    // Ids belong to a tree, and this is a different one. Holding an open
    // folder across scans would open whatever now happens to have that id.
    setForceOpenId(null);
    const base = baseRef.current;
    if (base) base.getContext("2d")!.clearRect(0, 0, base.width, base.height);
    if (generation !== 0) void fetchLayout();
  }, [generation, fetchLayout]);

  useEffect(() => {
    drawOverlay();
  }, [selected, hoveredId, drawOverlay]);

  useEffect(() => {
    if (revision === 0) return;
    void fetchLayout();
  }, [revision, fetchLayout]);

  useEffect(() => {
    // A new theme, accent or colour mode: the same layout, painted again.
    recolour();
  }, [themeRev, recolour]);

  useEffect(() => {
    void fetchLayout();
  }, [hideSystem, filter, fetchLayout]);

  useEffect(() => {
    // The open folder is a layout input, not a paint-time one: only the
    // backend can decide what a directory hides. Read through the ref inside
    // `fetchLayout`, keyed on the value here — the callback's identity has to
    // stay put, or this cascades into the size effect and double-fetches.
    //
    // Opening is the one change worth showing as a movement: the plate the
    // user clicked becomes what was inside it, so the two layouts are the same
    // blocks at different sizes, and a straight cut makes that look like a
    // different picture rather than the same one opening.
    //
    // Nothing else gets one. A scan tick, a resize or a filter change is the
    // map being redrawn rather than the map moving, and animating those would
    // leave the picture permanently in motion.
    morphRef.current = true;
    void fetchLayout();
  }, [forceOpenId, fetchLayout]);

  useEffect(() => {
    // Same for the depth: it picks which rule the layout follows.
    // Opening a plate is a request to override the legibility rules, and a
    // cap is a request that they not apply at all — so an open folder has
    // nothing left to say under one. Drop it rather than leave the state
    // meaning something the map is not doing.
    setForceOpenId(null);
    void fetchLayout();
  }, [maxDepth, fetchLayout]);

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
      for (const c of [baseRef.current, labelRef.current, overlayRef.current]) {
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

  /**
   * The folder under a point: the deepest directory rect containing it, at any
   * depth. `hitTest` alone will not do — it answers with whatever is smallest
   * there, which is usually a file — so this walks the list for the deepest
   * *directory* instead.
   *
   * Unlike `hitTest` this keeps answering while a zoom is running, against the
   * layout it is arriving at. Clicking into a moving picture is a misclick;
   * asking the wheel for another notch is not — it is one gesture, and the
   * next notch should carry on from where this one has got to.
   */
  const dirAt = useCallback(
    (cssX: number, cssY: number): TreemapRect | null => {
      let best: TreemapRect | null = null;
      for (const r of rectsRef.current) {
        if (!r.isDir) continue;
        if (
          cssX < r.x ||
          cssX >= r.x + r.w ||
          cssY < r.y ||
          cssY >= r.y + r.h
        ) {
          continue;
        }
        if (!best || r.depth > best.depth) best = r;
      }
      return best;
    },
    [],
  );
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
      lastClickRef.current = null;
      // The folder that is open is the one case a click closes: it has
      // children now, so nothing below would offer to.
      if (hit.id === forceOpenRef.current) {
        setOpen(null);
        return;
      }
      onSelect(hit);
      // A plate has nothing to zoom into without opening first, so the click
      // opens it — unless it turns out to be too small to be worth showing in
      // place, which `fetchLayout` answers by zooming instead.
      if (
        hit.isDir &&
        maxDepthRef.current === null &&
        platesRef.current.has(hit.id)
      ) {
        setOpen(hit.id);
        return;
      }
      // A directory the layout did choose to subdivide: single click zooms, as
      // it always has.
      if (hit.isDir) onNavigate(hit.id);
    },
    [hitTest, onSelect, onNavigate, setOpen],
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
        inId: dirAt(cssX, cssY)?.id ?? null,
        outId: backTarget(),
      });
    },
    [hitTest, dirAt, backTarget, onContext],
  );

  const handleDoubleClick = useCallback(() => {
    // The double click zooms the folder the *first* click opened. Not the rect
    // under the cursor: by the time the second click lands, the layout has
    // been replaced by what that folder held, so the cursor is over one of its
    // children — or over nothing, since the frames of the opening animation
    // are not a layout anyone can point at.
    const opened = lastClickRef.current;
    if (opened === null || opened === rootIdRef.current) return;
    onNavigate(opened);
  }, [onNavigate]);

  const zoomOut = useCallback(() => {
    const target = backTarget();
    if (target === null || target === rootIdRef.current) return;
    // Retracing the way in rather than moving somewhere new, so this step
    // must not push the place it is leaving.
    if (backRef.current.at(-1) === target) backRef.current.pop();
    backJumpRef.current = target;
    onNavigate(target);
  }, [backTarget, onNavigate]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.deltaY > 0) {
        zoomOut();
        return;
      }
      const bounds = containerRef.current!.getBoundingClientRect();
      const region = dirAt(e.clientX - bounds.left, e.clientY - bounds.top);
      if (region) onNavigate(region.id);
    },
    [zoomOut, dirAt, onNavigate],
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
        {/* Names live on their own layer so the map can be transformed
            underneath them: text inside a picture being scaled is a smear. */}
        <canvas ref={labelRef} className="absolute inset-0 h-full w-full" />
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
