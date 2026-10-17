import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Загрузка закреплённого снимка RepDB Free (§39.12: versioned snapshot, без обновления при запуске):
 * данные, текст лицензии и картинки. Всё ложится в `vendor/repdb/` — папка вне git: лицензия запрещает
 * публиковать набор как датасет (п. 3).
 */
export const REPDB_COMMIT = "d86f9612bee19db1069557bcac5c957021057eb9";
const REPOSITORY = "https://github.com/sergei-argutin/exercise-dataset.git";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const VENDOR_DIR = join(ROOT, "vendor", "repdb");
/** Рабочая копия источника на закреплённом коммите (картинки берутся отсюда). */
export const REPDB_CHECKOUT = join(VENDOR_DIR, "snapshot");

function git(args: readonly string[]): string {
  return execFileSync("git", ["-C", REPDB_CHECKOUT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

async function main(): Promise<void> {
  await mkdir(REPDB_CHECKOUT, { recursive: true });
  if (!existsSync(join(REPDB_CHECKOUT, ".git"))) {
    git(["init", "-q"]);
    git(["remote", "add", "origin", REPOSITORY]);
  }
  if (!existsSync(join(REPDB_CHECKOUT, "exercises.json")) || git(["rev-parse", "HEAD"]) !== REPDB_COMMIT) {
    git(["fetch", "-q", "--depth", "1", "origin", REPDB_COMMIT]);
    git(["checkout", "-q", "--force", "FETCH_HEAD"]);
  }
  if (git(["rev-parse", "HEAD"]) !== REPDB_COMMIT) throw new Error("RepDB: снимок не на закреплённом коммите");
  const data = await readFile(join(REPDB_CHECKOUT, "exercises.json"));
  const license = await readFile(join(REPDB_CHECKOUT, "LICENSE-DATA.md"));
  await writeFile(join(VENDOR_DIR, "exercises.json"), data);
  await writeFile(join(VENDOR_DIR, "LICENSE-DATA.md"), license);
  const source = {
    repository: REPOSITORY,
    commit: REPDB_COMMIT,
    fetchedAt: new Date().toISOString(),
    exercisesSha256: createHash("sha256").update(data).digest("hex"),
    licenseSha256: createHash("sha256").update(license).digest("hex"),
  };
  await writeFile(join(VENDOR_DIR, "SOURCE.json"), `${JSON.stringify(source, null, 2)}\n`);
  console.log(`RepDB ${REPDB_COMMIT.slice(0, 8)}: данные и картинки → vendor/repdb`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
