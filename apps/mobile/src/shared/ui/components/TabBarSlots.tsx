import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRoute } from "@react-navigation/native";
import { createSlotStore, PENDING, resolveSlot, type SlotStore } from "./slotStore.ts";

export interface WeekNavigationState {
  readonly week: number;
  readonly previous: (() => void) | null;
  readonly next: (() => void) | null;
  readonly busy?: boolean;
}

interface Slots {
  readonly weeks: SlotStore<WeekNavigationState | null | typeof PENDING>;
  /** Строка над кнопками вкладок (переключатель участников). */
  readonly dock: SlotStore<ReactNode | typeof PENDING>;
}

const SlotsContext = createContext<Slots | null>(null);
const NO_SLOTS: Slots = { weeks: createSlotStore(), dock: createSlotStore() };

/**
 * Нижняя плавающая панель и экраны — разные ветки дерева. Экран кладёт в хранилище своё содержимое для панели (стрелки недель,
 * строка переключателя) под своим ключом `route.key` и убирает его, только когда сам исчезает. Панель показывает записи того
 * экрана, который сейчас в фокусе (`focusedLeafKey`). Так при переходе между экранами содержимое панели меняется одним
 * обновлением: нет кадра, в котором прежний экран уже всё убрал, а новый ещё не поставил (кнопки не меняют размер).
 */
export function TabBarSlotsProvider({ children }: Readonly<{ children: ReactNode }>) {
  const slots = useMemo<Slots>(() => ({ weeks: createSlotStore(), dock: createSlotStore() }), []);
  return <SlotsContext.Provider value={slots}>{children}</SlotsContext.Provider>;
}

/**
 * Что экран с ключом `key` положил в панель (читает панель). Пока экран объявил содержимое, но оно не готово (`TabBarPending`),
 * панель держит то, что показывала до перехода.
 *
 * Новый ключ без записи в первом проходе — «экран ещё не успел объявить» (его эффекты идут после отрисовки панели в том же
 * коммите), а не «экран ничего не кладёт»: панель держит прежнее и принимает «записей нет» только после этих эффектов.
 */
export function useTabBarSlots(key: string | undefined): Readonly<{ weeks: WeekNavigationState | undefined; dock: ReactNode }> {
  const slots = useContext(SlotsContext) ?? NO_SLOTS;
  useSyncExternalStore(slots.weeks.subscribe, slots.weeks.getSnapshot, slots.weeks.getSnapshot);
  useSyncExternalStore(slots.dock.subscribe, slots.dock.getSnapshot, slots.dock.getSnapshot);
  const [trustedKey, setTrustedKey] = useState(key);
  useLayoutEffect(() => { if (trustedKey !== key) setTrustedKey(key); });
  const shown = useRef<{ weeks: WeekNavigationState | undefined; dock: ReactNode }>({ weeks: undefined, dock: undefined });
  const rawWeeks = slots.weeks.get(key);
  const rawDock = slots.dock.get(key);
  if (trustedKey !== key && rawWeeks === undefined && rawDock === undefined) return shown.current;
  shown.current = { weeks: resolveSlot<WeekNavigationState>(rawWeeks, shown.current.weeks), dock: resolveSlot<ReactNode>(rawDock, shown.current.dock) };
  return shown.current;
}

/**
 * Объявляет, что экран скоро положит в панель стрелки недель и/или строку: до готовности панель не пустеет, а держит прежнее. Ставится
 * там, где экран появляется раньше своих данных (маршрут), и снимается готовой записью экрана (`useWeekNavigation`, `TabBarDock`).
 */
export function TabBarPending({ weeks = false, dock = false }: Readonly<{ weeks?: boolean; dock?: boolean }>) {
  const slots = useContext(SlotsContext);
  const key = useRoute().key;
  useLayoutEffect(() => {
    if (slots === null) return;
    if (weeks && slots.weeks.get(key) === undefined) slots.weeks.set(key, PENDING);
    if (dock && slots.dock.get(key) === undefined) slots.dock.set(key, PENDING);
  }, [slots, key, weeks, dock]);
  useLayoutEffect(() => () => { slots?.weeks.remove(key); slots?.dock.remove(key); }, [slots, key]);
  return null;
}

/**
 * Стрелки переключения недель в панели: запись экрана; пока экран жив, она остаётся, и показывает её панель, когда экран в фокусе.
 * `ready = false` — данные для стрелок ещё грузятся: запись не трогается (объявленное «ожидается» держит прежние стрелки); `null` при
 * `ready` — стрелок у этого экрана нет.
 */
export function useWeekNavigation(state: WeekNavigationState | null, ready = true) {
  const slots = useContext(SlotsContext);
  const key = useRoute().key;
  // Действия экрана — новые функции на каждом рендере; в панель уходят постоянные обёртки,
  // а перезапись — только при смене недели, доступности стрелок или занятости.
  const actions = useRef(state);
  actions.current = state;
  const week = state?.week;
  const hasPrevious = state?.previous != null;
  const hasNext = state?.next != null;
  const busy = state?.busy;
  useLayoutEffect(() => {
    if (slots === null || !ready) return;
    if (week === undefined) { slots.weeks.set(key, null); return; }
    slots.weeks.set(key, { week, busy,
      previous: hasPrevious ? () => actions.current?.previous?.() : null,
      next: hasNext ? () => actions.current?.next?.() : null });
  }, [slots, key, ready, week, hasPrevious, hasNext, busy]);
  useLayoutEffect(() => () => { slots?.weeks.remove(key); }, [slots, key]);
}

/**
 * Строка над кнопками вкладок в нижней панели (переключатель участников). Кнопки вкладок при этом ужимаются, высота панели прежняя.
 * Запись — на каждом рендере экрана (элемент новый), снятие — при размонтировании; `null` — готовая запись «строки нет».
 */
export function TabBarDock({ children }: Readonly<{ children: ReactNode }>) {
  const slots = useContext(SlotsContext);
  const key = useRoute().key;
  useLayoutEffect(() => {
    slots?.dock.set(key, children ?? null);
  });
  useLayoutEffect(() => () => { slots?.dock.remove(key); }, [slots, key]);
  return null;
}
