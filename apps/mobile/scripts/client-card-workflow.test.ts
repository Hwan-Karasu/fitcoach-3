import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevQuestionnaireRepository, devQuestionnaireClientDeletionParticipant } from
  "../src/features/questionnaire/data/DevQuestionnaireRepository.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { createClientCardWorkflow } from "../src/workflows/saveClientCard.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

const WS = "synthetic-workspace-a";

async function stores() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devQuestionnaireClientDeletionParticipant]);
  await clients.initialize();
  const questionnaire = new DevQuestionnaireRepository(shared, WS);
  await questionnaire.initialize();
  const lease = await shared.acquire();
  const workflow = createClientCardWorkflow((task) => lease.writer.write(task), clients.cardParticipant, questionnaire.answersParticipant);
  const close = async () => { await shared.release(); await questionnaire.close(); await clients.close(); };
  return { clients, questionnaire, workflow, close };
}

const card = (displayName: string) => ({ displayName });

test("карточка + анкета: новый клиент и ответы появляются вместе, по одному событию от владельца", async () => {
  const { clients, questionnaire, workflow, close } = await stores();
  try {
    let clientEvents = 0;
    let answerEvents = 0;
    clients.subscribeCommittedChanges(() => { clientEvents += 1; });
    questionnaire.subscribeCommittedChanges(() => { answerEvents += 1; });
    const { client, answers } = await workflow.save(null, card("SyntheticBoth"), { "sys:lifestyle.sleep": " 7 часов " });
    assert.equal(client.displayName, "SyntheticBoth");
    assert.equal(answers?.answers["sys:lifestyle.sleep"], "7 часов");
    assert.equal((await questionnaire.getAnswers(client.id)).answers["sys:lifestyle.sleep"], "7 часов");
    assert.equal((await clients.list("ACTIVE")).length, 1);
    assert.deepEqual([clientEvents, answerEvents], [1, 1]);
  } finally { await close(); }
});

test("карточка + анкета: неверный ответ не оставляет новой карточки и не шлёт событий", async () => {
  const { clients, questionnaire, workflow, close } = await stores();
  try {
    let events = 0;
    clients.subscribeCommittedChanges(() => { events += 1; });
    questionnaire.subscribeCommittedChanges(() => { events += 1; });
    await assert.rejects(workflow.save(null, card("SyntheticGhost"), { "sys:lifestyle.fitness": "nope" }), { message: "QUESTIONNAIRE_ANSWER_INVALID" });
    await assert.rejects(workflow.save(null, card("SyntheticGhost"), { "unknown:field": "x" }), { message: "QUESTIONNAIRE_ANSWER_INVALID" });
    assert.equal((await clients.list("ACTIVE")).length, 0, "карточка откатилась вместе с ответами");
    assert.equal(events, 0);
  } finally { await close(); }
});

test("карточка + анкета: правка существующей — revision растёт, ответы пишутся; неверный ответ откатывает и правку карточки", async () => {
  const { clients, questionnaire, workflow, close } = await stores();
  try {
    const created = await clients.create(card("SyntheticEdit"));
    const edited = await workflow.save({ id: created.id, revision: created.revision }, card("SyntheticEdited"), { "sys:lifestyle.sleep": "6" });
    assert.equal(edited.client.displayName, "SyntheticEdited");
    assert.equal(edited.client.revision, created.revision + 1);
    assert.equal((await questionnaire.getAnswers(created.id)).answers["sys:lifestyle.sleep"], "6");
    await assert.rejects(workflow.save({ id: created.id, revision: edited.client.revision }, card("SyntheticBroken"), { "sys:lifestyle.fitness": "nope" }),
      { message: "QUESTIONNAIRE_ANSWER_INVALID" });
    const current = await clients.get(created.id);
    assert.equal(current?.displayName, "SyntheticEdited", "имя не изменилось");
    assert.equal(current?.revision, edited.client.revision);
    assert.equal((await questionnaire.getAnswers(created.id)).answers["sys:lifestyle.sleep"], "6");
  } finally { await close(); }
});

test("карточка + анкета: устаревшая revision отклоняется целиком, без ответов пишется только карточка", async () => {
  const { clients, questionnaire, workflow, close } = await stores();
  try {
    const created = await clients.create(card("SyntheticStale"));
    await clients.update(created.id, created.revision, card("SyntheticStale2"));
    await assert.rejects(workflow.save({ id: created.id, revision: created.revision }, card("SyntheticStale3"), { "sys:lifestyle.sleep": "9" }),
      { message: "CLIENT_STALE_OR_WRONG_SCOPE" });
    assert.deepEqual({ ...(await questionnaire.getAnswers(created.id)).answers }, {}, "ответы не записаны");
    let answerEvents = 0;
    questionnaire.subscribeCommittedChanges(() => { answerEvents += 1; });
    const current = await clients.get(created.id);
    const only = await workflow.save({ id: created.id, revision: current!.revision }, card("SyntheticStale4"), {});
    assert.equal(only.answers, null);
    assert.equal(answerEvents, 0, "без ответов событие анкеты не публикуется");
  } finally { await close(); }
});
