import { HEALTH_METRICS, HEALTH_METRIC_LABELS, type HealthMetric } from "./HealthModel.ts";

/** Сколько дней каждого вида данных вернул Health Connect и прошло проверку (после слияния повторов за день). */
export type HealthDayCounts = Readonly<Partial<Record<HealthMetric, number>>>;

/**
 * Что показать после успешного обновления. Раньше всегда «Данные обновлены.», даже когда Health Connect ничего не вернул, — владелец не мог понять,
 * подключено ли чтение или у источника просто нет данных.
 * `rawDays` — сколько значений отдала система до проверки диапазонов; `byMetric` — сколько дней осталось по каждому виду.
 */
export function syncedText(result: Readonly<{ rawDays?: number; byMetric?: HealthDayCounts }>): string {
  const counts = result.byMetric ?? {};
  const parts = HEALTH_METRICS.filter((metric) => (counts[metric] ?? 0) > 0).map((metric) => `${HEALTH_METRIC_LABELS[metric].toLowerCase()} — ${counts[metric]} дн.`);
  if (parts.length > 0) return `Данные обновлены: ${parts.join(", ")}`; // «дн.» уже с точкой в конце
  if ((result.rawDays ?? 0) > 0) return "Health Connect вернул данные, но ни одно значение не прошло проверку допустимых границ.";
  return "Health Connect не вернул данных за период. Откройте приложение Health Connect → «Данные и доступ» и проверьте, что часы или другое приложение записывают в него шаги и сон.";
}
