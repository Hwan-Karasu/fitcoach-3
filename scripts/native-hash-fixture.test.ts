import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { NATIVE_HASH_FIXTURE_SHA256, NATIVE_HASH_FIXTURE_SQL } from "../apps/mobile/src/features/backup/data/NativeHashFixture.ts";
import { snapshotContentSha256 } from "../apps/mobile/src/features/backup/data/SnapshotContentHash.ts";
import { nodeSnapshotSql } from "./r06/NodeSnapshotSql.ts";
import { canonicalContentSha256 } from "./r06/SqliteBackup.ts";

// BKP-AUDIT-1 C5: the device self-check compares the Kotlin hash with this constant. It must stay pinned to two independent
// implementations (node:crypto oracle and the production JS protocol), otherwise a wrong constant would disable or wrongly trust native.
test("native hash self-check fixture: golden SHA-256 equals the independent oracle and the JS protocol", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(NATIVE_HASH_FIXTURE_SQL);
    assert.equal(canonicalContentSha256(db), NATIVE_HASH_FIXTURE_SHA256);
    assert.equal(await snapshotContentSha256(nodeSnapshotSql(db)), NATIVE_HASH_FIXTURE_SHA256);
    db.exec("UPDATE plain SET note='changed' WHERE id=7");
    assert.notEqual(canonicalContentSha256(db), NATIVE_HASH_FIXTURE_SHA256, "the fixture is sensitive to a single value");
  } finally { db.close(); }
});
