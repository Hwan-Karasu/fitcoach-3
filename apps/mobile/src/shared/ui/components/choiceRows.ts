/** Строки сетки: по `columns` ячеек; неполная последняя строка растягивается на всю ширину. */
export function chunkRows<T>(items: readonly T[], columns: number): readonly (readonly T[])[] {
  const size = Math.max(1, Math.floor(columns));
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}
