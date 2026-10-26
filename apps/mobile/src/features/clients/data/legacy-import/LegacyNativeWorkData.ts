import type { SqliteStatementPort } from "../../../../shared/db/SqlitePort.ts";
import { legacyIdentityContextJson, type CandidateIdentityContext } from "../../../../shared/migration/LegacyIdentityBinding.ts";
import { runLegacyWritePlan } from "../../../../shared/migration/LegacyWritePlan.ts";
import { projectLegacyClientIdentities } from "../../domain/legacy-import/LegacyClientIdentity.ts";
import { legacyClientWorkDataStagePlan } from "./LegacyClientWorkDataStagePlan.ts";
import { TRAINER_TAG_NAME_POLICY, type SafetyImportReview, type TrainerNote, type TrainerTag } from "../../domain/ClientWorkDataModel.ts";
import { checkWorkDataRow, WORK_DATA_TABLES, workDataTime, type WorkDataRows, type WorkDataRow } from "../ClientWorkDataRows.ts";

const fail = (): never => { throw Error("R04_ID_LEDGER_WORK_DATA_NATIVE_PARITY_MISMATCH"); };
/** Bridges already-verified private rows to a self-contained 3.x owner seed.
 * Never called by an ordinary repository; no source file is opened here. */
export async function readLegacyNativeWorkData(tx: SqliteStatementPort, input: CandidateIdentityContext, importedAt: string): Promise<WorkDataRows> {
  const context = { ...input }, binding = legacyIdentityContextJson(context);
  try {
    const identity = await tx.first<{ context_json: string }>("SELECT context_json FROM r04_candidate_identity WHERE id=1");
    const bound: unknown = JSON.parse(identity?.context_json ?? "null");
    if (!Array.isArray(bound) || bound[0] !== binding || bound[2] !== importedAt || !workDataTime(importedAt)) return fail();
    const receipts = await tx.all<{ source_json: string; target_json: string }>("SELECT source_json,target_json FROM r04_work_receipt");
    if (receipts.length !== 1) return fail();
    const receipt = receipts[0]!, sources = JSON.parse(receipt.source_json) as { sourceKey: string; raw: Readonly<Record<string, unknown>> }[];
    const target = JSON.parse(receipt.target_json) as { tagNamePolicy: string; notes: TrainerNote[]; tags: TrainerTag[];
      reviews: SafetyImportReview[]; provenance: { sourceKey: string; clientId: string; sourceClientUpdatedAt: string;
        noteId: string | null; noteTimeBasis: string; tags: { sourceIndex: number; sourceLabel: string; tagId: string; normalizedName: string }[];
        reviews: { sourceField: string; reviewId: string }[] }[] };
    if (target.tagNamePolicy !== TRAINER_TAG_NAME_POLICY || !Array.isArray(sources) || !Array.isArray(target.provenance)
      || sources.length !== target.provenance.length || new Set(sources.map((s) => s.sourceKey)).size !== sources.length
      || new Set(target.provenance.map((p) => p.sourceKey)).size !== sources.length) return fail();
    const source = { accountScope: context.accountScope, rows: sources.map((s) => s.raw) };
    const identities = projectLegacyClientIdentities(source);
    if (identities.some((identity, i) => identity.sourceIdentityKey !== sources[i]!.sourceKey || identity.issues.length)) return fail();
    const maps = await tx.all<{ source_key: string; target_id: string }>("SELECT source_key,target_id FROM r04_candidate_ids WHERE kind='CLIENT'");
    const ids = { workspaces: new Map<string, string>(), clients: new Map(maps.map((m) => [m.source_key, m.target_id])) };
    if (ids.clients.size !== identities.length) return fail();
    // Reuse the owner projection/parity rather than trust matching edited rows
    // and receipts. The adapter cannot write or allocate even on corrupt input.
    await runLegacyWritePlan({ ...tx, run: async () => fail() }, legacyClientWorkDataStagePlan(context, importedAt,
      identities.map((identity, i) => ({ identity, raw: sources[i]!.raw })), ids, () => fail()));
    const rows: Record<typeof WORK_DATA_TABLES[number], WorkDataRow[]> = {
      trainer_notes: (await tx.all<WorkDataRow>("SELECT * FROM r04_work_notes")).map((r) => ({ ...r, revision: 1 })),
      trainer_tags: (await tx.all<WorkDataRow>("SELECT * FROM r04_work_tags")).map((r) => ({ ...r, revision: 1 })),
      client_tag_assignments: [...await tx.all<WorkDataRow>("SELECT * FROM r04_work_assignments")],
      client_safety_import_reviews: [...await tx.all<WorkDataRow>("SELECT * FROM r04_work_reviews")], client_work_import_evidence: [],
    };
    for (const p of target.provenance) {
      const source = sources.find((s) => s.sourceKey === p.sourceKey); if (!source) return fail();
      const note = target.notes.find((n) => n.id === p.noteId) ?? null;
      if (p.noteId !== null && (!note || note.clientId !== p.clientId || note.context?.reference !== p.sourceKey)
        || p.noteTimeBasis !== "IMPORT_TIME_SOURCE_NOTE_TIME_UNKNOWN" || !workDataTime(p.sourceClientUpdatedAt)
        || !await tx.first("SELECT 1 FROM clients WHERE workspace_id=? AND id=?", [context.targetWorkspaceId, p.clientId])) return fail();
      const tags = p.tags.map((t) => {
        const tag = target.tags.find((value) => value.id === t.tagId);
        if (!tag || tag.normalizedName !== t.normalizedName || !Number.isSafeInteger(t.sourceIndex) || t.sourceIndex < 0 || typeof t.sourceLabel !== "string"
          || !rows.client_tag_assignments.some((a) => a.client_id === p.clientId && a.tag_id === t.tagId)) return fail();
        return tag;
      });
      const reviews = p.reviews.map((r) => { const review = target.reviews.find((value) => value.id === r.reviewId);
        if (!review || review.clientId !== p.clientId || review.sourceField !== r.sourceField) return fail(); return review; });
      rows.client_work_import_evidence.push({ workspace_id: context.targetWorkspaceId, client_id: p.clientId, source_sha256: context.sourceSha256,
        source_key: p.sourceKey, imported_at: importedAt, source_json: JSON.stringify(source.raw),
        projection_json: JSON.stringify({ tagNamePolicy: target.tagNamePolicy, ...p, note, tags, reviews }) });
    }
    for (const table of WORK_DATA_TABLES) for (const row of rows[table]) {
      checkWorkDataRow(table, row); if (row.workspace_id !== context.targetWorkspaceId) return fail();
    }
    return rows;
  } catch { return fail(); }
}
