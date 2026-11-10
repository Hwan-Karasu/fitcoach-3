import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import TestRenderer from "react-test-renderer";
import { useAnswersForm, type AnswersForm } from "../src/features/questionnaire/presentation/useAnswersForm.ts";
import type { ClientAnswers, PublishedQuestionnaire, QuestionField } from "../src/features/questionnaire/domain/QuestionnaireModel.ts";
import type { QuestionnaireCommittedChange, QuestionnaireRepositoryPort } from "../src/features/questionnaire/domain/QuestionnaireRepositoryPort.ts";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const field = (id: string, type: QuestionField["type"]): QuestionField => ({ id, type, origin: "CUSTOM", semanticKey: null,
  label: id, help: null, required: true, hidden: false, retired: false, visibleIf: null, constraints: null,
  options: type === "SINGLE_CHOICE" ? [{ id: "yes", label: "Да", retired: false }] : [] });
const published: PublishedQuestionnaire = { version: 1, publishedAt: "2026-11-10T10:00:00Z", schema: { formatVersion: 1,
  sections: [{ id: "section", title: "Section", origin: "CUSTOM", help: null, hidden: false, fields: [field("number", "NUMBER"), field("choice", "SINGLE_CHOICE")] }] } };
const saved: ClientAnswers = { schemaVersion: 1, answers: { number: 20, choice: "yes" } };
const unexpected = async (): Promise<never> => { throw new Error("UNEXPECTED_PORT_CALL"); };
const port = (over: Partial<QuestionnaireRepositoryPort> = {}): QuestionnaireRepositoryPort => ({
  getPublished: async () => published, getAnswers: async () => saved,
  saveAnswers: async (_id, patch) => ({ schemaVersion: 1, answers: Object.fromEntries(Object.entries(patch).filter((pair) => pair[1] !== null)) as ClientAnswers["answers"] }),
  listVersions: unexpected, getVersion: unexpected, getDraft: unexpected, saveDraft: unexpected, previewPublish: unexpected,
  publishDraft: unexpected, discardDraft: unexpected, draftFromVersion: unexpected, completion: unexpected,
  subscribeCommittedChanges: () => () => undefined, ...over,
});

test("AUDIT-ALL-1: поздняя начальная загрузка не откатывает опубликованную схему и сохраняет ответы её новых полей", async () => {
  let state!: AnswersForm;
  let completeInitial!: (schema: PublishedQuestionnaire) => void;
  let changed: (change: QuestionnaireCommittedChange) => void = () => undefined;
  let reads = 0;
  const section = published.schema.sections[0]!;
  const next: PublishedQuestionnaire = { ...published, version: 2, schema: { formatVersion: 1,
    sections: [{ ...section, fields: [...section.fields, field("added", "SHORT_TEXT")] }] } };
  const repository = port({
    getPublished: () => ++reads === 1 ? new Promise((resolve) => { completeInitial = resolve; }) : Promise.resolve(next),
    getAnswers: async () => ({ schemaVersion: 2, answers: { ...saved.answers, added: "сохранённый ответ" } }),
    subscribeCommittedChanges: (listener) => { changed = listener; return () => undefined; },
  });
  function Probe() { state = useAnswersForm(repository, "a"); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(Probe)); });
    await act(async () => changed({ scope: "SCHEMA", clientId: null }));
    await act(async () => completeInitial(published));
    assert.equal(state.status, "ready");
    assert.equal(state.published!.version, 2);
    assert.equal(state.inputs.added, "сохранённый ответ");
    assert.deepEqual(state.dirtyIds, []);
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("AUDIT-ALL-1: очищенный числовой ответ или выбор сразу снижает заполненность анкеты", async () => {
  let state!: AnswersForm;
  const repository = port();
  function Probe() { state = useAnswersForm(repository, "a"); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(Probe)); });
    assert.equal(state.completion, "COMPLETE");
    await act(async () => state.onChange("number", ""));
    assert.equal(state.completion, "IN_PROGRESS");
    await act(async () => { state.onChange("number", "20"); state.onChange("choice", undefined); });
    assert.equal(state.completion, "IN_PROGRESS");
    await act(async () => { assert.deepEqual(state.prepare(), { choice: null }); });
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("AUDIT-ALL-1: прежние ответы и ошибка не выдаются за данные нового клиента во время чтения", async () => {
  let state!: AnswersForm;
  let resolveB!: (answers: ClientAnswers) => void;
  const repository = port({ getAnswers: (id) => id === "a" ? Promise.resolve(saved) : new Promise((resolve) => { resolveB = resolve; }) });
  function Probe({ id }: { id: string }) { state = useAnswersForm(repository, id); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(Probe, { id: "a" })); });
    await act(async () => { tree.update(createElement(Probe, { id: "b" })); });
    assert.equal(state.status, "loading");
    assert.deepEqual(state.inputs, {});
    await act(async () => { resolveB({ schemaVersion: null, answers: {} }); });
    assert.equal(state.status, "ready");
    assert.equal(state.completion, "NOT_STARTED");
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("AUDIT-ALL-1: ответ сохранения не затирает ввод, сделанный после начала записи", async () => {
  let state!: AnswersForm;
  let finish!: (next: ClientAnswers) => void;
  const repository = port({ saveAnswers: () => new Promise((resolve) => { finish = resolve; }) });
  function Probe() { state = useAnswersForm(repository, "a"); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(Probe)); });
    await act(async () => state.onChange("number", "25"));
    let pending!: Promise<void>;
    await act(async () => { pending = state.commit("a", state.prepare()!); });
    await act(async () => state.onChange("number", "30"));
    await act(async () => { finish({ schemaVersion: 1, answers: { number: 25, choice: "yes" } }); await pending; });
    assert.equal(state.inputs.number, "30");
    assert.deepEqual(state.dirtyIds, ["number"]);
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("AUDIT-ALL-1: поздний ACK другого клиента не меняет открытую анкету; ошибка чтения не переносится между клиентами", async () => {
  let state!: AnswersForm;
  let finish!: (next: ClientAnswers) => void;
  const repository = port({ getAnswers: async (id) => { if (id === "broken") throw new Error("READ_FAILED"); return saved; },
    saveAnswers: () => new Promise((resolve) => { finish = resolve; }) });
  function Probe({ id }: { id: string }) { state = useAnswersForm(repository, id); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { tree = TestRenderer.create(createElement(Probe, { id: "broken" })); });
    assert.equal(state.status, "failed");
    await act(async () => { tree.update(createElement(Probe, { id: "a" })); });
    assert.equal(state.status, "ready");
    await act(async () => state.onChange("number", "25"));
    let pending!: Promise<void>;
    await act(async () => { pending = state.commit("a", state.prepare()!); });
    await act(async () => { tree.update(createElement(Probe, { id: "b" })); });
    await act(async () => { finish({ schemaVersion: 1, answers: { number: 25, choice: "yes" } }); await pending; });
    assert.equal(state.inputs.number, "20");
    assert.deepEqual(state.dirtyIds, []);
  } finally { if (tree) await act(async () => tree.unmount()); }
});
