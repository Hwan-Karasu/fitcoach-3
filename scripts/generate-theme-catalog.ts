import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(projectRoot, "..", "FitCoach_3_DOCUMENTS_SYNCED_2026-10-14",
  "05-UI-UX", "theme-catalog.v1.json");
const target = path.resolve(projectRoot, "apps", "mobile", "src", "shared", "ui", "theme", "catalog.generated.ts");
const raw = await readFile(source, "utf8");
const parsed: unknown = JSON.parse(raw);
if (!isRecord(parsed) || parsed.schemaVersion !== 3 || !Array.isArray(parsed.themes) ||
  parsed.themes.length !== 9) {
  throw new Error("Theme catalog schema/size changed; review Product §56 before regeneration.");
}

const themeIds = new Set<string>();
const themes = parsed.themes.map((value: unknown) => {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" ||
    (value.tone !== "light" && value.tone !== "dark") || !Array.isArray(value.accentSwatches) ||
    value.accentSwatches.length !== 3 || !isRecord(value.status) || !Array.isArray(value.charts) ||
    value.charts.length !== 4 || typeof value.accentDefault !== "string") {
    throw new Error("Invalid theme entry in design baseline.");
  }
  if (themeIds.has(value.id)) throw new Error(`Duplicate theme ID: ${value.id}`);
  themeIds.add(value.id);
  const colors = ["canvas", "surface", "raised", "input", "border", "text", "secondary", "muted"] as const;
  for (const key of colors) assertHex(value[key], `${value.id}.${key}`);
  for (const key of ["success", "warning", "danger"] as const) {
    assertHex(value.status[key], `${value.id}.status.${key}`);
  }
  for (const chart of value.charts) assertHex(chart, `${value.id}.charts`);
  const accents = value.accentSwatches.map((accent: unknown) => {
    if (!isRecord(accent) || typeof accent.id !== "string" || typeof accent.name !== "string") {
      throw new Error(`Invalid accent entry in ${value.id}`);
    }
    for (const key of ["hex", "resolvedOnFill", "resolvedInk"] as const) {
      assertHex(accent[key], `${value.id}.${accent.id}.${key}`);
    }
    return {
      id: accent.id, name: accent.name, hex: accent.hex,
      resolvedOnFill: accent.resolvedOnFill, resolvedInk: accent.resolvedInk,
    };
  });
  if (new Set(accents.map((accent) => accent.id)).size !== 3 ||
    !accents.some((accent) => accent.id === value.accentDefault)) {
    throw new Error(`Invalid accent IDs/default in ${value.id}`);
  }
  return {
    id: value.id, name: value.name, tone: value.tone,
    canvas: value.canvas, surface: value.surface, raised: value.raised,
    input: value.input, border: value.border, text: value.text,
    secondary: value.secondary, muted: value.muted,
    status: { success: value.status.success, warning: value.status.warning, danger: value.status.danger },
    charts: value.charts, accentDefault: value.accentDefault, accentSwatches: accents,
  };
});

const hash = createHash("sha256").update(raw, "utf8").digest("hex");
const contents = `// Generated from ../FitCoach_3_DOCUMENTS_SYNCED_2026-10-14/05-UI-UX/theme-catalog.v1.json.
// Source SHA-256: ${hash}. Do not edit this runtime snapshot manually.
export const catalogSourceSha256 = "${hash}";
export const catalogThemes = ${JSON.stringify(themes, null, 2)} as const;
`;
if (process.argv.includes("--check")) {
  if (await readFile(target, "utf8") !== contents) {
    throw new Error("Generated theme snapshot is stale; run npm run theme:generate after source review.");
  }
  console.log(`Theme snapshot OK: 9 themes, 27 accents, source ${hash}`);
} else {
  await writeFile(target, contents, "utf8");
  console.log(`Generated theme snapshot: 9 themes, 27 accents, source ${hash}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertHex(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^#[0-9A-Fa-f]{6}$/u.test(value)) {
    throw new Error(`Invalid hex color at ${label}`);
  }
}
