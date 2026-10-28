import type { TransferSession } from "../../../../shared/training-transfer/TrainingTransfer.ts";

/**
 * Факты импортированного цикла в черновике конструктора (BUILDER-FACTS): видны и правятся в карточке упражнения до сохранения.
 * После сохранения факты принадлежат тренировкам и правятся через прошедшую запись. `sourceHash` черновика не пересчитывается:
 * он — отпечаток исходного листа, и повторный импорт того же листа не затирает правки.
 */
export interface ImportedFactRow { readonly id: string; readonly reps: number | null; readonly loadGrams: number | null }
export type ImportedFactPatch = Readonly<{ reps?: number | null; loadGrams?: number | null }>;

export function importedFactRows(sessions: readonly TransferSession[]): ReadonlyMap<string, readonly ImportedFactRow[]> {
  const groups = new Map<string, { position: number; row: ImportedFactRow }[]>();
  for (const session of sessions) for (const fact of session.facts) {
    const group = groups.get(fact.plannedExerciseId) ?? []; groups.set(fact.plannedExerciseId, group);
    group.push({ position: fact.position, row: { id: fact.id, reps: fact.values.reps, loadGrams: fact.values.loadGrams } });
  }
  return new Map([...groups].map(([id, group]) => [id, group.sort((a, b) => a.position - b.position).map((item) => item.row)]));
}

/** Те же границы, что у импорта: повторы 1–999, вес 0–1 000 000 г. */
export function isValidFactPatch(patch: ImportedFactPatch): boolean {
  const within = (value: number | null | undefined, min: number, max: number) => value == null || (Number.isInteger(value) && value >= min && value <= max);
  return within(patch.reps, 1, 999) && within(patch.loadGrams, 0, 1_000_000);
}

export function setImportedFact(sessions: readonly TransferSession[], factId: string, patch: ImportedFactPatch): readonly TransferSession[] {
  return sessions.map((session) => !session.facts.some((fact) => fact.id === factId) ? session : { ...session,
    facts: session.facts.map((fact) => fact.id === factId ? { ...fact, values: { ...fact.values, ...patch } } : fact) });
}
