import type { ExerciseDefinition, SystemCatalogMeta } from "./ExerciseModel.ts";
import type { CatalogEntry, CustomExerciseInput } from "./ExerciseRules.ts";

/**
 * Exercise Registry (Feature 08, §39): системные упражнения из снимка RepDB, свои упражнения и личный слой.
 * Ошибки: EXERCISE_NAME_INVALID, EXERCISE_CATEGORY_REQUIRED, EXERCISE_PROFILE_REQUIRED, EXERCISE_NOT_FOUND,
 * EXERCISE_STALE, EXERCISE_SYSTEM_READ_ONLY.
 */
export interface ExerciseCatalogPort {
  meta(): SystemCatalogMeta;
  /** Все упражнения с личным слоем; архивные свои упражнения не входят. */
  list(): Promise<readonly CatalogEntry[]>;
  /**
   * Архивные свои упражнения — только чтение: имя и профиль нужны истории и аналитике, пока в фактах встречается их id (UX-контракт истории).
   * В каталог и выбор упражнений они не возвращаются.
   */
  listArchived(): Promise<readonly CatalogEntry[]>;
  get(id: string): Promise<CatalogEntry | null>;
  createCustom(input: CustomExerciseInput, now?: Date): Promise<ExerciseDefinition>;
  updateCustom(id: string, expectedRevision: number, input: CustomExerciseInput, now?: Date): Promise<ExerciseDefinition>;
  /** Ревизия своего упражнения для CAS (у системного — null). */
  revisionOf(id: string): Promise<number | null>;
  archiveCustom(id: string, now?: Date): Promise<void>;
  setFavorite(id: string, favorite: boolean): Promise<void>;
  setHidden(id: string, hidden: boolean): Promise<void>;
  /** Личное название и синонимы — и для системных упражнений (§31.10, §39.2). */
  setPersonal(id: string, personal: Readonly<{ displayName: string | null; aliases: readonly string[] }>): Promise<void>;
  subscribeCommittedChanges(listener: () => void): () => void;
}
