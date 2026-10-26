import type { SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import { legacyIdentityContextJson, type CandidateIdentityContext } from "../../../../shared/migration/LegacyIdentityBinding.ts";
import { runLegacyWritePlan } from "../../../../shared/migration/LegacyWritePlan.ts";
import type { LegacyStageClient, LegacyStageClientIds } from "../../../../shared/migration/LegacyStageExtension.ts";
import { captureLegacySourceRow } from "../../../../shared/migration/LegacySourceCapture.ts";
import { projectLegacyExerciseCatalog } from "../../domain/legacy-import/LegacyExerciseCatalogProjection.ts";
import { projectLegacyExerciseReferences } from "../../domain/legacy-import/LegacyExerciseReferences.ts";
import { legacyExerciseCatalogStagePlan } from "./LegacyExerciseCatalogStagePlan.ts";
import type { InitialImportedExercises, ImportedExerciseRow } from "../ImportedExerciseStore.ts";

const fail = (): never => { throw Error("R04_ID_LEDGER_EXERCISE_NATIVE_PARITY_MISMATCH"); };
/** Called after whole-owner parity, within the pinned stage transaction. Fact
 * usage anchors are supplied by composition; they are not new performed facts. */
export async function readLegacyNativeExercises(tx: SqliteStatementPort, input: CandidateIdentityContext,
  clients: readonly LegacyStageClient[], clientIds: LegacyStageClientIds, factUse: readonly ImportedExerciseRow[]): Promise<InitialImportedExercises> {
  const context = { ...input }, facts = factUse.map((r) => ({ ...r }));
  const cards = clients.map((c) => ({ identity: { ...c.identity }, raw: captureLegacySourceRow(c.raw) }));
  const ids = { workspaces: new Map(clientIds.workspaces), clients: new Map(clientIds.clients) };
  try {
    const binding = JSON.parse((await tx.first<{ context_json: string }>("SELECT context_json FROM r04_candidate_identity WHERE id=1"))!.context_json) as unknown[];
    if (binding[0] !== legacyIdentityContextJson(context)) return fail();
    const receipt = (await tx.all<{ source_json: string }>("SELECT source_json FROM r04_exercise_receipt")); if (receipt.length !== 1) return fail();
    const source = JSON.parse(receipt[0]!.source_json) as { catalog: { raw: Record<string, unknown> }[]; refs: { sourceKey: string; raw: Record<string, unknown> }[] };
    const catalog = projectLegacyExerciseCatalog({ accountScope: context.accountScope, rows: source.catalog.map((c) => c.raw) });
    const refs = projectLegacyExerciseReferences(context.accountScope, catalog,
      source.refs.filter((r) => (JSON.parse(r.sourceKey) as unknown[])[1] === "training_exercises").map((r) => r.raw),
      source.refs.filter((r) => (JSON.parse(r.sourceKey) as unknown[])[1] === "training_exercise_history").map((r) => r.raw));
    await runLegacyWritePlan({ ...tx, run: async () => fail() }, legacyExerciseCatalogStagePlan(context,
      cards, ids, catalog, refs, () => fail()));
    const registry = await tx.all<ImportedExerciseRow>("SELECT * FROM r04_exercise_registry"), raw = new Map(catalog.map((c) => [c.sourceCatalogId, c.raw]));
    if (facts.some((f) => f.workspace_id !== context.targetWorkspaceId || !registry.some((r) => r.id === f.exercise_id) || typeof f.fact_id !== "string" || typeof f.client_id !== "string")) return fail();
    return { imported_exercises: registry.map((r) => ({ ...r, equipment_unspecified: r.equipment === null ? 1 : 0,
      source_sha256: context.sourceSha256, source_json: JSON.stringify(raw.get(r.source_catalog_id as string) ?? fail()) })),
      imported_exercise_links: [...await tx.all<ImportedExerciseRow>("SELECT * FROM r04_exercise_links")], imported_exercise_fact_use: facts,
      overlays: [...await tx.all<ImportedExerciseRow>("SELECT * FROM exercise_overlay")] };
  } catch { return fail(); }
}
