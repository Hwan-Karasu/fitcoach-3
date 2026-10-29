import { useEffect, useRef, useState } from "react";
import type { GroupCopy } from "../domain/Placement.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import { isGroupOfMesocycle } from "../domain/ParticipantCounterpart.ts";
import { acceptGroup, groupFresh, groupOf, type GroupRead } from "../domain/ParticipantGroupState.ts";

/**
 * Состав группы для места плана. Пока он не прочитан для этого места — `members: null` (полоса держит прежнее), а не состав прежней
 * программы; не прочитался — `failed` и повтор при возврате на экран или при следующем изменении плана (PART-DOCK-1).
 */
export function useParticipantGroup(repository: TrainingPlansRepositoryPort, clientId: string, programId: string,
  mesocycleId: string | null | undefined, workoutId: string | undefined, given: readonly GroupCopy[] | null | undefined,
  /** Экран на виду: после неудачного чтения повтор — при возвращении фокуса. */
  focused = true) {
  const [read, setRead] = useState<GroupRead<GroupCopy> | null>(null);
  const [version, setVersion] = useState(0);
  const refKind = workoutId !== undefined ? "workoutId" : "mesocycleId";
  const refId = workoutId ?? mesocycleId ?? null;
  const place = JSON.stringify([clientId, programId, refKind, refId]);
  const latest = useRef({ place, version });
  latest.current = { place, version };
  useEffect(() => {
    if (given !== undefined) return undefined;
    let active = true;
    const ref = refId === null ? null : refKind === "mesocycleId" ? { mesocycleId: refId } : { workoutId: refId };
    if (ref === null) { setRead({ place, version, status: "ready", members: [] }); return () => { active = false; }; }
    repository.getMesocycleGroup(clientId, programId, ref).then(
      (members) => { if (active) setRead((current) => acceptGroup(current, { place, version, status: "ready", members }, latest.current)); },
      () => { if (active) setRead((current) => acceptGroup(current, { place, version, status: "error" }, latest.current)); });
    return () => { active = false; };
  }, [clientId, given, place, programId, refId, refKind, repository, version]);
  useEffect(() => given !== undefined ? undefined : repository.subscribeCommittedChanges((change) => {
    if (change.selectionOnly !== true) setVersion((value) => value + 1);
  }), [given, repository]);
  const failed = given === undefined && read !== null && read.place === place && read.status === "error";
  // Не прочиталось: ещё одна попытка сразу и при возвращении экрана в фокус (не цикл повторов); дальше — по изменению плана.
  useEffect(() => { if (focused && failed) setVersion((value) => value + 1); }, [focused, failed]);
  const members = given === undefined ? groupOf(read, place) : given;
  const fresh = given === undefined ? groupFresh(read, place, version)
    : mesocycleId == null || isGroupOfMesocycle(members ?? [], mesocycleId);
  return { members, fresh, failed };
}
