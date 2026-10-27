import type { TrainingTransfer } from "../../../shared/training-transfer/TrainingTransfer.ts";
import { correctTransferIssue } from "./IssueCorrections.ts";
import { detectLegacyMapping, normalizeLegacyTable, type LegacyMapping } from "./LegacyExcel.ts";
import { transferReviewScopes, type TransferReviewScope } from "./TrainingTransferReview.ts";
import type { PickedWorkbook } from "./WorkbookFilesPort.ts";

export interface WorkbookReviewEntry {
  readonly viewWeek?: number;
  readonly issueInputs?: Readonly<Record<string, string>>;
  readonly header: number;
  readonly columns: LegacyMapping;
  readonly settingsOpen: boolean;
  readonly settingsDirty: boolean;
  readonly value: TrainingTransfer | null;
  readonly scope: TransferReviewScope | null;
  readonly mapping: Readonly<Record<string, string>>;
  readonly corrections: Readonly<Record<string, string>>;
  readonly error: string;
}
export interface WorkbookReviewSession {
  readonly selectedSheetIds: ReadonlySet<string>;
  readonly programTitle: string;
  readonly manualRequiredNames: ReadonlySet<string>;
  readonly nameMappings: ReadonlyMap<string, Readonly<{ targetId: string; origin: "MANUAL" | "HISTORY" }>>;
  readonly picked: PickedWorkbook;
  readonly planOnly: boolean;
  readonly sheets: readonly Readonly<{ id: string; label: string }>[];
  readonly activeId: string;
  readonly entries: Readonly<Record<string, WorkbookReviewEntry>>;
}

function onlySheet(input: TrainingTransfer, selected: TransferReviewScope, planOnly: boolean): TrainingTransfer {
  const slots = new Set(selected.weeks.flatMap((w) => w.workouts.map((item) => JSON.stringify([w.index, item.id]))));
  const sessions = planOnly ? [] : input.sessions.filter((s) => s.programId === selected.programId && slots.has(JSON.stringify([s.weekIndex, s.plannedWorkoutId])));
  const ids = new Set(selected.weeks.flatMap((w) => w.workouts.flatMap((item) => item.exercises.map((e) => e.exerciseId))));
  const targets = new Set([...selected.weeks.flatMap((w) => w.workouts.flatMap((item) => item.exercises.flatMap((e) => e.sets.map((s) => s.id)))), ...sessions.flatMap((s) => s.facts.map((f) => f.id))]);
  return { ...input, sessions, exercises: input.exercises.filter((e) => ids.has(e.id)), planHistory: [],
    issues: planOnly ? [] : input.issues?.filter((issue) => issue.programId === selected.programId && targets.has(issue.targetId)),
    programs: [{ ...input.programs.find((p) => p.id === selected.programId)!, kind: "PERIODIZED", simple: null, simpleWeeks: [],
      mesocycles: [{ id: selected.id, lineageId: selected.id, title: selected.title, ...selected.settings,
        weeks: selected.weeks.map((w) => ({ ...w, id: `${selected.id}:${w.index}`, type: w.type ?? "base" })) }] }] };
}

function prepare(session: WorkbookReviewSession, id: string, previous?: WorkbookReviewEntry): WorkbookReviewEntry {
  const index = Number(id);
  const table = session.picked.kind === "TABLES" ? session.picked.tables[index] : undefined;
  const detected = table ? detectLegacyMapping(table) : { header: 0, mapping: {} };
  const base: WorkbookReviewEntry = previous ?? { header: detected.header, columns: detected.mapping, settingsOpen: false,
    settingsDirty: false, value: null, scope: null, mapping: {}, corrections: {}, error: "" };
  try {
    let input: TrainingTransfer;
    let scope: TransferReviewScope | undefined;
    if (session.picked.kind === "TABLES" && table) {
      const mapping = session.planOnly ? { ...base.columns, actualReps: undefined, actualLoad: undefined,
        actualDuration: undefined, actualDistance: undefined, date: undefined } : base.columns;
      input = normalizeLegacyTable(table, session.picked.sourceId, base.header, mapping);
      scope = transferReviewScopes(input)[0];
    } else if (session.picked.kind === "TRANSFER") {
      input = session.picked.value;
      const scopeId = session.picked.planSheets?.[index]?.scopeId;
      scope = scopeId ? transferReviewScopes(input).find((item) => item.id === scopeId)
        : transferReviewScopes(input).filter((item) => item.programId !== null)[index];
    } else throw new Error("Лист больше недоступен.");
    if (!scope) throw new Error("На выбранном листе нет тренировок.");
    let value = onlySheet(input, scope, session.planOnly);
    for (const [issueId, correction] of Object.entries(base.corrections)) {
      if (value.issues?.some((issue) => issue.id === issueId)) value = correctTransferIssue(value, issueId, correction);
    }
    return { ...base, value, scope, settingsDirty: false, error: "" };
  } catch (error) {
    return { ...base, value: null, scope: null, settingsOpen: !table?.matrixSource,
      error: error instanceof Error ? error.message : "Не удалось открыть лист." };
  }
}

export function startWorkbookReview(picked: PickedWorkbook, planOnly: boolean): WorkbookReviewSession {
  const sheets = picked.kind === "TABLES" ? picked.tables.map((table, index) => ({ id: String(index), label: table.name }))
    : picked.planSheets?.map((sheet, index) => ({ id: String(index), label: sheet.name }))
      ?? transferReviewScopes(picked.value).filter((scope) => scope.programId !== null).map((scope, index) => ({ id: String(index), label: scope.title }));
  if (!sheets.length) throw new Error("В файле нет листов с программами тренировок.");
  const programTitle = picked.filename?.replace(/\.xlsx?$/iu, "").trim()
    || (picked.kind === "TRANSFER" && picked.value.programs.length === 1 ? picked.value.programs[0]!.title : "Программа из Excel");
  const selectedSheetIds = new Set(sheets.filter(({ id }) => {
    if (picked.kind !== "TABLES") return true;
    const table = picked.tables[Number(id)]!;
    return !(table.matrixSource && table.rows.length <= 1) && table.rows.some((row) => row.some((v) => v != null && String(v).trim() !== ""));
  }).map((s) => s.id));
  const result: WorkbookReviewSession = { picked, planOnly, sheets, selectedSheetIds, programTitle, activeId: sheets[0]!.id, entries: {}, nameMappings: new Map(), manualRequiredNames: new Set() };
  return { ...result, entries: { [result.activeId]: prepare(result, result.activeId) } };
}

export function selectWorkbookSheet(session: WorkbookReviewSession, id: string): WorkbookReviewSession {
  if (!session.sheets.some((sheet) => sheet.id === id)) throw new Error("Лист не найден.");
  return applyWorkbookNameMappings({ ...session, activeId: id, entries: session.entries[id] ? session.entries : { ...session.entries, [id]: prepare(session, id) } });
}

export function updateWorkbookEntry(session: WorkbookReviewSession, patch: Partial<WorkbookReviewEntry>): WorkbookReviewSession {
  return { ...session, entries: { ...session.entries, [session.activeId]: { ...session.entries[session.activeId]!, ...patch } } };
}

export function applyWorkbookColumns(session: WorkbookReviewSession): WorkbookReviewSession {
  return applyWorkbookNameMappings({ ...session, entries: { ...session.entries, [session.activeId]: prepare(session, session.activeId, session.entries[session.activeId]) } });
}

export function applyWorkbookNameMappings(session: WorkbookReviewSession): WorkbookReviewSession {
  let changed = false;
  const entries = Object.fromEntries(Object.entries(session.entries).map(([id, entry]) => {
    const mapping = { ...entry.mapping }; let entryChanged = false;
    for (const exercise of entry.value?.exercises ?? []) {
      const match = session.nameMappings.get(exercise.name.trim());
      if (match && mapping[exercise.id] !== match.targetId) { mapping[exercise.id] = match.targetId; entryChanged = true; }
    }
    changed ||= entryChanged;
    return [id, entryChanged ? { ...entry, mapping } : entry];
  }));
  return changed ? { ...session, entries } : session;
}

/** Literal source names are also used for initial automatic matching; do not fold case, ё or spacing. */
export function autoMatchWorkbookEntry(session: WorkbookReviewSession,
  candidates: readonly Readonly<{ id: string; name: string; available: boolean }>[]): WorkbookReviewSession {
  const entry = session.entries[session.activeId]!;
  const mapping = { ...entry.mapping };
  for (const exercise of entry.value?.exercises ?? []) {
    if (mapping[exercise.id] || session.manualRequiredNames.has(exercise.name.trim())) continue;
    const exact = candidates.filter((candidate) => candidate.available
      && (candidate.id === exercise.id || candidate.name.trim() === exercise.name.trim()));
    if (exact.length === 1) mapping[exercise.id] = exact[0]!.id;
  }
  return applyWorkbookNameMappings(updateWorkbookEntry(session, { mapping }));
}

export function setWorkbookNameMatch(session: WorkbookReviewSession, sourceName: string, targetId: string,
  origin: "MANUAL" | "HISTORY" = "MANUAL"): WorkbookReviewSession {
  const name = sourceName.trim();
  if (!name || !targetId) throw new Error("Выберите упражнение для сопоставления.");
  if (origin === "HISTORY" && session.nameMappings.get(name)?.origin === "MANUAL") return session;
  const manualRequiredNames = new Set(session.manualRequiredNames); manualRequiredNames.delete(name);
  return applyWorkbookNameMappings({ ...session, manualRequiredNames, nameMappings: new Map(session.nameMappings).set(name, { targetId, origin }) });
}

export function requireWorkbookNameChoices(session: WorkbookReviewSession, names: readonly string[]): WorkbookReviewSession {
  const blocked = new Set([...session.manualRequiredNames, ...names.filter((name) => session.nameMappings.get(name)?.origin !== "MANUAL")]);
  const entries = Object.fromEntries(Object.entries(session.entries).map(([id, entry]) => {
    const mapping = { ...entry.mapping };
    for (const exercise of entry.value?.exercises ?? []) if (blocked.has(exercise.name.trim())) delete mapping[exercise.id];
    return [id, { ...entry, mapping }];
  }));
  return { ...session, entries, manualRequiredNames: blocked };
}

/** Read all recognized names for one initial history proposal, without opening or resetting other tabs. */
export function workbookSourceNames(session: WorkbookReviewSession): readonly string[] {
  return [...new Set(session.sheets.flatMap(({ id }) => (session.entries[id] ?? prepare(session, id)).value?.exercises.map((e) => e.name.trim()) ?? []))];
}

export function workbookMatchesToRemember(session: WorkbookReviewSession, wholeBook = false): readonly Readonly<{ sourceName: string; targetId: string }>[] {
  const entries = wholeBook ? session.sheets.filter((s) => session.selectedSheetIds.has(s.id)).map((s) => session.entries[s.id]) : [session.entries[session.activeId]];
  const names = new Set(entries.flatMap((entry) => entry?.value?.exercises.map((e) => e.name.trim()) ?? []));
  return [...session.nameMappings].filter(([name, match]) => names.has(name) && match.origin === "MANUAL")
    .map(([sourceName, { targetId }]) => ({ sourceName, targetId }));
}

export function selectWorkbookImportSheets(session: WorkbookReviewSession, ids: readonly string[]): WorkbookReviewSession {
  const selectedSheetIds = new Set(ids.filter((id) => session.sheets.some((s) => s.id === id) && !emptyWorkbookSheet(session, id)));
  return { ...session, selectedSheetIds };
}

export function emptyWorkbookSheet(session: WorkbookReviewSession, id: string): boolean {
  if (session.picked.kind !== "TABLES") return false;
  const table = session.picked.tables[Number(id)];
  return !!table && (!!table.matrixSource && table.rows.length <= 1 || table.rows.every((row) => row.every((v) => v == null || String(v).trim() === "")));
}

export function correctWorkbookValue(session: WorkbookReviewSession, id: string, correction: string): WorkbookReviewSession {
  const current = session.entries[session.activeId]!;
  if (!current.value) throw new Error("Сначала откройте лист.");
  return updateWorkbookEntry(session, { value: correctTransferIssue(current.value, id, correction),
    corrections: { ...current.corrections, [id]: correction } });
}
