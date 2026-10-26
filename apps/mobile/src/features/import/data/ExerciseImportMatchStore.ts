import type { SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import type { ExerciseImportMatch } from "../domain/ExerciseImportMatches.ts";

export const EXERCISE_IMPORT_MATCH_MIGRATION = {
  version: 2, checksum: "training-transfer-exact-exercise-matches-v2-20261026",
  statements: [`CREATE TABLE training_import_exercise_matches (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    source_name TEXT COLLATE BINARY NOT NULL CHECK(length(source_name) > 0),
    target_id TEXT NOT NULL CHECK(length(target_id) > 0),
    PRIMARY KEY(workspace_id, source_name))`],
};

export function validateExerciseMatches(matches: readonly ExerciseImportMatch[]): readonly ExerciseImportMatch[] {
  const unique = new Map<string, string>();
  for (const match of matches) {
    if (!match.sourceName || match.sourceName !== match.sourceName.trim() || !match.targetId) throw new Error("Некорректное сопоставление упражнения.");
    const before = unique.get(match.sourceName);
    if (before !== undefined && before !== match.targetId) throw new Error("Одному названию выбраны разные упражнения.");
    unique.set(match.sourceName, match.targetId);
  }
  return [...unique].map(([sourceName, targetId]) => ({ sourceName, targetId }));
}

export class ExerciseImportMatchStore {
  private readonly workspace: string;
  constructor(workspace: string) { this.workspace = workspace; }
  async read(tx: SqliteStatementPort, sourceNames: readonly string[]): Promise<readonly ExerciseImportMatch[]> {
    const wanted = new Set(sourceNames);
    const rows = await tx.all<ExerciseImportMatch>(`SELECT source_name AS sourceName, target_id AS targetId
      FROM training_import_exercise_matches WHERE workspace_id = ? ORDER BY source_name COLLATE BINARY`, [this.workspace]);
    return rows.filter((row) => wanted.has(row.sourceName));
  }
  async save(tx: SqliteStatementPort, matches: readonly ExerciseImportMatch[]): Promise<void> {
    for (const { sourceName, targetId } of validateExerciseMatches(matches)) {
      await tx.run(`INSERT INTO training_import_exercise_matches(workspace_id, source_name, target_id) VALUES (?, ?, ?)
        ON CONFLICT(workspace_id, source_name) DO UPDATE SET target_id = excluded.target_id`, [this.workspace, sourceName, targetId]);
    }
  }
}
