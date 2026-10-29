import type { ClientChangePort, ClientRepositoryPort } from "../features/clients/public.ts";
import type { ActiveWorkoutCard, ActiveWorkoutsPort, TrainingExecutionPort, TrainingPlansRepositoryPort } from
  "../features/training/public.ts";

/**
 * §48.83: тренировки «в работе» у всех клиентов для быстрого перехода между дневниками. Факты — у дневника,
 * подписи — у клиентов и планов; архивный клиент и пропавшая из плана тренировка в список не попадают.
 */
export function createActiveWorkouts(execution: Pick<TrainingExecutionPort, "listActiveWorkouts" | "subscribeCommittedChanges">,
  plans: Pick<TrainingPlansRepositoryPort, "findWorkout" | "subscribeCommittedChanges">,
  clients: Pick<ClientRepositoryPort, "get"> & ClientChangePort): ActiveWorkoutsPort {
  // Подписи карточек (клиент, программа, тренировка) меняют только клиенты и планы; запись подхода их не меняет, поэтому
  // при каждом подходе заново собирается лишь список занятий «в работе», а имена и планы берутся из кэша (иначе — `clients.get` и
  // чтение плана на каждое занятие при каждом нажатии). Кэш сбрасывается изменением клиентов или планов.
  let cache = new Map<string, Promise<ActiveWorkoutCard | null>>();
  // Сброс зарегистрирован при создании, раньше любых слушателей, и не зависит от того, подписан ли кто-то сейчас.
  plans.subscribeCommittedChanges((change) => { if (change.selectionOnly !== true && change.orderOnly !== true) cache = new Map(); });
  clients.subscribeCommittedChanges(() => { cache = new Map(); });
  return {
    async list() {
      const active = await execution.listActiveWorkouts();
      const current = cache;
      const cards = await Promise.all(active.map((item): Promise<ActiveWorkoutCard | null> => {
        const key = JSON.stringify([item.clientId, item.programId, item.weekIndex, item.plannedWorkoutId]);
        const known = current.get(key);
        if (known !== undefined) return known;
        const loaded = load(item);
        current.set(key, loaded);
        loaded.catch(() => { if (current.get(key) === loaded) current.delete(key); });
        return loaded;
      }));
      return cards.filter((card): card is ActiveWorkoutCard => card !== null);
    },
    subscribe: (listener) => {
      const offExecution = execution.subscribeCommittedChanges(() => listener());
      const offPlans = plans.subscribeCommittedChanges((change) => {
        if (change.selectionOnly !== true && change.orderOnly !== true) listener();
      });
      const offClients = clients.subscribeCommittedChanges(() => listener());
      return () => { offExecution(); offPlans(); offClients(); };
    },
  };

  async function load(item: Awaited<ReturnType<typeof execution.listActiveWorkouts>>[number]): Promise<ActiveWorkoutCard | null> {
    const [client, found] = await Promise.all([clients.get(item.clientId),
      plans.findWorkout(item.clientId, item.programId, item.plannedWorkoutId, item.weekIndex)]);
    if (client === null || client.lifecycle !== "ACTIVE" || found === null) return null;
    const { program, workout } = found;
    return { slot: { clientId: item.clientId, programId: item.programId, weekIndex: item.weekIndex,
      plannedWorkoutId: item.plannedWorkoutId }, clientName: client.displayName, programTitle: program.title,
    workoutTitle: workout.title };
  }
}
