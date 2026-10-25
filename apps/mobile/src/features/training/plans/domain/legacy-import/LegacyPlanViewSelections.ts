import type { CandidateIdentityContext } from "../../../../../shared/migration/LegacyIdentityBinding.ts";
import type { LegacyPlansSource } from "../../../../../shared/migration/LegacyPlanSources.ts";
import type { PlanTargetRow } from "../../../../../shared/migration/LegacyPlanMappings.ts";

type Raw = Readonly<Record<string, unknown>>;
interface SelectionTables {
  readonly training_programs: readonly PlanTargetRow[];
  readonly training_program_members: readonly PlanTargetRow[];
  readonly training_mesocycles: readonly PlanTargetRow[];
  readonly training_mesocycle_selection: PlanTargetRow[];
}
const id = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const tuple = (row: Raw) => JSON.stringify([id(row.actor_id), id(row.client_id), id(row.library_id)]);

/** Restore a book's selected page only for the explicitly bound trainer actor.
 * A per-book page, a pinned book and the globally active book are distinct state.
 * Legacy local sessions generate random actor IDs and bind only trainer:legacy;
 * neither a sole row nor an actor name proves that missing identity.
 */
export function restoreLegacyPlanViewSelections(context: CandidateIdentityContext, source: LegacyPlansSource,
  clients: ReadonlyMap<string, string>, aliases: readonly PlanTargetRow[], target: SelectionTables) {
  const match = /^trainer:([^:]+):(.+)$/u.exec(context.accountScope);
  const actor = match && match[1]!.trim() && match[2] === context.sourceWorkspaceId ? match[1]! : null;
  const views = source.tables.training_program_view_state ?? [], counts = new Map<string, number>();
  for (const row of views) counts.set(tuple(row), (counts.get(tuple(row)) ?? 0) + 1);
  const programs = new Map((source.tables.training_programs ?? []).map((row) => [row.id, row]));
  const programAliases = new Map(aliases.filter((a) => a.source_table === "training_programs").map((a) => [a.source_row_id, a]));
  let restored = 0;
  const representations = views.map((row) => {
    const client = id(row.client_id), targetClientId = client === null ? null : clients.get(client) ?? null;
    const selected = id(row.selected_program_id), library = id(row.library_id), issues: string[] = [];
    const report = { sourceIdentity: tuple(row), sourceClientId: client, sourceProgramId: selected,
      targetClientId, targetProgramId: null as string | null, targetMesocycleId: null as string | null,
      disposition: "REVIEW_REQUIRED", issues };
    if (!id(row.actor_id) || !client || !library || counts.get(tuple(row)) !== 1) { issues.push("VIEW_IDENTITY_AMBIGUOUS"); return report; }
    if (actor === null) { issues.push("SOURCE_TRAINER_ACTOR_NOT_PROVEN"); return report; }
    if (row.actor_id !== actor) { report.disposition = "OTHER_ACTOR_RETAINED"; return report; }
    if (targetClientId === null) { issues.push("VIEW_CLIENT_NOT_FOUND"); return report; }
    if (row.selected_program_id === null || row.selected_program_id === "") { report.disposition = "NO_SELECTED_PAGE"; return report; }
    const physical = selected === null ? undefined : programs.get(selected), alias = selected === null ? undefined : programAliases.get(selected);
    if (!physical || !alias || physical.client_id !== client || alias.target_client_id !== targetClientId || alias.disposition !== "PLAN") {
      issues.push("VIEW_PAGE_NOT_AVAILABLE_FOR_CLIENT"); return report;
    }
    const root = physical.book_id === null || physical.book_id === "" ? physical.id : physical.book_id;
    if (root !== library || typeof alias.target_program_id !== "string") { issues.push("VIEW_LIBRARY_SCOPE_MISMATCH"); return report; }
    const programId = alias.target_program_id;
    const program = target.training_programs.find((p) => p.id === programId && p.workspace_id === context.targetWorkspaceId);
    const member = target.training_program_members.find((m) => m.program_id === programId && m.client_id === targetClientId && m.workspace_id === context.targetWorkspaceId);
    if (!program || !member) { issues.push("VIEW_TARGET_NOT_AVAILABLE"); return report; }
    report.targetProgramId = programId;
    if (program.kind === "SIMPLE") { report.disposition = "SIMPLE_PAGE_REPRESENTED"; return report; }
    const cycle = target.training_mesocycles.find((m) => m.id === alias.target_id && m.program_id === programId && m.client_id === targetClientId && m.workspace_id === context.targetWorkspaceId);
    if (!cycle) { issues.push("VIEW_TARGET_NOT_AVAILABLE"); return report; }
    const existing = target.training_mesocycle_selection.find((s) => s.program_id === programId && s.client_id === targetClientId);
    if (existing && existing.mesocycle_id !== cycle.id) { issues.push("VIEW_AND_ACTIVE_PAGE_CONFLICT"); return report; }
    report.targetMesocycleId = cycle.id as string;
    if (existing) report.disposition = "ACTIVE_PAGE_ALREADY_REPRESENTED";
    else {
      target.training_mesocycle_selection.push({ workspace_id: context.targetWorkspaceId, client_id: targetClientId, program_id: programId, mesocycle_id: cycle.id! });
      restored++; report.disposition = "RESTORED_BOOK_PAGE";
    }
    return report;
  });
  return { representations, restoredSelections: restored, reviewRows: representations.filter((r) => r.disposition === "REVIEW_REQUIRED").length };
}
