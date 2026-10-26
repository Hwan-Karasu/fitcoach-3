import { useRef, useState, type ComponentProps } from "react";
import { View } from "react-native";
import { ConfirmDialog, DropdownMenu, InlineNotice } from "../../../../shared/ui/components/public.ts";
import type { ClientPlacementOptions, PlacementTarget } from "../domain/Placement.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import { ParticipantChips } from "./ParticipantChips.tsx";

type CycleOption = NonNullable<ClientPlacementOptions["cycles"]>[number];

/** Picking a cycle only changes the constructor draft. The owner validates again when saving. */
export function ParticipantAssignments({ repository, hostProgramId, values, currentCycles, onAssign, ...chips }: ComponentProps<typeof ParticipantChips> & Readonly<{
  repository: TrainingPlansRepositoryPort;
  hostProgramId: string | null;
  values: ReadonlyMap<string, PlacementTarget>;
  currentCycles?: ReadonlyMap<string, string>;
  onAssign: (clientId: string, target: PlacementTarget) => void;
}>) {
  const anchor = useRef<View>(null);
  const request = useRef(0);
  const [choice, setChoice] = useState<Readonly<{ clientId: string; options: ClientPlacementOptions }> | null>(null);
  const [confirmation, setConfirmation] = useState<Readonly<{ clientId: string; cycle: CycleOption }> | null>(null);
  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const assign = (clientId: string, cycle: CycleOption, confirmed = false) => {
    onAssign(clientId, { kind: "existing", programId: cycle.programId, mesocycleId: cycle.mesocycleId,
      expectedRevision: cycle.revision, expectedGroupId: cycle.groupId, label: `${cycle.programTitle} · ${cycle.title}`,
      ...(confirmed ? { confirmReassignment: true } : {}) });
    setLabels((current) => new Map(current).set(clientId, `${cycle.programTitle} · ${cycle.title}`));
    setChoice(null); setConfirmation(null);
  };
  return <View ref={anchor} collapsable={false}>
    <ParticipantChips {...chips} details={new Map([...values].flatMap(([id, value]) => value.kind !== "existing" ? []
      : [[id, value.label ?? labels.get(id) ?? "Прикреплён существующий цикл"] as const]))}
      onConfigure={(clientId) => {
        const token = ++request.current;
        setError(null);
        void repository.getPlacementOptions([clientId], hostProgramId).then((rows) => {
          if (token !== request.current) return;
          if (rows[0] === undefined) throw new Error("TARGET_NOT_FOUND");
          setChoice({ clientId, options: rows[0] });
        }).catch(() => setError("Не удалось прочитать циклы. Нажмите на участника ещё раз."));
      }} />
    {error === null ? null : <InlineNotice kind="error">{error}</InlineNotice>}
    <DropdownMenu searchable visible={choice !== null} anchor={anchor} title="Программа участника" selected=""
      note="Копия получает свой план без результатов. Существующий цикл сохраняет все свои данные."
      options={choice === null ? [] : [{ value: "copy", label: "Добавить копию создаваемого цикла" },
        ...(choice.options.cycles ?? []).map((cycle) => ({ value: cycle.mesocycleId,
          label: `${cycle.programTitle} · ${cycle.title}${currentCycles?.get(choice.clientId) === cycle.mesocycleId ? " (прикреплён)" : cycle.grouped ? " (в другой группе)" : ""}` }))]}
      onClose={() => { request.current += 1; setChoice(null); }} onSelect={(value) => {
        if (choice === null) return;
        if (value === "copy") { onAssign(choice.clientId, choice.options.preferred); setChoice(null); return; }
        const cycle = choice.options.cycles?.find((item) => item.mesocycleId === value);
        if (cycle === undefined) return;
        if (cycle.grouped && currentCycles?.get(choice.clientId) !== cycle.mesocycleId) { setConfirmation({ clientId: choice.clientId, cycle }); setChoice(null); }
        else assign(choice.clientId, cycle);
      }} />
    <ConfirmDialog visible={confirmation !== null} title="Перенести цикл в эту группу?"
      description="Цикл выйдет из прежней группы переключения. Его план и результаты сохранятся. Перенос произойдёт при сохранении участников."
      confirmLabel="Прикрепить к этой группе" onCancel={() => setConfirmation(null)}
      onConfirm={() => { if (confirmation !== null) assign(confirmation.clientId, confirmation.cycle, true); }} />
  </View>;
}
