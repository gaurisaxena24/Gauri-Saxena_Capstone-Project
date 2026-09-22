import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";
export type FontSize = "default" | "large";

const THEME_KEY = "udc.theme";
const FONT_SIZE_KEY = "udc.fontSize";

interface SettingsContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

function readStored<T extends string>(key: string, valid: readonly T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw && (valid as readonly string[]).includes(raw) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStored(THEME_KEY, ["light", "dark"], "light"));
  const [fontSize, setFontSizeState] = useState<FontSize>(() =>
    readStored(FONT_SIZE_KEY, ["default", "large"], "default")
  );

  // Applied to <html> so the setting reaches every page via CSS, not per-component logic.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-font-size", fontSize);
  }, [fontSize]);

  function setTheme(next: Theme) {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // per-viewer convenience only; app still works without persistence
    }
  }

  function setFontSize(next: FontSize) {
    setFontSizeState(next);
    try {
      localStorage.setItem(FONT_SIZE_KEY, next);
    } catch {
      // per-viewer convenience only; app still works without persistence
    }
  }

  return (
    <SettingsContext.Provider value={{ theme, setTheme, fontSize, setFontSize }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
