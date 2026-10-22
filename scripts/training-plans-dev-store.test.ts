import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { membersWord, validateCreate } from "../apps/mobile/src/features/training/plans/domain/ProgramRules.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";
const DAY1 = new Date(2026, 9, 17, 9, 0);
const DAY2 = new Date(2026, 9, 17, 10, 0);

async function stores() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingPlansClientDeletionParticipant]);
  await clients.initialize();
  const plans = new DevTrainingPlansRepository(shared, WS);
  await plans.initialize();
  const close = async () => { await plans.close(); await clients.close(); };
  return { db, clients, plans, close };
}

const message = (code: string) => (error: unknown) => error instanceof Error && error.message.includes(code);

test("T01 правила: название обязательно, простая — один клиент, расширенная — один или несколько", () => {
  assert.deepEqual(validateCreate({ kind: "PERIODIZED", title: "  Сила   весна ", clientIds: ["a", "b", "a", " "] }),
    { kind: "PERIODIZED", title: "Сила весна", clientIds: ["a", "b"] });
  assert.throws(() => validateCreate({ kind: "SIMPLE", title: " ", clientIds: ["a"] }), message("DRAFT_INVALID"));
  assert.throws(() => validateCreate({ kind: "SIMPLE", title: "База", clientIds: ["a", "b"] }), message("PARTICIPANT_CONFLICT"));
  assert.throws(() => validateCreate({ kind: "PERIODIZED", title: "База", clientIds: [] }), message("DRAFT_INVALID"));
  assert.equal(membersWord(1), "1 участник");
  assert.equal(membersWord(3), "3 участника");
  assert.equal(membersWord(11), "11 участников");
});

test("T01 библиотеки клиентов A и B изолированы; общая расширенная видна обоим", async () => {
  const { clients, plans, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const b = await clients.create({ displayName: "SyntheticB" });
    const simple = await plans.createProgram({ kind: "SIMPLE", title: "База A", clientIds: [a.id] }, DAY1);
    const shared = await plans.createProgram({ kind: "PERIODIZED", title: "Блок", clientIds: [a.id, b.id] }, DAY2);
    const libraryA = await plans.getLibrary(a.id);
    const libraryB = await plans.getLibrary(b.id);
    assert.deepEqual(libraryA.active.map((card) => card.title), ["Блок", "База A"], "новые сверху");
    assert.deepEqual(libraryB.active.map((card) => card.title), ["Блок"]);
    assert.equal(libraryA.active[0]!.memberCount, 2);
    assert.equal(await plans.getProgram(b.id, simple.id), null, "чужая программа не открывается");
    assert.deepEqual((await plans.getProgram(b.id, shared.id))?.memberClientIds, [a.id, b.id]);
  } finally {
    await close();
  }
});

test("T01 повторный выбор уже выбранной программы ничего не меняет и не публикует изменение", async () => {
  const { clients, plans, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const program = await plans.createProgram({ kind: "SIMPLE", title: "База", clientIds: [a.id] }, DAY1);
    const published: string[][] = [];
    const unsubscribe = plans.subscribeCommittedChanges((change) => published.push([...change.clientIds]));
    await plans.selectProgram(a.id, program.id);
    await plans.selectProgram(a.id, program.id);
    unsubscribe();
    assert.deepEqual(published, [[a.id]], "открытие экрана программы не должно порождать цикл обновлений");
  } finally {
    await close();
  }
});

test("T01 выбранная программа: стабильна при создании новой, архив снимает, возврат не выбирает", async () => {
  const { clients, plans, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const b = await clients.create({ displayName: "SyntheticB" });
    const shared = await plans.createProgram({ kind: "PERIODIZED", title: "Блок", clientIds: [a.id, b.id] }, DAY1);
    await plans.selectProgram(a.id, shared.id);
    await plans.selectProgram(b.id, shared.id);
    await plans.createProgram({ kind: "SIMPLE", title: "Новая", clientIds: [a.id] }, DAY2);
    assert.equal((await plans.getLibrary(a.id)).selectedProgramId, shared.id, "новая программа не перехватывает выбор");

    await plans.archiveForClient(a.id, shared.id, DAY2);
    const archivedA = await plans.getLibrary(a.id);
    assert.equal(archivedA.selectedProgramId, null);
    assert.deepEqual(archivedA.archived.map((card) => card.id), [shared.id]);
    const libraryB = await plans.getLibrary(b.id);
    assert.equal(libraryB.selectedProgramId, shared.id, "архив A не трогает B");
    assert.deepEqual(libraryB.active.map((card) => card.id), [shared.id]);
    await assert.rejects(plans.selectProgram(a.id, shared.id), message("PROGRAM_ARCHIVED"));

    await plans.restoreForClient(a.id, shared.id);
    const restored = await plans.getLibrary(a.id);
    assert.equal(restored.selectedProgramId, null, "возврат из архива не делает программу выбранной");
    assert.equal(restored.active.length, 2);
  } finally {
    await close();
  }
});

test("T01 схема: простая не получает второго участника, выбор только из своих участий, CAS названия", async () => {
  const { db, clients, plans, close } = await stores();
  try {
    const a = await clients.create({ displayName: "SyntheticA" });
    const b = await clients.create({ displayName: "SyntheticB" });
    const simple = await plans.createProgram({ kind: "SIMPLE", title: "База", clientIds: [a.id] }, DAY1);
    assert.throws(() => db.prepare(`INSERT INTO training_program_members (workspace_id, program_id, client_id, joined_at)
      VALUES (?, ?, ?, ?)`).run(WS, simple.id, b.id, DAY1.toISOString()), /PARTICIPANT_CONFLICT/);
    await assert.rejects(plans.selectProgram(b.id, simple.id), message("TARGET_NOT_FOUND"));
    assert.throws(() => db.prepare("UPDATE training_programs SET kind = 'PERIODIZED' WHERE id = ?").run(simple.id),
      /DRAFT_INVALID/);
    const renamed = await plans.renameProgram(simple.id, simple.revision, "База 2");
    assert.equal(renamed.title, "База 2");
    await assert.rejects(plans.renameProgram(simple.id, simple.revision, "Старая"), message("PROGRAM_REVISION_CONFLICT"));
    const archivedClient = await clients.setArchived(b.id, b.revision, true);
    assert.equal(archivedClient.lifecycle, "ARCHIVED");
    await assert.rejects(plans.createProgram({ kind: "SIMPLE", title: "Архивному", clientIds: [b.id] }), message("TARGET_NOT_FOUND"));
  } finally {
    await close();
  }
});

test("T01 окончательное удаление клиента: своя программа удаляется, общая остаётся остальным", async () => {
  const { clients, plans, close } = await stores();
  try {
    const gone = await clients.create({ displayName: "SyntheticGone" });
    const kept = await clients.create({ displayName: "SyntheticKept" });
    await plans.createProgram({ kind: "SIMPLE", title: "Своя", clientIds: [gone.id] }, DAY1);
    const shared = await plans.createProgram({ kind: "PERIODIZED", title: "Общая", clientIds: [gone.id, kept.id] }, DAY2);
    await plans.selectProgram(gone.id, shared.id);
    const archived = await clients.setArchived(gone.id, gone.revision, true);
    await clients.deleteArchivedPermanently(gone.id, archived.revision);
    const library = await plans.getLibrary(kept.id);
    assert.deepEqual(library.active.map((card) => card.title), ["Общая"]);
    assert.equal(library.active[0]!.memberCount, 1);
    assert.deepEqual((await plans.getProgram(kept.id, shared.id))?.memberClientIds, [kept.id]);
  } finally {
    await close();
  }
});
