import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { snapshotContentSha256 } from "../apps/mobile/src/features/backup/data/SnapshotContentHash.ts";
import { SNAPSHOT_OWNER } from "../apps/mobile/src/features/backup/data/SnapshotCatalog.ts";
import { mediaDdl } from "./r06/SqliteBackupMedia.ts";
import { nodeSnapshotSql } from "./r06/NodeSnapshotSql.ts";
import { canonicalContentSha256 } from "./r06/SqliteBackup.ts";

test("R06 extracted snapshot catalog preserves original forward migration checksums", () => {
  const ddl = `CREATE TABLE at_backup_manifest (singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  json TEXT NOT NULL CHECK (json_valid(json) AND json_type(json) = 'object'))`;
  const expected = [ddl, mediaDdl.join("\n")].map((sql) => createHash("sha256").update(sql).digest("hex"));
  assert.deepEqual(SNAPSHOT_OWNER.chain.map((step) => step.checksum), expected);
  console.info(`R06_FROZEN_SNAPSHOT_CHECKSUMS ${JSON.stringify(expected)}`);
});

test("R06 portable content hash matches node oracle for exact int64, REAL edge values, binary/text/null and duplicate rows", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE atoms (a, b TEXT COLLATE NOCASE, c BLOB);
      INSERT INTO atoms VALUES (9223372036854775807,'A',x'00ff'),(-9223372036854775808,'a',x'00ff'),(NULL,'',NULL),('12','a',x''),('12','a',x'');
      CREATE INDEX atoms_b ON atoms(b)`);
    const insert = db.prepare("INSERT INTO atoms VALUES (?, 'real', NULL)");
    for (const value of [0.1, -0, 1.2345678901234567, Math.PI, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE,
      Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 2 ** -1022, Infinity, -Infinity]) insert.run(value);
    const expected = canonicalContentSha256(db);
    assert.equal(await snapshotContentSha256(nodeSnapshotSql(db)), expected);
    db.exec("DELETE FROM atoms WHERE rowid=(SELECT max(rowid) FROM atoms WHERE a='12')");
    assert.notEqual(await snapshotContentSha256(nodeSnapshotSql(db)), expected);
  } finally { db.close(); }
});
