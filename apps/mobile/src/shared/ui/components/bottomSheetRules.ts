/** Доля высоты листа, после которой отпущенный лист закрывается. */
export const SHEET_CLOSE_FRACTION = 0.3;
/** Скорость (dp/с) вниз, при которой лист закрывается даже после короткого сдвига. */
export const SHEET_CLOSE_VELOCITY = 900;
/** Сдвиг меньше этого значения — случайное касание ручки, лист не закрываем даже при быстром движении. */
export const SHEET_MIN_DRAG = 12;

/**
 * Что делать с листом, когда палец отпущен: закрыть или вернуть на место. Лист двигается за пальцем только вниз,
 * вверх не тянется (сдвиг не бывает отрицательным).
 */
export function sheetSettle(translationY: number, velocityY: number, sheetHeight: number): "close" | "stay" {
  "worklet";
  if (translationY < SHEET_MIN_DRAG) return "stay";
  if (velocityY >= SHEET_CLOSE_VELOCITY) return "close";
  return translationY >= sheetHeight * SHEET_CLOSE_FRACTION ? "close" : "stay";
}
