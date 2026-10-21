import { QUESTION_TYPES, type AnswerValue, type Answers, type ChoiceOption, type CompletionStatus,
  type PublishSummary, type QuestionField, type QuestionnaireSchema, type QuestionSection, type QuestionType,
  type VisibilityRule } from "./QuestionnaireModel.ts";

function choices(fieldId: string, labels: readonly string[]): readonly ChoiceOption[] {
  return labels.map((label, index) => ({ id: `${fieldId}:o${index + 1}`, label, retired: false }));
}

function field(id: string, type: QuestionType, label: string, extra: Partial<QuestionField> = {}): QuestionField {
  return { id: `sys:${id}`, origin: "SYSTEM", semanticKey: id, type, label, help: null, required: false,
    hidden: false, retired: false, options: [], visibleIf: null, constraints: null, ...extra };
}

function section(id: string, title: string, fields: readonly QuestionField[]): QuestionSection {
  return { id: `sys:${id}`, origin: "SYSTEM", title, help: null, hidden: false, fields };
}

const noContraindications: VisibilityRule = { sourceFieldId: "sys:health.noContra", operator: "NOT_EQUALS", value: "true" };

/**
 * The standard questionnaire (§10.4 categories, build120 content as a reference only). Stable
 * `sys:` IDs never change; weight lives in Measurements and steps are not part of V1.
 */
export function defaultQuestionnaireSchema(): QuestionnaireSchema {
  return { formatVersion: 1, sections: [
    section("goals", "Цель клиента", [
      field("goals.main", "MULTI_CHOICE", "С какой целью пришёл(а)?", { required: true,
        options: choices("sys:goals.main", ["Сбросить вес", "Набрать мышечную массу", "Развить физические качества",
          "Улучшить общее состояние здоровья", "Восстановиться после травмы или болезни",
          "Улучшить осанку, гибкость и подвижность"]) }),
      field("goals.other", "LONG_TEXT", "Другая цель"),
      field("goals.muscles", "MULTI_CHOICE", "Какие группы мышц в приоритете?", {
        options: choices("sys:goals.muscles", ["Грудь", "Спина", "Бицепс", "Трицепс", "Ягодицы", "Бёдра",
          "Икроножные", "Плечи", "Пресс", "Квадрицепсы", "Бицепс бедра", "Широчайшие", "Трапеции", "Предплечья", "Поясница", "Кор"]) }),
      field("goals.success", "MULTI_CHOICE", "Как поймёт, что результат достигнут?", {
        options: choices("sys:goals.success", ["Изменение веса", "Комфорт в одежде", "Улучшение самочувствия",
          "Визуальные изменения тела"]) }),
      field("goals.deadline", "SHORT_TEXT", "Есть ли конкретный срок?", { help: "К отпуску, к свадьбе, через 3 месяца…" }),
    ]),
    section("health", "Здоровье", [
      field("health.noContra", "SWITCH", "Противопоказаний нет"),
      field("health.diagnoses", "LONG_TEXT", "Диагнозы и хронические заболевания", { visibleIf: noContraindications }),
      field("health.injuries", "LONG_TEXT", "Травмы или проблемы с опорно-двигательным аппаратом", { visibleIf: noContraindications }),
      field("health.surgeries", "LONG_TEXT", "Операции или серьёзные повреждения", { visibleIf: noContraindications }),
      field("health.pain", "LONG_TEXT", "Боль или дискомфорт при движении", { visibleIf: noContraindications }),
      field("health.medications", "LONG_TEXT", "Препараты на постоянной основе"),
      field("health.supplements", "SHORT_TEXT", "БАДы"),
      field("health.hardMoves", "LONG_TEXT", "Движения, которые сложно выполнять"),
    ]),
    section("lifestyle", "Образ жизни", [
      field("lifestyle.currentActivity", "LONG_TEXT", "Есть ли сейчас регулярные тренировки?"),
      field("lifestyle.sportHistory", "LONG_TEXT", "Был ли спорт раньше?"),
      field("lifestyle.fitness", "SINGLE_CHOICE", "Оценка силы и выносливости (1–10)", {
        options: choices("sys:lifestyle.fitness", ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]) }),
      field("lifestyle.job", "SHORT_TEXT", "Работа и образ дня"),
      field("lifestyle.sitting", "SINGLE_CHOICE", "Сколько часов в день сидит?", {
        options: choices("sys:lifestyle.sitting", ["Менее 2 часов", "2–4 часа", "4–6 часов", "6–8 часов", "Более 8 часов"]) }),
      field("lifestyle.sleep", "SHORT_TEXT", "Сон"),
      field("lifestyle.habits", "LONG_TEXT", "Привычки"),
    ]),
    section("nutrition", "Питание и вес", [
      field("nutrition.bodySatisfaction", "SINGLE_CHOICE", "Устраивает ли вес и состав тела?", {
        options: choices("sys:nutrition.bodySatisfaction", ["Да, устраивает", "Нет, хочу изменить"]) }),
      field("nutrition.attempts", "LONG_TEXT", "Попытки похудеть или набрать вес"),
      field("nutrition.restrictions", "LONG_TEXT", "Ограничения, непереносимости, аллергии"),
      field("nutrition.eating", "LONG_TEXT", "Переедание, тяга к сладкому, эмоциональное питание"),
    ]),
    section("motivation", "Мотивация", [
      field("motivation.drivers", "LONG_TEXT", "Что мотивирует начать или продолжать?"),
      field("motivation.obstacles", "LONG_TEXT", "Что мешало раньше?"),
      field("motivation.support", "SHORT_TEXT", "Есть ли поддержка?"),
      field("motivation.expectations", "MULTI_CHOICE", "Что важно в работе с тренером?", {
        options: choices("sys:motivation.expectations", ["Строгость и дисциплина", "Гибкость и понимание",
          "Поддержка и мотивация", "Конкретика и чёткий план", "Комфортное общение", "Грамотный подход к тренировкам"]) }),
    ]),
    section("extra", "Дополнительно", [
      field("extra.cycle", "LONG_TEXT", "Менструальный цикл"),
      field("extra.trainerExperience", "LONG_TEXT", "Опыт работы с тренером"),
    ]),
  ] };
}

/**
 * Выбор у системных вопросов, добавленный в стандартную анкету позже (новые пункты — только в конец списка, id по порядку):
 * опубликованная версия получает недостающие пункты новой версией. Остальное в схеме не трогается; null — добавлять нечего.
 */
export function withMissingSystemOptions(current: QuestionnaireSchema, defaults: QuestionnaireSchema): QuestionnaireSchema | null {
  const known = new Map(allFields(defaults).filter((item) => item.field.origin === "SYSTEM").map((item) => [item.field.id, item.field]));
  let changed = false;
  const sections = current.sections.map((item) => ({ ...item, fields: item.fields.map((entry) => {
    const source = known.get(entry.id);
    if (source === undefined || entry.origin !== "SYSTEM" || (entry.type !== "MULTI_CHOICE" && entry.type !== "SINGLE_CHOICE")) return entry;
    const missing = source.options.filter((option) => !entry.options.some((existing) => existing.id === option.id));
    if (missing.length === 0) return entry;
    changed = true;
    return { ...entry, options: [...entry.options, ...missing] };
  }) }));
  return changed ? { ...current, sections } : null;
}

export function allFields(schema: QuestionnaireSchema): readonly Readonly<{ field: QuestionField; section: QuestionSection }>[] {
  return schema.sections.flatMap((item) => item.fields.map((entry) => ({ field: entry, section: item })));
}

function matches(source: QuestionField, value: AnswerValue | undefined, rule: VisibilityRule): boolean {
  const expected = rule.value.trim().toLocaleLowerCase("ru");
  let equal = false;
  let contains = false;
  if (value === undefined) {
    // No answer: not equal to anything and contains nothing.
  } else if (source.type === "SWITCH") {
    equal = String(value === true) === expected;
  } else if (Array.isArray(value)) {
    equal = value.length === 1 && value[0] === rule.value;
    contains = value.includes(rule.value);
  } else {
    const text = String(value).trim().toLocaleLowerCase("ru");
    equal = source.type === "SINGLE_CHOICE" ? value === rule.value : text === expected;
    contains = source.type === "SINGLE_CHOICE" ? equal : text.includes(expected);
  }
  if (rule.operator === "EQUALS") return equal;
  if (rule.operator === "NOT_EQUALS") return !equal;
  return contains;
}

/**
 * §23.8–23.9: a field is shown when it and its section are not hidden or retired and its rule
 * holds; a rule on an invisible source is false. Hidden answers are never deleted.
 */
export function isFieldVisible(schema: QuestionnaireSchema, fieldId: string, answers: Answers,
  seen: ReadonlySet<string> = new Set()): boolean {
  const entry = allFields(schema).find((item) => item.field.id === fieldId);
  if (entry === undefined || entry.field.hidden || entry.field.retired || entry.section.hidden) return false;
  const rule = entry.field.visibleIf;
  if (rule === null) return true;
  if (seen.has(fieldId)) return false;
  const source = allFields(schema).find((item) => item.field.id === rule.sourceFieldId)?.field;
  if (source === undefined || !isFieldVisible(schema, source.id, answers, new Set([...seen, fieldId]))) return false;
  return matches(source, answers[source.id], rule);
}

export function hasAnswer(value: AnswerValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** §10.3: derived, never edited; only applicable required questions count. */
export function completionStatus(schema: QuestionnaireSchema, answers: Answers): CompletionStatus {
  const known = allFields(schema);
  if (!known.some((item) => hasAnswer(answers[item.field.id]))) return "NOT_STARTED";
  const missing = known.some((item) => item.field.required && isFieldVisible(schema, item.field.id, answers)
    && !hasAnswer(answers[item.field.id]));
  return missing ? "IN_PROGRESS" : "COMPLETE";
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** Built-in ceilings; a field constraint can only make them stricter. */
export const TEXT_LIMITS: Readonly<Record<"SHORT_TEXT" | "LONG_TEXT", number>> = { SHORT_TEXT: 200, LONG_TEXT: 4000 };

/** «80,5», «80.5», «-3» → number; empty → null; anything else → "invalid". */
export function parseNumberInput(text: string): number | null | "invalid" {
  const value = text.trim().replace(/\s+/gu, "").replace(",", ".");
  if (value === "") return null;
  return /^-?\d+(\.\d+)?$/u.test(value) ? Number(value) : "invalid";
}

/** «16.10.2026» or «2026-10-16» → ISO date; empty → null. */
export function parseDateInput(text: string): string | null | "invalid" {
  const value = text.trim();
  if (value === "") return null;
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/u.exec(value);
  const iso = dotted === null ? value : `${dotted[3]}-${dotted[2]!.padStart(2, "0")}-${dotted[1]!.padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : "invalid";
}

export function formatDateInput(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

function numberText(value: number): string {
  return String(value).replace(".", ",");
}

/**
 * The reason an answer is not accepted, in plain Russian, or null when it is valid. Checks the
 * type first and then the field's own constraints. A retired option may stay only if it was the
 * saved answer already (§25.12).
 */
export function answerProblem(target: QuestionField, raw: unknown, previous: AnswerValue | undefined,
  today: string): string | null {
  if (target.retired) return "Этот вопрос убран из анкеты.";
  if (raw === null || raw === undefined) return null;
  const limits = target.constraints ?? {};
  const usable = (id: string, kept: readonly string[]) => target.options.some((option) => option.id === id
    && (!option.retired || kept.includes(id)));
  switch (target.type) {
    case "SHORT_TEXT":
    case "LONG_TEXT": {
      if (typeof raw !== "string") return "Введите текст.";
      const max = Math.min(limits.maxLength ?? TEXT_LIMITS[target.type], TEXT_LIMITS[target.type]);
      return raw.trim().length > max ? `Не больше ${max} символов (сейчас ${raw.trim().length}).` : null;
    }
    case "NUMBER": {
      if (typeof raw !== "number" || !Number.isFinite(raw) || Math.abs(raw) >= 1e9) return "Введите число, например 12 или 80,5.";
      if (limits.integer === true && !Number.isInteger(raw)) return "Нужно целое число.";
      if (limits.min !== undefined && raw < limits.min) return `Не меньше ${numberText(limits.min)}.`;
      if (limits.max !== undefined && raw > limits.max) return `Не больше ${numberText(limits.max)}.`;
      return null;
    }
    case "DATE": {
      if (typeof raw !== "string" || !isIsoDate(raw)) return "Дата в формате ДД.ММ.ГГГГ.";
      if (limits.notFuture === true && raw > today) return "Дата не может быть в будущем.";
      if (limits.notBefore !== undefined && raw < limits.notBefore) return `Не раньше ${formatDateInput(limits.notBefore)}.`;
      return null;
    }
    case "SWITCH":
      return typeof raw === "boolean" ? null : "Выберите «да» или «нет».";
    case "SINGLE_CHOICE": {
      const kept = typeof previous === "string" ? [previous] : [];
      return typeof raw === "string" && usable(raw, kept) ? null : "Выберите один из вариантов.";
    }
    case "MULTI_CHOICE": {
      if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string")) return "Выберите варианты из списка.";
      const kept = Array.isArray(previous) ? previous : [];
      return (raw as string[]).every((id) => usable(id, kept)) ? null : "Один из вариантов больше недоступен.";
    }
  }
}

/** Normalized stored value or null to clear; throws QUESTIONNAIRE_ANSWER_INVALID with no partial write. */
export function normalizeAnswer(target: QuestionField, raw: unknown, previous: AnswerValue | undefined,
  today: string): AnswerValue | null {
  if (answerProblem(target, raw, previous, today) !== null) throw new Error("QUESTIONNAIRE_ANSWER_INVALID");
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") return raw.trim() === "" ? null : raw.trim();
  if (Array.isArray(raw)) {
    const unique = [...new Set(raw as string[])];
    return unique.length === 0 ? null : unique;
  }
  return raw as AnswerValue;
}

function constraintIssue(target: QuestionField): string | null {
  const limits = target.constraints;
  if (limits === null) return null;
  if (limits.min !== undefined && limits.max !== undefined && limits.min > limits.max) return "минимум больше максимума";
  if (limits.maxLength !== undefined && (!Number.isInteger(limits.maxLength) || limits.maxLength < 1)) {
    return "максимальная длина должна быть положительным целым числом";
  }
  if (limits.notBefore !== undefined && !isIsoDate(limits.notBefore)) return "неверная дата «не раньше»";
  return null;
}

export interface SchemaIssue {
  readonly fieldId: string | null;
  readonly message: string;
}

function ruleIssue(schema: QuestionnaireSchema, target: QuestionField): string | null {
  const rule = target.visibleIf;
  if (rule === null) return null;
  const source = allFields(schema).find((item) => item.field.id === rule.sourceFieldId)?.field;
  if (source === undefined || source.retired) return "условие ссылается на вопрос, которого нет в анкете";
  if (source.id === target.id) return "вопрос не может зависеть от самого себя";
  if (rule.operator === "CONTAINS" && !["MULTI_CHOICE", "SHORT_TEXT", "LONG_TEXT"].includes(source.type)) {
    return "«содержит» подходит только для текста и множественного выбора";
  }
  if ((source.type === "SINGLE_CHOICE" || source.type === "MULTI_CHOICE")
    && !source.options.some((option) => option.id === rule.value)) return "условие ссылается на удалённый вариант ответа";
  if (source.type === "SWITCH" && rule.value !== "true" && rule.value !== "false") return "для переключателя условие — «да» или «нет»";
  return null;
}

/** §23.10 / §25.15: a schema with broken dependencies or cycles is never published. */
export function validateSchema(schema: QuestionnaireSchema): readonly SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const ids = new Set<string>();
  const unique = (id: string) => { if (ids.has(id)) issues.push({ fieldId: id, message: "повторяющийся идентификатор" }); ids.add(id); };
  for (const item of schema.sections) {
    unique(item.id);
    if (!item.title.trim()) issues.push({ fieldId: null, message: "у раздела нет названия" });
    for (const entry of item.fields) {
      unique(entry.id);
      entry.options.forEach((option) => unique(option.id));
      if (!(QUESTION_TYPES as readonly string[]).includes(entry.type)) issues.push({ fieldId: entry.id, message: "неизвестный тип вопроса" });
      if (!entry.label.trim()) issues.push({ fieldId: entry.id, message: "у вопроса нет текста" });
      if ((entry.type === "SINGLE_CHOICE" || entry.type === "MULTI_CHOICE") && !entry.retired
        && !entry.options.some((option) => !option.retired && option.label.trim())) {
        issues.push({ fieldId: entry.id, message: "нужен хотя бы один вариант ответа" });
      }
      const problem = ruleIssue(schema, entry);
      if (problem !== null) issues.push({ fieldId: entry.id, message: problem });
      const limits = constraintIssue(entry);
      if (limits !== null) issues.push({ fieldId: entry.id, message: limits });
    }
  }
  const rules = new Map(allFields(schema).flatMap((item) => (item.field.visibleIf === null ? []
    : [[item.field.id, item.field.visibleIf.sourceFieldId] as const])));
  for (const start of rules.keys()) {
    const path = new Set<string>([start]);
    for (let next = rules.get(start); next !== undefined; next = rules.get(next)) {
      if (path.has(next)) { issues.push({ fieldId: start, message: "условия образуют цикл" }); break; }
      path.add(next);
    }
  }
  return issues;
}

export function sameSchema(a: QuestionnaireSchema, b: QuestionnaireSchema): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** §25.6 what Publish changes, counted per stable field ID. */
export function publishSummary(published: QuestionnaireSchema, draft: QuestionnaireSchema): PublishSummary {
  // A move is a different section or a different order among fields present in both versions, so
  // adding or removing a neighbour does not count every following field as moved.
  const shared = new Set(allFields(published).map((item) => item.field.id)
    .filter((id) => allFields(draft).some((item) => item.field.id === id)));
  const positioned = (schema: QuestionnaireSchema) => new Map(schema.sections.flatMap((item) => item.fields
    .filter((entry) => shared.has(entry.id))
    .map((entry, index) => [entry.id, { field: entry, section: item, index }] as const)));
  const before = new Map(allFields(published).map((item) => [item.field.id, { ...item, index: -1 }]));
  const after = new Map(allFields(draft).map((item) => [item.field.id, { ...item, index: -1 }]));
  for (const [id, entry] of positioned(published)) before.set(id, entry);
  for (const [id, entry] of positioned(draft)) after.set(id, entry);
  let added = 0; let changed = 0; let hidden = 0; let retired = 0; let moved = 0;
  for (const [id, now] of after) {
    const old = before.get(id);
    if (old === undefined) { added += 1; continue; }
    if (!old.field.hidden && now.field.hidden) hidden += 1;
    if (!old.field.retired && now.field.retired) retired += 1;
    if (old.section.id !== now.section.id || old.index !== now.index) moved += 1;
    // Hide and retire are counted separately, so they are neutralised before the content check.
    const core = (item: QuestionField) => JSON.stringify({ ...item, hidden: false, retired: false });
    if (core(old.field) !== core(now.field)) changed += 1;
  }
  const removed = [...before.keys()].filter((id) => !after.has(id)).length;
  const sectionKey = (item: QuestionSection) => JSON.stringify({ id: item.id, title: item.title, help: item.help, hidden: item.hidden });
  const oldSections = new Set(published.sections.map(sectionKey));
  const sections = draft.sections.filter((item) => !oldSections.has(sectionKey(item))).length;
  return { added, changed, hidden, retired, removed, moved, sections };
}
