/** Raw v2 intake extraction shared by questionnaire retention and the client owner.
 * Full profile validation precedes operational writes; no active safety inference.
 */
export interface LegacyProfileWorkData {
  readonly trainerNote: string | null;
  readonly manualTags: readonly string[];
  readonly loadAvoidance: string | null;
  readonly safety: readonly { readonly sourceField: string; readonly text: string }[];
}
export function legacyProfileWorkData(raw: Readonly<Record<string, unknown>>): LegacyProfileWorkData {
  const text = (key: string) => typeof raw[key] === "string" && raw[key].trim() ? raw[key] : null;
  const meaningful = (value: string) => !["", "-", "—", "нет", "нет.", "не указано", "n/a"].includes(value.trim().toLocaleLowerCase("ru-RU"));
  return { trainerNote: text("trainerNotes"), loadAvoidance: text("unwantedLoad"),
    manualTags: Array.isArray(raw.trainerTags) && raw.trainerTags.every((value: unknown) => typeof value === "string") ? [...raw.trainerTags] as string[] : [],
    safety: ["diagnoses", "injuries", "pain", "hardMovements"].flatMap((key) => typeof raw[key] === "string" && meaningful(raw[key]) ? [{ sourceField: key, text: raw[key] }] : []) };
}
