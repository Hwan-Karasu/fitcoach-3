import type { SqliteStatementPort } from "../../shared/db/SqlitePort.ts";
import type { CandidateIdentityContext } from "../../shared/migration/LegacyIdentityBinding.ts";
import { readVerifiedLegacyWorkDataClients } from "../../features/clients/data/legacy-import/LegacyNativeWorkData.ts";
import { readLegacyNativeExercises } from "../../features/exercises/data/legacy-import/LegacyNativeExercises.ts";
import type { ImportedExerciseRow } from "../../features/exercises/data/ImportedExerciseStore.ts";

/** Joins owner inputs in the already-verified, pinned private stage transaction.
 * These usage anchors retain actual fact IDs; they do not materialize Execution. */
export async function readNativeLegacyExerciseSeed(tx: SqliteStatementPort, input: CandidateIdentityContext) {
  const context = { ...input };
  const clients = await readVerifiedLegacyWorkDataClients(tx, context);
  const factUse = await tx.all<ImportedExerciseRow>("SELECT workspace_id,client_id,exercise_id,id AS fact_id FROM r04_execution_facts ORDER BY id");
  return readLegacyNativeExercises(tx, context, clients.clients, clients.ids, factUse);
}
