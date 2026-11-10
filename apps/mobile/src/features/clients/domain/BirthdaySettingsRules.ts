import type { RosterBirthdaySettings } from "./ClientRosterPort.ts";

/** «За сколько дней закреплять день рождения» (UIX-13): целое число от 1 до 60; всё прочее — `null` (ошибка под полем, запись не выполняется). */
export function parseBirthdayLeadDays(text: string): number | null {
  const value = text.trim();
  if (!/^\d{1,2}$/u.test(value)) return null;
  const days = Number(value);
  return days >= 1 && days <= 60 ? days : null;
}

/** Что записать при изменении поля: `null` — менять нечего (значение то же), записи не будет. */
export function nextBirthdaySettings(saved: RosterBirthdaySettings, patch: Partial<RosterBirthdaySettings>): RosterBirthdaySettings | null {
  const next: RosterBirthdaySettings = { ...saved, ...patch };
  return next.birthdayPinEnabled === saved.birthdayPinEnabled && next.showBirthdayBadge === saved.showBirthdayBadge
    && next.birthdayPinLeadDays === saved.birthdayPinLeadDays ? null : next;
}
