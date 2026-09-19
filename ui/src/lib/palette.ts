// Indexed by mathom-core's `Category as u8`. Index 0 (directories) is
// theme-dependent — canvas code paints plates with canvasColors().plate.
export const PALETTE: readonly string[] = [
  "#30323a", // 0 directory plate (dark fallback; see canvasColors)
  "#a855f7", // 1 video
  "#22c55e", // 2 audio
  "#eab308", // 3 image
  "#f97316", // 4 archive
  "#3b82f6", // 5 document
  "#06b6d4", // 6 code
  "#ec4899", // 7 executable
  "#64748b", // 8 system
  "#84cc16", // 9 data
  "#71717a", // 10 other
];

/** Canvas colors resolved from the active theme's CSS variables. */
export function canvasColors() {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    background: v("--color-app"),
    plate: v("--color-plate"),
    selection: v("--color-ink"),
    hoverRing: v("--color-accent-ink"),
  };
}

/** Levels the plate ramp distinguishes before it stops changing. */
const SHADE_LEVELS = 6;
/** Lightness step per nesting level, in 0..255. Enough to see, not to shout. */
const SHADE_STEP = 8;

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
 * The plate fill for nesting level `level`: one step further from the theme's
 * plate colour for each level in. Depth has to be readable without a texture,
 * because the alternative — a texture that means "something is in here" — has
 * to be explained, while a shade does not. The step follows the theme, so a
 * light plate darkens inward and a dark one lightens.
 */
export function plateShade(plate: string, level: number): string {
  const [r, g, b] = rgb(plate);
  const step = luminance(r, g, b) > 0.4 ? -SHADE_STEP : SHADE_STEP;
  const lift = Math.min(level, SHADE_LEVELS) * step;
  const at = (c: number) => Math.max(0, Math.min(255, Math.round(c + lift)));
  return `rgb(${at(r)}, ${at(g)}, ${at(b)})`;
}

/**
 * Ink or paper for text on `fill`. File blocks keep the fixed category colours
 * whatever the theme, so this picks literal near-black or near-white rather
 * than a theme token — a token would be chosen for the plate, not for the
 * colour actually underneath.
 */
export function textOn(fill: string): string {
  const [r, g, b] = rgb(fill);
  return luminance(r, g, b) > 0.45
    ? "rgba(12, 12, 14, 0.88)"
    : "rgba(250, 250, 250, 0.92)";
}
