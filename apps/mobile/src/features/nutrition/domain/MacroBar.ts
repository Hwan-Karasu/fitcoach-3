import type { TargetRange } from "./TargetModel.ts";

/** Запас шкалы над верхней границей коридора, чтобы рамка коридора не упиралась в край полосы. */
const RANGE_HEADROOM = 1.15;

/** Геометрия полосы «съедено / цель» в долях ширины 0…1; `band` — рамка коридора (только для диапазона). */
export interface MacroBarGeometry {
  readonly fill: number;
  readonly band: Readonly<{ left: number; width: number }> | null;
}

/**
 * Полоса макронутриента на «Главной» (макет UI-OWN-069): точная цель — шкала до цели; коридор — шкала на 15 % длиннее верхней границы,
 * рамка отмечает коридор. Неизвестное «съедено» или цель без верхней границы дают пустую полосу, а не нулевое значение.
 */
export function macroBarGeometry(eatenX10: number | null, target: TargetRange | null): MacroBarGeometry {
  if (target === null || target.maxX10 <= 0) return { fill: 0, band: null };
  const isRange = target.minX10 !== target.maxX10;
  const scale = isRange ? target.maxX10 * RANGE_HEADROOM : target.maxX10;
  const fill = eatenX10 === null ? 0 : Math.min(1, Math.max(0, eatenX10 / scale));
  return { fill, band: isRange ? { left: target.minX10 / scale, width: (target.maxX10 - target.minX10) / scale } : null };
}
