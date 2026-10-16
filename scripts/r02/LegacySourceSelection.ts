/** Device discovery supplies opaque IDs; this policy never prints paths or account keys. */
export interface LegacySourceCandidate {
  readonly sourceId: string;
  readonly kind: "trainer-local" | "account-scoped" | "backup";
  readonly marker: "recognized" | "unknown";
  readonly binding: "verified" | "unverified";
  readonly schema: "supported" | "unsupported" | "unknown";
}

export type LegacySourceSelection =
  | { readonly status: "none" }
  | { readonly status: "single-candidate"; readonly sourceId: string }
  | { readonly status: "blocked"; readonly reason: "AMBIGUOUS_SOURCE" | "UNKNOWN_MARKER" | "UNVERIFIED_BINDING" | "UNSUPPORTED_SCHEMA" | "DUPLICATE_SOURCE_ID" };

/** Selection is an inspection result, never permission to migrate or cut over. */
export function selectLegacySource(candidates: readonly LegacySourceCandidate[]): LegacySourceSelection {
  if (candidates.length === 0) return { status: "none" };
  if (new Set(candidates.map((candidate) => candidate.sourceId)).size !== candidates.length) {
    return { status: "blocked", reason: "DUPLICATE_SOURCE_ID" };
  }
  if (candidates.some((candidate) => candidate.marker === "unknown")) {
    return { status: "blocked", reason: "UNKNOWN_MARKER" };
  }
  if (candidates.length !== 1) return { status: "blocked", reason: "AMBIGUOUS_SOURCE" };
  const source = candidates[0]!;
  if (source.schema !== "supported") return { status: "blocked", reason: "UNSUPPORTED_SCHEMA" };
  if (source.binding !== "verified") return { status: "blocked", reason: "UNVERIFIED_BINDING" };
  return { status: "single-candidate", sourceId: source.sourceId };
}
