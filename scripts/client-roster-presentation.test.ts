import assert from "node:assert/strict";
import test from "node:test";
import { CREDITS_ENDING_MAX, EMPTY_ROSTER_FILTERS, matchesRosterFilters, rosterFilterCount, summarizeRoster } from "../apps/mobile/src/features/clients/domain/ClientRosterFilters.ts";
import type { RosterClientOverview } from "../apps/mobile/src/features/clients/domain/ClientRosterOverview.ts";
import { birthdayOccurrenceForYear, formatArchivedSince, permanentDeleteDescription,
  presentArchivedClients, presentClientRoster } from
  "../apps/mobile/src/features/clients/domain/ClientRosterPresentation.ts";
import type { ClientRosterRow, RosterBirthdaySettings } from
  "../apps/mobile/src/features/clients/domain/ClientRosterPort.ts";

const settings: RosterBirthdaySettings = {
  birthdayPinEnabled: true, birthdayPinLeadDays: 14, showBirthdayBadge: true,
};

test("structured sex, health and credit filters intersect before birthday/recent priority, search and Today ordering", () => {
  const a = { ...row("a", "Клиент А", "2000-10-18"), sex: "MALE" as const };
  const b = { ...row("b", "Клиент Б", null), sex: "MALE" as const };
  const excluded = { ...row("excluded", "Клиент В", "2000-10-17", "2026-10-17T12:00:00Z"), sex: "FEMALE" as const };
  const fact: RosterClientOverview = { metrics: [], restricted: true, restrictionsKnown: true, creditStatus: "AVAILABLE", todayStartMinute: 600, todayEndMinute: 660 };
  const overview = new Map([[a.id, fact], [b.id, fact], [excluded.id, fact]]);
  const filters = { sex: "MALE", health: "RESTRICTED", credit: "AVAILABLE" } as const;
  const base = { rows: [a, b, excluded], sort: "NAME" as const, today: "2026-10-17", birthday: settings, dismissals: [], overview, filters };
  const normal = presentClientRoster({ ...base, search: "" });
  assert.deepEqual(normal.birthday.map((entry) => entry.client.id), ["a"]);
  assert.equal(normal.recent, null);
  assert.deepEqual(normal.regular.map((entry) => entry.client.id), ["b"]);
  const today = presentClientRoster({ ...base, search: "Клиент", todayStarts: new Map([[a.id, 900], [b.id, 800], [excluded.id, 700]]) });
  assert.deepEqual(today.regular.map((entry) => entry.client.id), ["b", "a"]);
  assert.deepEqual(today.birthday, []);
  assert.equal(today.recent, null);
  assert.equal(rosterFilterCount(filters), 3);
  assert.equal(rosterFilterCount(EMPTY_ROSTER_FILTERS), 0);
});

test("unknown facts do not masquerade as unmarked health or an empty pack; unspecified sex is explicit", () => {
  const client = row("a", "А", null);
  assert.equal(matchesRosterFilters(client, undefined, { ...EMPTY_ROSTER_FILTERS, sex: "UNSPECIFIED" }), true);
  assert.equal(matchesRosterFilters(client, undefined, { ...EMPTY_ROSTER_FILTERS, sex: "MALE" }), false);
  assert.equal(matchesRosterFilters(client, undefined, { ...EMPTY_ROSTER_FILTERS, health: "UNMARKED" }), false);
  const unknown: RosterClientOverview = { metrics: [], restricted: false, restrictionsKnown: false, creditStatus: "UNKNOWN", todayStartMinute: null, todayEndMinute: null };
  assert.equal(matchesRosterFilters(client, unknown, { ...EMPTY_ROSTER_FILTERS, health: "UNMARKED" }), false);
  assert.equal(matchesRosterFilters(client, unknown, { ...EMPTY_ROSTER_FILTERS, credit: "EMPTY" }), false);
  assert.equal(matchesRosterFilters(client, { ...unknown, restrictionsKnown: true }, { ...EMPTY_ROSTER_FILTERS, health: "UNMARKED" }), true);
  for (const credit of ["AVAILABLE", "EMPTY", "NO_PACK", "NOT_TRACKED"] as const) {
    assert.equal(matchesRosterFilters(client, { ...unknown, creditStatus: credit }, { ...EMPTY_ROSTER_FILTERS, credit }), true);
  }
});

function row(id: string, displayName: string, birthDate: string | null,
  lastOpenedAt: string | null = null): ClientRosterRow {
  return { id, displayName, birthDate, lastOpenedAt, contactPhone: null,
    contactEmail: null, heightCmX10: null, emoji: null, lifecycle: "ACTIVE",
    revision: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    archivedAt: null };
}

test("C01 birthday is date-only and Feb 29 becomes Feb 28 in non-leap years", () => {
  assert.equal(birthdayOccurrenceForYear("2000-02-29", 2026), "2026-02-28");
  assert.equal(birthdayOccurrenceForYear("2000-02-29", 2028), "2028-02-29");
  const before = presentClientRoster({ rows: [row("leap", "Leap", "2000-02-29")],
    search: "", sort: "NAME", today: "2026-02-27", birthday: settings, dismissals: [] });
  assert.equal(before.birthday[0]?.birthdayBadge, "ДР завтра");
  assert.equal(before.birthday[0]?.birthdayOccurrence, "2026-02-28");
  const after = presentClientRoster({ rows: [row("leap", "Leap", "2000-02-29")],
    search: "", sort: "NAME", today: "2026-03-01", birthday: settings, dismissals: [] });
  assert.equal(after.birthday.length, 0);
});

test("C01 birthday priority, recent and search are disjoint; dismissal is occurrence-only", () => {
  const rows = [
    row("birthday", "Борис", "2000-10-16", "2026-10-15T11:00:00Z"),
    row("later", "Алина", "2000-10-20"),
    row("recent", "Вера", null, "2026-10-15T10:00:00Z"),
    row("regular", "Глеб", null),
  ];
  const normal = presentClientRoster({ rows, search: "", sort: "NAME",
    today: "2026-10-15", birthday: settings, dismissals: [] });
  assert.deepEqual(normal.birthday.map((entry) => entry.client.id), ["birthday", "later"]);
  assert.equal(normal.recent?.client.id, "recent");
  assert.deepEqual(normal.regular.map((entry) => entry.client.id), ["regular"]);
  const dismissed = presentClientRoster({ rows, search: "", sort: "NAME",
    today: "2026-10-15", birthday: settings,
    dismissals: [{ clientId: "birthday", occurrenceDate: "2026-10-16" }] });
  assert.equal(dismissed.recent?.client.id, "birthday");
  assert.equal(dismissed.recent?.birthdayBadge, "ДР завтра");
  const nextYear = presentClientRoster({ rows, search: "", sort: "NAME",
    today: "2027-10-15", birthday: settings,
    dismissals: [{ clientId: "birthday", occurrenceDate: "2026-10-16" }] });
  assert.ok(nextYear.birthday.some((entry) => entry.client.id === "birthday"));
  const search = presentClientRoster({ rows, search: "Бор", sort: "RECENT",
    today: "2026-10-15", birthday: settings, dismissals: [] });
  assert.equal(search.birthday.length, 0);
  assert.equal(search.recent, null);
  assert.deepEqual(search.regular.map((entry) => entry.client.id), ["birthday"]);
  assert.equal(search.regular[0]?.birthdayBadge, "ДР завтра");
  const badgeOnly = presentClientRoster({ rows, search: "", sort: "NAME",
    today: "2026-10-15", birthday: { ...settings, birthdayPinEnabled: false }, dismissals: [] });
  assert.equal(badgeOnly.birthday.length, 0);
  assert.equal(badgeOnly.recent?.client.id, "birthday");
  assert.equal(badgeOnly.recent?.birthdayBadge, "ДР завтра");
});

test("C01 badge window and lifecycle stay independent of birthday pin", () => {
  const rows = [
    row("today", "А", "2000-10-15"),
    row("day-seven", "Б", "2000-10-22"),
    row("day-eight", "В", "2000-10-23"),
    { ...row("archived", "Г", "2000-10-15"), lifecycle: "ARCHIVED" as const },
  ];
  const result = presentClientRoster({ rows, search: "", sort: "NAME",
    today: "2026-10-15", birthday: { ...settings, birthdayPinEnabled: false },
    dismissals: [] });
  assert.equal(result.birthday.length, 0);
  assert.equal(result.recent, null);
  assert.deepEqual(result.regular.map((entry) => [entry.client.id, entry.birthdayBadge]), [
    ["today", "ДР сегодня"], ["day-seven", "ДР через 7 д."], ["day-eight", null],
  ]);
});

test("C04 archived date is the local calendar day with a genitive month", () => {
  const localMidnight = new Date(2026, 9, 12, 0, 0, 0).toISOString();
  assert.equal(formatArchivedSince(localMidnight), "В архиве с 12 октября 2026");
  const lateEvening = new Date(2026, 0, 31, 23, 59, 0).toISOString();
  assert.equal(formatArchivedSince(lateEvening), "В архиве с 31 января 2026");
  assert.equal(formatArchivedSince(null), "В архиве");
  assert.equal(formatArchivedSince("not-a-date"), "В архиве");
});

test("C04 archive list defaults to archivedAt DESC and searches identity fields only", () => {
  const archived = (id: string, name: string, at: string) =>
    ({ ...row(id, name, null), lifecycle: "ARCHIVED" as const, archivedAt: at });
  const rows = [
    archived("old", "Анна", "2026-01-01T00:00:00Z"),
    archived("new", "Яна", "2026-10-01T00:00:00Z"),
    { ...archived("phone", "Борис", "2026-05-01T00:00:00Z"), contactPhone: "+7 900" },
    row("active", "Активный", null),
  ];
  assert.deepEqual(presentArchivedClients(rows, "", "ARCHIVED_AT").map((item) => item.id),
    ["new", "phone", "old"]);
  assert.deepEqual(presentArchivedClients(rows, "", "NAME").map((item) => item.id),
    ["old", "phone", "new"]);
  assert.deepEqual(presentArchivedClients(rows, "900", "NAME").map((item) => item.id), ["phone"]);
  assert.deepEqual(presentArchivedClients(rows, "нет такого", "NAME"), []);
});

test("C04 delete confirmation states irreversibility and the real manifest", () => {
  const text = permanentDeleteDescription({ clientId: "a", displayName: "Анна", revision: 3,
    owners: [{ owner: "clients.profile", rows: 1 }, { owner: "clients.recoveryDrafts", rows: 1 },
      { owner: "clients.activity", rows: 0 }] });
  assert.match(text, /необратимо/u);
  assert.match(text, /карточка клиента; черновики формы: 1\./u);
  assert.doesNotMatch(text, /Недавно открытые/u);
});

test("CL-02 «Сегодня по расписанию»: только клиенты из фильтра, плоский список по времени записи", () => {
  const rows = [
    row("birthday", "Борис", "2000-10-18", "2026-10-17T09:00:00Z"),
    row("late", "Алина", null),
    row("early", "Вера", null),
    row("none", "Глеб", null),
  ];
  const starts = new Map([["late", 18 * 60], ["early", 9 * 60], ["birthday", 12 * 60]]);
  const result = presentClientRoster({ rows, search: "", sort: "NAME", today: "2026-10-17",
    birthday: settings, dismissals: [], todayStarts: starts });
  assert.equal(result.todayOnly, true);
  assert.deepEqual(result.birthday, []);
  assert.equal(result.recent, null);
  assert.deepEqual(result.regular.map((entry) => entry.client.id), ["early", "birthday", "late"]);
  // Поиск ищет только внутри сегодняшнего набора.
  const searched = presentClientRoster({ rows, search: "ве", sort: "NAME", today: "2026-10-17",
    birthday: settings, dismissals: [], todayStarts: starts });
  assert.deepEqual(searched.regular.map((entry) => entry.client.id), ["early"]);
  // Пустой набор — фильтр включён, но никого нет.
  const empty = presentClientRoster({ rows, search: "", sort: "NAME", today: "2026-10-17",
    birthday: settings, dismissals: [], todayStarts: new Map() });
  assert.equal(empty.todayOnly, true);
  assert.equal(empty.regular.length, 0);
});

test("Дата ближайшего дня рождения на закреплённой карточке", () => {
  const result = presentClientRoster({
    rows: [row("soon", "Алина", "2000-10-25"), row("tomorrow", "Борис", "1990-10-18"), row("today", "Вера", "1995-10-17")],
    search: "", sort: "NAME", today: "2026-10-17", birthday: settings, dismissals: [],
  });
  const text = new Map(result.birthday.map((entry) => [entry.client.id, entry.birthdayText]));
  assert.equal(text.get("today"), "Сегодня, 17 окт.");
  assert.equal(text.get("tomorrow"), "Завтра, 18 окт.");
  assert.equal(text.get("soon"), "25 окт., через 8 дн.");
});

test("UIX-02: сводка дня — занятия сегодня и на неделе, «кончается абонемент» при остатке 0…3 занятий", () => {
  const fact = (over: Partial<RosterClientOverview>): RosterClientOverview => ({ metrics: [], restricted: false, restrictionsKnown: true,
    creditStatus: "UNKNOWN", todayStartMinute: null, todayEndMinute: null, ...over });
  const overview = new Map<string, RosterClientOverview>([
    ["a", fact({ todayCount: 2, todayStartMinute: 600, weekCount: 5, creditsAvailable: 3, creditStatus: "AVAILABLE" })],
    ["b", fact({ todayCount: 0, weekCount: 1, creditsAvailable: 4, creditStatus: "AVAILABLE" })],
    ["c", fact({ todayCount: 1, todayStartMinute: 700, weekCount: 1, creditsAvailable: 0, creditStatus: "EMPTY" })],
    ["d", fact({ creditsAvailable: null, creditStatus: "NOT_TRACKED" })],
  ]);
  assert.deepEqual(summarizeRoster(overview, ["a", "b", "c", "d"]), { today: 3, week: 7, ending: 2, todayClients: 2, weekClients: 3 });
  assert.deepEqual(summarizeRoster(overview, ["b", "d"]), { today: 0, week: 1, ending: 0, todayClients: 0, weekClients: 1 }, "только видимые клиенты");
  assert.deepEqual(summarizeRoster(new Map(), ["a"]), { today: 0, week: 0, ending: 0, todayClients: 0, weekClients: 0 }, "нет данных — нули, не ошибка");
  assert.equal(CREDITS_ENDING_MAX, 3);
});

test("UIX-02: фильтр кольца складывается с остальными фильтрами; «Сегодня» упорядочен по началу записи", () => {
  const male = { ...row("m", "Михаил", null), sex: "MALE" as const };
  const female = { ...row("f", "Фаина", null), sex: "FEMALE" as const };
  const third = { ...row("z", "Захар", null), sex: "MALE" as const };
  const fact = (over: Partial<RosterClientOverview>): RosterClientOverview => ({ metrics: [], restricted: false, restrictionsKnown: true,
    creditStatus: "AVAILABLE", todayStartMinute: null, todayEndMinute: null, ...over });
  const overview = new Map<string, RosterClientOverview>([
    ["m", fact({ weekCount: 2, creditsAvailable: 3, todayStartMinute: 900, todayEndMinute: 960, todayCount: 1 })],
    ["f", fact({ weekCount: 1, creditsAvailable: 8, todayStartMinute: 600, todayEndMinute: 660, todayCount: 1 })],
    ["z", fact({ weekCount: 0, creditsAvailable: 2 })],
  ]);
  const base = { rows: [male, female, third], search: "", sort: "NAME" as const, today: "2026-10-17", birthday: settings, dismissals: [], overview };
  const names = (ring: "TODAY" | "WEEK" | "ENDING" | null, filters = EMPTY_ROSTER_FILTERS) =>
    presentClientRoster({ ...base, ring, filters }).regular.map((entry) => entry.client.id);
  assert.deepEqual(names(null), ["z", "m", "f"], "без кольца — по имени");
  assert.deepEqual(names("TODAY"), ["f", "m"], "по времени начала записи");
  assert.deepEqual(names("WEEK"), ["m", "f"], "есть занятия на неделе, по имени");
  assert.deepEqual(names("ENDING"), ["z", "m"], "остаток 3 и 2 занятия, по имени");
  assert.deepEqual(names("ENDING", { ...EMPTY_ROSTER_FILTERS, sex: "MALE" }), ["z", "m"]);
  assert.deepEqual(names("TODAY", { ...EMPTY_ROSTER_FILTERS, sex: "FEMALE" }), ["f"], "кольцо и лист пересекаются");
  assert.deepEqual(presentClientRoster({ ...base, ring: "WEEK" }).birthday, [], "при фильтре кольца именинник не закрепляется");
});
