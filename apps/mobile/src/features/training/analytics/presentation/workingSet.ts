import type { SetFact } from "../../execution/public.ts";

/**
 * Засчитанный рабочий подход: подтверждён и не разминка (§48.44, §48.80: частично выполненный односторонний — один подход).
 * Единое правило для истории, статистики и прогресса упражнения (UX-контракт истории, решение владельца 2026-10-20).
 */
export const isWorkingSet = (fact: SetFact): boolean => fact.confirmed && fact.setType !== "WARMUP";
