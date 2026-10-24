import { useEffect, useState } from "react";
import type { GroupCopy } from "../domain/Placement.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import { isGroupOfMesocycle } from "../domain/ParticipantCounterpart.ts";

export function useParticipantGroup(repository: TrainingPlansRepositoryPort, clientId: string, programId: string,
  mesocycleId: string | null | undefined, workoutId: string | undefined, given: readonly GroupCopy[] | null | undefined) {
  const [read, setRead] = useState<Readonly<{ key: string; members: readonly GroupCopy[] }> | null>(null);
  const [version, setVersion] = useState(0);
  const members = given === undefined ? read?.members ?? null : given;
  const refKind = mesocycleId != null ? "mesocycleId" : "workoutId";
  const refId = mesocycleId ?? workoutId ?? null;
  const readKey = JSON.stringify([clientId, programId, refKind, refId]);
  useEffect(() => {
    if (given !== undefined) return undefined;
    let active = true;
    const ref = refId === null ? null : refKind === "mesocycleId" ? { mesocycleId: refId } : { workoutId: refId };
    if (ref === null) { setRead({ key: readKey, members: [] }); return () => { active = false; }; }
    repository.getMesocycleGroup(clientId, programId, ref)
      .then((copies) => { if (active) setRead({ key: readKey, members: copies }); }).catch(() => undefined);
    return () => { active = false; };
  }, [clientId, given, programId, readKey, refId, refKind, repository, version]);
  useEffect(() => given !== undefined ? undefined : repository.subscribeCommittedChanges((change) => {
    if (change.selectionOnly !== true && change.orderOnly !== true) setVersion((value) => value + 1);
  }), [given, repository]);
  const fresh = given === undefined ? read?.key === readKey
    : mesocycleId == null || isGroupOfMesocycle(members ?? [], mesocycleId);
  return { members, fresh };
}
