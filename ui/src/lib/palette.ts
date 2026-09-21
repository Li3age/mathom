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
 * The classic scheme: one colour for files, one for folders, ten of them —
 * five accents, each tuned for the theme it will be seen in.
 *
 * The folder colour is the map's tone, so it is the accent's own hue at the
 * weight the map already uses for its plates. The file colour is that *same
 * hue, lighter*: the map then has one colour in two weights, and the weights
 * are the only thing it needs to say — a dark block still has something inside
 * it, a light one is the end of the branch. Two unrelated hues, which is what
 * the eleven-category palette amounts to, say nothing at a glance; this says
 * one thing instantly.
 *
 * The light theme is not the dark theme's values reused. A colour sits
 * differently on a pale plate than on a dark one — the same teal that reads as
 * a solid surface on near-black goes chalky on #d8d9dc — so each scheme is
 * deepened and given a little more chroma for the light theme. The hue is the
 * one thing that does not move, so a scheme is recognisably the same scheme in
 * either theme.
 *
 * Values are OKLCH: dark folder L 0.525 C 0.038, dark file L 0.725 C 0.058,
 * light folder L 0.470 C 0.055, light file L 0.630 C 0.070.
 */
export interface Scheme {
  folder: string;
  file: string;
}

export const CLASSIC: Record<AccentName, { dark: Scheme; light: Scheme }> = {
  teal: {
    dark: { folder: "#507271", file: "#7bb2b1" },
    light: { folder: "#326564", file: "#529795" },
  },
  blue: {
    dark: { folder: "#5c6c80", file: "#8da9cb" },
    light: { folder: "#455d79", file: "#6c8cb3" },
  },
  violet: {
    dark: { folder: "#6d667d", file: "#ab9fc6" },
    light: { folder: "#5f5476", file: "#8f80ae" },
  },
  rose: {
    dark: { folder: "#7f625f", file: "#c89994" },
    light: { folder: "#774f4b", file: "#b07974" },
  },
  green: {
    dark: { folder: "#5d705d", file: "#90b090" },
    light: { folder: "#476348", file: "#6f956f" },
  },
};

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
export function blockColors(
  mode: ColorMode,
  accent: AccentName,
  theme: "light" | "dark",
): BlockColors {
  if (mode === "classic") {
    const scheme = CLASSIC[accent]?.[theme] ?? CLASSIC.teal.dark;
    const files = ramp(scheme.file);
    return {
      folder: ramp(scheme.folder),
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

/**
 * The light that falls on the top of a block. One value, drawn as a short
 * fade down from the top edge — a surface catching the light, the way every
 * raised panel in the OS this imitates does it. It replaced a 1px bevel: two
 * hairlines read as a technical drawing, one soft edge reads as a solid.
 */
export const GLOSS_LIGHT = "rgba(255, 255, 255, 0.10)";

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
