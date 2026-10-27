/**
 * Канонический текст значения для хешей квитанций переноса: ключи объектов по `localeCompare`, `undefined` пропускается.
 * Порядок и вывод нельзя менять: от них зависят сохранённые хеши (повторный импорт сверяется с квитанцией).
 *
 * Порядок ключей запоминается по «форме» объекта (набор ключей в порядке вставки). На Android Hermes `localeCompare` идёт
 * через платформенный Collator и стоит микросекунды; при сортировке ключей каждого из десятков тысяч объектов книги
 * один проход хеширования занимал секунды.
 */
const MAX_REMEMBERED_SHAPES = 512;
const MAX_KEYS_REMEMBERED = 32;
const shapes = new Map<string, readonly string[]>();

function keyOrder(keys: readonly string[]): readonly string[] {
  if (keys.length < 2) return keys;
  if (keys.length > MAX_KEYS_REMEMBERED) return [...keys].sort((a, b) => a.localeCompare(b));
  const shape = JSON.stringify(keys);
  const known = shapes.get(shape);
  if (known !== undefined) return known;
  const order = [...keys].sort((a, b) => a.localeCompare(b));
  if (shapes.size >= MAX_REMEMBERED_SHAPES) shapes.clear();
  shapes.set(shape, order);
  return order;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of keyOrder(Object.keys(record))) {
      const item = record[key];
      if (item !== undefined) parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
    }
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}
