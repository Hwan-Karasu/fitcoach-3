/** Системная полоса принадлежит общей панели, а не каждому вложенному футеру. */
export function panelBottomPadding(safeBottom: number, keyboardVisible: boolean): number {
  return keyboardVisible ? 4 : Math.max(0, safeBottom) + 4;
}
