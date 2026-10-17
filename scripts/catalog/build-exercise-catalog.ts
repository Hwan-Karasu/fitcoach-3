import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SystemCatalog } from "../../apps/mobile/src/features/exercises/domain/ExerciseModel.ts";
import { REPDB_CHECKOUT, VENDOR_DIR } from "./fetch-repdb.ts";
import { normalizeRecord, validateCatalog, type RepdbRecord } from "./normalize-repdb.ts";

/**
 * Сборка системного каталога: `vendor/repdb/exercises.json` + русские названия → реестр FitCoach
 * `system-catalog.generated.json` в приложении. Запуск: `npm run catalog:fetch && npm run catalog:build`.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUTPUT = join(ROOT, "apps", "mobile", "src", "features", "exercises", "data", "system-catalog.generated.json");
const RU_NAMES = join(dirname(fileURLToPath(import.meta.url)), "repdb-names-ru.json");

interface RepdbFile {
  readonly name: string;
  readonly schema_version: number;
  readonly exercises: readonly RepdbRecord[];
}

const ASSETS = join(ROOT, "apps", "mobile", "assets", "exercises");
const IMAGE_MAP = join(ROOT, "apps", "mobile", "src", "features", "exercises", "presentation", "exerciseImages.generated.ts");

/**
 * Картинки встраиваются в приложение (офлайн, §39.13.5): копия в `apps/mobile/assets/exercises/` (вне git)
 * и карта «путь из источника → require» для Metro. Карта без самих картинок данных не раскрывает.
 */
async function bundleImages(paths: readonly string[]): Promise<void> {
  await mkdir(ASSETS, { recursive: true });
  const unique = [...new Set(paths)].sort();
  for (const path of unique) {
    if (!/^images\/flat\/[a-z0-9-]+\.webp$/.test(path)) throw new Error(`RepDB: неожиданный путь картинки ${path}`);
    await copyFile(join(REPDB_CHECKOUT, path), join(ASSETS, basename(path)));
  }
  const lines = unique.map((path) => `  "${path}": require("../../../../assets/exercises/${basename(path)}") as number,`);
  await writeFile(IMAGE_MAP, [
    "/* eslint-disable @typescript-eslint/no-require-imports */",
    "// Сгенерировано `npm run catalog:build` из снимка RepDB Free. Не править вручную.",
    "// Картинки — в apps/mobile/assets/exercises (вне git, лицензия RepDB п. 3): после клона нужен catalog:fetch + build.",
    "export const exerciseImages: Readonly<Record<string, number>> = {",
    ...lines,
    "};",
    "",
  ].join("\n"));
  console.log(`Картинки: ${unique.length} → apps/mobile/assets/exercises`);
}

async function main(): Promise<void> {
  const source = JSON.parse(await readFile(join(VENDOR_DIR, "SOURCE.json"), "utf8")) as { exercisesSha256: string; fetchedAt: string };
  const file = JSON.parse(await readFile(join(VENDOR_DIR, "exercises.json"), "utf8")) as RepdbFile;
  if (file.schema_version !== 3) throw new Error(`RepDB: неизвестная схема ${file.schema_version}, нужна проверка адаптера`);
  const ru = JSON.parse(await readFile(RU_NAMES, "utf8")) as Readonly<Record<string, string>>;
  const exercises = file.exercises.map((record) => normalizeRecord(record, ru[record.id]));
  const problems = validateCatalog(exercises);
  if (problems.length > 0) throw new Error(`Каталог не прошёл проверку:\n${problems.join("\n")}`);
  const missingRuNames = file.exercises.filter((record) => !ru[record.id]).length;
  const catalog: SystemCatalog = {
    meta: {
      provider: "REPDB",
      datasetName: file.name,
      datasetSchemaVersion: file.schema_version,
      sourceSha256: source.exercisesSha256,
      importedAt: source.fetchedAt,
      license: "RepDB Free Tier License v1.0 (vendor/repdb/LICENSE-DATA.md)",
      attribution: "Exercise data by RepDB (repdb.co)",
      count: exercises.length,
      missingRuNames,
    },
    exercises: [...exercises].sort((a, b) => a.name.localeCompare(b.name, "ru")),
  };
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(catalog)}\n`);
  await bundleImages(exercises.flatMap((exercise) => exercise.media === null ? []
    : [exercise.media.start, exercise.media.peak, exercise.media.main].filter((path): path is string => path !== null)));
  const profiles = new Map<string, number>();
  for (const exercise of exercises) profiles.set(exercise.trackingProfile, (profiles.get(exercise.trackingProfile) ?? 0) + 1);
  console.log(`Каталог: ${exercises.length} упражнений, без русского названия: ${missingRuNames}`);
  console.log(`Профили: ${[...profiles.entries()].map(([id, n]) => `${id} ${n}`).join(", ")}`);
}

await main();
