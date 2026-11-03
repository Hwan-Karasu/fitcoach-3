/**
 * BKP-PERF: замер этапов копии на ПК (V8, node:sqlite), не тест. Синтетическая рабочая база (рецепты, фото рецептов),
 * те же функции движка, что в APK. Порт считает обращения к SQLite так, как их видит мост Expo: `each` — один вызов
 * на строку (getEachAsync → stepAsync), остальные — один вызов. Время на телефоне (Hermes, мост) этим не заменяется.
 * Запуск: node --experimental-strip-types scripts/backup-bench.ts [повторов]
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { backup, DatabaseSync } from "node:sqlite";
import { prepareProductionDatabase, PRODUCTION_IDENTITY, PRODUCTION_WORKSPACE_ID as WS } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { SCHEMA_OWNERS } from "../apps/mobile/src/app/composition/schema.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { inspectDatabaseIdentity } from "../apps/mobile/src/shared/db/DatabaseIdentity.ts";
import { SqliteSnapshotEngine } from "../apps/mobile/src/features/backup/data/SqliteSnapshotEngine.ts";
import { snapshotContentSha256 } from "../apps/mobile/src/features/backup/data/SnapshotContentHash.ts";
import type { SnapshotSqlPort, SnapshotSqlValue } from "../apps/mobile/src/features/backup/data/SnapshotSqlPort.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { nodeSnapshotSql } from "./r06/NodeSnapshotSql.ts";
import { nodeSnapshotMediaSettings } from "./r06/NodeSnapshotMedia.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4HsAAAAASUVORK5CYII=", "base64");
const NOW = "2026-11-03T10:00:00.000Z";
const schema = { identity: PRODUCTION_IDENTITY, owners: SCHEMA_OWNERS };
const engine = new SqliteSnapshotEngine(schema);

interface Counter { calls: number; rows: number }
function counted(port: SnapshotSqlPort, counter: Counter): SnapshotSqlPort {
  const wrapped: SnapshotSqlPort = {
    run: (sql, b) => { counter.calls++; return port.run(sql, b); },
    first: (sql, b) => { counter.calls++; return port.first(sql, b); },
    all: async <Row>(sql: string, b?: readonly SnapshotSqlValue[]) => { counter.calls++; const rows = await port.all<Row>(sql, b); counter.rows += rows.length; return rows; },
    async *each<Row>(sql: string, b?: readonly SnapshotSqlValue[]) { counter.calls++; for await (const row of port.each<Row>(sql, b)) { counter.calls++; counter.rows++; yield row; } },
    transaction: (task) => port.transaction((tx) => task(counted(tx, counter))),
  };
  return wrapped;
}

async function fixture(recipes: number, photos: number, photoBytes: number) {
  const directory = mkdtempSync(join(tmpdir(), "athlete-backup-bench-"));
  const media = join(directory, "images"); mkdirSync(media);
  const file = join(directory, "live.db");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(file)));
  await prepareProductionDatabase(shared);
  const db = new DatabaseSync(file);
  const insert = db.prepare(`INSERT INTO recipes (id, workspace_id, name, servings_x10, revision, created_at, updated_at, description, details_json)
    VALUES (?, ?, ?, 10, 1, ?, ?, ?, ?)`);
  db.exec("BEGIN");
  for (let i = 0; i < recipes; i++) {
    let photoUri: string | null = null;
    if (i < photos) {
      const photo = join(media, `photo-${i}.png`);
      writeFileSync(photo, Buffer.concat([PNG, Buffer.alloc(photoBytes - PNG.length, i % 251)]));
      photoUri = pathToFileURL(photo).href;
    }
    const details = { prepMinutes: 5, cookMinutes: 20, categories: ["Синтетика"], photoUri, steps: ["Шаг 1: нарезать", "Шаг 2: смешать", "Шаг 3: запечь"] };
    insert.run(randomUUID(), WS, `Рецепт ${i}`, NOW, NOW, `Синтетическое описание ${i}`.padEnd(120, "."), JSON.stringify(details));
  }
  db.exec("COMMIT");
  return { directory, db, media, cleanup: () => { db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

type Stage = { name: string; ms: number; calls: number; rows: number };
async function timed(stages: Stage[], name: string, task: (counter: Counter) => Promise<unknown>): Promise<void> {
  const counter = { calls: 0, rows: 0 }; const started = performance.now();
  await task(counter);
  stages.push({ name, ms: performance.now() - started, calls: counter.calls, rows: counter.rows });
}
const open = (file: string) => { const db = new DatabaseSync(file); db.exec("PRAGMA journal_mode=DELETE"); return db; };

/** Поток автокопии с изменениями (BKP-PERF-1): одна копия SQLite, хеш при сравнении, запечатывание той же копии с известным
 * хешем, одна проверка; publish того же процесса повторную проверку не делает (совпал нативный SHA файла). */
async function automaticChanged(f: Awaited<ReturnType<typeof fixture>>): Promise<Stage[]> {
  const s: Stage[] = []; const job = mkdtempSync(join(f.directory, "job-")); const current = join(job, "current.db");
  await timed(s, "SQLite: копия", async () => backup(f.db, current));
  const copy = open(current); let known = "";
  await timed(s, "Сравнение: хеш содержимого", async (c) => { await inspectDatabaseIdentity(counted(nodeSnapshotSql(copy), c), schema.identity, schema.owners); known = await snapshotContentSha256(counted(nodeSnapshotSql(copy), c)); });
  await timed(s, "Формирование (фото, хеш известен)", async (c) => engine.sealSnapshot(counted(nodeSnapshotSql(copy), c), { backupId: randomUUID(), createdAt: NOW }, nodeSnapshotMediaSettings({ mediaRoot: f.media }), known));
  await timed(s, "Проверка (хеш + фото)", async (c) => engine.validateSnapshot(counted(nodeSnapshotSql(copy), c)));
  copy.close(); rmSync(job, { recursive: true, force: true });
  return s;
}
/** Проверка без изменений после запуска или после записи с тем же содержимым: копия SQLite + хеш. Без записей в этом процессе
 * (BKP-PERF-3) проверка не выполняет ни одного обращения к базе — в замере не участвует. */
async function unchangedBefore(f: Awaited<ReturnType<typeof fixture>>): Promise<Stage[]> {
  const s: Stage[] = []; const job = mkdtempSync(join(f.directory, "job-")); const current = join(job, "current.db");
  await timed(s, "SQLite: копия", async () => backup(f.db, current));
  const copy = open(current);
  await timed(s, "Хеш содержимого", async (c) => snapshotContentSha256(counted(nodeSnapshotSql(copy), c)));
  copy.close(); rmSync(job, { recursive: true, force: true });
  return s;
}
/** Ручная копия: копия SQLite, формирование, проверка. */
async function manual(f: Awaited<ReturnType<typeof fixture>>): Promise<Stage[]> {
  const s: Stage[] = []; const job = mkdtempSync(join(f.directory, "job-")); const partial = join(job, "snapshot.partial");
  await timed(s, "SQLite: копия", async () => backup(f.db, partial));
  const sealed = open(partial);
  await timed(s, "Формирование (хеш + фото)", async (c) => engine.sealSnapshot(counted(nodeSnapshotSql(sealed), c), { backupId: randomUUID(), createdAt: NOW }, nodeSnapshotMediaSettings({ mediaRoot: f.media })));
  await timed(s, "Проверка (хеш + фото)", async (c) => engine.validateSnapshot(counted(nodeSnapshotSql(sealed), c)));
  sealed.close();
  const bytes = statSync(partial).size; rmSync(job, { recursive: true, force: true });
  s.push({ name: `Размер архива, КБ: ${Math.round(bytes / 1024)}`, ms: 0, calls: 0, rows: 0 });
  return s;
}

const scenarios = [
  { name: "Маленькая база (200 рецептов)", recipes: 200, photos: 0, photoBytes: 0 },
  { name: "Средняя база (5 000 рецептов)", recipes: 5_000, photos: 0, photoBytes: 0 },
  { name: "Большая база (30 000 рецептов)", recipes: 30_000, photos: 0, photoBytes: 0 },
  { name: "Много фото (500 рецептов, 30 фото × 400 КБ)", recipes: 500, photos: 30, photoBytes: 400 * 1024 },
];
const flows = { "Автокопия с изменениями": automaticChanged, "Автокопия без изменений": unchangedBefore, "Ручная копия": manual };
const repeats = Number(process.argv[2] ?? 5);
for (const scenario of scenarios) {
  const f = await fixture(scenario.recipes, scenario.photos, scenario.photoBytes);
  try {
    console.log(`\n## ${scenario.name}`);
    for (const [flow, run] of Object.entries(flows)) {
      const runs: Stage[][] = [];
      for (let i = 0; i < repeats; i++) runs.push(await run(f));
      console.log(`### ${flow} (среднее из ${repeats})`);
      let total = 0; let calls = 0;
      for (const [index, stage] of runs[0]!.entries()) {
        const ms = runs.reduce((sum, r) => sum + r[index]!.ms, 0) / repeats; total += ms; calls += stage.calls;
        console.log(`  ${stage.name.padEnd(48)} ${ms.toFixed(1).padStart(8)} мс  вызовов SQLite ${String(stage.calls).padStart(7)}  строк ${stage.rows}`);
      }
      console.log(`  ${"Итого".padEnd(48)} ${total.toFixed(1).padStart(8)} мс  вызовов SQLite ${String(calls).padStart(7)}`);
    }
  } finally { f.cleanup(); }
}
