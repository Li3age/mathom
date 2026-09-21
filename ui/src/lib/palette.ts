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

/** One colour per `Category`, folder included at index 0. */
export interface BlockColors {
  folder: string;
  byCategory: readonly string[];
}

/** The classic scheme's file colour repeated for every category, cached. */
const flatCache = new Map<string, readonly string[]>();

function flat(file: string): readonly string[] {
  let row = flatCache.get(file);
  if (!row) {
    row = PALETTE.map(() => file);
    flatCache.set(file, row);
  }
  return row;
}

/**
 * What the map paints with, for the mode, accent and theme in force. Classic
 * deliberately returns the same shape as multi — one colour per category —
 * with every category holding the same value, so the painting code does not
 * need to know which mode it is in.
 */
export function blockColors(
  mode: ColorMode,
  accent: AccentName,
  theme: "light" | "dark",
): BlockColors {
  if (mode === "classic") {
    const scheme = CLASSIC[accent]?.[theme] ?? CLASSIC.teal.dark;
    return {
      folder: scheme.folder,
      byCategory: flat(scheme.file),
    };
  }
  return { folder: folderPlate(accent), byCategory: PALETTE };
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
