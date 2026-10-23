/** Product §§10.15,20.2,22.2: trainer-private operational records, independent
 * from questionnaire schema. Import review is never an ACTIVE limitation. */
export interface TrainerNote {
  readonly id: string;
  readonly workspaceId: string;
  readonly clientId: string;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly pinned: boolean;
  readonly context: { readonly type: "LEGACY_IMPORT"; readonly reference: string } | null;
}
export interface TrainerTag {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly color: string | null;
  readonly lifecycle: "ACTIVE" | "ARCHIVED";
}
export interface ClientTagAssignment {
  readonly workspaceId: string;
  readonly clientId: string;
  readonly tagId: string;
}
export interface SafetyImportReview {
  readonly id: string;
  readonly workspaceId: string;
  readonly clientId: string;
  readonly status: "PENDING_REVIEW";
  readonly sourceField: "diagnoses" | "injuries" | "pain" | "hardMovements" | "unwantedLoad";
  readonly body: string;
  readonly importedAt: string;
  readonly sourceClientUpdatedAt: string;
}

/** A versioned naming policy, not a tag ID. Rename keeps the persisted tag ID.
 * No transliteration, ё→е folding, accent stripping or punctuation substitution. */
export const TRAINER_TAG_NAME_POLICY = "NFC_WHITESPACE_RU_CASE_V1" as const;
export function trainerTagName(raw: string): { readonly name: string; readonly key: string } {
  const name = raw.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!name || /[\p{Cc}\p{Cf}]/u.test(name)) throw new Error("CLIENT_WORK_DATA_TAG_NAME_INVALID");
  return { name, key: name.toLocaleLowerCase("ru-RU") };
}
