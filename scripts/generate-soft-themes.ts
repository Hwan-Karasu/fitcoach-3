import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { catalogThemes } from "../apps/mobile/src/shared/ui/theme/catalog.generated.ts";

const source = new URL("../docs/ui/themes/fitcoach_themes_v1.json", import.meta.url);
const target = new URL("../apps/mobile/src/shared/ui/theme/soft.generated.ts", import.meta.url);
const raw = await readFile(source, "utf8");
const parsed: unknown = JSON.parse(raw);
function record(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid theme record");
}
function label(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid theme label");
}
function hex(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^#[\da-f]{6}$/iu.test(value)) throw new Error(`Invalid theme HEX: ${String(value)}`);
}
record(parsed);
record(parsed.themes);
const order = parsed.themeOrder;
if (!Array.isArray(order) || order.length !== 6 || new Set(order).size !== 6) throw new Error("Expected six themes");
const themes = order.map((id: unknown) => {
  label(id);
  const theme = (parsed.themes as Record<string, unknown>)[id];
  record(theme);
  label(theme.nameRu);
  if (theme.appearance !== "light" && theme.appearance !== "dark") throw new Error("Invalid appearance");
  record(theme.colors);
  record(theme.accents);
  record(theme.weekPaletteSlots);
  for (const role of ["background", "surface", "surfaceElevated", "surfaceSecondary", "navigation", "textPrimary", "textSecondary", "textMuted", "border", "divider", "iconPrimary", "iconSecondary", "success", "warning", "error", "info"]) hex(theme.colors[role]);
  // Slots are retained as reference only: training week/category colours keep their existing ownership.
  for (const value of Object.values(theme.weekPaletteSlots)) hex(value);
  const accentSwatches = Object.entries(theme.accents).map(([accentId, value]) => {
    record(value);
    label(value.nameRu);
    for (const role of ["base", "onAccent", "pressed", "soft", "onSoft", "focusRing"]) hex(value[role]);
    return { id: accentId, name: value.nameRu, hex: value.base, resolvedOnFill: value.onAccent,
      resolvedInk: value.base, pressed: value.pressed, soft: value.soft, onSoft: value.onSoft, focusRing: value.focusRing };
  });
  if (accentSwatches.length !== 3 || !accentSwatches.some((accent) => accent.id === theme.defaultAccentId)) throw new Error("Invalid accents/default");
  const c = theme.colors;
  return { id, name: theme.nameRu, tone: theme.appearance, canvas: c.background, surface: c.surface,
    raised: c.surfaceElevated, input: c.surfaceSecondary, border: c.border, text: c.textPrimary,
    secondary: c.textSecondary, muted: c.textMuted, navigation: c.navigation, divider: c.divider,
    iconPrimary: c.iconPrimary, iconSecondary: c.iconSecondary,
    status: { success: c.success, warning: c.warning, danger: c.error, info: c.info },
    // Chart series keep the existing four semantic roles, independent from user accent and week slots.
    charts: catalogThemes.find((legacy) => legacy.id === (theme.appearance === "dark" ? "graphite-teal" : "polar-teal"))!.charts,
    accentDefault: theme.defaultAccentId, accentSwatches };
});
const hash = createHash("sha256").update(raw).digest("hex");
const output = `// Generated from docs/ui/themes/fitcoach_themes_v1.json. Do not edit.\n// Source SHA-256: ${hash}\nexport const softThemes = ${JSON.stringify(themes, null, 2)} as const;\n`;
if (process.argv.includes("--check")) {
  if (await readFile(target, "utf8") !== output) throw new Error("Soft theme snapshot is stale");
  console.log("Soft theme snapshot OK: 6 themes / 18 accents");
} else {
  await writeFile(target, output, "utf8");
  console.log("Generated soft themes: 6 themes / 18 accents");
}
