export const rootTabs = {
  Clients: "Клиенты",
  Calendar: "Календарь",
  Archive: "Архив",
} as const;

export type RootTabName = keyof typeof rootTabs;

export const workspaceTabs = {
  Home: "Главная",
  Nutrition: "Питание",
  Training: "Тренировки",
  More: "Ещё",
} as const;

export type WorkspaceTabName = keyof typeof workspaceTabs;

export const moreDestinations = {
  Questionnaire: "Анкета",
  TrainingArchive: "Архив",
  Statistics: "Статистика",
} as const;

export type MoreDestinationName = keyof typeof moreDestinations;

// More is a control, not a seventh client section (§53.3).
export const clientSections = [
  "Home",
  "Nutrition",
  "Training",
  "Questionnaire",
  "TrainingArchive",
  "Statistics",
] as const;

export type ClientSectionName = (typeof clientSections)[number];
