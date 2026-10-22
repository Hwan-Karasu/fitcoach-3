import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { createSqliteBackup, prepareBackupForRestore, SnapshotError, validateSqliteBackup, canonicalContentSha256 } from "./r06/SqliteBackup.ts";
import { MEDIA_CHUNK_BYTES } from "./r06/SqliteBackupMedia.ts";
import { prepareProductionDatabase, inspectProductionDatabase, PRODUCTION_WORKSPACE_ID as WS } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4HsAAAAASUVORK5CYII=", "base64");
const NOW = "2026-10-22T10:00:00.000Z";
const metadata = () => ({ backupId: randomUUID(), createdAt: NOW });
const code = (expected: SnapshotError["code"]) => (error: unknown) => error instanceof SnapshotError && error.code === expected;
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "athlete-backup-media-"));
  const sourceRoot = join(directory, "old-images"); const restoredRoot = join(directory, "new-images");
  mkdirSync(sourceRoot); mkdirSync(restoredRoot);
  const file = join(directory, "source.db");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(file)));
  await prepareProductionDatabase(shared);
  const db = new DatabaseSync(file);
  const sourcePhoto = join(sourceRoot, "old-photo.dat"); writeFileSync(sourcePhoto, PNG);
  const addRecipe = (photoUri = pathToFileURL(sourcePhoto).href, archived = false) => {
    const id = randomUUID();
    const details = { prepMinutes: 0, cookMinutes: 5, categories: ["Synthetic"], photoUri, steps: ["Step"], preservedUnknown: { zero: 0, flag: false } };
    db.prepare(`INSERT INTO recipes (id, workspace_id, name, servings_x10, revision, created_at, updated_at, details_json, archived_at)
      VALUES (?, ?, ?, 10, 7, ?, ?, ?, ?)`).run(id, WS, "Synthetic photo recipe", NOW, NOW, JSON.stringify(details, null, 2), archived ? NOW : null);
    return id;
  };
  return { directory, file, db, sourceRoot, restoredRoot, sourcePhoto, addRecipe, destination: join(directory, "copy.atbackup"),
    partial: join(directory, "copy.partial"), staging: join(directory, "staging.db"),
    cleanup: () => { if (db.isOpen) db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test("R06 one SQLite file embeds bounded media chunks and restores after losing original DB and photos", async () => {
  const f = await fixture();
  try {
    const image = Buffer.concat([PNG, Buffer.alloc(MEDIA_CHUNK_BYTES * 2 + 19, 71)]);
    writeFileSync(f.sourcePhoto, image);
    const recipeId = f.addRecipe();
    const before = f.db.prepare("SELECT * FROM recipes WHERE id=?").get(recipeId)!;
    const sourceBytes = readFileSync(f.file);
    const m = await createSqliteBackup(f.db, f.partial, f.destination, metadata(), { mediaRoot: f.sourceRoot });
    assert.equal(m.media?.entries, 1); assert.equal(m.media?.bytes, image.length);
    assert.deepEqual(readFileSync(f.file), sourceBytes);
    assert.deepEqual(readFileSync(f.sourcePhoto), image);
    const copy = new DatabaseSync(f.destination, { readOnly: true });
    try {
      assert.equal(copy.prepare("SELECT count(*) AS n FROM at_backup_media_chunks").get()?.n, 3);
      assert.ok(Number(copy.prepare("SELECT max(length(data)) AS n FROM at_backup_media_chunks").get()?.n) <= MEDIA_CHUNK_BYTES);
    } finally { copy.close(); }
    const saved = readFileSync(f.destination);
    f.db.close(); rmSync(f.file); rmSync(f.sourceRoot, { recursive: true });
    writeFileSync(join(f.restoredRoot, "current-photo.png"), PNG);
    assert.deepEqual(await validateSqliteBackup(f.destination), m, "validation never opens old media URIs");
    await prepareBackupForRestore(f.destination, f.staging, { mediaRoot: f.restoredRoot });
    const staging = new DatabaseSync(f.staging, { readOnly: true });
    try {
      assert.equal(await inspectProductionDatabase(nodeSqlitePort(staging)), "OWNED");
      const after = staging.prepare("SELECT * FROM recipes WHERE id=?").get(recipeId)!;
      const details = JSON.parse(String(after.details_json)) as Record<string, unknown>;
      const uri = String(details.photoUri);
      assert.ok(fileURLToPath(uri).startsWith(f.restoredRoot));
      assert.ok(uri.endsWith(".png"), "extension comes from image signature, not old filename");
      assert.deepEqual(readFileSync(fileURLToPath(uri)), image);
      assert.deepEqual({ ...after, details_json: before.details_json }, { ...before }, "revisions/dates and every other column stay exact");
      assert.deepEqual({ ...details, photoUri: pathToFileURL(f.sourcePhoto).href }, JSON.parse(String(before.details_json)));
      assert.equal(canonicalContentSha256(staging, [{ id: recipeId, sourceUri: pathToFileURL(f.sourcePhoto).href,
        originalJson: String(before.details_json), restoredUri: uri }]), m.contentSha256);
      assert.notEqual(canonicalContentSha256(staging), m.contentSha256, "only intentional URI relocation changes logical checksum");
    } finally { staging.close(); }
    assert.deepEqual(readFileSync(f.destination), saved);
    assert.deepEqual(readFileSync(join(f.restoredRoot, "current-photo.png")), PNG);
  } finally { f.cleanup(); }
});

test("R06 shared and archived recipe photos are fully covered; extraction replay reuses only exact bytes", async () => {
  const f = await fixture();
  try {
    f.addRecipe(); f.addRecipe(undefined, true);
    const m = await createSqliteBackup(f.db, f.partial, f.destination, metadata(), { mediaRoot: f.sourceRoot });
    assert.equal(m.media?.entries, 1);
    const restoreId = randomUUID();
    await prepareBackupForRestore(f.destination, f.staging, { mediaRoot: f.restoredRoot, restoreId });
    const files = readdirSync(f.restoredRoot); assert.equal(files.length, 1);
    const output = join(f.restoredRoot, files[0]!);
    await prepareBackupForRestore(f.destination, join(f.directory, "second.db"), { mediaRoot: f.restoredRoot, restoreId });
    assert.deepEqual(readdirSync(f.restoredRoot), files);
    writeFileSync(output, "existing unrelated file");
    await assert.rejects(prepareBackupForRestore(f.destination, join(f.directory, "third.db"), { mediaRoot: f.restoredRoot, restoreId }));
    assert.equal(readFileSync(output, "utf8"), "existing unrelated file");
  } finally { f.cleanup(); }
});

for (const kind of ["missing", "empty", "outside root", "traversal", "symlink escape", "directory", "remote URI", "non-image"] as const) {
  test(`R06 ${kind} media cannot publish a misleading complete backup`, async () => {
    const f = await fixture();
    try {
      let uri = pathToFileURL(f.sourcePhoto).href;
      if (kind === "missing") rmSync(f.sourcePhoto);
      if (kind === "empty") writeFileSync(f.sourcePhoto, Buffer.alloc(0));
      if (kind === "non-image") writeFileSync(f.sourcePhoto, "not an image");
      if (kind === "outside root" || kind === "traversal") {
        const outside = join(f.directory, "outside.png"); writeFileSync(outside, PNG);
        uri = kind === "traversal" ? `${pathToFileURL(f.sourceRoot).href}/%2e%2e/outside.png` : pathToFileURL(outside).href;
      }
      if (kind === "symlink escape") {
        const outside = join(f.directory, "outside-folder"); mkdirSync(outside); writeFileSync(join(outside, "photo.png"), PNG);
        const junction = join(f.sourceRoot, "escaped"); symlinkSync(outside, junction, "junction");
        uri = pathToFileURL(join(junction, "photo.png")).href;
      }
      if (kind === "directory") uri = pathToFileURL(f.sourceRoot).href;
      if (kind === "remote URI") uri = "https://example.invalid/photo.png";
      f.addRecipe(uri);
      const before = readFileSync(f.file);
      await assert.rejects(createSqliteBackup(f.db, f.partial, f.destination, metadata(), { mediaRoot: f.sourceRoot }), code("SNAPSHOT_INCOMPLETE_MEDIA"));
      assert.equal(existsSync(f.destination), false);
      assert.deepEqual(readFileSync(f.file), before);
    } finally { f.cleanup(); }
  });
}

for (const kind of ["missing chunk", "changed bytes", "wrong chunk position", "wrong length", "manifest count", "unreferenced asset"] as const) {
  test(`R06 backup media ${kind} fails before extraction or candidate creation`, async () => {
    const f = await fixture();
    try {
      f.addRecipe();
      await createSqliteBackup(f.db, f.partial, f.destination, metadata(), { mediaRoot: f.sourceRoot });
      const copy = new DatabaseSync(f.destination);
      if (kind === "missing chunk") copy.exec("DELETE FROM at_backup_media_chunks");
      if (kind === "changed bytes") {
        const bytes = Buffer.from(PNG); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
        copy.prepare("UPDATE at_backup_media_chunks SET data=?").run(bytes);
      }
      if (kind === "wrong chunk position") copy.exec("UPDATE at_backup_media_chunks SET position=9");
      if (kind === "wrong length") copy.exec("UPDATE at_backup_media SET byte_length=byte_length+1");
      if (kind === "manifest count") copy.exec("UPDATE at_backup_manifest SET json=json_set(json,'$.media.entries',7)");
      if (kind === "unreferenced asset") copy.exec("UPDATE at_backup_media SET source_uri='file:///unreferenced.png'");
      copy.close();
      const before = readFileSync(f.destination);
      await assert.rejects(prepareBackupForRestore(f.destination, f.staging, { mediaRoot: f.restoredRoot }), code("SNAPSHOT_INVALID"));
      assert.equal(existsSync(f.staging), false);
      assert.deepEqual(readdirSync(f.restoredRoot), []);
      assert.deepEqual(readFileSync(f.destination), before);
    } finally { f.cleanup(); }
  });
}

test("R06 original metadata-only prototype remains readable without destructive schema rebuild", async () => {
  const f = await fixture();
  try {
    await createSqliteBackup(f.db, f.partial, f.destination, metadata());
    const copy = new DatabaseSync(f.destination);
    copy.exec(`DROP TABLE at_backup_media_chunks; DROP TABLE at_backup_media;
      DELETE FROM at_backup_schema_migrations WHERE version=2;
      UPDATE at_backup_manifest SET json=json_remove(json,'$.media')`);
    copy.close();
    const before = readFileSync(f.destination);
    assert.equal((await validateSqliteBackup(f.destination)).media, undefined);
    await prepareBackupForRestore(f.destination, f.staging);
    assert.deepEqual(readFileSync(f.destination), before);
  } finally { f.cleanup(); }
});

for (const phase of ["EMBEDDED", "WRITING", "PUBLISHED"] as const) {
  test(`R06 actual process death during media ${phase}: old data and copy survive, new attempt succeeds`, async () => {
    const f = await fixture();
    try {
      writeFileSync(f.sourcePhoto, Buffer.concat([PNG, Buffer.alloc(MEDIA_CHUNK_BYTES * 2, 73)]));
      const recipeId = f.addRecipe();
      const manifest = await createSqliteBackup(f.db, f.partial, f.destination, metadata(), { mediaRoot: f.sourceRoot });
      f.db.close();
      const current = readFileSync(f.file); const backup = readFileSync(f.destination);
      writeFileSync(join(f.restoredRoot, "current-photo.png"), PNG);
      const child = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./r06/backup-media-crash-worker.ts", import.meta.url)), f.directory, phase],
        { encoding: "utf8", timeout: 20_000, windowsHide: true });
      assert.ok(!child.error, String(child.error));
      assert.ok(child.signal !== null || child.status !== 0, "child must actually die at a media boundary");
      assert.equal(child.stderr.includes("Error:"), false, child.stderr);
      assert.deepEqual(readFileSync(f.file), current);
      assert.deepEqual(readFileSync(f.destination), backup);
      assert.deepEqual(readFileSync(join(f.restoredRoot, "current-photo.png")), PNG);
      if (phase === "EMBEDDED") {
        assert.equal(existsSync(join(f.directory, "interrupted.atbackup")), false);
        const source = new DatabaseSync(f.file);
        try {
          const next = await createSqliteBackup(source, join(f.directory, "retry.partial"), join(f.directory, "retry.atbackup"), metadata(), { mediaRoot: f.sourceRoot });
          assert.equal(next.contentSha256, manifest.contentSha256);
        } finally { source.close(); }
      } else {
        // A new attempt uses a new staging file and fresh private image names, no overwrite.
        const prepared = await prepareBackupForRestore(f.destination, f.staging, { mediaRoot: f.restoredRoot });
        assert.equal(prepared.contentSha256, manifest.contentSha256);
        const db = new DatabaseSync(f.staging, { readOnly: true });
        try {
          const details = JSON.parse(String(db.prepare("SELECT details_json FROM recipes WHERE id=?").get(recipeId)?.details_json)) as { photoUri: string };
          assert.deepEqual(readFileSync(fileURLToPath(details.photoUri)), readFileSync(f.sourcePhoto));
        } finally { db.close(); }
      }
    } finally { f.cleanup(); }
  });
}
