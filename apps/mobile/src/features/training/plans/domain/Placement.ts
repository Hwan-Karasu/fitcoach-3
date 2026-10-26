/**
 * P01: независимая копия в программе клиента либо ссылка на его существующий цикл.
 * join сохранён для прежних команд и черновиков; новый интерфейс предлагает личную или новую программу.
 */
export type PlacementTarget =
  | Readonly<{ kind: "program"; programId: string }>
  | Readonly<{ kind: "join" }>
  | Readonly<{ kind: "new" }>
  | Readonly<{ kind: "existing"; programId: string; mesocycleId: string; expectedRevision: number; expectedGroupId: string | null; confirmReassignment?: boolean; label?: string }>;

export interface Placement {
  readonly clientId: string;
  readonly target: PlacementTarget;
}

/** Участник группы мезоцикла: его копия и программа, где она лежит. */
export interface GroupCopy {
  readonly clientId: string;
  readonly programId: string;
  readonly mesocycleId: string;
}

export interface PlacementProgram {
  readonly id: string;
  readonly kind: "SIMPLE" | "PERIODIZED";
  readonly title: string;
  readonly createdAt: string;
}

export interface ClientPlacementOptions {
  readonly clientId: string;
  /** Расширенные программы клиента (кроме этой), новые первыми; `current` — выбранная у клиента. */
  readonly programs: readonly Readonly<{ id: string; title: string; current: boolean }>[];
  readonly cycles?: readonly Readonly<{ programId: string; programTitle: string; mesocycleId: string; title: string; revision: number; groupId: string | null; grouped: boolean }>[];
  readonly preferred: PlacementTarget;
}

/**
 * Вариант по умолчанию, как в 2.0: текущая программа клиента, если она Расширенная; иначе его последняя
 * Расширенная; иначе — новая личная программа.
 */
export function preferredPlacement(programs: readonly PlacementProgram[], selectedProgramId: string | null,
  hostProgramId: string | null): PlacementTarget {
  const periodized = programs.filter((program) => program.kind === "PERIODIZED" && program.id !== hostProgramId);
  const current = periodized.find((program) => program.id === selectedProgramId);
  if (current !== undefined) return { kind: "program", programId: current.id };
  const latest = [...periodized].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return latest === undefined ? { kind: "new" } : { kind: "program", programId: latest.id };
}
