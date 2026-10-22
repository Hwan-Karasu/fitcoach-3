import assert from "node:assert/strict";
import { mkdtempSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DEV_CLIENTS_LEDGER, devClientCatalog } from "./d01/history/DevClientCatalog.ts";
import { formatHeightCmX10, parseHeightCmX10, validPastBirthDate } from
  "../apps/mobile/src/features/clients/domain/ClientProfileValidation.ts";
import { runMigrations } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import type { SqliteConnectionPort, SqliteStatementPort, SqlValue } from
  "../apps/mobile/src/shared/db/SqlitePort.ts";
import { WriterCoordinator } from "../apps/mobile/src/shared/db/WriterCoordinator.ts";
import { importHistoricalFixture } from "./support/import-historical-fixture.ts";

function sqlitePort(db: DatabaseSync): SqliteConnectionPort {
  db.exec("PRAGMA foreign_keys = ON");
  const statements: SqliteStatementPort = {
    run: async (sql: string, bindings: readonly SqlValue[] = []) => {
      const result = db.prepare(sql).run(...bindings);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    first: async <Row>(sql: string, bindings: readonly SqlValue[] = []): Promise<Row | null> =>
      (db.prepare(sql).get(...bindings) as Row | undefined) ?? null,
    all: async <Row>(sql: string, bindings: readonly SqlValue[] = []): Promise<readonly Row[]> =>
      db.prepare(sql).all(...bindings) as Row[],
  };
  return {
    ...statements,
    exclusive: async <T>(task: (tx: SqliteStatementPort) => Promise<T>): Promise<T> => {
      db.exec("BEGIN IMMEDIATE");
      try { const value = await task(statements); db.exec("COMMIT"); return value; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    close: async () => { db.close(); },
  };
}

test("F04 dev client store persists create/archive/restore across reopen with scoped CAS", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fitcoach-clients-"));
  const file = join(directory, "synthetic.db");
  const open = async () => sqlitePort(new DatabaseSync(file));
  const store = new DevClientRepository(open, "synthetic-workspace-a");
  try {
    await store.initialize();
    await assert.rejects(store.create({ displayName: "  " }), { message: "CLIENT_NAME_INVALID" });
    await assert.rejects(store.create({ displayName: "Synthetic", contactEmail: "invalid" }),
      { message: "CLIENT_EMAIL_INVALID" });
    const created = await store.create({ displayName: "  Synthetic Client  ",
      contactPhone: " 123 ", contactEmail: " test@example.invalid " });
    assert.match(created.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    assert.equal(created.displayName, "Synthetic Client");
    assert.equal(created.contactPhone, "123");
    assert.equal(created.revision, 1);
    assert.equal((await store.list("ACTIVE")).length, 1);
    const archived = await store.setArchived(created.id, 1, true);
    assert.equal(archived.lifecycle, "ARCHIVED");
    assert.equal(archived.revision, 2);
    assert.ok(archived.archivedAt);
    await assert.rejects(store.setArchived(created.id, 1, false),
      { message: "CLIENT_STALE_OR_WRONG_SCOPE" });
    assert.equal((await store.list("ACTIVE")).length, 0);
    await store.close();
    const reopened = new DevClientRepository(open, "synthetic-workspace-a");
    await reopened.initialize();
    assert.equal((await reopened.list("ARCHIVED"))[0]?.id, created.id);
    const restored = await reopened.setArchived(created.id, 2, false);
    assert.equal(restored.lifecycle, "ACTIVE");
    assert.equal(restored.archivedAt, null);
    await reopened.close();
    const otherWorkspace = new DevClientRepository(open, "synthetic-workspace-b");
    await otherWorkspace.initialize();
    assert.equal((await otherWorkspace.list("ACTIVE")).length, 0);
    await assert.rejects(otherWorkspace.setArchived(created.id, 3, true),
      { message: "CLIENT_STALE_OR_WRONG_SCOPE" });
    await otherWorkspace.close();
  } finally {
    await store.close();
    rmSync(file, { force: true });
    rmdirSync(directory);
  }
});

test("C03 client edit keeps the same ID and refuses stale or invalid writes", async () => {
  const db = new DatabaseSync(":memory:");
  const store = new DevClientRepository(async () => sqlitePort(db), "synthetic-workspace-a");
  await store.initialize();
  try {
    const created = await store.create({ displayName: "Before" });
    assert.equal((await store.get(created.id))?.displayName, "Before");
    const edited = await store.update(created.id, 1,
      { displayName: "After", contactEmail: "after@example.invalid" });
    assert.equal(edited.id, created.id);
    assert.equal(edited.revision, 2);
    assert.equal(edited.contactEmail, "after@example.invalid");
    await assert.rejects(store.update(created.id, 1, { displayName: "Stale" }),
      { message: "CLIENT_STALE_OR_WRONG_SCOPE" });
    assert.equal((await store.get(created.id))?.displayName, "After");
    await assert.rejects(store.update(created.id, 2,
      { displayName: "After", contactEmail: "bad" }), { message: "CLIENT_EMAIL_INVALID" });
    assert.equal((await store.get(created.id))?.revision, 2);
    assert.equal(await store.get("missing-id"), null);
  } finally { await store.close(); }
});

test("C03 basic profile validates dates and exact comma/dot height without inventing weight", async () => {
  assert.equal(parseHeightCmX10("172,5"), 1725);
  assert.equal(parseHeightCmX10("172.5"), 1725);
  assert.equal(parseHeightCmX10(""), null);
  assert.equal(parseHeightCmX10("172,55"), "invalid");
  assert.equal(parseHeightCmX10("0"), "invalid");
  assert.equal(formatHeightCmX10(1725), "172,5");
  assert.equal(validPastBirthDate("2000-02-29"), true);
  assert.equal(validPastBirthDate("2001-02-29"), false);
  assert.equal(validPastBirthDate("2999-01-01"), false);
  const db = new DatabaseSync(":memory:");
  const store = new DevClientRepository(async () => sqlitePort(db), "synthetic-workspace-a");
  await store.initialize();
  try {
    const created = await store.create({ displayName: "Synthetic Profile",
      birthDate: "2000-02-29", heightCmX10: 1725, emoji: "🏋️" });
    assert.equal(created.birthDate, "2000-02-29");
    assert.equal(created.heightCmX10, 1725);
    assert.equal(created.emoji, "🏋️");
    await assert.rejects(store.update(created.id, 1,
      { displayName: "Bad", birthDate: "2001-02-29" }), { message: "CLIENT_BIRTH_DATE_INVALID" });
    assert.equal((await store.get(created.id))?.revision, 1);
    const changed = await store.update(created.id, 1,
      { displayName: "Synthetic Profile", birthDate: null, heightCmX10: null, emoji: null });
    assert.equal(changed.birthDate, null);
    assert.equal(changed.heightCmX10, null);
    assert.equal(changed.emoji, null);
  } finally { await store.close(); }
});

test("F04 dev schema v7 upgrades an existing v1 client row in place", async () => {
  const db = new DatabaseSync(":memory:");
  const port = sqlitePort(db);
  await runMigrations(new WriterCoordinator(port), [devClientCatalog[0]!], DEV_CLIENTS_LEDGER);
  db.exec(`INSERT INTO workspaces VALUES ('synthetic-workspace-a','Synthetic','2026-01-01T00:00:00Z');
    INSERT INTO clients
      (id,workspace_id,display_name,contact_phone,contact_email,lifecycle,revision,
       created_at,updated_at,archived_at)
    VALUES ('synthetic-client','synthetic-workspace-a','Before',NULL,NULL,'ACTIVE',1,
      '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',NULL);`);
  const imported = await importHistoricalFixture(db, devClientCatalog, DEV_CLIENTS_LEDGER);
  const store = new DevClientRepository(imported.shared, "synthetic-workspace-a");
  await store.initialize();
  try {
    const row = await store.get("synthetic-client");
    assert.equal(row?.displayName, "Before");
    assert.equal(row?.birthDate, null);
    assert.equal(row?.heightCmX10, null);
    assert.equal(row?.sex, null, "пол у старой карточки не угадывается");
    assert.equal((imported.db.prepare("SELECT count(*) AS n FROM clients_schema_migrations").get() as { n: number }).n, 2);
  } finally { await store.close(); await port.close(); }
});

test("C01 recent is a scoped activity fact, not Client.updatedAt, and sort persists", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fitcoach-roster-"));
  const file = join(directory, "synthetic.db");
  const open = async () => sqlitePort(new DatabaseSync(file));
  const store = new DevClientRepository(open, "synthetic-workspace-a");
  try {
    await store.initialize();
    const a = await store.create({ displayName: "Alpha", birthDate: "2000-10-16" });
    const b = await store.create({ displayName: "Beta" });
    assert.equal(await store.getRosterSort(), "NAME");
    assert.deepEqual(await store.getBirthdaySettings(), {
      birthdayPinEnabled: true, birthdayPinLeadDays: 14, showBirthdayBadge: true,
    });
    await store.setRosterSort("RECENT");
    await assert.rejects(store.setBirthdaySettings({ birthdayPinEnabled: true,
      birthdayPinLeadDays: 61, showBirthdayBadge: true }),
    { message: "CLIENT_BIRTHDAY_SETTINGS_INVALID" });
    await store.setBirthdaySettings({ birthdayPinEnabled: true,
      birthdayPinLeadDays: 30, showBirthdayBadge: false });
    await store.dismissBirthday(a.id, "2026-10-16");
    await assert.rejects(store.dismissBirthday(a.id, "2026-10-17"),
      { message: "CLIENT_BIRTHDAY_DISMISSAL_INVALID" });
    assert.deepEqual((await store.listBirthdayDismissals()).map((item) => ({ ...item })),
      [{ clientId: a.id, occurrenceDate: "2026-10-16" }]);
    await store.recordRealOpen(b.id, "2026-10-15T10:00:00.000Z");
    await store.recordRealOpen(a.id, "2026-10-15T11:00:00.000Z");
    assert.equal((await store.get(a.id))?.updatedAt, a.updatedAt);
    const rows = await store.listRoster("ACTIVE");
    assert.equal(rows.find((row) => row.id === a.id)?.lastOpenedAt, "2026-10-15T11:00:00.000Z");
    assert.equal(rows.find((row) => row.id === b.id)?.lastOpenedAt, "2026-10-15T10:00:00.000Z");
    // CL-05: быстрая смена эмодзи меняет только эмодзи, с CAS; null возвращает инициалы.
    const withEmoji = await store.changeEmoji(b.id, b.revision, "💪");
    assert.equal(withEmoji.emoji, "💪");
    assert.equal(withEmoji.revision, b.revision + 1);
    assert.equal(withEmoji.displayName, "Beta");
    await assert.rejects(store.changeEmoji(b.id, b.revision, "🔥"), { message: "CLIENT_STALE_OR_WRONG_SCOPE" });
    await assert.rejects(store.changeEmoji(b.id, withEmoji.revision, "123456789"), { message: "CLIENT_EMOJI_INVALID" });
    assert.equal((await store.changeEmoji(b.id, withEmoji.revision, null)).emoji, null);
    await store.setArchived(a.id, a.revision, true);
    assert.equal((await store.listRoster("ARCHIVED"))[0]?.lastOpenedAt, null);
    await assert.rejects(store.recordRealOpen(a.id), { message: "CLIENT_OPEN_WRONG_SCOPE_OR_ARCHIVED" });
    await store.setArchived(a.id, a.revision + 1, false);
    assert.equal((await store.listRoster("ACTIVE")).find((row) => row.id === a.id)?.lastOpenedAt, null);
    await store.close();
    const reopened = new DevClientRepository(open, "synthetic-workspace-a");
    await reopened.initialize();
    assert.equal(await reopened.getRosterSort(), "RECENT");
    assert.deepEqual(await reopened.getBirthdaySettings(), {
      birthdayPinEnabled: true, birthdayPinLeadDays: 30, showBirthdayBadge: false,
    });
    assert.deepEqual((await reopened.listBirthdayDismissals()).map((item) => ({ ...item })),
      [{ clientId: a.id, occurrenceDate: "2026-10-16" }]);
    assert.equal((await reopened.listRoster("ACTIVE")).find((row) => row.id === b.id)?.lastOpenedAt,
      "2026-10-15T10:00:00.000Z");
    const otherWorkspace = new DevClientRepository(open, "synthetic-workspace-b");
    await otherWorkspace.initialize();
    assert.equal((await otherWorkspace.listRoster("ACTIVE")).length, 0);
    assert.equal(await otherWorkspace.getRosterSort(), "NAME");
    assert.deepEqual((await otherWorkspace.listBirthdayDismissals()).map((item) => ({ ...item })), []);
    await assert.rejects(otherWorkspace.recordRealOpen(b.id),
      { message: "CLIENT_OPEN_WRONG_SCOPE_OR_ARCHIVED" });
    await assert.rejects(otherWorkspace.dismissBirthday(a.id, "2026-10-16"),
      { message: "CLIENT_BIRTHDAY_DISMISSAL_INVALID" });
    await otherWorkspace.close();
    await reopened.close();
  } finally {
    await store.close();
    rmSync(file, { force: true });
    rmdirSync(directory);
  }
});

test("C03 recovery draft survives reopen and is cleared only by a committed client save", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fitcoach-client-draft-"));
  const file = join(directory, "synthetic.db");
  const open = async () => sqlitePort(new DatabaseSync(file));
  const form = { displayName: "Unsaved", contactPhone: "", contactEmail: "bad-input",
    birthDate: "", heightDraft: "172,55", emoji: null };
  const first = new DevClientRepository(open, "synthetic-workspace-a");
  try {
    await first.initialize();
    const saved = await first.saveDraft({ clientId: null, baseClientRevision: null, formData: form });
    assert.equal(saved.mode, "create");
    assert.equal((await first.list("ACTIVE")).length, 0);
    assert.equal((await first.saveDraft({ clientId: null, baseClientRevision: null,
      formData: { ...form, displayName: "Still Unsaved" } })).id, saved.id);
    await first.close();
    const second = new DevClientRepository(open, "synthetic-workspace-a");
    await second.initialize();
    assert.equal((await second.loadDraft(null))?.formData.displayName, "Still Unsaved");
    await assert.rejects(second.create({ displayName: "Invalid", contactEmail: "bad-input" }),
      { message: "CLIENT_EMAIL_INVALID" });
    assert.equal((await second.loadDraft(null))?.id, saved.id);
    const client = await second.create({ displayName: "Committed" });
    assert.equal((await second.loadDraft(null)), null);
    const editForm = { ...form, displayName: "Edit Draft" };
    await second.saveDraft({ clientId: client.id, baseClientRevision: client.revision,
      formData: editForm });
    await assert.rejects(second.update(client.id, 99, { displayName: "Nope" }),
      { message: "CLIENT_STALE_OR_WRONG_SCOPE" });
    assert.equal((await second.loadDraft(client.id))?.formData.displayName, "Edit Draft");
    await second.update(client.id, client.revision, { displayName: "Committed Edit" });
    assert.equal(await second.loadDraft(client.id), null);
    await second.saveDraft({ clientId: null, baseClientRevision: null, formData: form });
    await second.close();
    const ageDraft = new DatabaseSync(file);
    try {
      ageDraft.prepare("UPDATE client_recovery_drafts SET updated_at = ?")
        .run("2020-01-01T00:00:00.000Z");
    } finally { ageDraft.close(); }
    const third = new DevClientRepository(open, "synthetic-workspace-a");
    await third.initialize();
    assert.equal(await third.loadDraft(null), null);
    await third.close();
  } finally {
    await first.close();
    rmSync(file, { force: true });
    rmdirSync(directory);
  }
});

function rowCount(db: DatabaseSync, table: string, clientId: string): number {
  return (db.prepare(`SELECT count(*) AS n FROM ${table} WHERE client_id = ?`)
    .get(clientId) as { n: number }).n;
}

test("C04 permanent delete: archived only, explicit owner manifest, other client untouched", async () => {
  const db = new DatabaseSync(":memory:");
  const store = new DevClientRepository(async () => sqlitePort(db), "synthetic-workspace-a");
  await store.initialize();
  try {
    const a = await store.create({ displayName: "Alpha", birthDate: "2000-10-16" });
    const b = await store.create({ displayName: "Beta", birthDate: "2000-10-16" });
    for (const client of [a, b]) {
      await store.recordRealOpen(client.id, "2026-10-15T10:00:00.000Z");
      await store.dismissBirthday(client.id, "2026-10-16");
      await store.saveDraft({ clientId: client.id, baseClientRevision: client.revision,
        formData: { displayName: "Draft", contactPhone: "", contactEmail: "", birthDate: "",
          heightDraft: "", emoji: null } });
    }
    assert.deepEqual({ ...(await store.countByLifecycle()) }, { active: 2, archived: 0 });
    // CA-03: an active client cannot be previewed or deleted permanently.
    await assert.rejects(store.previewPermanentDelete(a.id), { message: "CLIENT_NOT_ARCHIVED" });
    await assert.rejects(store.deleteArchivedPermanently(a.id, a.revision),
      { message: "CLIENT_NOT_ARCHIVED" });
    assert.equal((await store.get(a.id))?.lifecycle, "ACTIVE");
    // Archive drops the activity fact; drafts and dismissals remain until permanent delete.
    const archived = await store.setArchived(a.id, a.revision, true);
    assert.deepEqual({ ...(await store.countByLifecycle()) }, { active: 1, archived: 1 });
    // CA-05: preview is read-only; cancelling after it changes nothing.
    const manifest = await store.previewPermanentDelete(a.id);
    assert.equal(manifest.displayName, "Alpha");
    assert.equal(manifest.revision, archived.revision);
    assert.deepEqual(manifest.owners.map((entry) => ({ ...entry })), [
      { owner: "clients.profile", rows: 1 },
      { owner: "clients.recoveryDrafts", rows: 1 },
      { owner: "clients.activity", rows: 0 },
      { owner: "clients.birthdayDismissals", rows: 1 },
    ]);
    assert.equal((await store.get(a.id))?.revision, archived.revision);
    assert.equal(rowCount(db, "client_recovery_drafts", a.id), 1);
    await assert.rejects(store.deleteArchivedPermanently(a.id, archived.revision - 1),
      { message: "CLIENT_STALE_OR_WRONG_SCOPE" });
    assert.equal((await store.get(a.id))?.lifecycle, "ARCHIVED");
    await store.deleteArchivedPermanently(a.id, archived.revision);
    // CA-04: A is fully gone, B keeps every owned row.
    assert.equal(await store.get(a.id), null);
    for (const table of ["client_recovery_drafts", "client_activity", "birthday_dismissals"]) {
      assert.equal(rowCount(db, table, a.id), 0, table);
      assert.equal(rowCount(db, table, b.id), 1, table);
    }
    assert.deepEqual({ ...(await store.countByLifecycle()) }, { active: 1, archived: 0 });
    await assert.rejects(store.deleteArchivedPermanently(a.id, archived.revision),
      { message: "CLIENT_NOT_FOUND" });
  } finally { await store.close(); }
});

test("C04 permanent delete fails closed on an unknown client-owned table", async () => {
  const db = new DatabaseSync(":memory:");
  const store = new DevClientRepository(async () => sqlitePort(db), "synthetic-workspace-a");
  await store.initialize();
  try {
    const client = await store.create({ displayName: "Guarded" });
    await store.saveDraft({ clientId: client.id, baseClientRevision: client.revision,
      formData: { displayName: "Draft", contactPhone: "", contactEmail: "", birthDate: "",
        heightDraft: "", emoji: null } });
    const archived = await store.setArchived(client.id, client.revision, true);
    db.exec(`CREATE TABLE synthetic_future_owner (id TEXT PRIMARY KEY, client_id TEXT)`);
    await assert.rejects(store.deleteArchivedPermanently(client.id, archived.revision),
      { message: "CLIENT_DELETION_BLOCKED" });
    assert.equal((await store.get(client.id))?.lifecycle, "ARCHIVED");
    assert.equal(rowCount(db, "client_recovery_drafts", client.id), 1);
  } finally { await store.close(); }
});

test("C04 archive sort persists across reopen and stays workspace-scoped", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fitcoach-archive-sort-"));
  const file = join(directory, "synthetic.db");
  const open = async () => sqlitePort(new DatabaseSync(file));
  const first = new DevClientRepository(open, "synthetic-workspace-a");
  try {
    await first.initialize();
    assert.equal(await first.getArchiveSort(), "ARCHIVED_AT");
    await first.setArchiveSort("NAME");
    await assert.rejects(first.setArchiveSort("BAD" as "NAME"), { message: "CLIENT_ARCHIVE_SORT_INVALID" });
    assert.equal(await first.getRosterSort(), "NAME");
    await first.close();
    const reopened = new DevClientRepository(open, "synthetic-workspace-a");
    await reopened.initialize();
    assert.equal(await reopened.getArchiveSort(), "NAME");
    await reopened.close();
    const other = new DevClientRepository(open, "synthetic-workspace-b");
    await other.initialize();
    assert.equal(await other.getArchiveSort(), "ARCHIVED_AT");
    assert.deepEqual({ ...(await other.countByLifecycle()) }, { active: 0, archived: 0 });
    await other.close();
  } finally {
    await first.close();
    rmSync(file, { force: true });
    rmSync(`${file}-wal`, { force: true });
    rmSync(`${file}-shm`, { force: true });
    rmdirSync(directory);
  }
});
