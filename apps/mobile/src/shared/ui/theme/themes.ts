import { catalogThemes } from "./catalog.generated.ts";

/**
 * Темы приложения: «Зефирка» (UI-OWN-048, решение владельца 2026-10-19 — тема по умолчанию) и каталог нормативного
 * пакета (генерируется, вручную не меняется). Значения «Зефирки» — из `zefirka-package/tokens.json`.
 */
const zefirka = {
  id: "zefirka",
  name: "Зефирка",
  tone: "light",
  canvas: "#F5F0E8",
  surface: "#FFFFFF",
  raised: "#F5F0E8",
  input: "#F5F0E8",
  border: "#E3DACB",
  text: "#1F1A14",
  secondary: "#6E655A",
  muted: "#9A8F82",
  status: { success: "#2F7D5B", warning: "#B0650E", danger: "#A3261C" },
  charts: ["#7A4210", "#2F7D5B", "#B0650E", "#A3261C"],
  accentDefault: "brand",
  accentSwatches: [{ id: "brand", name: "Карамель", hex: "#7A4210", resolvedOnFill: "#FFFFFF", resolvedInk: "#7A4210", soft: "#F3E6D6" }],
} as const;

export const appThemes = [zefirka, ...catalogThemes] as const;

export const DEFAULT_THEME_ID = zefirka.id;
