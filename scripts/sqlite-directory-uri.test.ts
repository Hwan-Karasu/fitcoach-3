import assert from "node:assert/strict";
import test from "node:test";
import { sqliteDirectoryUri } from "../apps/mobile/src/shared/db/SqliteDirectoryUri.ts";

test("Android SQLite native directory path becomes a file URI accepted by Expo filesystem", () => {
  assert.equal(sqliteDirectoryUri("/data/user/0/synthetic/files/SQLite"), "file:///data/user/0/synthetic/files/SQLite");
});
test("SQLite directory preserves an existing file URI without double encoding", () => {
  assert.equal(sqliteDirectoryUri("file:///private/synthetic%20workspace/SQLite"), "file:///private/synthetic%20workspace/SQLite");
});
test("SQLite native path escapes spaces, hash and literal percent separately from existing URI encoding", () => {
  assert.equal(sqliteDirectoryUri("/private/Library #1/%40workspace/SQLite"), "file:///private/Library%20%231/%2540workspace/SQLite");
});
test("SQLite directory rejects relative paths, foreign schemes, authorities and traversal", () => {
  for (const value of ["", "SQLite", "https://example.test/SQLite", "content://documents/SQLite", "file://remote/SQLite", "/private/../SQLite", "file:///private/%2e%2e/SQLite"]) {
    assert.throws(() => sqliteDirectoryUri(value), /SQLITE_DIRECTORY_INVALID/u);
  }
});
