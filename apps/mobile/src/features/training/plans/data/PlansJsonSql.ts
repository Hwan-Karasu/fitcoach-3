import { jsonArray, jsonText } from "../../../../shared/db/SchemaGuards.ts";

const object = (json: string) => `json_type(${json}) = 'object'`;
const text = jsonText;
const integer = (json: string, path: string) => `json_type(${json}, '${path}') = 'integer'`;
const nullableInteger = (json: string, path: string) => `(json_type(${json}, '${path}') IS NULL OR json_type(${json}, '${path}') IN ('null', 'integer'))`;
const nullableText = (json: string, path: string) => `(json_type(${json}, '${path}') IS NULL OR json_type(${json}, '${path}') IN ('null', 'text'))`;
const optionalId = (json: string, path: string) => `(json_type(${json}, '${path}') IS NULL OR (${jsonText(json, path)} AND length(trim(json_extract(${json}, '${path}'))) > 0))`;
export const workoutSql = (json: string): string => `(${object(json)} AND ${text(json, "$.id")} AND ${text(json, "$.title")}
  AND ${optionalId(json, "$.lineageId")}
  AND ${jsonArray(json, "$.exercises", "exercise", (item) => `${text(item, "$.id")} AND ${text(item, "$.exerciseId")}
    AND ${nullableInteger(item, "$.restSec")} AND ${nullableText(item, "$.instruction")}
    AND ${optionalId(item, "$.lineageId")} AND ${optionalId(item, "$.supersetId")}
    AND (json_type(${item}, '$.rir') IS NULL OR json_type(${item}, '$.rir') = 'null' OR
      (json_type(${item}, '$.rir') = 'object' AND ${integer(item, "$.rir.min")} AND json_type(${item}, '$.rir.max') IN ('integer','null')))
    AND ${jsonArray(item, "$.sets", "planned_set", (set) => `${text(set, "$.id")}
      AND ${nullableInteger(set, "$.repsMax")} AND ${["reps", "loadGrams", "durationSec", "distanceM"]
        .map((key) => `json_type(${set}, '$.${key}') IN ('null','integer')`).join(" AND ")}`)}`)})`;
const workouts = (json: string, path: string) => jsonArray(json, path, "workout", workoutSql);
export const draftSql = (json: string): string => `(${object(json)} AND ${text(json, "$.title")} AND ${integer(json, "$.plan.weeks")}
  AND ${workouts(json, "$.plan.workouts")})`;
const weeksSql = (json: string, path: string, indexed: boolean) => jsonArray(json, path, "week", (item) =>
  `${indexed ? integer(item, "$.index") : text(item, "$.type")} AND ${workouts(item, "$.workouts")}`);
export const simpleHistorySql = (json: string): string => `(${object(json)} AND ${text(json, "$.title")} AND ${weeksSql(json, "$.weeks", true)})`;
export const mesocycleSql = (json: string): string => `(${object(json)} AND ${text(json, "$.id")} AND ${text(json, "$.lineageId")}
  AND ${text(json, "$.title")} AND ${jsonArray(json, "$.weeks", "week", (item) => `${text(item, "$.id")} AND ${integer(item, "$.index")}
    AND ${text(item, "$.type")} AND ${workouts(item, "$.workouts")}`)})`;
const templateCycle = (json: string): string => `(${object(json)} AND ${text(json, "$.title")} AND ${weeksSql(json, "$.weeks", false)})`;
export const templateSql = (json: string): string => `(CASE json_extract(${json}, '$.kind')
  WHEN 'SIMPLE' THEN ${integer(json, "$.weeks")} AND ${workouts(json, "$.workouts")}
  WHEN 'MESOCYCLE' THEN ${templateCycle(`json_quote(json_extract(${json}, '$.mesocycle'))`)}
  WHEN 'PERIODIZED' THEN ${jsonArray(json, "$.mesocycles", "cycle", templateCycle)} ELSE 0 END)`;
export const builderSql = (json: string): string => `(${draftSql(json)} OR
  (json_extract(${json}, '$.envelope') = 2 AND ${draftSql(`json_quote(json_extract(${json}, '$.draft'))`)}
    AND (json_type(${json}, '$.base') = 'null' OR ${draftSql(`json_quote(json_extract(${json}, '$.base'))`)})) OR
  (${integer(json, "$.baseRevision")} AND ${workoutSql(`json_quote(json_extract(${json}, '$.input.workout'))`)}
    AND ${text(json, "$.input.workoutId")} AND ${integer(json, "$.input.weekIndex")}) OR
  (${text(json, "$.programTitle")} AND ${text(json, "$.title")} AND ${text(json, "$.cycleType")}
    AND ${text(json, "$.repsText")} AND ${text(json, "$.startDate")} AND ${integer(json, "$.editing")}
    AND json_type(${json}, '$.members') = 'array' AND ${weeksSql(json, "$.weeks", false)}))`;
export const periodizedDraftSql = (json: string): string => `(${integer(json, "$.baseRevision")} AND json_type(${json}, '$.clientIds') = 'array'
  AND json_extract(${json}, '$.kind') IN ('WEEK','MESOCYCLE') AND ${draftSql(`json_quote(json_extract(${json}, '$.draft'))`)})`;
