import { createContext, useContext, useEffect, useState } from "react";
import { THEMES, AppTheme, DEFAULT_THEME_ID, getTheme } from "@/lib/themes";

const STORAGE_KEY = "swiftdata-theme";

interface ThemeContextValue {
  theme: AppTheme;
  setThemeId: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: THEMES[0],
  setThemeId: () => {},
});

export const useAppTheme = () => useContext(ThemeContext);

function applyTheme(theme: AppTheme) {
  const root = document.documentElement;

  // Primary color
  root.style.setProperty("--primary", theme.primary);
  root.style.setProperty("--ring", theme.primary);
  root.style.setProperty("--accent", theme.primary);

  // Dark theme base vars
  if (!theme.isLight) {
    root.style.setProperty("--background", "240 15% 6%");
    root.style.setProperty("--foreground", "0 0% 95%");
    root.style.setProperty("--card", "240 12% 10%");
    root.style.setProperty("--card-foreground", "0 0% 95%");
    root.style.setProperty("--popover", "240 12% 10%");
    root.style.setProperty("--popover-foreground", "0 0% 95%");
    root.style.setProperty("--secondary", "240 10% 15%");
    root.style.setProperty("--secondary-foreground", "0 0% 90%");
    root.style.setProperty("--muted", "240 10% 14%");
    root.style.setProperty("--muted-foreground", "240 5% 62%");
    root.style.setProperty("--border", "240 10% 18%");
    root.style.setProperty("--input", "240 10% 18%");
  } else {
    // Restore light defaults
    root.style.setProperty("--background", "0 0% 100%");
    root.style.setProperty("--foreground", "0 0% 0%");
    root.style.setProperty("--card", "0 0% 100%");
    root.style.setProperty("--card-foreground", "0 0% 0%");
    root.style.setProperty("--popover", "0 0% 100%");
    root.style.setProperty("--popover-foreground", "0 0% 0%");
    root.style.setProperty("--secondary", "40 20% 94%");
    root.style.setProperty("--secondary-foreground", "0 0% 0%");
    root.style.setProperty("--muted", "40 15% 93%");
    root.style.setProperty("--muted-foreground", "0 0% 0%");
    root.style.setProperty("--border", "40 15% 85%");
    root.style.setProperty("--input", "40 15% 85%");
  }

  // Glass RGB vars for CSS
  root.style.setProperty("--glass-rgb", theme.glassRgb);
  root.style.setProperty("--glass-border-rgb", theme.glassBorder);
  root.style.setProperty("--hero-hex", theme.heroHex);

  // Body gradient
  document.body.style.backgroundImage = theme.bodyGradient === "none" ? "" : theme.bodyGradient;
  document.body.style.backgroundAttachment = theme.bodyGradient === "none" ? "" : "fixed";
  document.body.style.minHeight = "100vh";

  // Glass mode attribute
  root.setAttribute("data-glass", theme.isLight ? "0" : "1");
  root.setAttribute("data-theme", theme.id);
}

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [themeId, setThemeIdState] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME_ID; } catch { return DEFAULT_THEME_ID; }
  });

  const theme = getTheme(themeId);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setThemeId = (id: string) => {
    setThemeIdState(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
  };

  return (
    <ThemeContext.Provider value={{ theme, setThemeId }}>
      {children}
    </ThemeContext.Provider>
  );
};
