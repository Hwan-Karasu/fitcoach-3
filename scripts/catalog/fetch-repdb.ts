import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Загрузка закреплённого снимка RepDB Free (§39.12: versioned snapshot, без обновления при запуске).
 * Файлы ложатся в `vendor/repdb/` — папка вне git: лицензия запрещает публиковать набор как датасет.
 */
export const REPDB_COMMIT = "d86f9612bee19db1069557bcac5c957021057eb9";
const BASE = `https://raw.githubusercontent.com/sergei-argutin/exercise-dataset/${REPDB_COMMIT}`;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const VENDOR_DIR = join(ROOT, "vendor", "repdb");

async function download(name: string): Promise<Buffer> {
  const response = await fetch(`${BASE}/${name}`);
  if (!response.ok) throw new Error(`RepDB: ${name} — HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main(): Promise<void> {
  await mkdir(VENDOR_DIR, { recursive: true });
  const data = await download("exercises.json");
  const license = await download("LICENSE-DATA.md");
  await writeFile(join(VENDOR_DIR, "exercises.json"), data);
  await writeFile(join(VENDOR_DIR, "LICENSE-DATA.md"), license);
  const source = {
    repository: "https://github.com/sergei-argutin/exercise-dataset",
    commit: REPDB_COMMIT,
    fetchedAt: new Date().toISOString(),
    exercisesSha256: createHash("sha256").update(data).digest("hex"),
    licenseSha256: createHash("sha256").update(license).digest("hex"),
  };
  await writeFile(join(VENDOR_DIR, "SOURCE.json"), `${JSON.stringify(source, null, 2)}\n`);
  console.log(`RepDB ${REPDB_COMMIT.slice(0, 8)}: exercises.json ${data.length} байт → vendor/repdb`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
