import { jsonArray, jsonText } from "../../../shared/db/SchemaGuards.ts";
const unit = (json: string, path: string) => `json_extract(${json}, '${path}') IN ('G','ML','PIECE','PORTION')`;
const positive = (json: string, path: string) => `(json_type(${json}, '${path}') = 'integer' AND json_extract(${json}, '${path}') > 0)`;
const nutrients = (json: string, path: string) => ["kcalX10", "proteinX10", "fatX10", "carbsX10"]
  .map((key) => `json_type(${json}, '${path}.${key}') IN ('integer','null')`).join(" AND ");
export const ingredientsSql = (json: string, path = "$"): string => jsonArray(json, path, "ingredient", (item) =>
  `${jsonText(item, "$.foodId")} AND ${jsonText(item, "$.name")} AND ${unit(item, "$.unit")} AND ${positive(item, "$.quantityX10")}`);
export const snapshotSql = (json: string): string => `(${jsonText(json, "$.name")} AND json_type(${json}, '$.brand') IN ('text','null')
  AND ${jsonText(json, "$.source.id")} AND json_extract(${json}, '$.source.kind') IN ('FOOD','RECIPE')
  AND ${unit(json, "$.basis.unit")} AND ${positive(json, "$.basis.amountX10")} AND ${positive(json, "$.quantityX10")}
  AND ${nutrients(json, "$.perBasis")} AND ${nutrients(json, "$.eaten")} AND ${ingredientsSql(json, "$.ingredients")})`;
