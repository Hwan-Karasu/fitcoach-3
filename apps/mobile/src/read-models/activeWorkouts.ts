import type { ClientRepositoryPort } from "../features/clients/public.ts";
import type { ActiveWorkoutCard, ActiveWorkoutsPort, TrainingExecutionPort, TrainingPlansRepositoryPort } from
  "../features/training/public.ts";

/**
 * §48.83: тренировки «в работе» у всех клиентов для быстрого перехода между дневниками. Факты — у дневника,
 * подписи — у клиентов и планов; архивный клиент и пропавшая из плана тренировка в список не попадают.
 */
export function createActiveWorkouts(execution: Pick<TrainingExecutionPort, "listActiveWorkouts" | "subscribeCommittedChanges">,
  plans: Pick<TrainingPlansRepositoryPort, "findWorkout">, clients: Pick<ClientRepositoryPort, "get">): ActiveWorkoutsPort {
  return {
    async list() {
      const active = await execution.listActiveWorkouts();
      const cards = await Promise.all(active.map(async (item): Promise<ActiveWorkoutCard | null> => {
        const [client, found] = await Promise.all([clients.get(item.clientId),
          plans.findWorkout(item.clientId, item.programId, item.plannedWorkoutId, item.weekIndex)]);
        if (client === null || client.lifecycle !== "ACTIVE" || found === null) return null;
        const { program, workout } = found;
        return { slot: { clientId: item.clientId, programId: item.programId, weekIndex: item.weekIndex,
          plannedWorkoutId: item.plannedWorkoutId }, clientName: client.displayName, programTitle: program.title,
        workoutTitle: workout.title };
      }));
      return cards.filter((card): card is ActiveWorkoutCard => card !== null);
    },
    subscribe: (listener) => execution.subscribeCommittedChanges(() => listener()),
  };
}
