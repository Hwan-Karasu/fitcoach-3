import { SESSION_TYPE_COLORS, type SessionType, type SessionTypeColor } from "../domain/CalendarModel.ts";

/** One swatch per colour family; stable storage keys keep existing data compatible. */
export const sessionTypeColorHex: Readonly<Record<SessionTypeColor, string>> = {
  teal: "#247343", blue: "#2456A6", violet: "#6A3FA0", amber: "#8A6500", rose: "#B52A32", slate: "#4A5563",
};
export const sessionTypeColorLabels: Readonly<Record<SessionTypeColor, string>> = {
  teal: "Зелёный", blue: "Синий", violet: "Фиолетовый", amber: "Жёлтый", rose: "Красный", slate: "Серый",
};
export const DEFAULT_DUTY_COLOR = "#B64D00";

export function resolveDutyColor(value: string | null): string {
  const aliases: Readonly<Record<string, string>> = {
    "#0E6E73": sessionTypeColorHex.teal, "#8A5A00": sessionTypeColorHex.amber, "#A3324F": sessionTypeColorHex.rose,
  };
  const normalized = value?.toUpperCase() ?? DEFAULT_DUTY_COLOR;
  return aliases[normalized] ?? ([DEFAULT_DUTY_COLOR, ...Object.values(sessionTypeColorHex)].includes(normalized) ? normalized : DEFAULT_DUTY_COLOR);
}

/** Existing automatic/duplicate colours receive unused swatches in stable list order. */
export function resolveTypeColors(types: readonly SessionType[], dutyColor: string): ReadonlyMap<string, SessionTypeColor> {
  const result = new Map<string, SessionTypeColor>();
  const used = new Set<string>([dutyColor]);
  const active = types.filter((type) => !type.archived);
  for (const type of active) {
    if (type.color !== null && !used.has(sessionTypeColorHex[type.color])) {
      result.set(type.id, type.color);
      used.add(sessionTypeColorHex[type.color]);
    }
  }
  for (const type of active) {
    if (result.has(type.id)) continue;
    const color = SESSION_TYPE_COLORS.find((candidate) => !used.has(sessionTypeColorHex[candidate]));
    if (color !== undefined) { result.set(type.id, color); used.add(sessionTypeColorHex[color]); }
  }
  return result;
}
