export interface ExerciseImportMatch { readonly sourceName: string; readonly targetId: string; readonly available?: boolean }
export interface ExerciseImportMatchesPort {
  getExerciseMatches(sourceNames: readonly string[]): Promise<readonly ExerciseImportMatch[]>;
  rememberExerciseMatches(matches: readonly ExerciseImportMatch[]): Promise<void>;
}
