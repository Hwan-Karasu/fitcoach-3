/** Host world for the REAL restore pipeline: ExpoRestoreJobs + ExpoSqliteBackup + engine run unchanged,
 * only Expo IO is replaced (expo-backup-boundary.ts, node:sqlite). Used by tests and the benchmark. */
import { registerHooks } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";
import { backupBoundary, File, openDatabaseAsync } from "./expo-backup-boundary.ts";
import { prepareProductionDatabase, PRODUCTION_IDENTITY, PRODUCTION_WORKSPACE_ID as WS } from "../../src/app/composition/productionDatabase.ts";
import { SCHEMA_OWNERS } from "../../src/app/composition/schema.ts";
import { SharedSqliteDatabase } from "../../src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "../../../../scripts/support/node-sqlite-port.ts";
import { canonicalContentSha256 } from "../../../../scripts/r06/SqliteBackup.ts";

const boundary = new URL("./expo-backup-boundary.ts", import.meta.url).href;
const modules = new Set(["expo-file-system", "expo-file-system/legacy", "expo-sqlite", "expo-modules-core", "react-native"]);
const hooks = registerHooks({ resolve(specifier, context, next) {
  return modules.has(specifier) ? { url: boundary, shortCircuit: true } : next(specifier, context);
} });
const { ExpoRestoreJobs } = await import("../../src/app/composition/ExpoRestoreJobs.ts");
const { ExpoSqliteBackup } = await import("../../src/features/backup/data/ExpoSqliteBackup.ts");
const { expoSnapshotMedia } = await import("../../src/features/backup/data/ExpoSnapshotMedia.ts");
const { Directory } = await import("./expo-backup-boundary.ts");
hooks.deregister();

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4HsAAAAASUVORK5CYII=", "base64");
const NOW = "2026-11-11T10:00:00.000Z";
export interface WorldOptions { readonly clients?: number; readonly recipes?: number; readonly photos?: number; readonly photoBytes?: number }
export interface Tables { readonly clients: readonly unknown[]; readonly recipes: readonly unknown[] }

export async function createWorld(options: WorldOptions = {}) {
  const { clients = 3, recipes = 20, photos = 0, photoBytes = 4096 } = options;
  const root = mkdtempSync(join(tmpdir(), "restore-world-")); backupBoundary.root = root;
  backupBoundary.queries.length = 0; backupBoundary.fullDisk = false; backupBoundary.freeBytes = Number.MAX_SAFE_INTEGER;
  const dirs = { sqlite: join(root, "SQLite"), images: join(root, "local-images"), external: join(root, "external"), restore: join(root, "runtime-restore", "production") };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  const liveFile = join(dirs.sqlite, "fitcoach_v3.db");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(liveFile)));
  await prepareProductionDatabase(shared);
  const raw = () => new DatabaseSync(liveFile);
  const db = raw();
  db.exec("BEGIN");
  const addClient = db.prepare("INSERT INTO clients (id,workspace_id,display_name,lifecycle,archived_at,revision,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)");
  for (let i = 0; i < clients; i++) {
    const archived = i % 5 === 4;
    addClient.run(`synthetic-${i}`, WS, `Synthetic ${i}`, archived ? "ARCHIVED" : "ACTIVE", archived ? NOW : null, NOW, NOW);
  }
  const addRecipe = db.prepare(`INSERT INTO recipes (id, workspace_id, name, servings_x10, revision, created_at, updated_at, description, details_json)
    VALUES (?, ?, ?, 10, 1, ?, ?, ?, ?)`);
  for (let i = 0; i < recipes; i++) {
    let photoUri: string | null = null;
    if (i < photos) {
      const photo = join(dirs.images, `photo-${i}.png`);
      writeFileSync(photo, Buffer.concat([PNG, Buffer.alloc(Math.max(0, photoBytes - PNG.length), i % 251)]));
      photoUri = pathToFileURL(photo).href;
    }
    const details = { prepMinutes: 5, categories: ["Синтетика"], photoUri, steps: ["Шаг 1", "Шаг 2", "Шаг 3"] };
    addRecipe.run(`recipe-${String(i).padStart(6, "0")}`, WS, `Рецепт ${i}`, NOW, NOW, `Описание ${i}`.padEnd(120, "."), JSON.stringify(details));
  }
  db.exec("COMMIT"); db.close();

  const live = new File(liveFile) as never; const images = new Directory(dirs.images) as never;
  const driver = new ExpoSqliteBackup({ identity: PRODUCTION_IDENTITY, owners: SCHEMA_OWNERS });
  const maintenance = { withClosedDatabase: <T>(task: () => Promise<T>) => task() };
  let changeToken = 1;
  const jobs = new ExpoRestoreJobs({ root: new Directory(dirs.restore) as never, live, images, maintenance: maintenance as never,
    pick: async () => backupBoundary.picked as never, currentWriteToken: () => changeToken } as never);

  /** Independent oracle: rows of the business tables straight from SQLite, not via the engine under test. */
  const tables = (file = liveFile): Tables => {
    const handle = new DatabaseSync(file);
    try {
      const rows = (table: string) => handle.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map((row) => ({ ...row }));
      return { clients: rows("clients"), recipes: rows("recipes") };
    } finally { handle.close(); }
  };
  let counter = 0;
  const world = {
    root, dirs, liveFile, jobs, driver, tables, backupBoundary,
    /** Business write to LIVE (also advances the change token like the real SharedSqliteDatabase would). */
    write(sql: string, ...args: (string | number | null)[]) { const handle = raw(); try { handle.prepare(sql).run(...args); } finally { handle.close(); } changeToken++; },
    get changeToken() { return changeToken; },
    /** Makes an external `.atbackup` of the CURRENT live data (manual path: real createSnapshot; automatic path: sealPrivateCopy). */
    async makeBackup(mode: "manual" | "automatic", name = `${mode}-${counter++}`): Promise<{ file: File; tables: Tables }> {
      const destination = new File(dirs.external, `${name}.atbackup`);
      const metadata = { backupId: randomUUID(), createdAt: NOW };
      const settings = { files: expoSnapshotMedia(images) };
      if (mode === "manual") {
        const source = await openDatabaseAsync("fitcoach_v3.db", {}, dirs.sqlite);
        try { await driver.createSnapshot(source as never, new File(dirs.external, `${name}.partial`) as never, destination as never, metadata, settings); }
        finally { await source.closeAsync(); }
      } else {
        const handle = raw(); const copyPath = join(dirs.external, `${name}-copy.db`);
        try {
          await backup(handle, copyPath);
          const copy = new DatabaseSync(copyPath); let hash: string;
          try { hash = canonicalContentSha256(copy); } finally { copy.close(); }
          await driver.sealPrivateCopy(new File(copyPath) as never, destination as never, metadata, hash, settings);
        } finally { handle.close(); }
      }
      return { file: destination, tables: tables() };
    },
    cleanup() { rmSync(root, { recursive: true, force: true }); backupBoundary.picked = null; },
  };
  return world;
}
export type World = Awaited<ReturnType<typeof createWorld>>;
