import type { AccentName } from "./theme";

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

/** The highlight and shadow of a block's 1px bevel. */
export const BEVEL_LIGHT = "rgba(255, 255, 255, 0.10)";
export const BEVEL_DARK = "rgba(0, 0, 0, 0.22)";

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
 * The threshold is low because the palette's blocks are: every category sits
 * near 0.34 luminance, where dark ink reads at about 4.8:1 and white at 2.6:1.
 * Only the folder plates, half that again, take white.
 */
export function textOn(fill: string): string {
  const [r, g, b] = rgb(fill);
  return luminance(r, g, b) > 0.25
    ? "rgba(12, 12, 14, 0.92)"
    : "rgba(250, 250, 250, 0.92)";
}
