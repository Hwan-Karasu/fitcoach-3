import type { TrackingMetric } from "./SimplePlanRules.ts";

/** То, что планам нужно знать об упражнении каталога: название, величины подхода, миниатюра. */
export interface ExerciseInfo {
  readonly name: string;
  readonly metrics: readonly TrackingMetric[];
  /** Ресурс картинки (Metro asset id) или null. */
  readonly thumbnail: number | null;
}

/** Каталог упражнений глазами планов. Собирается в composition из публичного порта каталога. */
export interface ExerciseLookupPort {
  lookup(): Promise<ReadonlyMap<string, ExerciseInfo>>;
  subscribe(listener: () => void): () => void;
}
