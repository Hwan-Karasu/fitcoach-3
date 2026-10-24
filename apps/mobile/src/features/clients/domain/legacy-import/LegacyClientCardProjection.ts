import type { LegacyClientsSource } from "../../../../shared/migration/LegacyProfileSources.ts";
import type { LegacyClientIdentityCandidate } from "./LegacyClientIdentity.ts";
import { legacyObjectJson } from "../../../../shared/migration/LegacyValues.ts";
import { parseHeightCmX10, validPastBirthDate } from "../ClientProfileValidation.ts";

export interface ClientCardFields {
  readonly birthDate: string | null;
  readonly heightCmX10: number | null;
  readonly sex: "MALE" | "FEMALE" | null;
  readonly emoji: string | null;
}
export interface LegacyClientCardCandidate {
  readonly identity: LegacyClientIdentityCandidate;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly fields: ClientCardFields | null;
  readonly legacyProfile: Readonly<Record<string, unknown>> | null;
  readonly issues: readonly string[];
}

/** Exact base-card fields only. Profile answers, billing counters and weight remain separate sources. */
export function projectLegacyClientCard(identity: LegacyClientIdentityCandidate, raw: Readonly<Record<string, unknown>>): LegacyClientCardCandidate {
  if (raw.id !== identity.sourceClientId || raw.workspace_id !== identity.sourceWorkspaceId) {
    throw new Error("R04_CLIENT_CARD_SCOPE_MISMATCH");
  }
  const issues: string[] = [];
  if (identity.displayName === null || !identity.displayName.trim() || identity.displayName.length > 200) issues.push("R04_CLIENT_CARD_NAME_INVALID");
  const values = new Map<string, string>();
  for (const field of ["birthdate", "height", "gender", "avatar_emoji"]) {
    if (typeof raw[field] !== "string") issues.push("R04_CLIENT_CARD_FIELD_INVALID");
    else values.set(field, raw[field]);
  }
  const birthDate = values.get("birthdate") || null;
  if (!validPastBirthDate(birthDate)) issues.push("R04_CLIENT_CARD_BIRTH_DATE_INVALID");
  const heightRaw = values.get("height");
  const heightText = heightRaw?.trim().replace(",", ".").replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "");
  const height = heightText === undefined ? "invalid" : parseHeightCmX10(heightText);
  if (height === "invalid") issues.push("R04_CLIENT_CARD_HEIGHT_INVALID");
  const gender = values.get("gender");
  const sex = gender === "Мужской" ? "MALE" : gender === "Женский" ? "FEMALE" : null;
  if (gender !== "" && gender !== "Мужской" && gender !== "Женский") issues.push("R04_CLIENT_CARD_SEX_UNRESOLVED");
  const emoji = values.get("avatar_emoji") || null;
  if (emoji !== null && Array.from(emoji).length > 8) issues.push("R04_CLIENT_CARD_EMOJI_INVALID");
  const legacyProfile = legacyObjectJson(raw.profile_json);
  if (legacyProfile === null) issues.push("R04_CLIENT_CARD_LEGACY_PROFILE_INVALID");
  return { identity, raw, legacyProfile, issues,
    fields: issues.length > 0 ? null : { birthDate, heightCmX10: height === "invalid" ? null : height, sex, emoji } };
}

export function projectLegacyClientCards(source: LegacyClientsSource,
  identities: readonly LegacyClientIdentityCandidate[]): readonly LegacyClientCardCandidate[] {
  const { accountScope, rows } = source;
  if (!accountScope.trim() || identities.some((row) => row.accountScope !== accountScope)) throw new Error("R04_CLIENT_CARD_SCOPE_MISMATCH");
  const byId = new Map(identities.map((row) => [row.sourceClientId, row]));
  if (byId.size !== identities.length) throw new Error("R04_CLIENT_CARD_IDENTITY_INVALID");
  if (rows.length !== byId.size) throw new Error("R04_CLIENT_CARD_COVERAGE_MISMATCH");
  const seen = new Set<string>();
  return rows.map((raw) => {
    const id = typeof raw.id === "string" ? raw.id : "";
    const identity = byId.get(id);
    if (!identity || seen.has(id)) throw new Error("R04_CLIENT_CARD_IDENTITY_INVALID");
    seen.add(id);
    return projectLegacyClientCard(identity, raw);
  });
}
