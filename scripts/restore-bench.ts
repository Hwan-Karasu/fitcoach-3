/**
 * BKP-AUDIT-1: замер полного конвейера восстановления на ПК (V8, node:sqlite). Реальные ExpoRestoreJobs/ExpoSqliteBackup/движок,
 * подменён только ввод-вывод Expo. Это НЕ время телефона (Hermes, мост), а сравнение «до/после» на одном наборе и одной машине.
 * Запуск: node --experimental-strip-types scripts/restore-bench.ts <метка> [recipes] [photos] [photoKB]
 * Результат: artifacts/bkp-audit/<метка>.json
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createWorld } from "../apps/mobile/scripts/support/restore-world.ts";
import { backupBoundary } from "../apps/mobile/scripts/support/expo-backup-boundary.ts";

const label = process.argv[2] ?? "run";
const recipes = Number(process.argv[3] ?? 30_000); const photos = Number(process.argv[4] ?? 20); const photoKb = Number(process.argv[5] ?? 300);
const HASH = "SELECT type, name, tbl_name, sql FROM sqlite_master";
const stats = () => ({ hashPasses: backupBoundary.queries.filter((q) => q.startsWith(HASH)).length,
  integrityChecks: backupBoundary.queries.filter((q) => q.includes("integrity_check")).length, queries: backupBoundary.queries.length });

const world = await createWorld({ clients: 40, recipes, photos, photoBytes: photoKb * 1024 });
const result: Record<string, unknown> = { label, recipes, photos, photoKb, node: process.version, liveBytes: statSync(world.liveFile).size };
try {
  for (const mode of ["manual", "automatic"] as const) {
    backupBoundary.queries.length = 0;
    let started = performance.now();
    const backup = await world.makeBackup(mode);
    const create = { ms: Math.round(performance.now() - started), ...stats(), fileBytes: statSync(join(world.dirs.external, `${mode}-${mode === "manual" ? 0 : 1}.atbackup`)).size };
    world.write("INSERT INTO clients (id,workspace_id,display_name,lifecycle,revision,created_at,updated_at) VALUES (?,?,?,?,1,?,?)",
      `after-${mode}`, "local-trainer", `After ${mode}`, "ACTIVE", "2026-11-11", "2026-11-11");
    backupBoundary.picked = backup.file; backupBoundary.queries.length = 0;
    const phases: { phase: string; at: number }[] = []; started = performance.now();
    const preview = await world.jobs.prepareFile((p) => { if (phases.at(-1)?.phase !== p.phase) phases.push({ phase: p.phase, at: Math.round(performance.now() - started) }); });
    assert.ok(preview);
    const prepare = { ms: Math.round(performance.now() - started), ...stats(), phases };
    backupBoundary.queries.length = 0; started = performance.now();
    const outcome = await world.jobs.apply(preview.id);
    const apply = { ms: Math.round(performance.now() - started), ...stats(), outcome };
    assert.equal(outcome, "COMMITTED");
    assert.deepEqual(world.tables().clients, backup.tables.clients, "clients differ after restore");
    assert.equal(world.tables().recipes.length, backup.tables.recipes.length);
    backupBoundary.queries.length = 0; started = performance.now();
    await world.jobs.readPoint();
    const readPoint = { ms: Math.round(performance.now() - started), ...stats() };
    result[mode] = { create, prepare, apply, readPoint, totalRestoreMs: prepare.ms + apply.ms + readPoint.ms };
    await world.jobs.deletePoint((await world.jobs.readPoint())!.id).catch(() => undefined);
  }
} finally { world.cleanup(); }
mkdirSync("artifacts/bkp-audit", { recursive: true });
writeFileSync(`artifacts/bkp-audit/${label}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
