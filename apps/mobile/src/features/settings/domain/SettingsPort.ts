/** Выбранные тема и акцент; допустимость id проверяет каталог тем, не хранилище. */
export interface AppearanceSetting {
  readonly themeId: string;
  readonly accentId: string | null;
}

/**
 * Собственные UI-настройки тренера (Settings owner). Чтение возвращает `null`, если значение не сохранялось
 * или повреждено: вызывающий берёт значение по умолчанию. Ошибка записи не скрывается.
 */
export interface SettingsPort {
  readAppearance(): Promise<AppearanceSetting | null>;
  saveAppearance(value: AppearanceSetting): Promise<void>;
  /** Id групп замеров, видимых в карточке «Замеры» (NUT-FS-10). */
  readMeasurementGroups(): Promise<readonly string[] | null>;
  saveMeasurementGroups(ids: readonly string[]): Promise<void>;
  subscribeCommittedChanges(listener: () => void): () => void;
}

export function parseAppearance(json: string): AppearanceSetting | null {
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value !== "object" || value === null) return null;
    const { themeId, accentId } = value as Record<string, unknown>;
    if (typeof themeId !== "string" || themeId === "") return null;
    if (accentId !== null && typeof accentId !== "string") return null;
    return { themeId, accentId };
  } catch {
    return null;
  }
}

export function parseStringList(json: string): readonly string[] | null {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : null;
  } catch {
    return null;
  }
}
