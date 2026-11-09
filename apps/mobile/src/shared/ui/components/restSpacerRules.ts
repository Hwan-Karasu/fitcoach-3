/**
 * Обычный нижний запас без панели. Содержимое дневника разделено зазором 12, поэтому вместе с ним получается прежний отступ 24,
 * а над панелью — зазор 12: сама высота запаса равна только реальному перекрытию.
 */
export const REST_SPACER_BASE = 12;

/**
 * Запас под последним элементом прокрутки: перекрытие панелью нижнего края области (панель занимает `inset` от низа окна,
 * под областью прокрутки уже лежит `spaceBelow`, например панель вкладок). Не перекрывает — обычный запас.
 */
export function restSpacerHeight(inset: number, spaceBelow: number): number {
  const overlap = Math.max(0, inset - Math.max(0, spaceBelow));
  return Math.max(REST_SPACER_BASE, Math.ceil(overlap));
}
