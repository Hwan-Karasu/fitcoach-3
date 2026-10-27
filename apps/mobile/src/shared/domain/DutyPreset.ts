/** Именованные диапазоны дежурства тренера: настройка интерфейса, не факт клиента. */
export interface DutyPreset {
  readonly id: string;
  readonly name: string;
  readonly startMinute: number;
  readonly endMinute: number;
}
export const MAX_DUTY_PRESETS = 8;
export const MAX_DUTY_PRESET_NAME = 24;

/** Оставляет только корректные пресеты: имя без пробелов по краям, диапазон кратен 30 минутам внутри суток. */
export function normalizeDutyPresets(input: unknown): readonly DutyPreset[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: DutyPreset[] = [];
  for (const item of input) {
    if (typeof item !== "object" || item === null) continue;
    const { id, name, startMinute, endMinute } = item as Record<string, unknown>;
    if (typeof id !== "string" || id === "" || seen.has(id) || typeof name !== "string") continue;
    const trimmed = name.trim();
    if (trimmed === "" || trimmed.length > MAX_DUTY_PRESET_NAME) continue;
    if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)) continue;
    const start = startMinute as number;
    const end = endMinute as number;
    if (start < 0 || end > 1440 || end <= start || start % 30 !== 0 || end % 30 !== 0) continue;
    seen.add(id);
    result.push({ id, name: trimmed, startMinute: start, endMinute: end });
    if (result.length === MAX_DUTY_PRESETS) break;
  }
  return result;
}
