/** Private bridge input contracts; not normal 3.x storage or public reports. */
export type LegacySourceRow = Readonly<Record<string, unknown>>;
export interface LegacyClientsSource {
  readonly accountScope: string;
  readonly rows: readonly LegacySourceRow[];
}
export interface LegacyExerciseCatalogSource {
  readonly accountScope: string;
  readonly rows: readonly LegacySourceRow[];
}
export interface LegacyQuestionnaireSource {
  readonly accountScope: string;
  readonly owners: readonly LegacySourceRow[];
  readonly templates: readonly LegacySourceRow[];
  readonly revisions: readonly LegacySourceRow[];
  readonly answers: readonly LegacySourceRow[];
  readonly changes: readonly LegacySourceRow[] | null;
}
