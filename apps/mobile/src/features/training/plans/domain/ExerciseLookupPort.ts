import type { TrackingMetric } from "./SimplePlanRules.ts";

/** То, что планам нужно знать об упражнении каталога: название, величины подхода, миниатюра. */
export interface ExerciseInfo {
  readonly name: string;
  readonly metrics: readonly TrackingMetric[];
  /** Ресурс картинки (Metro asset id) или null. */
  readonly thumbnail: number | null;
  /** Одностороннее упражнение: левая и правая сторона записываются раздельно (§48.66). */
  readonly unilateral: boolean;
  /** Категория упражнения (группа мышц каталога) — для статистики по мышечным группам (§48.86.27); без неё — «Без категории». */
  readonly group?: Readonly<{ id: string; label: string }>;
}

/** Каталог упражнений глазами планов. Собирается в composition из публичного порта каталога. */
export interface ExerciseLookupPort {
  lookup(): Promise<ReadonlyMap<string, ExerciseInfo>>;
  subscribe(listener: () => void): () => void;
}
