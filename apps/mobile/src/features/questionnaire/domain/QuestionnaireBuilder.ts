import type { ChoiceOption, QuestionField, QuestionnaireSchema, QuestionSection, QuestionType } from "./QuestionnaireModel.ts";

/**
 * Чистые правки схемы для конструктора (§§23, 25, 27). Каждая функция возвращает новую схему; ID полей,
 * разделов и вариантов стабильны и никогда не переиспользуются (§23.15, §25.9).
 */

export type FieldPatch = Partial<Pick<QuestionField, "label" | "help" | "required" | "type" | "visibleIf" | "constraints">>;

export const CHOICE_TYPES: readonly QuestionType[] = ["SINGLE_CHOICE", "MULTI_CHOICE"];

function mapField(schema: QuestionnaireSchema, fieldId: string,
  change: (field: QuestionField) => QuestionField): QuestionnaireSchema {
  return { ...schema, sections: schema.sections.map((section) => ({
    ...section, fields: section.fields.map((field) => field.id === fieldId ? change(field) : field),
  })) };
}

function mapSection(schema: QuestionnaireSchema, sectionId: string,
  change: (section: QuestionSection) => QuestionSection): QuestionnaireSchema {
  return { ...schema, sections: schema.sections.map((section) => section.id === sectionId ? change(section) : section) };
}

function moveItem<T>(items: readonly T[], index: number, direction: -1 | 1): readonly T[] {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as T);
  return next;
}

/** Где поле сейчас лежит. */
export function locateField(schema: QuestionnaireSchema, fieldId: string):
  Readonly<{ section: QuestionSection; index: number; field: QuestionField }> | null {
  for (const section of schema.sections) {
    const index = section.fields.findIndex((field) => field.id === fieldId);
    if (index >= 0) return { section, index, field: section.fields[index] as QuestionField };
  }
  return null;
}

/** Был ли элемент (поле или вариант) в опубликованной версии: на него уже могут быть ответы. */
export function publishedHasField(published: QuestionnaireSchema, fieldId: string): boolean {
  return locateField(published, fieldId) !== null;
}

/** §27.5: новое поле выбранного типа в разделе; текст вводится сразу в редакторе. */
export function addField(schema: QuestionnaireSchema, sectionId: string, type: QuestionType, id: string): QuestionnaireSchema {
  const field: QuestionField = { id, origin: "CUSTOM", semanticKey: null, type, label: "", help: null, required: false,
    hidden: false, retired: false, options: [], visibleIf: null, constraints: null };
  return mapSection(schema, sectionId, (section) => ({ ...section, fields: [...section.fields, field] }));
}

/** Тип системного поля и поля из опубликованной версии не меняется (ответы привязаны к типу, §25.11). */
export function canChangeType(field: QuestionField, published: QuestionnaireSchema): boolean {
  return field.origin === "CUSTOM" && !publishedHasField(published, field.id);
}

export function updateField(schema: QuestionnaireSchema, fieldId: string, patch: FieldPatch): QuestionnaireSchema {
  return mapField(schema, fieldId, (field) => {
    const next = { ...field, ...patch };
    // Смена типа на невыборный убирает варианты; ограничения другого типа не переносятся.
    if (patch.type !== undefined && patch.type !== field.type) {
      return { ...next, options: CHOICE_TYPES.includes(patch.type) ? field.options : [], constraints: null };
    }
    return next;
  });
}

export function setFieldHidden(schema: QuestionnaireSchema, fieldId: string, hidden: boolean): QuestionnaireSchema {
  return mapField(schema, fieldId, (field) => ({ ...field, hidden }));
}

/** §27.10: копия встаёт сразу после оригинала, всегда как своё поле, с новыми ID поля и вариантов. */
export function duplicateField(schema: QuestionnaireSchema, fieldId: string, newId: string,
  newOptionId: (index: number) => string): QuestionnaireSchema {
  const found = locateField(schema, fieldId);
  if (found === null) return schema;
  const copy: QuestionField = { ...found.field, id: newId, origin: "CUSTOM", semanticKey: null,
    label: `${found.field.label} (копия)`, retired: false,
    options: found.field.options.filter((option) => !option.retired).map((option, index) => ({ ...option, id: newOptionId(index) })) };
  return mapSection(schema, found.section.id, (section) => {
    const fields = [...section.fields];
    fields.splice(found.index + 1, 0, copy);
    return { ...section, fields };
  });
}

export function moveField(schema: QuestionnaireSchema, fieldId: string, direction: -1 | 1): QuestionnaireSchema {
  const found = locateField(schema, fieldId);
  if (found === null) return schema;
  return mapSection(schema, found.section.id, (section) => ({ ...section, fields: moveItem(section.fields, found.index, direction) }));
}

/** §27.9 «Переместить в раздел…»: поле встаёт в конец выбранного раздела, ID не меняется. */
export function moveFieldToSection(schema: QuestionnaireSchema, fieldId: string, sectionId: string): QuestionnaireSchema {
  const found = locateField(schema, fieldId);
  if (found === null || found.section.id === sectionId) return schema;
  return { ...schema, sections: schema.sections.map((section) => {
    if (section.id === found.section.id) return { ...section, fields: section.fields.filter((field) => field.id !== fieldId) };
    if (section.id === sectionId) return { ...section, fields: [...section.fields, found.field] };
    return section;
  }) };
}

export type RemoveResult = Readonly<{ schema: QuestionnaireSchema; outcome: "DELETED" | "RETIRED" | "FORBIDDEN" }>;

/**
 * §25.9: своё поле, которого не было в опубликованной версии, удаляется; уже опубликованное —
 * «убирается из анкеты» (retired, ответы и ID сохраняются). Системное поле не удаляется — только скрыть.
 */
export function removeField(schema: QuestionnaireSchema, fieldId: string, published: QuestionnaireSchema): RemoveResult {
  const found = locateField(schema, fieldId);
  if (found === null || found.field.origin === "SYSTEM") return { schema, outcome: "FORBIDDEN" };
  if (!publishedHasField(published, fieldId)) {
    return { outcome: "DELETED", schema: mapSection(schema, found.section.id, (section) => ({
      ...section, fields: section.fields.filter((field) => field.id !== fieldId) })) };
  }
  return { outcome: "RETIRED", schema: mapField(schema, fieldId, (field) => ({ ...field, retired: true, hidden: true })) };
}

/** Вернуть в анкету поле, убранное в этом черновике или раньше (ID тот же, ответы на месте). */
export function restoreField(schema: QuestionnaireSchema, fieldId: string): QuestionnaireSchema {
  return mapField(schema, fieldId, (field) => ({ ...field, retired: false, hidden: false }));
}

export function addSection(schema: QuestionnaireSchema, id: string, title: string): QuestionnaireSchema {
  return { ...schema, sections: [...schema.sections, { id, origin: "CUSTOM", title, help: null, hidden: false, fields: [] }] };
}

export function updateSection(schema: QuestionnaireSchema, sectionId: string,
  patch: Partial<Pick<QuestionSection, "title" | "help" | "hidden">>): QuestionnaireSchema {
  return mapSection(schema, sectionId, (section) => ({ ...section, ...patch }));
}

export function moveSection(schema: QuestionnaireSchema, sectionId: string, direction: -1 | 1): QuestionnaireSchema {
  const index = schema.sections.findIndex((section) => section.id === sectionId);
  return { ...schema, sections: moveItem(schema.sections, index, direction) };
}

/** §25.16: удалить можно только свой пустой раздел; с вопросами — сначала перенести их, иначе скрыть. */
export function removeSection(schema: QuestionnaireSchema, sectionId: string): RemoveResult {
  const section = schema.sections.find((item) => item.id === sectionId);
  if (section === undefined || section.origin === "SYSTEM" || section.fields.length > 0) return { schema, outcome: "FORBIDDEN" };
  return { outcome: "DELETED", schema: { ...schema, sections: schema.sections.filter((item) => item.id !== sectionId) } };
}

function mapOptions(schema: QuestionnaireSchema, fieldId: string,
  change: (options: readonly ChoiceOption[]) => readonly ChoiceOption[]): QuestionnaireSchema {
  return mapField(schema, fieldId, (field) => ({ ...field, options: change(field.options) }));
}

export function addOption(schema: QuestionnaireSchema, fieldId: string, id: string, label: string): QuestionnaireSchema {
  return mapOptions(schema, fieldId, (options) => [...options, { id, label, retired: false }]);
}

export function renameOption(schema: QuestionnaireSchema, fieldId: string, optionId: string, label: string): QuestionnaireSchema {
  return mapOptions(schema, fieldId, (options) => options.map((option) => option.id === optionId ? { ...option, label } : option));
}

export function moveOption(schema: QuestionnaireSchema, fieldId: string, optionId: string, direction: -1 | 1): QuestionnaireSchema {
  return mapOptions(schema, fieldId, (options) => moveItem(options, options.findIndex((option) => option.id === optionId), direction));
}

/** §25.12: вариант из опубликованной версии выводится (retired), новый — удаляется. */
export function removeOption(schema: QuestionnaireSchema, fieldId: string, optionId: string,
  published: QuestionnaireSchema): RemoveResult {
  const wasPublished = locateField(published, fieldId)?.field.options.some((option) => option.id === optionId) ?? false;
  return {
    outcome: wasPublished ? "RETIRED" : "DELETED",
    schema: mapOptions(schema, fieldId, (options) => wasPublished
      ? options.map((option) => option.id === optionId ? { ...option, retired: true } : option)
      : options.filter((option) => option.id !== optionId)),
  };
}

export function restoreOption(schema: QuestionnaireSchema, fieldId: string, optionId: string): QuestionnaireSchema {
  return mapOptions(schema, fieldId, (options) => options.map((option) => option.id === optionId ? { ...option, retired: false } : option));
}
