import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { selectLegacySource, type LegacySourceCandidate } from "./r02/LegacySourceSelection.ts";
import { auditLegacyCopy, hasSingleAuditCopyArgument } from "./r03/AuditLegacyCopy.ts";
import { createSyntheticLegacyFixture, syntheticFixtureManifest } from "./r03/SyntheticLegacyFixture.ts";
import { readLegacyNutritionEntryEvidenceInSnapshot } from "./r04/LegacyNutritionEntrySourceReader.ts";
import { summarizeNutritionEntryIdentity } from "./r04/NutritionEntryIdentityReport.ts";

function inSyntheticTempFiles(count: number, run: (paths: readonly string[]) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "fitcoach-r03-synthetic-"));
  const paths = Array.from({ length: count }, (_, index) => join(directory, `source-${index + 1}.atbackup`));
  try { run(paths); }
  finally {
    for (const path of paths) if (existsSync(path)) unlinkSync(path);
    rmdirSync(directory);
  }
}

function inSyntheticTempFile(run: (path: string) => void): void {
  inSyntheticTempFiles(1, (paths) => run(paths[0]!));
}

test("R03: file-backed synthetic source is audited read-only and never certified", () => {
  inSyntheticTempFile((path) => {
    const db = createSyntheticLegacyFixture(path);
    db.close();
    const before = createHash("sha256").update(readFileSync(path)).digest("hex");
    const report = auditLegacyCopy(path);
    const after = createHash("sha256").update(readFileSync(path)).digest("hex");
    assert.equal(after, before);
    if (report.status === "blocked") return assert.fail("synthetic source unexpectedly blocked");
    assert.equal(report.status, "requires-semantic-review");
    assert.ok(report.reasons.includes("SOURCE_FACTS_UNVERIFIED"));
    assert.equal(report.collisions.sourceRows, 6);
    assert.ok(!JSON.stringify(report).includes("synthetic-client-"));
  });
});

test("R03: file-backed nutrition edge fixture remains byte-identical after identity read", () => {
  inSyntheticTempFile((path) => {
    createSyntheticLegacyFixture(path).close();
    const hash = () => createHash("sha256").update(readFileSync(path)).digest("hex");
    const before = hash();
    const source = new DatabaseSync(path, { readOnly: true });
    try {
      source.exec("PRAGMA query_only=ON");
      source.exec("BEGIN");
      const report = summarizeNutritionEntryIdentity(
        readLegacyNutritionEntryEvidenceInSnapshot(source, "synthetic-account-scope"));
      assert.equal(report.physicalDayRows, 4);
      assert.equal(report.physicalEntryRows, 3);
      assert.equal(report.unknownEntryMacroValues, 1);
      assert.equal(report.snapshotNumericStringMacroRows, 1);
      assert.equal(report.shapeCompleteButUnverifiedRows, 1);
      assert.equal(report.targetWrites, 0);
      source.exec("ROLLBACK");
    } finally { source.close(); }
    assert.equal(hash(), before);
  });
});

test("R03: corrupt SQLite bytes fail closed without echoing content or path", () => {
  inSyntheticTempFile((path) => {
    writeFileSync(path, "synthetic-invalid-sqlite", "utf8");
    const report = auditLegacyCopy(path);
    assert.deepEqual(report, { status: "blocked", reasons: ["SOURCE_AUDIT_FAILED"] });
    assert.ok(!JSON.stringify(report).includes(path));
    assert.ok(!JSON.stringify(report).includes("synthetic-invalid-sqlite"));
  });
});

test("R03: corrupted manifest is blocked before semantic audit", () => {
  inSyntheticTempFile((path) => {
    const db = createSyntheticLegacyFixture(path);
    db.prepare("UPDATE athlete_backup_manifest SET json=?").run("{synthetic-invalid-manifest");
    db.close();
    const report = auditLegacyCopy(path);
    assert.equal(report.status, "blocked");
    assert.ok(report.reasons.includes("MANIFEST_INVALID"));
    assert.ok(!JSON.stringify(report).includes("synthetic-invalid-manifest"));
  });
});

test("R03: absent source and multiple inputs never trigger an implicit choice", () => {
  inSyntheticTempFile((path) => {
    assert.deepEqual(auditLegacyCopy(path), { status: "blocked", reasons: ["SOURCE_AUDIT_FAILED"] });
    assert.equal(hasSingleAuditCopyArgument([path]), true);
    assert.equal(hasSingleAuditCopyArgument([path, path]), false);
    assert.equal(hasSingleAuditCopyArgument([]), false);
  });
});

test("R03: two valid account-scoped file sources remain separate and block selection", () => {
  inSyntheticTempFiles(2, (paths) => {
    const [firstPath, secondPath] = paths as [string, string];
    const first = createSyntheticLegacyFixture(firstPath);
    first.close();
    const second = createSyntheticLegacyFixture(secondPath);
    second.prepare("UPDATE account_database_binding SET scope_key=?").run("synthetic-second-account");
    second.prepare("UPDATE athlete_backup_manifest SET json=?").run(JSON.stringify({
      type: "manual", formatVersion: 1, schemaVersion: 25, sourceSchemaVersion: 28,
      accountScopeKey: "synthetic-second-account", appVersion: "2.0.0",
    }));
    second.close();
    const golden = syntheticFixtureManifest();
    for (const path of paths) {
      const source = new DatabaseSync(path, { readOnly: true });
      try {
        for (const [table, expected] of Object.entries(golden)) {
          // Table names are only from the fixed synthetic fixture catalog.
          const rows = source.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
          assert.equal(rows.length, expected.count);
          assert.equal(createHash("sha256").update(JSON.stringify(rows)).digest("hex"), expected.sha256);
        }
      } finally { source.close(); }
    }
    const before = paths.map((path) => createHash("sha256").update(readFileSync(path)).digest("hex"));
    const reports = paths.map((path) => auditLegacyCopy(path));
    assert.ok(reports.every((report) => report.status === "requires-semantic-review"));
    assert.deepEqual(paths.map((path) => createHash("sha256").update(readFileSync(path)).digest("hex")), before);
    const candidates: LegacySourceCandidate[] = [
      { sourceId: "synthetic-account-db-a", kind: "account-scoped", marker: "recognized", binding: "verified", schema: "supported" },
      { sourceId: "synthetic-account-db-b", kind: "account-scoped", marker: "recognized", binding: "verified", schema: "supported" },
    ];
    assert.deepEqual(selectLegacySource(candidates), { status: "blocked", reason: "AMBIGUOUS_SOURCE" });
    assert.ok(!JSON.stringify(reports).includes("synthetic-second-account"));
  });
});

test("R03: an unknown marker among multiple sources blocks before any merge", () => {
  const candidates: LegacySourceCandidate[] = [
    { sourceId: "synthetic-account-db-a", kind: "account-scoped", marker: "recognized", binding: "verified", schema: "supported" },
    { sourceId: "synthetic-account-db-b", kind: "account-scoped", marker: "unknown", binding: "verified", schema: "supported" },
  ];
  assert.deepEqual(selectLegacySource(candidates), { status: "blocked", reason: "UNKNOWN_MARKER" });
});
