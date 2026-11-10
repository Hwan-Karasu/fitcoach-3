import type { HistoryMode } from "./historyTypes.ts";
import { useCallback, useState } from "react";
import { createViewRetainer } from "../../../../shared/ui/retainedView.ts";

/**
 * Состояние экранов «Истории занятий», пока открыта карточка клиента (UX-контракт v1.2 §5): режим, поиск, выбранный мезоцикл, раскрытые
 * тренировки и позиции прокрутки по программам. Живёт в модуле, а не в экране: возврат из «Деталей» или дневника не сбрасывает контекст.
 * Освобождается, когда закрыта последняя карточка клиента (`retainHistoryView`): открытая поверх тренировка — тоже карточка этого клиента.
 */
export interface ProgramViewState {
  /** `undefined` — ещё не выбирали (по умолчанию — мезоцикл с последним занятием), `null` — «Все». */
  mesocycleId: string | null | undefined;
  /** Ключи раскрытых групп: `область|ключ тренировки`. */
  readonly expanded: Set<string>;
  /** Позиции прокрутки списка тренировок по области (`Все` или мезоцикл). */
  readonly scroll: Map<string, number>;
}

export interface ClientHistoryView {
  mode: HistoryMode;
  query: string;
  readonly programs: Map<string, ProgramViewState>;
}

const byClient = new Map<string, ClientHistoryView>();

export function historyViewOf(clientId: string): ClientHistoryView {
  const found = byClient.get(clientId);
  if (found !== undefined) return found;
  const created: ClientHistoryView = { mode: "workouts", query: "", programs: new Map() };
  byClient.set(clientId, created);
  return created;
}

export function programViewOf(clientId: string, programId: string): ProgramViewState {
  const view = historyViewOf(clientId);
  const found = view.programs.get(programId);
  if (found !== undefined) return found;
  const created: ProgramViewState = { mesocycleId: undefined, expanded: new Set(), scroll: new Map() };
  view.programs.set(programId, created);
  return created;
}

/** Карточка клиента открыта: состояние сохраняется; возвращённая функция вызывается при закрытии карточки. */
export const retainHistoryView = createViewRetainer((clientId) => { byClient.delete(clientId); });

/** Выбор и раскрытие принадлежат программе клиента, даже если навигатор переиспользовал экран. */
export function useProgramHistoryView(clientId: string, programId: string) {
  const view = programViewOf(clientId, programId);
  const [state, setState] = useState(() => ({ view, selected: view.mesocycleId, expanded: new Set(view.expanded), listOpen: false }));
  if (state.view !== view) setState({ view, selected: view.mesocycleId, expanded: new Set(view.expanded), listOpen: false });
  const choose = useCallback((selected: string | null) => { view.mesocycleId = selected; setState((old) => ({ ...old, selected })); }, [view]);
  const toggle = useCallback((key: string) => setState((old) => {
    const expanded = new Set(old.expanded);
    if (!expanded.delete(key)) expanded.add(key);
    view.expanded.clear(); expanded.forEach((item) => view.expanded.add(item));
    return { ...old, expanded };
  }), [view]);
  const setListOpen = useCallback((listOpen: boolean) => setState((old) => ({ ...old, listOpen })), []);
  return { view, selected: state.selected, expanded: state.expanded, listOpen: state.listOpen, choose, toggle, setListOpen };
}
