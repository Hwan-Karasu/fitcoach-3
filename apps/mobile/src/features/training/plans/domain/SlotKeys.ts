/**
 * Ключи слотов карточек конструктора (BUILDER-SLOTS). В каждой неделе у тренировок и упражнений свои `id`, и React пересоздавал бы все
 * карточки при смене недели. Слотовый ключ принадлежит карточке на экране: упражнение, которое осталось, сохраняет ключ (перетаскивание
 * его не меняет); новые `id` занимают ключи ушедших по порядку, а недостающие создаются заново. Тогда при смене недели карточки и
 * `Sortable.Grid` переиспользуются, а не строятся с нуля.
 */
export function assignSlotKeys(previous: ReadonlyMap<string, string>, ids: readonly string[], fresh: () => string): Map<string, string> {
  const present = new Set(ids);
  const free = [...previous].filter(([id]) => !present.has(id)).map(([, key]) => key);
  const next = new Map<string, string>();
  for (const id of ids) next.set(id, previous.get(id) ?? free.shift() ?? fresh());
  return next;
}
