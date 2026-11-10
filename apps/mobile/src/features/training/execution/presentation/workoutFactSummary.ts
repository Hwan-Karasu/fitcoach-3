import type { SetFact } from "../domain/ExecutionModel.ts";
import { factVolume } from "./programMatrix.ts";

/** Один проход по снимку вместо повторного поиска всех фактов для каждой карточки упражнения. */
export function workoutFactSummary(facts: Iterable<SetFact>) {
  const volumes = new Map<string, number>();
  const warmups = new Map<string, SetFact[]>();
  for (const fact of facts) {
    const key = fact.plannedExerciseId;
    volumes.set(key, (volumes.get(key) ?? 0) + factVolume(fact));
    if (fact.extra) {
      const group = warmups.get(key) ?? [];
      group.push(fact); warmups.set(key, group);
    }
  }
  for (const group of warmups.values()) group.sort((a, b) => a.position - b.position);
  return { volumes, warmups };
}
