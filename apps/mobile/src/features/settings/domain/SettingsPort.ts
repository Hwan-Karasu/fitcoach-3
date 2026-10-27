import { normalizeClientCards, type ClientCardPreference } from "../../../shared/domain/ClientCardPreference.ts";
import { normalizeDutyPresets, type DutyPreset } from "../../../shared/domain/DutyPreset.ts";
/** Выбранные тема и акцент; допустимость id проверяет каталог тем, не хранилище. */
export interface AppearanceSetting {
  readonly themeId: string;
  readonly accentId: string | null;
  readonly showClientListShortcut?: boolean;
  readonly hideNavigationLabels?: boolean;
  readonly dutyColor?: string | null;
  readonly hiddenSessionTypeIds?: readonly string[];
  readonly clientCards?: ClientCardPreference;
  readonly dutyPresets?: readonly DutyPreset[];
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
    const options = value as Record<string, unknown>;
    return { themeId, accentId,
      ...(options.clientCards !== undefined ? { clientCards: normalizeClientCards(options.clientCards) } : {}),
      ...(typeof options.showClientListShortcut === "boolean" ? { showClientListShortcut: options.showClientListShortcut } : {}),
      ...(typeof options.hideNavigationLabels === "boolean" ? { hideNavigationLabels: options.hideNavigationLabels } : {}),
      ...(options.dutyColor === null || (typeof options.dutyColor === "string" && /^#[0-9a-f]{6}$/iu.test(options.dutyColor))
        ? { dutyColor: options.dutyColor as string | null } : {}),
      ...(Array.isArray(options.hiddenSessionTypeIds) && options.hiddenSessionTypeIds.every((id) => typeof id === "string" && id.length > 0)
        ? { hiddenSessionTypeIds: [...new Set(options.hiddenSessionTypeIds as string[])] } : {}),
      ...(Array.isArray(options.dutyPresets) ? { dutyPresets: normalizeDutyPresets(options.dutyPresets) } : {}),
    };
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
