import type { ArchiveSortMode, ClientDeletionManifest } from "./ClientArchivePort.ts";
import type { BirthdayDismissal, ClientRosterRow, RosterBirthdaySettings,
  RosterSortMode } from "./ClientRosterPort.ts";

export interface PresentedClient {
  readonly client: ClientRosterRow;
  readonly birthdayBadge: string | null;
  readonly birthdayOccurrence: string | null;
  readonly daysUntilBirthday: number | null;
}

export interface PresentedRoster {
  readonly birthday: readonly PresentedClient[];
  readonly recent: PresentedClient | null;
  readonly regular: readonly PresentedClient[];
  readonly searching: boolean;
}

export function localCalendarDate(now: Date): string {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const genitiveMonths = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля",
  "августа", "сентября", "октября", "ноября", "декабря"] as const;

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

function byName(a: PresentedClient, b: PresentedClient): number {
  return a.client.displayName.localeCompare(b.client.displayName, "ru")
    || a.client.id.localeCompare(b.client.id);
}

function bySelectedSort(mode: RosterSortMode): (a: PresentedClient, b: PresentedClient) => number {
  return mode === "NAME" ? byName : (a, b) =>
    (b.client.lastOpenedAt ?? "").localeCompare(a.client.lastOpenedAt ?? "") || byName(a, b);
}

/** Search only by identity/contact fields; default is archivedAt DESC (§15.10). */
export function presentArchivedClients(rows: readonly ClientRosterRow[], search: string,
  sort: ArchiveSortMode): readonly ClientRosterRow[] {
  const needle = search.trim().toLocaleLowerCase("ru");
  const byName = (a: ClientRosterRow, b: ClientRosterRow) =>
    a.displayName.localeCompare(b.displayName, "ru") || a.id.localeCompare(b.id);
  return rows.filter((row) => row.lifecycle === "ARCHIVED"
    && [row.displayName, row.contactPhone, row.contactEmail]
      .some((value) => value?.toLocaleLowerCase("ru").includes(needle)))
    .sort(sort === "NAME" ? byName
      : (a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "") || byName(a, b));
}

/** No birthday/recent duplicate; search flattens priorities but keeps short badges. */
export function presentClientRoster(input: Readonly<{
  rows: readonly ClientRosterRow[];
  search: string;
  sort: RosterSortMode;
  today: string;
  birthday: RosterBirthdaySettings;
  dismissals: readonly BirthdayDismissal[];
}>): PresentedRoster {
  if (dateEpoch(input.today) === null) throw new Error("ROSTER_TODAY_INVALID");
  const needle = input.search.trim().toLocaleLowerCase("ru");
  const searching = needle.length > 0;
  const dismissed = new Set(input.dismissals.map((row) => JSON.stringify([row.clientId, row.occurrenceDate])));
  const presented = input.rows.filter((row) => row.lifecycle === "ACTIVE"
    && [row.displayName, row.contactPhone, row.contactEmail]
      .some((value) => value?.toLocaleLowerCase("ru").includes(needle)))
    .map((client): PresentedClient => {
      const birthday = nextBirthday(client.birthDate, input.today);
      const days = birthday?.daysUntil ?? null;
      const birthdayBadge = !input.birthday.showBirthdayBadge || days === null || days > 7
        ? null : days === 0 ? "ДР сегодня" : days === 1 ? "ДР завтра" : `ДР через ${days} д.`;
      return { client, birthdayBadge, birthdayOccurrence: birthday?.occurrence ?? null,
        daysUntilBirthday: days };
    });
  if (searching) return {
    birthday: [], recent: null, regular: [...presented].sort(bySelectedSort(input.sort)), searching,
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
    .sort((a, b) => (b.client.lastOpenedAt ?? "").localeCompare(a.client.lastOpenedAt ?? "") || byName(a, b))[0] ?? null;
  return {
    birthday, recent,
    regular: remaining.filter((row) => row.client.id !== recent?.client.id).sort(bySelectedSort(input.sort)),
    searching,
  };
}
