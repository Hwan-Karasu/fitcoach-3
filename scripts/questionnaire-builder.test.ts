import assert from "node:assert/strict";
import test from "node:test";
import { addField, addOption, addSection, canChangeType, discardIfBlank, duplicateField, locateField, moveField, moveFieldTo, moveFieldToSection,
  moveOption, moveSection, removeField, removeOption, removeSection, restoreField, updateField } from
  "../apps/mobile/src/features/questionnaire/domain/QuestionnaireBuilder.ts";
import { defaultQuestionnaireSchema, validateSchema } from "../apps/mobile/src/features/questionnaire/domain/QuestionnaireRules.ts";
import { builderRows, dropTarget } from "../apps/mobile/src/features/questionnaire/presentation/builderRows.ts";

const published = defaultQuestionnaireSchema();
const firstSection = published.sections[0]!;
const systemField = firstSection.fields[0]!;

test("Q02 новое поле: стабильный ID, тип выбран до создания, текст вводится в редакторе", () => {
  let schema = addField(published, firstSection.id, "SINGLE_CHOICE", "c:new");
  const found = locateField(schema, "c:new");
  assert.equal(found?.section.id, firstSection.id);
  assert.equal(found?.field.origin, "CUSTOM");
  assert.ok(validateSchema(schema).some((issue) => issue.fieldId === "c:new"), "без текста и вариантов не публикуется");
  schema = updateField(schema, "c:new", { label: "Любимое время" });
  schema = addOption(schema, "c:new", "c:new:o1", "Утро");
  assert.deepEqual(validateSchema(schema).filter((issue) => issue.fieldId === "c:new"), []);
  assert.equal(canChangeType(locateField(schema, "c:new")!.field, published), true);
  assert.equal(canChangeType(systemField, published), false, "тип системного поля не меняется");
  // Смена на невыборный тип убирает варианты.
  assert.deepEqual(locateField(updateField(schema, "c:new", { type: "SHORT_TEXT" }), "c:new")?.field.options, []);
});

test("Q02 удаление: новое — удаляется, опубликованное — убирается из анкеты, системное — нельзя", () => {
  const draft = addField(published, firstSection.id, "SHORT_TEXT", "c:draft");
  assert.equal(removeField(draft, "c:draft", published).outcome, "DELETED");
  assert.equal(locateField(removeField(draft, "c:draft", published).schema, "c:draft"), null);
  assert.equal(removeField(draft, systemField.id, published).outcome, "FORBIDDEN");
  // Своё поле, уже опубликованное в прошлой версии: retired, ID и место сохраняются.
  const nextPublished = updateField(draft, "c:draft", { label: "Привычки" });
  const retired = removeField(nextPublished, "c:draft", nextPublished);
  assert.equal(retired.outcome, "RETIRED");
  assert.equal(locateField(retired.schema, "c:draft")?.field.retired, true);
  assert.equal(locateField(restoreField(retired.schema, "c:draft"), "c:draft")?.field.retired, false);
});

test("Q02 порядок: выше/ниже в разделе, перенос в раздел, разделы; копия встаёт за оригиналом", () => {
  const second = published.sections[1]!;
  const [a, b] = firstSection.fields;
  const moved = moveField(published, b!.id, -1);
  assert.deepEqual(moved.sections[0]!.fields.slice(0, 2).map((field) => field.id), [b!.id, a!.id]);
  assert.deepEqual(moveField(published, a!.id, -1).sections[0]!.fields.map((field) => field.id),
    firstSection.fields.map((field) => field.id), "первое поле выше не поднимается");
  const across = moveFieldToSection(published, a!.id, second.id);
  assert.equal(locateField(across, a!.id)?.section.id, second.id);
  assert.equal(across.sections[1]!.fields.at(-1)?.id, a!.id);
  const copy = duplicateField(published, a!.id, "c:copy", (index) => `c:copy:o${index}`);
  assert.equal(copy.sections[0]!.fields[1]!.id, "c:copy");
  assert.equal(locateField(copy, "c:copy")?.field.origin, "CUSTOM");
  const sections = moveSection(published, second.id, -1);
  assert.equal(sections.sections[0]!.id, second.id);
  const withSection = addSection(published, "c:sec", "Сон");
  assert.equal(removeSection(withSection, "c:sec").outcome, "DELETED");
  assert.equal(removeSection(published, firstSection.id).outcome, "FORBIDDEN");
});

test("Q02 перетаскивание: место внутри раздела, в другой раздел, на то же место — без изменений", () => {
  const second = published.sections[1]!;
  const ids = firstSection.fields.map((field) => field.id);
  // Первое поле — на третье место (номер среди остальных полей раздела = 2).
  const down = moveFieldTo(published, ids[0]!, firstSection.id, 2);
  assert.deepEqual(down.sections[0]!.fields.map((field) => field.id), [ids[1], ids[2], ids[0], ...ids.slice(3)]);
  const across = moveFieldTo(published, ids[1]!, second.id, 0);
  assert.equal(across.sections[1]!.fields[0]!.id, ids[1]);
  assert.equal(locateField(across, ids[1]!)?.section.id, second.id);
  assert.equal(moveFieldTo(published, ids[1]!, firstSection.id, 1), published, "то же место");
  assert.equal(moveFieldTo(published, ids[0]!, second.id, 99).sections[1]!.fields.at(-1)?.id, ids[0], "номер за краем — в конец");
});

test("Q02 список конструктора: вопрос попадает в раздел ближайшего заголовка выше", () => {
  const [s1, s2] = published.sections;
  const rows = builderRows({ ...published, sections: [s1!, s2!] }, new Set([s2!.id]));
  const keys = rows.map((row) => row.key);
  assert.equal(keys[0], `s:${s1!.id}`);
  assert.equal(keys.at(-1), `s:${s2!.id}`, "свёрнутый раздел — только заголовок");
  const moved = s1!.fields[0]!.id;
  const without = rows.filter((row) => row.key !== `f:${moved}`);
  const put = (index: number) => [...without.slice(0, index), rows[1]!, ...without.slice(index)];
  // Сразу под заголовком первого раздела — место 0; после второго вопроса — место 1.
  assert.deepEqual(dropTarget(put(1), moved), { sectionId: s1!.id, index: 0 });
  assert.deepEqual(dropTarget(put(2), moved), { sectionId: s1!.id, index: 1 });
  // Под свёрнутым заголовком второго раздела — в конец второго раздела.
  assert.deepEqual(dropTarget(put(without.length), moved), { sectionId: s2!.id, index: Number.MAX_SAFE_INTEGER });
  // Выше первого заголовка — в начало первого раздела.
  assert.deepEqual(dropTarget(put(0), moved), { sectionId: s1!.id, index: 0 });
});

test("Q02 варианты: новый удаляется, опубликованный выводится; порядок меняется", () => {
  const choice = published.sections.flatMap((section) => section.fields).find((field) => field.options.length > 1)!;
  const [first, second] = choice.options;
  const retired = removeOption(published, choice.id, first!.id, published);
  assert.equal(retired.outcome, "RETIRED");
  assert.equal(locateField(retired.schema, choice.id)?.field.options.find((option) => option.id === first!.id)?.retired, true);
  const added = addOption(published, choice.id, "c:opt", "Другое");
  assert.equal(removeOption(added, choice.id, "c:opt", published).outcome, "DELETED");
  const reordered = moveOption(published, choice.id, second!.id, -1);
  assert.equal(locateField(reordered, choice.id)?.field.options[0]?.id, second!.id);
});

test("новый вопрос, закрытый пустым, не остаётся; заполненный и системный — остаются", () => {
  const added = addField(published, firstSection.id, "SINGLE_CHOICE", "c:blank");
  assert.equal(locateField(discardIfBlank(added, "c:blank"), "c:blank"), null);
  assert.deepEqual(discardIfBlank(added, "c:blank"), published);
  const withOption = addOption(added, "c:blank", "c:blank:o1", "Утро");
  assert.notEqual(locateField(discardIfBlank(withOption, "c:blank"), "c:blank"), null, "заполнен только вариант — вопрос остаётся");
  const titled = updateField(added, "c:blank", { label: "Любимое время" });
  assert.notEqual(locateField(discardIfBlank(titled, "c:blank"), "c:blank"), null);
  assert.equal(discardIfBlank(published, systemField.id), published, "системный вопрос не удаляется");
});
