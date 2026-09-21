import type { AccentName, ColorMode } from "./theme";

/**
 * The colour of a folder block, per accent — and this is the map's *tone*.
 *
 * Folders cover more of the map than anything else, so the folder colour is
 * the thing to get right first; the file colours are what sits on top of it.
 * They all sit at one Morandi lightness (OKLab 0.525) with one dusting of
 * chroma (0.038), so switching accent changes the hue and nothing else about
 * the map's weight — and the ACCENT control in settings, which already sets
 * the window's accent, now sets this too, because "a colour scheme" is one
 * choice and not two.
 */
export const FOLDER_PLATES: Record<AccentName, string> = {
  teal: "#507271",
  blue: "#5c6c80",
  violet: "#6d667d",
  rose: "#7f625f",
  green: "#5d705d",
};

/** The folder colour a scheme paints with. */
export function folderPlate(accent: AccentName): string {
  return FOLDER_PLATES[accent] ?? FOLDER_PLATES.teal;
}

/**
 * The classic scheme: one colour for files, one for folders.
 *
 * One pair, the same under every accent and in both themes. Five of them was
 * five answers to a question nobody asked — the accent sets the window's
 * accent, and the map has one pair of colours it paints in; a map whose whole
 * palette changed with the accent was five maps to learn instead of one. The
 * accent still decides the folder colour in `multi`, where the file types are
 * the point.
 *
 * Two hues, and they carry different jobs: the *hue* says folder or file, and
 * the *lightness* says how deep in you are. The folder is the warm one, the
 * file the cool one; the folder is the lighter and the file the deeper, the
 * way round a printed map is drawn — the folder is the surface you are looking
 * at, the file is the ink on it.
 *
 * The two are close in lightness — 0.05 apart, and the ramp spans 0.09, so
 * their runs do overlap. That is fine, and it is the whole point of spending
 * two hues on this: folder and file are told apart by hue, which no amount of
 * depth can change, so the lightness axis is free to mean depth alone. A pair
 * sharing one hue would have had to keep the two runs apart instead, which is
 * what made the earlier versions either muddy or heavy.
 */
export interface Scheme {
  folder: string;
  file: string;
}

export const CLASSIC: Scheme = { folder: "#ebbc8d", file: "#8dbceb" };

/**
 * Level contrast: the same colour, a step darker for each level of nesting.
 *
 * This is what makes a two-colour map read as a *structure* rather than as a
 * flat mosaic, and it is the half of SpaceSniffer's default view we were
 * missing — its manual: "Those are the base colors, but they will be darkened
 * to show nesting according to the Level Contrast parameter." Without it, a
 * folder holding three hundred files is three hundred identical rectangles
 * and there is nothing in the map to say how deep in you are.
 *
 * Both colours move by the same amount, so the gap between a folder and a file
 * is exactly the same at every level and the two never read as each other. It
 * saturates: past the third level everything is one shade, because the small
 * blocks at the bottom are where a map is busiest and a ramp that kept going
 * would turn that corner into a gradient rather than a set of blocks.
 */
const LEVEL_STEP = 0.03;
const LEVEL_MAX = 3;

/** A hex colour with its OKLab lightness shifted by `dl`, in place. */
function shiftLightness(hex: string, dl: number): string {
  const [r, g, b] = rgb(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  // OKLab, then back with L moved. Clamped so a step off the end of the range
  // saturates against it instead of wrapping round.
  const L = Math.min(
    1,
    Math.max(0, 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s + dl),
  );
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const l3 = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m3 = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s3 = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const enc = (c: number) => {
    const v = Math.max(0, Math.min(1, c));
    const out = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(out * 255);
  };
  const to = (v: number) => v.toString(16).padStart(2, "0");
  return `#${to(enc(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3))}${to(
    enc(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
  )}${to(enc(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3))}`;
}

/** One base colour as a ramp: the colour itself, then a step per level. */
const ramps = new Map<string, readonly string[]>();

function ramp(base: string): readonly string[] {
  let row = ramps.get(base);
  if (!row) {
    // Level 0 is the colour itself, not a round trip through OKLab and back:
    // the schemes are chosen values and a step of nothing should return them
    // unchanged, to the last bit.
    row = [
      base,
      ...Array.from({ length: LEVEL_MAX }, (_, i) =>
        shiftLightness(base, -LEVEL_STEP * (i + 1)),
      ),
    ];
    ramps.set(base, row);
  }
  return row;
}

/**
 * The shade a block at `depth` wears. Depth is measured from the view root, so
 * a file sitting directly in the folder being looked at is depth 1 and wears
 * the colour as designed; each level further in is a step darker. Ramps
 * saturate, so this never misses.
 */
export function atDepth(colourRamp: readonly string[], depth: number): string {
  return colourRamp[Math.min(Math.max(depth - 1, 0), colourRamp.length - 1)];
}

/** The colours of the map: folders and files, each a ramp by level. */
export interface BlockColors {
  folder: readonly string[];
  /** Indexed by `Category`; `PALETTE`'s index 0 is the folder slot. */
  byCategory: readonly (readonly string[])[];
}

/**
 * What the map paints with, for the mode, accent and theme in force. Classic
 * deliberately returns the same shape as multi — one ramp per category — with
 * every category holding the same colour, so the painting code does not need
 * to know which mode it is in.
 */
export function blockColors(mode: ColorMode, accent: AccentName): BlockColors {
  if (mode === "classic") {
    const files = ramp(CLASSIC.file);
    return {
      folder: ramp(CLASSIC.folder),
      // Every category wears the same ramp — that is what "classic" means.
      byCategory: PALETTE.map(() => files),
    };
  }
  return {
    folder: ramp(folderPlate(accent)),
    byCategory: PALETTE.map((c) => ramp(c)),
  };
}

/** The colour one block wears, for the mode/accent/theme in force. */
export function blockColor(
  colors: BlockColors,
  isDir: boolean,
  category: number,
  depth: number,
): string {
  const ramp = isDir
    ? colors.folder
    : (colors.byCategory[category] ?? colors.byCategory[10]);
  return atDepth(ramp, depth);
}

// Indexed by mathom-core's `Category as u8`.
//
// Morandi: one palette for every scheme, because a category should be the same
// colour whichever accent is chosen — otherwise switching accent moves the
// green you had learned. Eight hues spread round the wheel at one lightness
// (OKLab 0.735) and one dusting of chroma (0.070, where Tailwind's 500s run to
// 0.23). The two neutrals stay neutral: forcing a grey up to that chroma lands
// it on a hue some class already owns.
//
// The chroma is low enough that neighbouring hues are hard to tell apart —
// that is what Morandi is. Size and position carry most of the map's meaning,
// the tooltip and the labels carry the rest, and the labels are on by default.
export const PALETTE: readonly string[] = [
  FOLDER_PLATES.teal, // 0 directory (the scheme overrides this)
  "#c09ac2", // 1 video — mauve
  "#8ab692", // 2 audio — sage
  "#bea676", // 3 image — ochre
  "#d09b88", // 4 archive — terracotta
  "#89add5", // 5 document — dusty blue
  "#72b7b7", // 6 code — dusty teal
  "#d097a3", // 7 executable — dusty rose
  "#a5a9b5", // 8 system — grey
  "#a7af7c", // 9 data — olive
  "#a7a9b0", // 10 other — grey
];

/** Canvas colors resolved from the active theme's CSS variables. */
export function canvasColors() {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    /** The map's surface, behind every block — not the window background. */
    plate: v("--color-plate"),
    selection: v("--color-ink"),
    hoverRing: v("--color-accent-ink"),
  };
}

/** `#rrggbb` or `rgb(...)`. */
function rgb(color: string): [number, number, number] {
  if (color.startsWith("#")) {
    const n = Number.parseInt(color.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const parts = color.match(/\d+/g);
  return parts
    ? [Number(parts[0]), Number(parts[1]), Number(parts[2])]
    : [0, 0, 0];
}

function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Ink or paper for text on `fill`, used by the optional block labels. File
 * blocks keep the fixed category colours whatever the theme, so this picks
 * literal near-black or near-white rather than a theme token — a token would
 * be chosen for the plate, not for the colour actually underneath.
 *
 * The threshold is low because the blocks are: the eleven categories sit near
 * 0.34 luminance, where dark ink reads at about 4.8:1 and white at 2.6:1, and
 * the classic schemes' lighter halves come in lower still. A block only takes
 * white when it is genuinely dark — the folder plates, and nothing else. The
 * mid-tones in between are the reason for the exact number: at 0.25 a light
 * theme's file colour lands a hair either side of it and takes white on the
 * wrong side, where dark ink would have been 1.7:1 better.
 */
export function textOn(fill: string): string {
  const [r, g, b] = rgb(fill);
  return luminance(r, g, b) > 0.18
    ? "rgba(12, 12, 14, 0.92)"
    : "rgba(250, 250, 250, 0.92)";
}
