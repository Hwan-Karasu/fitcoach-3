import type { BuilderMesocycleInput } from "./PeriodizedModel.ts";
import type { TrainingProgram } from "./ProgramModel.ts";
import type { Placement } from "./Placement.ts";
import type { RemovedResultsAction } from "./WeekEditSave.ts";

/**
 * Сохранение мезоцикла из конструктора (UI-OWN-041): новый мезоцикл («+ Мезоцикл», у выбранных участников) или
 * правка мезоцикла открытого клиента целиком — настройки и все недели. Версия до правки сохраняется; недели,
 * убранные с конца, удаляются только без результатов (иначе `WEEK_HAS_RESULTS`).
 */
export interface MesocycleSaveRequest {
  readonly clientId: string;
  readonly programId: string;
  readonly expectedRevision: number;
  /** `null` — новый мезоцикл. */
  readonly mesocycleId: string | null;
  /** Новый мезоцикл: участники (открывший — среди них). Правка — только открытый клиент. */
  readonly clientIds: readonly string[];
  readonly mesocycle: BuilderMesocycleInput;
  /** «+ Мезоцикл»: куда ляжет копия у клиентов вне этой программы (UI-OWN-044). */
  readonly placements?: readonly Placement[];
  /** Что сделать с результатами тренировок, которые правка убирает из плана; без выбора — `WEEK_HAS_RESULTS` (ADR-031). */
  readonly resultsAction?: RemovedResultsAction;
}

export type MesocycleSaveResult = Readonly<{ program: TrainingProgram; mesocycleId: string }>;

export interface MesocycleSavePort {
  save(request: MesocycleSaveRequest): Promise<MesocycleSaveResult>;
}

/** Сторона планов в общей транзакции. */
export interface MesocycleSavePlansParticipant<Tx> {
  /** Тренировки недель, которые правка удалит: у них не должно быть результатов. */
  removedWorkouts(tx: Tx, request: MesocycleSaveRequest): Promise<readonly Readonly<{ weekIndex: number; plannedWorkoutId: string;
    programTitle: string; mesocycleTitle: string; workoutTitle: string }>[]>;
  save(tx: Tx, request: MesocycleSaveRequest, now: Date): Promise<MesocycleSaveResult>;
  notify(clientIds: readonly string[]): void;
}
