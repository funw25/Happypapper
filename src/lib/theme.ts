/**
 * Theme preference handling (docs/03-requirements.md 3.3).
 *
 * The preference is stored in localStorage, so it survives a refresh without a
 * server round trip, and applies before first paint through the inline script
 * in `src/app/layout.tsx`. This module holds the values shared by that script
 * and the switch control.
 */
export const THEME_STORAGE_KEY = "happypaper-theme";

export const THEME_PREFS = ["light", "dark", "system"] as const;
export type ThemePref = (typeof THEME_PREFS)[number];

export const THEME_LABELS: Record<ThemePref, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

export function isThemePref(value: unknown): value is ThemePref {
  return typeof value === "string" && (THEME_PREFS as readonly string[]).includes(value);
}

/** Resolves a preference to the theme actually painted. */
export function resolveTheme(pref: ThemePref, systemDark: boolean): "light" | "dark" {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}

/**
 * Runs in the browser only. Writes the resolved theme to <html> so CSS tokens
 * switch, and keeps `color-scheme` in sync for native form controls.
 */
export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveTheme(pref, systemDark);
  root.dataset.theme = resolved;
  root.dataset.themePref = pref;
  root.style.colorScheme = resolved;
}

export function readStoredTheme(): ThemePref {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePref(stored) ? stored : "system";
  } catch {
    return "system";
  }
}
