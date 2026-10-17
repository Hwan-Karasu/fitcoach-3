import type { QuestionField, QuestionnaireSchema, QuestionSection } from "../domain/QuestionnaireModel.ts";

/**
 * Конструктор показывает анкету одним списком: заголовок раздела → его вопросы → строка «Добавить вопрос».
 * Перетаскиваются только вопросы; раздел, в который упал вопрос, — ближайший заголовок выше.
 */
export type BuilderRow =
  | Readonly<{ key: string; kind: "SECTION"; section: QuestionSection; first: boolean; open: boolean }>
  | Readonly<{ key: string; kind: "FIELD"; section: QuestionSection; field: QuestionField }>
  | Readonly<{ key: string; kind: "END"; section: QuestionSection }>;

export function builderRows(schema: QuestionnaireSchema, collapsed: ReadonlySet<string>): readonly BuilderRow[] {
  return schema.sections.flatMap((section, at): BuilderRow[] => {
    const open = !collapsed.has(section.id);
    const head: BuilderRow = { key: `s:${section.id}`, kind: "SECTION", section, first: at === 0, open };
    if (!open) return [head];
    return [head, ...section.fields.map((field): BuilderRow => ({ key: `f:${field.id}`, kind: "FIELD", section, field })),
      { key: `e:${section.id}`, kind: "END", section }];
  });
}

/** Куда встал вопрос после перетаскивания: раздел и место среди его вопросов (за краем — в конец). */
export function dropTarget(order: readonly BuilderRow[], fieldId: string):
  Readonly<{ sectionId: string; index: number }> | null {
  const at = order.findIndex((row) => row.kind === "FIELD" && row.field.id === fieldId);
  if (at < 0) return null;
  let index = 0;
  for (let cursor = at - 1; cursor >= 0; cursor -= 1) {
    const row = order[cursor] as BuilderRow;
    if (row.kind === "FIELD") index += 1;
    else if (row.kind === "END") return { sectionId: row.section.id, index: Number.MAX_SAFE_INTEGER };
    // Свёрнутый раздел: его вопросов в списке нет — вопрос встаёт в конец раздела.
    else return { sectionId: row.section.id, index: row.open ? index : Number.MAX_SAFE_INTEGER };
  }
  const first = order.find((row) => row.kind === "SECTION");
  return first === undefined ? null : { sectionId: first.section.id, index: 0 };
}
