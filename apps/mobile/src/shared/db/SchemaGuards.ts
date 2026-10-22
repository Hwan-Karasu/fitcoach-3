/** Constant SQL only: never pass user input to these schema builders. */
export function guardRows(name: string, table: string, valid: (row: string) => string, code: string): readonly string[] {
  return ["INSERT", "UPDATE"].map((operation) => `CREATE TRIGGER ${name}_${operation.toLowerCase()}
    BEFORE ${operation} ON ${table} WHEN NOT COALESCE((${valid("NEW")}), 0)
    BEGIN SELECT RAISE(ABORT, '${code}'); END`);
}

export function immutableScope(table: string, columns: readonly string[]): string {
  return `CREATE TRIGGER ${table}_scope_fixed BEFORE UPDATE OF ${columns.join(", ")} ON ${table}
    WHEN ${columns.map((column) => `NEW.${column} IS NOT OLD.${column}`).join(" OR ")}
    BEGIN SELECT RAISE(ABORT, 'OWNER_SCOPE_IMMUTABLE'); END`;
}

/** Existing invalid rows block upgrade atomically; migrations never repair or discard facts silently. */
export function preflight(owner: string, checks: readonly Readonly<{ table: string; valid: (row: string) => string }>[]): readonly string[] {
  const table = `d01_${owner}_preflight`;
  return [`CREATE TEMP TABLE ${table} (ok INTEGER NOT NULL CHECK (ok = 1))`,
    ...checks.map((check) => `INSERT INTO ${table} SELECT NOT EXISTS (SELECT 1 FROM ${check.table} AS existing
      WHERE NOT COALESCE((${check.valid("existing")}), 0))`), `DROP TABLE ${table}`];
}

export const validJson = (json: string, shape: string): string => `CASE WHEN json_valid(${json}) THEN COALESCE((${shape}), 0) ELSE 0 END`;
export const jsonText = (json: string, path: string): string => `json_type(${json}, '${path}') = 'text'`;
export const jsonArray = (json: string, path: string, alias: string, itemValid: (json: string) => string): string =>
  `(json_type(${json}, '${path}') = 'array' AND NOT EXISTS (SELECT 1 FROM json_each(${json}, '${path}') AS ${alias}
    WHERE CASE WHEN ${alias}.type = 'object' THEN COALESCE((${itemValid(`${alias}.value`)}), 0) ELSE 0 END = 0))`;
