import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createLocalRepositories } from "../src/app/composition/createLocalRepositories.ts";
import { prepareProductionDatabase, PRODUCTION_WORKSPACE_ID as WS } from "../src/app/composition/productionDatabase.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import type { SystemCatalog } from "../src/features/exercises/domain/ExerciseModel.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

const catalog = JSON.parse(readFileSync(new URL("../src/features/exercises/data/system-catalog.generated.json", import.meta.url), "utf8")) as SystemCatalog;

/** AUD26-01: в собранной схеме приложения у таблицы квитанций переноса есть client_id; окончательное удаление клиента не должно упираться в неё. */
test("AUD26-01: архивный клиент удаляется окончательно в полной схеме приложения, квитанции переноса клиента уходят вместе с ним", async () => {
  const root = mkdtempSync(join(tmpdir(), "athlete-delete-"));
  const file = join(root, "live.db");
  const database = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(file)));
  const raw = <T,>(work: (handle: DatabaseSync) => T): T => { const handle = new DatabaseSync(file); try { return work(handle); } finally { handle.close(); } };
  const owners = createLocalRepositories(database, WS, catalog);
  try {
    await prepareProductionDatabase(database);
    await owners.initialize();
    const keep = await owners.clients.create({ displayName: "Остаётся" });
    const gone = await owners.clients.create({ displayName: "Удаляется" });
    // Квитанции прежнего движка переноса остаются в старых базах: по строке у каждого клиента.
    for (const id of [keep.id, gone.id]) {
      raw((handle) => handle.prepare(`INSERT INTO training_transfer_receipts(workspace_id, client_id, source_key, source_hash, local_hash, program_ids_json)
        VALUES (?, ?, 'k', 'h', 'l', '[]')`).run(WS, id));
    }
    const archived = await owners.clients.setArchived(gone.id, gone.revision, true);
    const manifest = await owners.clients.previewPermanentDelete(gone.id);
    assert.equal(manifest.owners.find((entry) => entry.owner === "training-transfer.receipts")?.rows, 1, "квитанции клиента видны в манифесте удаления");
    
    await owners.clients.deleteArchivedPermanently(gone.id, archived.revision);
    const left = raw((handle) => handle.prepare("SELECT client_id FROM training_transfer_receipts").all()) as { client_id: string }[];
    assert.deepEqual(left.map((row) => row.client_id), [keep.id], "квитанции другого клиента не тронуты");
    assert.equal(await owners.clients.get(gone.id), null);
  } finally {
    await owners.close();
    rmSync(root, { recursive: true, force: true });
  }
});
