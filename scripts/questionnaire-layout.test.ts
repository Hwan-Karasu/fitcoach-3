import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevQuestionnaireRepository } from "../apps/mobile/src/features/questionnaire/data/DevQuestionnaireRepository.ts";
import { defaultQuestionnaireSchema, withMissingSystemOptions } from "../apps/mobile/src/features/questionnaire/domain/QuestionnaireRules.ts";
import { choiceColumns } from "../apps/mobile/src/features/questionnaire/presentation/choiceLayout.ts";
import { chunkRows } from "../apps/mobile/src/shared/ui/components/choiceRows.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";

const labelsOf = (fieldId: string) => defaultQuestionnaireSchema().sections.flatMap((section) => section.fields)
  .find((entry) => entry.id === fieldId)!.options.map((option) => option.label);

test("шкала 1–10 — один ряд, «Да/Нет» и пол — по числу вариантов, длинные подписи — два столбца", () => {
  assert.equal(choiceColumns(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]), 10);
  assert.equal(choiceColumns(["Да", "Нет"]), 2);
  assert.equal(choiceColumns(["Не указан", "Мужской", "Женский"]), 3);
  assert.equal(choiceColumns(["Да, устраивает", "Нет, хочу изменить"]), 2);
  assert.equal(choiceColumns(["Строгость и дисциплина", "Гибкость и понимание", "Поддержка и мотивация", "Конкретика и чёткий план"]), 2);
});

test("сидячая работа — два ряда по три, мышцы — столбцы одной ширины", () => {
  assert.equal(choiceColumns(labelsOf("sys:lifestyle.sitting")), 3);
  assert.equal(choiceColumns(labelsOf("sys:goals.muscles")), 2);
});

test("строки сетки: неполная последняя строка остаётся одна", () => {
  assert.deepEqual(chunkRows([1, 2, 3, 4, 5], 3), [[1, 2, 3], [4, 5]]);
  assert.deepEqual(chunkRows([1, 2], 2), [[1, 2]]);
  assert.deepEqual(chunkRows([], 3), []);
});

test("в стандартной анкете есть квадрицепсы и другие группы мышц, прежние пункты не сдвинуты", () => {
  const muscles = labelsOf("sys:goals.muscles");
  assert.deepEqual(muscles.slice(0, 9), ["Грудь", "Спина", "Бицепс", "Трицепс", "Ягодицы", "Бёдра", "Икроножные", "Плечи", "Пресс"]);
  assert.ok(muscles.includes("Квадрицепсы") && muscles.length > 9);
});

/** Старая установка: те же пункты, но без добавленных позже (взято обрезкой стандартной схемы до девяти групп). */
function legacyWithNineMuscles() {
  const schema = defaultQuestionnaireSchema();
  return { ...schema, sections: schema.sections.map((section) => ({ ...section, fields: section.fields.map((entry) =>
    entry.id === "sys:goals.muscles" ? { ...entry, options: entry.options.slice(0, 9) } : entry) })) };
}

test("недостающие пункты системного выбора добавляются, остальное не меняется; повтор — ничего", () => {
  const next = withMissingSystemOptions(legacyWithNineMuscles(), defaultQuestionnaireSchema())!;
  const muscles = next.sections.flatMap((section) => section.fields).find((entry) => entry.id === "sys:goals.muscles")!.options;
  assert.equal(muscles.length, labelsOf("sys:goals.muscles").length);
  assert.deepEqual(muscles.slice(0, 9).map((option) => option.id), legacyWithNineMuscles().sections.flatMap((s) => s.fields)
    .find((entry) => entry.id === "sys:goals.muscles")!.options.map((option) => option.id));
  assert.equal(withMissingSystemOptions(next, defaultQuestionnaireSchema()), null);
});

test("установленная анкета со старым списком мышц при открытии получает новую версию", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, "ws");
  await clients.initialize();
  const first = new DevQuestionnaireRepository(shared, "ws");
  await first.initialize();
  await first.close();
  // Состояние старой установки: версия 1 и черновик с девятью группами (журнал версий неизменяем — снимаем защиту только в этом тесте).
  const old = JSON.stringify(legacyWithNineMuscles());
  db.exec("DROP TRIGGER questionnaire_versions_no_update");
  db.prepare("UPDATE questionnaire_versions SET schema_json = ?").run(old);
  db.prepare("UPDATE questionnaire_drafts SET schema_json = ?").run(old);
  const second = new DevQuestionnaireRepository(shared, "ws");
  await second.initialize();
  const published = await second.getPublished();
  assert.equal(published.version, 2);
  const muscles = published.schema.sections.flatMap((section) => section.fields).find((entry) => entry.id === "sys:goals.muscles")!.options;
  assert.equal(muscles.length, labelsOf("sys:goals.muscles").length);
  await second.close();
  const third = new DevQuestionnaireRepository(shared, "ws");
  await third.initialize();
  assert.equal((await third.getPublished()).version, 2);
  await third.close();
  await clients.close();
});
