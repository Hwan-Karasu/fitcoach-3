import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { KNOWN_EQUIPMENT } from "../apps/mobile/src/features/exercises/domain/ExerciseLabels.ts";

/**
 * Значки оборудования из папки владельца `SVG` (UI-OWN-093). Файлы — трассировка PNG: potrace (один чёрный путь с
 * `<g transform>`) и imagetracer (слои с `opacity`). Скрипт приводит всё к одному силуэту в `currentColor`, чтобы красила
 * тема: у imagetracer-файлов отбрасываются полупрозрачные слои (фон и антиалиасинг), рисунок центрируется и получает поля.
 * Результат: `assets/equipment/<id>.svg` (эталон) и `approvedEquipmentGlyphs.generated.ts`.
 */
const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "../SVG");
const assets = resolve(root, "apps/mobile/assets/equipment");
const output = resolve(root, "apps/mobile/src/features/exercises/presentation/approvedEquipmentGlyphs.generated.ts");

/** Слои imagetracer с непрозрачностью ниже порога — фон/антиалиасинг. */
const OPACITY_MIN = 0.5;
/** Поля вокруг рисунка: доля от большей стороны рамки. */
const MARGIN = 1.06;

/**
 * Файл не по имени: у владельца файл нарисован другим оборудованием или вариантов несколько.
 * A — сведение бёдер, B — разведение (решение владельца 2026-11-12); `flat_bench` по рисунку — петли TRX.
 */
const FILE_FOR: Readonly<Record<string, string>> = {
  hip_adduction_machine: "07_hip_abduction_machine_A.svg",
  hip_abduction_machine: "08_hip_abduction_machine_B.svg",
  suspension_trainer: "flat_bench-преобразовано-из-png.svg",
  pec_deck: "chest_fly_machine-преобразовано-из-png.svg",
  plate_loaded_dip_machine: "dip_machine-преобразовано-из-png.svg",
  elliptical: "air_bike-преобразовано-из-png.svg",
  air_bike: "stationary_bike-преобразовано-из-png.svg",
};
/** Файлы не по имени: попадают только через FILE_FOR (A/B, `flat_bench` = петли) либо не используются (чужой рисунок, не оборудование). */
const UNUSED_FILES: ReadonlySet<string> = new Set([
  "03_hip_adduction_machine.svg", "11_plate_loaded_dip_machine.svg", "none-преобразовано-из-png.svg",
  "07_hip_abduction_machine_A.svg", "08_hip_abduction_machine_B.svg", "flat_bench-преобразовано-из-png.svg",
]);
/**
 * Остаются прежние значки: файл нарисован другим оборудованием (фитбол, канат, скамья) или не перекрашивается темой
 * (канаты — картинка с человеком). Мини-лента — прежний одобренный значок, он хранится в `assets/equipment`.
 */
const KEEP_PREVIOUS: ReadonlySet<string> = new Set(["loop_band", "battle_rope", "stability_ball", "climbing_rope", "flat_bench"]);
function idOfFile(file: string): string {
  return file.replace(/\.svg$/u, "").replace(/-преобразовано-из-png$/u, "").replace(/^\d+_/u, "");
}

const collapse = (text: string) => text.replace(/\s+/gu, " ").trim();

function fromPotrace(text: string): string {
  const viewBox = /viewBox="([^"]+)"/u.exec(text)?.[1]?.replace(/\.0+(?=\s|$)/gu, "");
  const group = /<g transform="([^"]+)"[^>]*>([\s\S]*?)<\/g>/u.exec(text);
  if (viewBox === undefined || group === null) throw new Error("potrace: нет viewBox или группы");
  const d = [...group[2]!.matchAll(/\sd="([^"]+)"/gu)].map((match) => collapse(match[1]!)).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><g transform="${collapse(group[1]!)}" fill="currentColor" stroke="none"><path d="${d}"/></g></svg>`;
}

function fromTracer(text: string): string {
  const kept: string[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const tag of text.matchAll(/<path\b[^>]*>/gu)) {
    const opacity = Number(/\sopacity="([^"]+)"/u.exec(tag[0])?.[1] ?? "1");
    const d = /\sd="([^"]+)"/u.exec(tag[0])?.[1];
    if (d === undefined || opacity < OPACITY_MIN) continue;
    const rounded = collapse(d.replace(/-?\d+\.\d+/gu, (n) => String(Math.round(Number(n) * 2) / 2)));
    kept.push(rounded);
    const numbers = rounded.replace(/[MLQZ]/gu, " ").trim().split(/\s+/u).map(Number);
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      x0 = Math.min(x0, numbers[i]!); x1 = Math.max(x1, numbers[i]!);
      y0 = Math.min(y0, numbers[i + 1]!); y1 = Math.max(y1, numbers[i + 1]!);
    }
  }
  if (kept.length === 0) throw new Error("tracer: нет непрозрачных контуров");
  const side = Math.round(Math.max(x1 - x0, y1 - y0) * MARGIN);
  const vx = Math.round((x0 + x1) / 2 - side / 2), vy = Math.round((y0 + y1) / 2 - side / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${side} ${side}"><path fill="currentColor" fill-rule="evenodd" d="${kept.join(" ")}"/></svg>`;
}

function convert(text: string): string {
  const svg = /<g transform=/u.test(text) ? fromPotrace(text) : fromTracer(text);
  if (/<(?:script|image|foreignObject)\b|base64|\bhref\s*=/iu.test(svg) || !/currentColor/u.test(svg)) throw new Error("Недопустимое содержимое SVG");
  return svg;
}

const files = (await readdir(source)).filter((name) => name.endsWith(".svg")).sort();
const known = new Set(KNOWN_EQUIPMENT);
const fileOf = new Map<string, string>();
for (const file of files) {
  if (UNUSED_FILES.has(file)) continue;
  const id = idOfFile(file);
  if (!known.has(id)) throw new Error(`Файл «${file}»: нет оборудования «${id}» — добавьте в FILE_FOR или UNUSED_FILES`);
  if (KEEP_PREVIOUS.has(id)) continue;
  fileOf.set(id, file);
}
for (const [id, file] of Object.entries(FILE_FOR)) {
  if (!known.has(id) || !files.includes(file)) throw new Error(`FILE_FOR: «${id}» → «${file}» не найден`);
  fileOf.set(id, file);
}

await mkdir(assets, { recursive: true });
const glyphs: Record<string, string> = {};
for (const [id, file] of [...fileOf].sort(([a], [b]) => a.localeCompare(b))) {
  const svg = convert(await readFile(resolve(source, file), "utf8"));
  glyphs[id] = svg;
  await writeFile(resolve(assets, `${id}.svg`), svg, "utf8");
}
// Прежний одобренный значок мини-ленты хранится в assets/equipment и переносится как есть.
for (const id of KEEP_PREVIOUS) {
  if (id !== "loop_band") continue;
  glyphs[id] = collapse(await readFile(resolve(assets, `${id}.svg`), "utf8")).replace(/\s(?:role|aria-label)="[^"]*"/gu, "");
}

const sorted = Object.fromEntries(Object.entries(glyphs).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(output,
  `// Owner-supplied approved vectors (folder SVG). Generated by scripts/prepare-equipment-icons.ts — do not edit.\nexport const approvedEquipmentGlyphs: Readonly<Record<string, string>> = ${JSON.stringify(sorted, null, 2)};\n`, "utf8");

const missing = KNOWN_EQUIPMENT.filter((id) => glyphs[id] === undefined);
const kb = Math.round(Object.values(glyphs).reduce((sum, svg) => sum + Buffer.byteLength(svg), 0) / 1024);
console.log(`Prepared ${Object.keys(glyphs).length} SVG equipment icons (${kb} KB). Без значка из папки (прежний значок): ${missing.join(", ") || "нет"}.`);