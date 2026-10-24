import type { Answers, QuestionnaireSchema } from "../QuestionnaireModel.ts";
import { allFields, answerProblem, defaultQuestionnaireSchema, validateSchema } from "../QuestionnaireRules.ts";
import { legacyProfileWorkData, type LegacyProfileWorkData } from "../../../../shared/migration/LegacyProfileWorkData.ts";

/** Exact build120 ClientProfileFields → current system questions. No guessed labels,
 * synthetic measurements, inferred medical clearance or questionnaire-owned trainer notes. */
const fields: Readonly<Record<string, string>> = {
  goals: "goals.main", goalsOther: "goals.other", muscles: "goals.muscles", successCriteria: "goals.success",
  deadline: "goals.deadline", diagnoses: "health.diagnoses", healthCleared: "health.noContra",
  medications: "health.medications", supplements: "health.supplements", injuries: "health.injuries",
  surgeries: "health.surgeries", pain: "health.pain", hardMovements: "health.hardMoves",
  currentActivity: "lifestyle.currentActivity", sportHistory: "lifestyle.sportHistory", fitnessLevel: "lifestyle.fitness",
  job: "lifestyle.job", sittingHours: "lifestyle.sitting", sleep: "lifestyle.sleep", habits: "lifestyle.habits",
  bodySatisfaction: "nutrition.bodySatisfaction", weightHistory: "nutrition.attempts", dietRestrictions: "nutrition.restrictions",
  eatingBehavior: "nutrition.eating", motivation: "motivation.drivers", obstacles: "motivation.obstacles",
  support: "motivation.support", trainerExpectations: "motivation.expectations", menstrualCycle: "extra.cycle",
  trainerExperience: "extra.trainerExperience",
};
const supplemental: Readonly<Record<string, string>> = {
  successCriteriaOther: "Другой признак достижения результата", gymAccess: "Условия для занятий",
};
const workFields = ["trainerNotes", "trainerTags", "unwantedLoad"] as const;
const excludedFields = ["steps", "photo"] as const;
const arrayFields = new Set(["goals", "muscles", "successCriteria", "trainerExpectations", "trainerTags"]);
/** Only explicitly verified spelling changes; no case folding or approximate matching. */
const optionAliases: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  muscles: { "Бедра": "Бёдра", "Руки: бицепс": "Бицепс", "Руки: трицепс": "Трицепс" },
  sittingHours: { "2-4 часа": "2–4 часа", "4-6 часов": "4–6 часов", "6-8 часов": "6–8 часов" },
  trainerExpectations: { "Конкретика и четкий план": "Конкретика и чёткий план" },
};
export function legacyProfileQuestionnaireSchema(): QuestionnaireSchema {
  const base = defaultQuestionnaireSchema();
  return { ...base, sections: [...base.sections, { id: "legacy:profile:additional", origin: "CUSTOM", title: "Дополнительные сведения из 2.0",
    help: null, hidden: false, fields: Object.entries(supplemental).map(([key, label]) => ({
      id: `legacy:profile:${key}`, origin: "CUSTOM", semanticKey: null, type: "LONG_TEXT", label, help: null,
      required: false, hidden: false, retired: false, options: [], visibleIf: null, constraints: null,
    })) }] };
}
export interface LegacyProfileProjection {
  readonly answers: Answers | null;
  /** Shaped candidates for the separate WorkData owner. Not questionnaire answers or a
   * claim that notes/tags/safety have already been persisted to their final domain. */
  readonly workData: LegacyProfileWorkData;
  readonly excludedByProduct: readonly { readonly sourceField: string; readonly value: unknown }[];
  readonly issues: readonly string[];
  readonly sourceFields: number;
}
export function projectLegacyClientProfile(raw: Readonly<Record<string, unknown>>): LegacyProfileProjection {
  const schema = legacyProfileQuestionnaireSchema();
  if (validateSchema(schema).length > 0) throw new Error("R04_PROFILE_TARGET_SCHEMA_INVALID");
  const targetFields = new Map(allFields(schema).map(({ field }) => [field.id, field]));
  const issues: string[] = []; const answers: Record<string, Answers[string]> = {};
  const known = new Set([...Object.keys(fields), ...Object.keys(supplemental), ...workFields, ...excludedFields]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) { issues.push("R04_PROFILE_UNKNOWN_FIELD"); continue; }
    const value = raw[key];
    if (key === "photo") {
      if (value !== null && typeof value !== "string") issues.push("R04_PROFILE_VALUE_TYPE_INVALID");
      continue;
    }
    if (arrayFields.has(key)) {
      if (!Array.isArray(value) || value.some((v: unknown) => typeof v !== "string") || new Set(value).size !== value.length) {
        issues.push("R04_PROFILE_VALUE_TYPE_INVALID"); continue;
      }
    } else if (key === "healthCleared" ? typeof value !== "boolean" : typeof value !== "string") {
      issues.push("R04_PROFILE_VALUE_TYPE_INVALID"); continue;
    }
    const targetId = Object.hasOwn(fields, key) ? `sys:${fields[key]}` : Object.hasOwn(supplemental, key) ? `legacy:profile:${key}` : null;
    if (targetId === null) continue;
    const field = targetFields.get(targetId)!;
    let converted: unknown = value;
    if (field.type === "SINGLE_CHOICE" || field.type === "MULTI_CHOICE") {
      if (value === "") continue; // Exact empty single-choice source, no invented selection.
      const labels = Array.isArray(value) ? value : [value];
      const ids: string[] = [];
      for (const label of labels) {
        const aliases = optionAliases[key];
        const translated = typeof label === "string" && aliases && Object.hasOwn(aliases, label) ? aliases[label] : label;
        const option = field.options.find((item) => item.label === translated);
        if (!option || ids.includes(option.id)) { issues.push("R04_PROFILE_OPTION_UNRESOLVED"); continue; }
        ids.push(option.id);
      }
      converted = field.type === "MULTI_CHOICE" ? ids : ids[0];
    }
    if (answerProblem(field, converted, undefined, "1970-01-01") !== null) issues.push("R04_PROFILE_ANSWER_INVALID");
    else answers[targetId] = converted as Answers[string];
  }
  // §10.15 visibility keeps populated health answers even with clearance=true.
  // Preserve both source facts; neither reject valid intake nor infer medical clearance.
  return { answers: issues.length > 0 ? null : answers, sourceFields: Object.keys(raw).length, issues: [...new Set(issues)],
    workData: legacyProfileWorkData(raw),
    excludedByProduct: excludedFields.filter((key) => Object.hasOwn(raw, key)).map((key) => ({ sourceField: key, value: raw[key] })) };
}
