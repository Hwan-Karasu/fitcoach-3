import type { ArchiveSortMode, ClientDeletionManifest } from "./ClientArchivePort.ts";
import type { BirthdayDismissal, ClientRosterRow, RosterBirthdaySettings,
  RosterSortMode } from "./ClientRosterPort.ts";

export interface PresentedClient {
  readonly client: ClientRosterRow;
  readonly birthdayBadge: string | null;
  readonly birthdayOccurrence: string | null;
  readonly daysUntilBirthday: number | null;
  /** Когда ближайший день рождения: «25 окт., через 8 дн.», «Завтра, 18 окт.». */
  readonly birthdayText: string | null;
}

export interface PresentedRoster {
  readonly birthday: readonly PresentedClient[];
  readonly recent: PresentedClient | null;
  readonly regular: readonly PresentedClient[];
  readonly searching: boolean;
  /** Включён «Сегодня по расписанию»: плоский список по времени записи (§7). */
  readonly todayOnly: boolean;
}

export function localCalendarDate(now: Date): string {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const shortMonths = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.",
  "нояб.", "дек."] as const;

/** Дата ближайшего дня рождения и сколько до него осталось — для закреплённой карточки. */
export function birthdayLabel(occurrence: string, daysUntil: number): string {
  const date = `${Number(occurrence.slice(8, 10))} ${shortMonths[Number(occurrence.slice(5, 7)) - 1] ?? ""}`;
  if (daysUntil === 0) return `Сегодня, ${date}`;
  if (daysUntil === 1) return `Завтра, ${date}`;
  return `${date}, через ${daysUntil} дн.`;
}

const genitiveMonths = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля",
  "августа", "сентября", "октября", "ноября", "декабря"] as const;

/** Full years on a local date; «29 февраля» counts from 1 March in non-leap years. */
export function ageOn(birthDate: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(birthDate) || !/^\d{4}-\d{2}-\d{2}$/u.test(today) || birthDate >= today) {
    return null;
  }
  const years = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return today.slice(5) >= birthDate.slice(5) ? years : years - 1;
}

export function formatYears(years: number): string {
  const tail = years % 100;
  if (tail >= 11 && tail <= 14) return `${years} лет`;
  if (years % 10 === 1) return `${years} год`;
  return years % 10 >= 2 && years % 10 <= 4 ? `${years} года` : `${years} лет`;
}

/** Local calendar date of archivedAt; no Intl dependency on Hermes. */
export function formatArchivedSince(archivedAt: string | null): string {
  const at = archivedAt === null ? Number.NaN : Date.parse(archivedAt);
  if (Number.isNaN(at)) return "В архиве";
  const local = new Date(at);
  return `В архиве с ${local.getDate()} ${genitiveMonths[local.getMonth()]} ${local.getFullYear()}`;
}

const deletionOwnerLabels: Readonly<Record<string, string>> = {
  "clients.recoveryDrafts": "черновики формы",
  "clients.activity": "отметка «Недавно открытые»",
  "clients.birthdayDismissals": "скрытые закрепления дня рождения",
  "accounting.client": "записи абонемента, списаний и оплат",
  "measurements.body": "замеры",
  "questionnaire.answers": "ответы анкеты",
};

/** Consequence text built from the actual manifest, not a generic «Вы уверены?». */
export function permanentDeleteDescription(manifest: ClientDeletionManifest): string {
  const extra = manifest.owners.filter((entry) => entry.owner !== "clients.profile"
    && entry.owner !== "calendar.appointments" && entry.rows > 0)
    .map((entry) => `${deletionOwnerLabels[entry.owner] ?? entry.owner}: ${entry.rows}`);
  const appointments = manifest.owners.find((entry) => entry.owner === "calendar.appointments")?.rows ?? 0;
  return [
    "Действие необратимо. Карточку и данные клиента нельзя будет вернуть из Архива.",
    `Будет удалено: карточка клиента${extra.length > 0 ? `; ${extra.join("; ")}` : ""}.`,
    ...appointments > 0 ? [`Записи календаря: ${appointments}. Будущие записи будут отменены, `
      + "прошлые останутся в истории календаря без данных клиента (как «Удалённый клиент»)."] : [],
    "Тренировки и питание ещё не подключены, поэтому их данных у клиента нет.",
  ].join("\n\n");
}

function dateEpoch(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  if (year === 0) return null;
  const value = new Date(0);
  value.setUTCFullYear(year!, month! - 1, date!);
  value.setUTCHours(0, 0, 0, 0);
  const epoch = value.getTime();
  const check = new Date(epoch);
  return check.getUTCFullYear() === year && check.getUTCMonth() + 1 === month
    && check.getUTCDate() === date ? epoch : null;
}

function leap(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Calendar-only occurrence; Feb 29 is presented on Feb 28 in non-leap years. */
export function birthdayOccurrenceForYear(birthDate: string, year: number): string | null {
  if (dateEpoch(birthDate) === null || !Number.isSafeInteger(year) || year < 1 || year > 9999) return null;
  const month = Number(birthDate.slice(5, 7));
  const day = Number(birthDate.slice(8, 10));
  const occurrenceDay = month === 2 && day === 29 && !leap(year) ? 28 : day;
  return `${year}-${String(month).padStart(2, "0")}-${String(occurrenceDay).padStart(2, "0")}`;
}

function nextBirthday(birthDate: string | null, today: string): Readonly<{
  occurrence: string; daysUntil: number;
}> | null {
  if (birthDate === null) return null;
  const todayEpoch = dateEpoch(today);
  if (todayEpoch === null) throw new Error("ROSTER_TODAY_INVALID");
  let year = Number(today.slice(0, 4));
  let occurrence = birthdayOccurrenceForYear(birthDate, year);
  if (occurrence === null) return null;
  if (occurrence < today) {
    year += 1;
    occurrence = birthdayOccurrenceForYear(birthDate, year);
    if (occurrence === null) return null;
  }
  const occurrenceEpoch = dateEpoch(occurrence);
  if (occurrenceEpoch === null) return null;
  return { occurrence, daysUntil: Math.round((occurrenceEpoch - todayEpoch) / 86_400_000) };
}

/**
 * Один коллатор на модуль: `localeCompare(…, "ru")` на каждое сравнение в Hermes очень дорог
 * (каталог упражнений: 2,6 с на 643 записи). Даты и ID — ISO/ASCII, их хватает обычного сравнения.
 */
const ruCollator = new Intl.Collator("ru");

function compareAscii(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byName(a: PresentedClient, b: PresentedClient): number {
  return ruCollator.compare(a.client.displayName, b.client.displayName) || compareAscii(a.client.id, b.client.id);
}

function bySelectedSort(mode: RosterSortMode): (a: PresentedClient, b: PresentedClient) => number {
  return mode === "NAME" ? byName : (a, b) =>
    compareAscii(b.client.lastOpenedAt ?? "", a.client.lastOpenedAt ?? "") || byName(a, b);
}

/** Search only by identity/contact fields; default is archivedAt DESC (§15.10). */
export function presentArchivedClients(rows: readonly ClientRosterRow[], search: string,
  sort: ArchiveSortMode): readonly ClientRosterRow[] {
  const needle = search.trim().toLowerCase();
  const byName = (a: ClientRosterRow, b: ClientRosterRow) =>
    ruCollator.compare(a.displayName, b.displayName) || compareAscii(a.id, b.id);
  return rows.filter((row) => row.lifecycle === "ARCHIVED"
    && [row.displayName, row.contactPhone, row.contactEmail]
      .some((value) => value?.toLowerCase().includes(needle)))
    .sort(sort === "NAME" ? byName
      : (a, b) => compareAscii(b.archivedAt ?? "", a.archivedAt ?? "") || byName(a, b));
}

/** No birthday/recent duplicate; search flattens priorities but keeps short badges. */
export function presentClientRoster(input: Readonly<{
  rows: readonly ClientRosterRow[];
  search: string;
  sort: RosterSortMode;
  today: string;
  birthday: RosterBirthdaySettings;
  dismissals: readonly BirthdayDismissal[];
  /** Начало ближайшей сегодняшней записи по клиенту; задано — фильтр «Сегодня» включён. */
  todayStarts?: ReadonlyMap<string, number> | null;
  filters?: ClientRosterFilters;
  overview?: RosterOverview | null;
}>): PresentedRoster {
  if (dateEpoch(input.today) === null) throw new Error("ROSTER_TODAY_INVALID");
  const needle = input.search.trim().toLowerCase();
  const searching = needle.length > 0;
  const dismissed = new Set(input.dismissals.map((row) => JSON.stringify([row.clientId, row.occurrenceDate])));
  const todayStarts = input.todayStarts ?? null;
  const presented = input.rows.filter((row) => row.lifecycle === "ACTIVE"
    && matchesRosterFilters(row, input.overview?.get(row.id), input.filters ?? EMPTY_ROSTER_FILTERS)
    && (todayStarts === null || todayStarts.has(row.id))
    && [row.displayName, row.contactPhone, row.contactEmail]
      .some((value) => value?.toLowerCase().includes(needle)))
    .map((client): PresentedClient => {
      const birthday = nextBirthday(client.birthDate, input.today);
      const days = birthday?.daysUntil ?? null;
      const birthdayBadge = !input.birthday.showBirthdayBadge || days === null || days > 7
        ? null : days === 0 ? "ДР сегодня" : days === 1 ? "ДР завтра" : `ДР через ${days} д.`;
      return { client, birthdayBadge, birthdayOccurrence: birthday?.occurrence ?? null,
        daysUntilBirthday: days,
        birthdayText: birthday === null ? null : birthdayLabel(birthday.occurrence, birthday.daysUntil) };
    });
  if (todayStarts !== null) return {
    birthday: [], recent: null, searching, todayOnly: true,
    regular: [...presented].sort((a, b) => (todayStarts.get(a.client.id) ?? 0) - (todayStarts.get(b.client.id) ?? 0)
      || byName(a, b)),
  };
  if (searching) return {
    birthday: [], recent: null, regular: [...presented].sort(bySelectedSort(input.sort)), searching, todayOnly: false,
  };
  const birthday = input.birthday.birthdayPinEnabled
    ? presented.filter((row) => row.daysUntilBirthday !== null
      && row.daysUntilBirthday <= input.birthday.birthdayPinLeadDays
      && row.birthdayOccurrence !== null
      && !dismissed.has(JSON.stringify([row.client.id, row.birthdayOccurrence])))
      .sort((a, b) => (a.daysUntilBirthday ?? 0) - (b.daysUntilBirthday ?? 0) || byName(a, b))
    : [];
  const pinned = new Set(birthday.map((row) => row.client.id));
  const remaining = presented.filter((row) => !pinned.has(row.client.id));
  const recent = [...remaining].filter((row) => row.client.lastOpenedAt !== null)
    .sort((a, b) => compareAscii(b.client.lastOpenedAt ?? "", a.client.lastOpenedAt ?? "") || byName(a, b))[0] ?? null;
  return {
    birthday, recent,
    regular: remaining.filter((row) => row.client.id !== recent?.client.id).sort(bySelectedSort(input.sort)),
    searching, todayOnly: false,
  };
}
import { EMPTY_ROSTER_FILTERS, matchesRosterFilters, type ClientRosterFilters } from "./ClientRosterFilters.ts";
import type { RosterOverview } from "./ClientRosterOverview.ts";
