/** Presentation preferences shared by Settings and the client workspace. */
export const CLIENT_START_SECTIONS = [
  { id: "Home", label: "Главная" }, { id: "Nutrition", label: "Питание" }, { id: "Training", label: "Тренировки" },
  { id: "More", label: "Ещё" },
] as const;
export const CLIENT_METRICS = [
  { id: "nextAppointment", label: "Следующее занятие" }, { id: "lastTraining", label: "Последняя тренировка" },
  { id: "credits", label: "Абонемент" }, { id: "weight", label: "Вес" },
  { id: "calories", label: "Калории" }, { id: "steps", label: "Шаги" }, { id: "fatPercent", label: "% жира" },
] as const;
export type ClientStartSection = typeof CLIENT_START_SECTIONS[number]["id"];
export type ClientMetricId = typeof CLIENT_METRICS[number]["id"];
export interface ClientCardPreference {
  readonly startSection: ClientStartSection;
  readonly metricIds: readonly ClientMetricId[];
  readonly showHealthBadge: boolean;
}
export const DEFAULT_CLIENT_CARDS: ClientCardPreference = {
  startSection: "Home", metricIds: ["nextAppointment", "lastTraining", "credits"], showHealthBadge: true,
};
export function normalizeClientCards(input: unknown): ClientCardPreference {
  const value = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const section = value.startSection === "Profile" || value.startSection === "Archive" ? "More" : value.startSection;
  const metricIds = Array.isArray(value.metricIds) ? [...new Set(value.metricIds.filter((id): id is ClientMetricId =>
    CLIENT_METRICS.some((option) => option.id === id)))].slice(0, 4) : DEFAULT_CLIENT_CARDS.metricIds;
  return {
    startSection: CLIENT_START_SECTIONS.some((option) => option.id === section) ? section as ClientStartSection : "Home",
    metricIds,
    showHealthBadge: typeof value.showHealthBadge === "boolean" ? value.showHealthBadge : true,
  };
}
