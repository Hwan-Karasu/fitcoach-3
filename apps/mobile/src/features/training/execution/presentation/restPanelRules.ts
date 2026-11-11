import type { RestTimer } from "../domain/RestTimerRules.ts";

export type RestPanelPreference = "expanded" | "collapsed";
export function restPanelMode(preference: RestPanelPreference, count: number) {
  return count === 0 ? "hidden" : preference;
}

export function orderedRestTimers(list: readonly RestTimer[]): readonly RestTimer[] {
  return [...list].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
}

export const TIMER_GAP = 8;
/** Внутренний отступ карточки и промежуток между четырьмя кнопками (макет: два и больше таймеров — карточки рядом). */
export const CARD_PADDING = 5;
export const ACTION_GAP = 3;
/** Самая узкая кнопка карточки при нескольких таймерах: ниже неё карточка не сжимается, а следующая только выглядывает. */
export const MIN_ACTION_WIDTH = 34;
const MIN_CARD_WIDTH = 4 * MIN_ACTION_WIDTH + 3 * ACTION_GAP + 2 * CARD_PADDING + 1;
/** Два таймера — две карточки рядом, если на каждую хватает четырёх кнопок не уже 34 dp; иначе (узкий экран, крупный шрифт)
 * карточки не сжимаются, а следующая выглядывает с краю и листается. Три и больше — две полные и край третьей. */
export function timerCarouselLayout(width: number, count: number, fontScale: number) {
  const available = Math.max(0, width);
  const minimum = Math.min(available, Math.round(MIN_CARD_WIDTH + 28 * (Math.max(1, fontScale) - 1)));
  const full = Math.min(Math.max(1, count), Math.max(1, Math.floor((available + TIMER_GAP) / (minimum + TIMER_GAP))));
  const overflow = count > full;
  const cardWidth = count <= 1 ? available : overflow
    ? Math.max(minimum, (available - 24 - full * TIMER_GAP) / full)
    : Math.max(0, (available - (full - 1) * TIMER_GAP) / full);
  const step = cardWidth + TIMER_GAP;
  const maxOffset = Math.max(0, count * step - TIMER_GAP - available);
  return { cardWidth, step, maxOffset, stops: maxOffset === 0 ? 1 : Math.ceil(maxOffset / step) + 1 };
}

/** В компактной строке время не ужимается: сначала оставляем место имени, раскрытию и «Ещё». */
export function compactTimerCount(width: number, count: number, multipleOwners: boolean, fontScale: number): number {
  if (count <= 1) return count;
  const token = (multipleOwners ? 84 : 54) * Math.max(1, fontScale);
  const available = Math.max(0, width - 156);
  if (count * token <= available) return count;
  return Math.max(0, Math.min(count - 1, Math.floor((available - 64 * Math.max(1, fontScale)) / token)));
}

/** При удалении видимой карточки сохраняем ближайшее место вместо возврата к началу. */
export function retainedTimerOffset(previousIds: readonly string[], nextIds: readonly string[], offset: number, step: number, maxOffset: number, previousStep = step): number {
  if (nextIds.length === 0 || step <= 0) return 0;
  const previousIndex = Math.max(0, Math.round(offset / previousStep));
  const anchor = previousIds[previousIndex];
  const found = anchor === undefined ? -1 : nextIds.indexOf(anchor);
  return Math.max(0, Math.min(maxOffset, (found < 0 ? Math.min(previousIndex, nextIds.length - 1) : found) * step));
}

export function timerCarouselPosition(offset: number, step: number, maxOffset: number, stops: number): number {
  if (maxOffset > 0 && offset >= maxOffset - 1) return stops - 1;
  return Math.max(0, Math.min(stops - 1, Math.round(offset / step)));
}

export function timerCountLabel(count: number): string {
  const last = count % 10;
  const teen = count % 100;
  return `${count} ${teen >= 11 && teen <= 14 ? "таймеров" : last === 1 ? "таймер" : last >= 2 && last <= 4 ? "таймера" : "таймеров"}`;
}

export function timerInitials(name: string): string {
  return name.trim().split(/\s+/u).slice(0, 2).map((part) => Array.from(part)[0]?.toLocaleUpperCase("ru") ?? "").join("") || "?";
}

/** Быстрый взмах по ручке, dp/с: решает сам, независимо от пройденного пути. */
export const PANEL_FLING_VELOCITY = 500;
/** Сдвиг ручки, dp, после которого панель дотягивается до другого состояния, даже если палец не дошёл до середины. */
export const PANEL_SNAP_DISTANCE = 24;

/**
 * Куда довести панель таймеров, когда палец отпущен. `start` — состояние в начале жеста (1 — развёрнута, 0 — свёрнута), `progress` — где панель
 * сейчас (0…1), `velocityY` — скорость пальца вниз, `range` — полный ход панели в dp. Быстрый взмах решает по направлению; иначе
 * сдвиг от начала не меньше `PANEL_SNAP_DISTANCE` ведёт к другому состоянию; короткий — возвращает в исходное.
 */
export function restPanelSettleTarget(start: 0 | 1, progress: number, velocityY: number, range: number): 0 | 1 {
  "worklet";
  if (velocityY > PANEL_FLING_VELOCITY) return 0;
  if (velocityY < -PANEL_FLING_VELOCITY) return 1;
  const moved = (progress - start) * range;
  if (moved <= -PANEL_SNAP_DISTANCE) return 0;
  if (moved >= PANEL_SNAP_DISTANCE) return 1;
  return start;
}
