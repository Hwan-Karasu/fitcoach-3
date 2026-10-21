import type { TrainingProgram } from "./ProgramModel.ts";
import type { SimpleProgramDraft } from "./SimplePlanModel.ts";

/**
 * Сохранение структуры Простой программы из конструктора: если правка убирает недели или тренировки, в которых уже есть результаты,
 * тренер подтверждает это явно (`confirmRemovedResults`), иначе `WEEKS_HAVE_RESULTS`. Результаты не удаляются — остаются в истории
 * и вернутся в дневник, если неделю или тренировку вернуть.
 */
export interface SimplePlanSaveRequest {
  readonly clientId: string;
  readonly programId: string;
  readonly expectedRevision: number;
  readonly draft: SimpleProgramDraft;
  readonly confirmRemovedResults: boolean;
}

export interface SimplePlanSavePort {
  saveSimplePlan(request: SimplePlanSaveRequest): Promise<TrainingProgram>;
}

/** Сторона планов в общей транзакции. */
export interface SimplePlanSavePlansParticipant<Tx> {
  /** Слоты (неделя × тренировка), которые правка уберёт из плана. */
  removedWorkouts(tx: Tx, request: SimplePlanSaveRequest): Promise<readonly Readonly<{ weekIndex: number; plannedWorkoutId: string }>[]>;
  save(tx: Tx, request: SimplePlanSaveRequest, now: Date): Promise<TrainingProgram>;
  notify(clientIds: readonly string[]): void;
}
