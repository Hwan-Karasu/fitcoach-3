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

test("BKP-PERF-2 keyset pages give the oracle hash: page boundary, Cyrillic, int64 rowid, WITHOUT ROWID; NOCASE/NULL/mixed keys fall back", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE texts (id TEXT PRIMARY KEY NOT NULL, note TEXT);
      CREATE TABLE ints (id INTEGER PRIMARY KEY, value REAL);
      CREATE TABLE pairs (id TEXT PRIMARY KEY, n INTEGER) WITHOUT ROWID;
      CREATE TABLE exact (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE empty (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE nocase (id TEXT PRIMARY KEY COLLATE NOCASE, v TEXT);
      CREATE TABLE nullable (id TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE mixed (id PRIMARY KEY, v TEXT)`);
    const texts = db.prepare("INSERT INTO texts VALUES (?, ?)");
    for (let i = 0; i < 1203; i++) texts.run(`${["я", "Я", "a", "B", "é", ""][i % 6]}${i}`, i % 7 === 0 ? "Подход ✓" : `n${i}`);
    const ints = db.prepare("INSERT INTO ints VALUES (?, ?)");
    for (const id of [9223372036854775807n, -9223372036854775808n, 0n, -1n, 9007199254740993n]) ints.run(id, -0);
    for (let i = 1; i <= 700; i++) ints.run(BigInt(i * 1000), i / 3);
    const pairs = db.prepare("INSERT INTO pairs VALUES (?, ?)");
    for (let i = 0; i < 501; i++) pairs.run(`k${String(i).padStart(4, "0")}`, i);
    const exact = db.prepare("INSERT INTO exact VALUES (?)");
    for (let i = 0; i < 500; i++) exact.run(`e${i}`);
    db.exec(`INSERT INTO nocase VALUES ('b', '1'), ('A', '2'), ('c', '3');
      INSERT INTO nullable VALUES (NULL, 'x'), (NULL, 'y'), ('z', 'z');
      INSERT INTO mixed VALUES (1, 'int'), ('1', 'text'), (x'01', 'blob'), (2.5, 'real')`);
    let calls = 0; const port = nodeSnapshotSql(db);
    const counted = { ...port,
      all: async <Row>(sql: string, bindings?: readonly (string | number | null | Uint8Array)[]) => { calls++; return port.all<Row>(sql, bindings); },
      async *each<Row>(sql: string, bindings?: readonly (string | number | null | Uint8Array)[]) { for await (const row of port.each<Row>(sql, bindings)) { calls++; yield row; } } };
    const progress: [number, number][] = [];
    assert.equal(await snapshotContentSha256(counted, [], (done, total) => progress.push([done, total])), canonicalContentSha256(db));
    // 2 919 rows; per-row reads remain only for the 10 fallback rows (NOCASE, NULL, mixed).
    assert.ok(calls < 100, `calls=${calls}`);
    assert.deepEqual(progress.at(-1), [2919, 2919]);
    assert.deepEqual(progress[0], [0, 2919]);
  } finally { db.close(); }
});
