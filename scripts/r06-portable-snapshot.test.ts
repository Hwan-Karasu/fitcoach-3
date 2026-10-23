import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { snapshotContentSha256 } from "../apps/mobile/src/features/backup/data/SnapshotContentHash.ts";
import { SNAPSHOT_OWNER, mediaDdl } from "../apps/mobile/src/features/backup/data/SnapshotCatalog.ts";
import { nodeSnapshotSql } from "./r06/NodeSnapshotSql.ts";
import { canonicalContentSha256 } from "./r06/SqliteBackup.ts";
import { R06_SCALAR_FIXTURE_SHA256, R06_SCALAR_FIXTURE_SQL } from "../apps/mobile/src/app/composition/r06ScalarFixture.ts";
import { embedRecipePhotos, verifyRecipePhotos } from "../apps/mobile/src/features/backup/data/SnapshotMedia.ts";
import { SnapshotError } from "../apps/mobile/src/features/backup/domain/SnapshotManifest.ts";
import type { SnapshotMediaPort } from "../apps/mobile/src/features/backup/data/SnapshotMediaPort.ts";

test("R06 extracted snapshot catalog preserves original forward migration checksums", () => {
  // Independent golden values from the original host catalog, before extraction.
  const expected = ["10a8e7f4fc13630bc00babb545f4ea63180f279ec409115ab08dd431ea68933d",
    "48661e54e04ce637d4fdb467e23b4a6db7904cffb0c2e43cc0fd1bde540d0195"];
  assert.deepEqual(SNAPSHOT_OWNER.chain.map((step) => step.checksum), expected);
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

test("R06 native SQL fixture contains the same SQLite values as the independent Node oracle", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(R06_SCALAR_FIXTURE_SQL);
    assert.equal(canonicalContentSha256(db), R06_SCALAR_FIXTURE_SHA256);
    assert.equal(await snapshotContentSha256(nodeSnapshotSql(db)), R06_SCALAR_FIXTURE_SHA256);
  } finally { db.close(); }
});

for (const changed of [false, true]) test(`R06 short media reads are assembled; changed source=${changed} ${changed ? "rolls back all private metadata" : "retains exact bytes"}`, async () => {
  const db = new DatabaseSync(":memory:");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4HsAAAAASUVORK5CYII=", "base64");
  let closed = false; let unchangedChecked = false; let offset = 0;
  const files: SnapshotMediaPort = {
    async openSource() {
      return { size: png.length, async read(bytes) {
        const part = png.subarray(offset, offset + Math.min(bytes, 7)); offset += part.length; return part;
      }, async assertUnchanged() {
        unchangedChecked = true;
        if (changed) throw new SnapshotError("SNAPSHOT_INCOMPLETE_MEDIA");
      }, close() { closed = true; } };
    },
    async publishVerified() { throw new Error("NOT_EXTRACTING"); },
  };
  try {
    db.exec("CREATE TABLE recipes (id TEXT, details_json TEXT)");
    db.prepare("INSERT INTO recipes VALUES (?, ?)").run("synthetic", JSON.stringify({ photoUri: "file:///synthetic.png" }));
    const port = nodeSnapshotSql(db);
    const embed = () => port.transaction(async (tx) => {
      for (const sql of mediaDdl) await tx.run(sql);
      return embedRecipePhotos(tx, { files });
    });
    if (changed) {
      await assert.rejects(embed(), (error: unknown) => error instanceof SnapshotError && error.code === "SNAPSHOT_INCOMPLETE_MEDIA");
      assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name), ["recipes"]);
    } else {
      const summary = await embed();
      await verifyRecipePhotos(port, summary);
      assert.deepEqual(Buffer.from(db.prepare("SELECT data FROM at_backup_media_chunks").get()!.data as Uint8Array), png);
    }
    assert.ok(closed && unchangedChecked);
  } finally { db.close(); }
});
