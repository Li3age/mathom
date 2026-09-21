import { useEffect, useState } from "react";
import {
  type AccentName,
  type ColorMode,
  type ThemePref,
  applyTheme,
  loadAccent,
  loadColorMode,
  loadThemePref,
  resolvedTheme,
  saveThemeSettings,
} from "../lib/theme";

/** Applies + persists theme/accent/mode, follows the OS under "system"; `themeRev` bumps so canvas renderers re-bake. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(loadThemePref);
  const [accent, setAccent] = useState<AccentName>(loadAccent);
  const [mode, setMode] = useState<ColorMode>(loadColorMode);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true,
  );
  const [themeRev, setThemeRev] = useState(0);

  useEffect(() => {
    applyTheme(pref, accent);
    saveThemeSettings(pref, accent, mode);
    setThemeRev((r) => r + 1);
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyTheme(pref, accent);
      setSystemDark(mq.matches);
      setThemeRev((r) => r + 1);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref, accent, mode]);

  return {
    pref,
    setPref,
    accent,
    setAccent,
    mode,
    setMode,
    /** Resolved, for anything that has to pick a colour before it paints. */
    theme: resolvedTheme(pref, systemDark),
    themeRev,
  };
}
