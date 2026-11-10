import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { backup, DatabaseSync } from "node:sqlite";
import { backupBoundary, File, openDatabaseAsync } from "./support/expo-backup-boundary.ts";
import { prepareProductionDatabase, PRODUCTION_IDENTITY, inspectProductionDatabase } from "../src/app/composition/productionDatabase.ts";
import { SCHEMA_OWNERS } from "../src/app/composition/schema.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";
import { canonicalContentSha256 } from "../../../scripts/r06/SqliteBackup.ts";
import { RestorePreparationTrace } from "../src/features/backup/domain/RestorePreparation.ts";

const boundary = new URL("./support/expo-backup-boundary.ts", import.meta.url).href;
const modules = new Set(["expo-file-system", "expo-file-system/legacy", "expo-sqlite", "expo-modules-core", "react-native"]);
const hooks = registerHooks({ resolve(specifier, context, next) {
  return modules.has(specifier) ? { url: boundary, shortCircuit: true } : next(specifier, context);
} });
const { ExpoSqliteBackup } = await import("../src/features/backup/data/ExpoSqliteBackup.ts");
hooks.deregister();

test("RECOVERY-51 real Expo driver: manual and automatic sealing both prepare; two content passes, source unchanged", async () => {
  const directory = mkdtempSync(join(tmpdir(), "restore-driver-")); backupBoundary.root = directory;
  const live = join(directory, "live.db");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(live)));
  await prepareProductionDatabase(shared);
  const raw = new DatabaseSync(live);
  raw.prepare("INSERT INTO clients (id,workspace_id,display_name,lifecycle,revision,created_at,updated_at) VALUES ('synthetic-51',?,'Synthetic restore','ACTIVE',1,'2026-11-10','2026-11-10')")
    .run(PRODUCTION_IDENTITY.workspaceId);
  const driver = new ExpoSqliteBackup({ identity: PRODUCTION_IDENTITY, owners: SCHEMA_OWNERS });
  try {
    const expected = canonicalContentSha256(raw);
    for (const mode of ["manual", "automatic"] as const) {
      const destination = new File(directory, `${mode}.atbackup`) as never;
      const metadata = { backupId: "10000000-0000-4000-8000-000000000051", createdAt: "2026-11-10T12:00:00.000Z" };
      if (mode === "manual") {
        const source = await openDatabaseAsync("live.db", {}, directory);
        try { await driver.createSnapshot(source as never, new File(directory, "manual.partial") as never, destination, metadata); }
        finally { await source.closeAsync(); }
      } else {
        const copy = new File(directory, "automatic-copy.db") as never; await backup(raw, join(directory, "automatic-copy.db"));
        await driver.sealPrivateCopy(copy, destination, metadata, expected);
      }
      const original = readFileSync(join(directory, `${mode}.atbackup`));
      backupBoundary.queries.length = 0;
      const phases: string[] = [];
      const trace = new RestorePreparationTrace(mode, (p) => { if (phases.at(-1) !== p.phase) phases.push(p.phase); }, () => 0, () => undefined);
      const staged = new File(directory, `${mode}-incoming.db`) as never;
      await driver.prepareForRestore(destination, new File(directory, `${mode}-inspection.db`) as never, staged,
        { observe: trace.observe }, () => trace.phase("PREPARE_CANDIDATE"));
      trace.finish(true);
      assert.deepEqual(phases, ["COPY_SOURCE", "VERIFY_SOURCE", "PREPARE_CANDIDATE", "READY"]);
      assert.equal(backupBoundary.queries.filter((sql) => sql.startsWith("SELECT type, name, tbl_name, sql FROM sqlite_master")).length, 2,
        "one input verification and one post-transformation hash, no redundant third full input scan");
      const candidate = new DatabaseSync(join(directory, `${mode}-incoming.db`));
      try {
        assert.equal(canonicalContentSha256(candidate), expected);
        assert.equal(await inspectProductionDatabase(nodeSqlitePort(candidate)), "OWNED");
      } finally { candidate.close(); }
      assert.deepEqual(readFileSync(join(directory, `${mode}.atbackup`)), original);
      const brokenPath = join(directory, `${mode}-broken.atbackup`);
      copyFileSync(join(directory, `${mode}.atbackup`), brokenPath);
      const broken = new DatabaseSync(brokenPath);
      try { broken.exec("UPDATE clients SET display_name='tampered synthetic value'"); } finally { broken.close(); }
      const tampered = readFileSync(brokenPath); let accepted = false;
      await assert.rejects(driver.prepareForRestore(new File(brokenPath) as never,
        new File(directory, `${mode}-bad-inspection.db`) as never, new File(directory, `${mode}-bad-incoming.db`) as never,
        {}, () => { accepted = true; }), (error: unknown) => error instanceof Error && error.message === "SNAPSHOT_INVALID");
      assert.equal(accepted, false, "a corrupt candidate never reaches transformation");
      assert.deepEqual(readFileSync(brokenPath), tampered);
      backupBoundary.fullDisk = true;
      try {
        await assert.rejects(driver.prepareForRestore(destination, new File(directory, `${mode}-full-inspection.db`) as never,
          new File(directory, `${mode}-full-incoming.db`) as never),
          (error: unknown) => error instanceof Error && error.message === "SNAPSHOT_SPACE_LOW");
      } finally { backupBoundary.fullDisk = false; }
      assert.deepEqual(readFileSync(join(directory, `${mode}.atbackup`)), original);
    }
  } finally { raw.close(); await shared.release(); rmSync(directory, { recursive: true, force: true }); }
});
