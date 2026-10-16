import * as SQLite from "expo-sqlite";

type CheckName =
  | "foreign_keys"
  | "wal"
  | "exclusive_commit"
  | "rollback"
  | "nested_use_case"
  | "serialized_writes"
  | "post_commit_revision"
  | "rollback_keeps_read_model"
  | "targeted_read_model"
  | "two_connections"
  | "wal_checkpoint"
  | "foreign_key_check"
  | "integrity_check"
  | "indexed_query";

export interface SpikeCheck {
  name: CheckName;
  passed: boolean;
  detail: string;
}

export interface SpikeReport {
  runId: string;
  sqliteVersion: string;
  checks: SpikeCheck[];
  allPassed: boolean;
  queryPlan: string[];
}

interface ItemRow {
  id: string;
  value: string;
  revision: number;
}

interface CountRow {
  count: number;
}

interface PlanRow {
  detail: string;
}

const DATABASE_NAME = "fitcoach_r07_spike.db";

export async function runSqliteSpike(): Promise<SpikeReport> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const itemId = `item-${runId}`;
  const unrelatedId = `unrelated-${runId}`;
  const checks: SpikeCheck[] = [];
  const postCommitRevisions: number[] = [];
  const readModel = new Map<string, ItemRow>();
  const invalidatedIds: string[] = [];

  try {
    await db.execAsync("PRAGMA foreign_keys = ON");
    await db.execAsync("PRAGMA journal_mode = WAL");
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS spike_items (
        id TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision >= 0)
      );
      CREATE TABLE IF NOT EXISTS spike_children (
        id TEXT PRIMARY KEY NOT NULL,
        item_id TEXT NOT NULL REFERENCES spike_items(id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS spike_items_value_idx ON spike_items(value);
    `);

    const foreignKeys = await db.getFirstAsync<{ foreign_keys: number }>(
      "PRAGMA foreign_keys",
    );
    const journal = await db.getFirstAsync<{ journal_mode: string }>(
      "PRAGMA journal_mode",
    );
    checks.push(check("foreign_keys", foreignKeys?.foreign_keys === 1, String(foreignKeys?.foreign_keys)));
    checks.push(check("wal", journal?.journal_mode.toLowerCase() === "wal", String(journal?.journal_mode)));

    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(
        "INSERT INTO spike_items (id, value, revision) VALUES (?, ?, 0)",
        itemId,
        "baseline",
      );
      await tx.runAsync(
        "INSERT INTO spike_items (id, value, revision) VALUES (?, ?, 0)",
        unrelatedId,
        "unrelated",
      );
    });
    const inserted = await db.getFirstAsync<ItemRow>(
      "SELECT id, value, revision FROM spike_items WHERE id = ?",
      itemId,
    );
    checks.push(check("exclusive_commit", inserted?.value === "baseline", JSON.stringify(inserted)));
    const unrelated = await db.getFirstAsync<ItemRow>(
      "SELECT id, value, revision FROM spike_items WHERE id = ?",
      unrelatedId,
    );
    if (!inserted || !unrelated) throw new Error("INITIAL_READ_MODEL_MISSING");
    readModel.set(itemId, inserted);
    readModel.set(unrelatedId, unrelated);

    try {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync(
          "UPDATE spike_items SET value = ?, revision = revision + 1 WHERE id = ?",
          "must-rollback",
          itemId,
        );
        await writeChildInSameTransaction(tx, itemId, `child-${runId}`);
        throw new Error("INJECTED_ROLLBACK");
      });
    } catch (cause) {
      if (!(cause instanceof Error) || cause.message !== "INJECTED_ROLLBACK") throw cause;
    }
    const rolledBack = await db.getFirstAsync<ItemRow>(
      "SELECT id, value, revision FROM spike_items WHERE id = ?",
      itemId,
    );
    const rolledBackChildCount = await db.getFirstAsync<CountRow>(
      "SELECT COUNT(*) AS count FROM spike_children WHERE item_id = ?",
      itemId,
    );
    checks.push(check("rollback", rolledBack?.value === "baseline" && rolledBack.revision === 0 && rolledBackChildCount?.count === 0, JSON.stringify({ rolledBack, rolledBackChildCount })));
    checks.push(check("nested_use_case", rolledBackChildCount?.count === 0, `child-count=${rolledBackChildCount?.count}`));
    checks.push(check("rollback_keeps_read_model", readModel.get(itemId) === inserted && invalidatedIds.length === 0, `invalidations=${invalidatedIds.length}`));

    let writerQueue: Promise<unknown> = Promise.resolve();
    const write = (nextValue: string): Promise<void> => {
      const queued = writerQueue.then(async () => {
        await db.withExclusiveTransactionAsync(async (tx) => {
          await tx.runAsync(
            "UPDATE spike_items SET value = ?, revision = revision + 1 WHERE id = ?",
            nextValue,
            itemId,
          );
        });
        const committed = await db.getFirstAsync<ItemRow>(
          "SELECT id, value, revision FROM spike_items WHERE id = ?",
          itemId,
        );
        if (!committed) throw new Error("COMMITTED_ROW_MISSING");
        postCommitRevisions.push(committed.revision);
        readModel.set(itemId, committed);
        invalidatedIds.push(itemId);
      });
      writerQueue = queued.catch(() => undefined);
      return queued;
    };
    await Promise.all([write("first"), write("second")]);
    const final = await db.getFirstAsync<ItemRow>(
      "SELECT id, value, revision FROM spike_items WHERE id = ?",
      itemId,
    );
    checks.push(check("serialized_writes", final?.value === "second" && final.revision === 2, JSON.stringify(final)));
    checks.push(check("post_commit_revision", postCommitRevisions.join(",") === "1,2", postCommitRevisions.join(",")));
    checks.push(check(
      "targeted_read_model",
      readModel.get(itemId)?.revision === 2 &&
        readModel.get(unrelatedId) === unrelated &&
        invalidatedIds.length === 2 &&
        invalidatedIds.every((id) => id === itemId),
      `invalidated=${invalidatedIds.join(",")}; unrelated-preserved=${readModel.get(unrelatedId) === unrelated}`,
    ));

    const secondDb = await SQLite.openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
    try {
      const visible = await secondDb.getFirstAsync<ItemRow>(
        "SELECT id, value, revision FROM spike_items WHERE id = ?",
        itemId,
      );
      checks.push(check("two_connections", visible?.value === "second" && visible.revision === 2, JSON.stringify(visible)));
    } finally {
      await secondDb.closeAsync();
    }
    const checkpoint = await db.getFirstAsync<{ busy: number; log: number; checkpointed: number }>(
      "PRAGMA wal_checkpoint(PASSIVE)",
    );
    checks.push(check("wal_checkpoint", checkpoint?.busy === 0, JSON.stringify(checkpoint)));

    const foreignKeyViolations = await db.getAllAsync<unknown>("PRAGMA foreign_key_check");
    checks.push(check("foreign_key_check", foreignKeyViolations.length === 0, `violations=${foreignKeyViolations.length}`));
    const integrity = await db.getFirstAsync<{ integrity_check: string }>(
      "PRAGMA integrity_check",
    );
    checks.push(check("integrity_check", integrity?.integrity_check === "ok", String(integrity?.integrity_check)));

    const queryPlanRows = await db.getAllAsync<PlanRow>(
      "EXPLAIN QUERY PLAN SELECT id FROM spike_items WHERE value = ?",
      "second",
    );
    const queryPlan = queryPlanRows.map((row) => row.detail);
    checks.push(check("indexed_query", queryPlan.some((line) => line.includes("spike_items_value_idx")), queryPlan.join(" | ")));

    const count = await db.getFirstAsync<CountRow>(
      "SELECT COUNT(*) AS count FROM spike_items WHERE id = ?",
      itemId,
    );
    if (count?.count !== 1) throw new Error("SPIKE_ROW_COUNT_INVALID");

    const version = await db.getFirstAsync<{ version: string }>(
      "SELECT sqlite_version() AS version",
    );
    return {
      runId,
      sqliteVersion: version?.version ?? "unknown",
      checks,
      allPassed: checks.every((entry) => entry.passed),
      queryPlan,
    };
  } finally {
    await db.closeAsync();
  }
}

function check(name: CheckName, passed: boolean, detail: string): SpikeCheck {
  return { name, passed, detail };
}

async function writeChildInSameTransaction(
  tx: SQLite.SQLiteDatabase,
  itemId: string,
  childId: string,
): Promise<void> {
  await tx.runAsync(
    "INSERT INTO spike_children (id, item_id) VALUES (?, ?)",
    childId,
    itemId,
  );
}
