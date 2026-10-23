import assert from "node:assert/strict";
import test from "node:test";
import { BackupStorageError, backupFilename, parsePublishedBackup } from "../apps/mobile/src/features/backup/domain/BackupPublication.ts";

const source = { sourceUri: "file:///private/synthetic.atbackup", backupId: "10000000-0000-4000-8000-000000000001",
  createdAt: "2026-10-23T15:24:05.000Z", sha256: "a".repeat(64), bytes: 12288 };
const filename = "athlete-diary-20261023-152405-10000000-0000-4000-8000-000000000001.atbackup";
const good = { ok: true, uri: "content://media/external_primary/downloads/42", filename, sha256: "a".repeat(64), bytes: 12288 };

test("R06 publication binds the native receipt to the exact verified snapshot and readable content URI", () => {
  assert.equal(backupFilename(source), filename);
  assert.deepEqual(parsePublishedBackup(good, source), { uri: good.uri, filename, sha256: source.sha256, bytes: 12288 });
});
for (const [name, changed] of Object.entries({ digest: { sha256: "b".repeat(64) }, incomplete: { bytes: 12287 },
  anotherBackup: { filename: "another.atbackup" }, privateFile: { uri: "file:///private/staging.db" },
  arbitraryUri: { uri: "https://example.test/backup" }, missingAuthority: { uri: "content:///42" },
  rawError: { error: "PRIVATE_PATH_OR_PLATFORM_MESSAGE" }, missingSuccess: { ok: undefined } })) {
  test(`R06 publication rejects native ${name} without declaring a completed backup`, () => {
    assert.throws(() => parsePublishedBackup({ ...good, ...changed }, source), BackupStorageError);
  });
}
test("R06 publication propagates only known content-free failure codes", () => {
  assert.throws(() => parsePublishedBackup({ ok: false, code: "BACKUP_LOCATION_UNSUPPORTED" }, source),
    (error: unknown) => error instanceof BackupStorageError && error.code === "BACKUP_LOCATION_UNSUPPORTED");
  assert.throws(() => parsePublishedBackup({ ok: false, code: "PRIVATE_PATH_OR_NATIVE_EXCEPTION" }, source),
    (error: unknown) => error instanceof BackupStorageError && error.message === "BACKUP_PUBLICATION_INVALID");
});
test("R06 publication rejects invalid identity/date even when a native caller claims success", () => {
  for (const changed of [{ backupId: "../../untrusted" }, { createdAt: "2026-02-30T15:24:05.000Z" }, { createdAt: "not-a-date" }]) {
    assert.throws(() => parsePublishedBackup(good, { ...source, ...changed }), BackupStorageError);
  }
});
