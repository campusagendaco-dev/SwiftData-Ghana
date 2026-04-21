export interface AppTheme {
  id: string;
  label: string;
  dot: string;       // CSS color string for the color picker dot
  primary: string;   // HSL values for --primary CSS var (e.g. "48 96% 53%")
  bodyGradient: string; // CSS gradient for body background
  glassRgb: string;  // "r, g, b" for glass card rgba
  glassBorder: string;
  isLight: boolean;  // if true, foreground is dark
  heroHex: string;   // hex color for hero sections
}

export const THEMES: AppTheme[] = [
  {
    id: "amber",
    label: "Amber",
    dot: "#fbbf24",
    primary: "48 96% 53%",
    bodyGradient: "none",
    glassRgb: "255,255,255",
    glassBorder: "255,255,255",
    isLight: true,
    heroHex: "#1a1a2e",
  },
  {
    id: "night",
    label: "Night",
    dot: "#a855f7",
    primary: "270 75% 62%",
    bodyGradient: "radial-gradient(ellipse at 20% 0%, #1a0a2e 0%, #07030f 60%)",
    glassRgb: "20,8,40",
    glassBorder: "168,85,247",
    isLight: false,
    heroHex: "#0d0620",
  },
  {
    id: "ocean",
    label: "Ocean",
    dot: "#06b6d4",
    primary: "185 85% 45%",
    bodyGradient: "radial-gradient(ellipse at 30% 0%, #062a4e 0%, #010d1c 60%)",
    glassRgb: "5,20,50",
    glassBorder: "6,182,212",
    isLight: false,
    heroHex: "#041828",
  },
  {
    id: "forest",
    label: "Forest",
    dot: "#22c55e",
    primary: "142 65% 42%",
    bodyGradient: "radial-gradient(ellipse at 25% 0%, #072a14 0%, #020d06 60%)",
    glassRgb: "5,18,10",
    glassBorder: "34,197,94",
    isLight: false,
    heroHex: "#051a0d",
  },
  {
    id: "crimson",
    label: "Crimson",
    dot: "#f43f5e",
    primary: "350 80% 55%",
    bodyGradient: "radial-gradient(ellipse at 20% 0%, #2a0812 0%, #0f0205 60%)",
    glassRgb: "30,5,12",
    glassBorder: "244,63,94",
    isLight: false,
    heroHex: "#1a0510",
  },
  {
    id: "galaxy",
    label: "Galaxy",
    dot: "#818cf8",
    primary: "238 75% 70%",
    bodyGradient: "radial-gradient(ellipse at 50% 0%, #0d0828 0%, #040210 60%), radial-gradient(circle at 80% 80%, #0a0520 0%, transparent 50%)",
    glassRgb: "10,5,30",
    glassBorder: "129,140,248",
    isLight: false,
    heroHex: "#0a0520",
  },
  {
    id: "sunset",
    label: "Sunset",
    dot: "#f97316",
    primary: "24 90% 55%",
    bodyGradient: "radial-gradient(ellipse at 30% 0%, #2d1002 0%, #0f0500 60%)",
    glassRgb: "25,8,0",
    glassBorder: "249,115,22",
    isLight: false,
    heroHex: "#1c0a00",
  },
  {
    id: "rose",
    label: "Rose",
    dot: "#f472b6",
    primary: "328 80% 65%",
    bodyGradient: "radial-gradient(ellipse at 20% 0%, #2a0520 0%, #0f0208 60%)",
    glassRgb: "25,5,18",
    glassBorder: "244,114,182",
    isLight: false,
    heroHex: "#1a0415",
  },
  {
    id: "light",
    label: "Light",
    dot: "#64748b",
    primary: "48 96% 53%",
    bodyGradient: "none",
    glassRgb: "255,255,255",
    glassBorder: "200,200,200",
    isLight: true,
    heroHex: "#f8fafc",
  },
];

export const DEFAULT_THEME_ID = "amber";

export function getTheme(id: string): AppTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
