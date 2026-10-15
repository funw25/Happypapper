"use client";

import { useEffect, useState } from "react";
import {
  THEME_LABELS,
  THEME_PREFS,
  THEME_STORAGE_KEY,
  applyTheme,
  readStoredTheme,
  type ThemePref,
} from "@/lib/theme";

/**
 * Three-way theme switch (UI-001 to UI-005). The stored preference is the
 * source of truth; "follow system" also reacts to an OS change while the page
 * is open.
 */
export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref | null>(null);

  useEffect(() => {
    setPref(readStoredTheme());
  }, []);

  useEffect(() => {
    if (!pref) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(pref);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [pref]);

  function select(next: ThemePref) {
    setPref(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be blocked; the page still switches for this session.
    }
    applyTheme(next);
  }

  return (
    <div className="hp-theme-switch" role="group" aria-label="主题">
      {THEME_PREFS.map((value) => {
        const active = pref === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            title={value === "system" ? "跟随系统设置自动切换" : `固定为${THEME_LABELS[value]}主题`}
            onClick={() => select(value)}
          >
            {THEME_LABELS[value]}
          </button>
        );
      })}
    </div>
  );
}
