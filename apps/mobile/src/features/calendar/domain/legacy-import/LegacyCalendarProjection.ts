import type { CandidateIdentityContext } from "../../../../shared/migration/LegacyIdentityBinding.ts";
import { LEGACY_CALENDAR_COLUMNS, type CalendarRaw, type LegacyCalendarSnapshot } from "../../../../shared/migration/LegacyCalendarSources.ts";
import { isExplicitTimestamp } from "../../../../shared/migration/LegacyValues.ts";
import { isLocalDate, overlaps } from "../CalendarRules.ts";
import { parseSourceJson } from "../../../../shared/migration/SourceJson.ts";

export type CalendarIdentityKind = "SESSION_TYPE" | "APPOINTMENT" | "INTERVAL";
export type CalendarRow = Record<string, string | number | null>;
class MappingIssue extends Error {}
class NumericToken { readonly text: string; constructor(text: string) { this.text = text; } }
const issue = (code: string): never => { throw new MappingIssue(code); };
const fail = (code: string): never => { throw new Error(`R04_ID_LEDGER_CALENDAR_${code}`); };
const object = (value: unknown): CalendarRaw => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof NumericToken) ? value as CalendarRaw : issue("OBJECT_UNSUPPORTED");
const nonempty = (value: unknown): string => typeof value === "string" && value.trim() ? value : issue("TEXT_UNSUPPORTED");
const date = (value: unknown): string => typeof value === "string" && isLocalDate(value) ? value : issue("DATE_UNSUPPORTED");
function minute(value: unknown): number {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) return issue("TIME_UNSUPPORTED");
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
function json(value: unknown): CalendarRaw {
  if (typeof value !== "string") return issue("PLANNER_JSON_UNSUPPORTED");
  try { return object(parseSourceJson(value, (_key, source) => new NumericToken(source))); }
  catch (error) { if (error instanceof SyntaxError) return issue("PLANNER_JSON_UNREADABLE"); throw error; }
}
function jsonInteger(value: unknown, min: number, max: number): number {
  if (!(value instanceof NumericToken) || !/^(?:0|[1-9]\d*)(?:\.0+)?$/u.test(value.text)) return issue("PLANNER_NUMBER_UNSUPPORTED");
  const n = Number(value.text); return Number.isSafeInteger(n) && n >= min && n <= max ? n : issue("PLANNER_NUMBER_UNSUPPORTED");
}
const types = new Map<string, { name: string; catalogName: string; category: string; seed: string; credit: number }>([
  ["training", { name: "Тренировка", catalogName: "Персональная тренировка", category: "TRAINING", seed: "personal", credit: 1 }],
  ["guest_visit", { name: "Гостевой визит", catalogName: "Гостевой визит", category: "OTHER", seed: "guest", credit: 0 }],
  ["initial_instruction", { name: "Первичный инструктаж", catalogName: "Первичный инструктаж", category: "INSTRUCTION", seed: "instruction", credit: 0 }],
]);
const newCatalogDefaults = [...types.values(), { name: "Консультация", catalogName: "Консультация", category: "CONSULTATION", seed: "consultation", credit: 0 }];
export function composeLegacyCalendar(context: CandidateIdentityContext, importedAt: string, source: LegacyCalendarSnapshot, clients: ReadonlyMap<string, string>,
  identity: (kind: CalendarIdentityKind, key: string) => string) {
  const tables: Record<string, CalendarRow[]> = { session_types: [], calendar_settings: [], calendar_appointments: [], calendar_intervals: [],
    accounting_settings: [{ workspace_id: context.targetWorkspaceId, default_mode: "UNTRACKED" }] };
  const representations: { sourceKey: string; targetIds: readonly string[]; issues: string[]; metadata: Record<string, unknown> }[] = [];
  const key = (...parts: readonly unknown[]) => JSON.stringify([context.accountScope, ...parts]);
  function retain(sourceKey: string, metadata: Record<string, unknown>, run: () => readonly string[], warnings: readonly string[] = []) {
    try { representations.push({ sourceKey, targetIds: run(), issues: [...warnings], metadata }); }
    catch (error) { if (!(error instanceof MappingIssue)) throw error; representations.push({ sourceKey, targetIds: [], issues: [...warnings, error.message], metadata }); }
  }
  const seen = new Set<string>(), typeIds = new Map<string, string>();
  // Standard 3.x first-setup catalog, not legacy facts. Installing planner settings
  // suppresses runtime seeding, so all four defaults must already be present.
  for (const type of newCatalogDefaults) {
    const typeId = identity("SESSION_TYPE", key("calendar_seed", type.seed)); typeIds.set(type.seed, typeId);
    tables.session_types!.push({ id: typeId, workspace_id: context.targetWorkspaceId, seed_key: type.seed, name: type.catalogName, category: type.category,
      default_duration_minutes: 60, requires_credit: type.credit, archived_at: null, created_at: importedAt, color: null });
  }
  const rows = (source.appointments ?? []).map((row) => {
    if (typeof row.id !== "string" || !row.id.trim()) return fail("IDENTITY_INVALID");
    const sourceKey = key("calendar_appointments", row.id); if (seen.has(sourceKey)) return fail("DUPLICATE_SOURCE_KEY"); seen.add(sourceKey);
    return { row, sourceKey };
  }).sort((a, b) => a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0);
  for (const { row, sourceKey } of rows) {
    const warnings: string[] = [];
    const unknownFields = Object.keys(row).filter((name) => !(LEGACY_CALENDAR_COLUMNS as readonly string[]).includes(name)).sort();
    if (unknownFields.some((name) => row[name] != null)) warnings.push("UNMAPPED_APPOINTMENT_FIELDS");
    if (typeof row.note === "string" && row.note.length > 1000) warnings.push("NOTE_EXCEEDS_CURRENT_EDITOR_LIMIT");
    if (typeof row.guest_name === "string" && row.guest_name.length > 120) warnings.push("GUEST_EXCEEDS_CURRENT_EDITOR_LIMIT");
    if (typeof row.duration_minutes === "number" && row.duration_minutes > 0 && row.duration_minutes % 30 === 0 && ![30, 60, 90, 120].includes(row.duration_minutes)) warnings.push("DURATION_EXCEEDS_CURRENT_EDITOR_OPTIONS");
    const metadata: Record<string, unknown> = { unknownFields, sourceClientName: row.client_name ?? null, sourceCreatedAt: row.created_at ?? null, sourceUpdatedAt: row.updated_at ?? null,
      createdAtBasis: isExplicitTimestamp(row.created_at) ? "SOURCE_TIMESTAMP" : "IMPORT_TIME", updatedAtBasis: isExplicitTimestamp(row.updated_at) ? "SOURCE_TIMESTAMP" : "IMPORT_TIME",
      lifecycleBasis: row.deleted_at === null ? "SOURCE_ACTIVE_SCHEDULE" : "SOURCE_SOFT_DELETE_ONLY", outcomeBasis: "UNKNOWN_NOT_INFERRED", creditBasis: "NO_SUPPORTED_SOURCE_ACCOUNTING" };
    retain(sourceKey, metadata, () => {
      for (const field of ["status", "outcome", "completed_at", "missed_at", "cancelled_at", "paid", "paid_at", "pack_id", "payment_id", "requires_credit", "credit_bypass", "accounting_mode"]) if (row[field] != null && row[field] !== "") return issue("STATUS_OR_BILLING_SOURCE_UNVERIFIED");
      const localDate = date(row.date_key), start = minute(row.start_time), end = minute(row.end_time), duration = row.duration_minutes;
      if (typeof duration !== "number" || !Number.isSafeInteger(duration) || duration <= 0 || duration % 30 !== 0 || start % 30 !== 0) return issue("TIME_GRID_UNREPRESENTABLE");
      if ((start + duration) % 1440 !== end) return issue("END_TIME_MISMATCH");
      if (start + duration > 1440) return issue("OVERNIGHT_STORAGE_REQUIRED");
      if (row.client_id !== null && typeof row.client_id !== "string" || typeof row.guest_name !== "string") return issue("PARTICIPANT_UNREPRESENTABLE");
      const clientSource = typeof row.client_id === "string" && row.client_id.trim() ? row.client_id : null;
      const guest = typeof row.guest_name === "string" && row.guest_name.trim() ? row.guest_name : null;
      if (clientSource !== null && guest !== null) return issue("PARTICIPANT_AMBIGUOUS");
      const clientId = clientSource === null ? null : clients.get(clientSource);
      if (clientId === undefined || clientId === null && guest === null) return issue("PARTICIPANT_UNRESOLVED");
      if (typeof row.note !== "string") return issue("NOTE_UNSUPPORTED");
      const removed = row.deleted_at !== null;
      if (removed && !isExplicitTimestamp(row.deleted_at)) return issue("DELETION_TIME_UNREPRESENTABLE");
      const code = nonempty(row.appointment_type), type = types.get(code); if (!type) return issue("TYPE_UNSUPPORTED");
      const typeId = typeIds.get(type.seed)!;
      const targetId = identity("APPOINTMENT", sourceKey);
      tables.calendar_appointments!.push({ id: targetId, workspace_id: context.targetWorkspaceId, local_date: localDate, start_minute: start, duration_minutes: duration,
        client_id: clientId, guest_name: guest, participant_deleted: 0, session_type_id: typeId, session_type_name: type.name, session_type_category: type.category,
        session_type_requires_credit: type.credit, note: row.note, lifecycle: removed ? "CANCELLED" : "SCHEDULED", revision: 1,
        created_at: isExplicitTimestamp(row.created_at) ? row.created_at : importedAt, updated_at: isExplicitTimestamp(row.updated_at) ? row.updated_at : importedAt,
        cancelled_at: removed ? row.deleted_at as string : null, credit_bypass: 1, outcome: null, outcome_at: null });
      Object.assign(metadata, { targetTypeBasis: "LEGACY_ENUM_TO_3X_SEED", importedCreditPolicyBasis: "NEW_3X_TYPE_POLICY_WITH_LEGACY_BYPASS", targetCancelledAtBasis: removed ? "SOURCE_SOFT_DELETE_TIME_NOT_OUTCOME" : null });
      return [targetId, typeId];
    }, warnings);
  }
  for (const appointment of tables.calendar_appointments!) {
    const others = tables.calendar_appointments!.filter((other) => other.id !== appointment.id && other.lifecycle !== "CANCELLED" && appointment.lifecycle !== "CANCELLED"
      && other.local_date === appointment.local_date && overlaps(other.start_minute as number, (other.start_minute as number) + (other.duration_minutes as number), appointment.start_minute as number, (appointment.start_minute as number) + (appointment.duration_minutes as number))).map((other) => other.id as string);
    if (others.length) representations.find((r) => r.targetIds[0] === appointment.id)!.metadata.overlappingActiveIds = others.sort();
  }
  if (source.plannerRows !== null && source.plannerRows.length > 1) return fail("DUPLICATE_PLANNER_KEY");
  for (const row of source.plannerRows ?? []) {
    if (row.key !== "calendar_planner_settings") return fail("PLANNER_OWNER_INVALID");
    const sourceKey = key("app_settings", "calendar_planner_settings"), parsed: { value?: CalendarRaw } = {};
    retain(sourceKey, { coverage: "CALENDAR_OWNED_KEY_ONLY", sourceUpdatedAt: row.updated_at ?? null }, () => { parsed.value = json(row.value); return []; });
    if (!parsed.value) continue; const settings = parsed.value;
    retain(key("planner_display"), { sourceEndHourBasis: "INCLUSIVE_HOUR", newPolicyFieldsBasis: "NEW_3X_DEFAULTS" }, () => {
      const start = jsonInteger(settings.startHour, 7, 22), end = jsonInteger(settings.endHour, 7, 22);
      if (start > end || !Array.isArray(settings.workingDays) || !settings.workingDays.length) return issue("PLANNER_DISPLAY_UNREPRESENTABLE");
      const days = settings.workingDays.map((day) => jsonInteger(day, 0, 6)); if (new Set(days).size !== days.length) return issue("PLANNER_DISPLAY_UNREPRESENTABLE");
      tables.calendar_settings!.push({ workspace_id: context.targetWorkspaceId, day_start_minute: start * 60, day_end_minute: (end + 1) * 60,
        visible_weekdays: [1, 2, 3, 4, 5, 6, 0].map((day) => days.includes(day) ? "1" : "0").join(""), default_session_type_id: typeIds.get("personal")!,
        copy_appointments: 1, copy_duty: 1, copy_blocked: 1, clear_appointments: 1, clear_duty: 1, clear_blocked: 1, undo_cancel_prompt: 1 }); return [];
    });
    for (const [field, kind] of [["dutySlots", "DUTY"], ["blockedSlots", "BLOCKED"]] as const) retain(key(field), { representation: "EXPLICIT_HOUR_FLAGS" }, () => {
      const flags = object(settings[field]);
      for (const day of Object.keys(flags).sort()) retain(key(field, day), {}, () => {
        const localDate = date(day), slots = object(flags[day]);
        for (const time of Object.keys(slots).sort()) retain(key(field, day, time), { sourceEnabled: typeof slots[time] === "boolean" ? slots[time] : "UNSUPPORTED_VALUE" }, () => {
          if (!/^(?:[01]\d|2[0-3]):00$/u.test(time)) return issue("PLANNER_HOUR_FLAG_UNREPRESENTABLE");
          if (slots[time] === false) return [];
          if (slots[time] !== true) return issue("PLANNER_FLAG_UNSUPPORTED");
          const targetId = identity("INTERVAL", key(field, day, time)), start = minute(time);
          tables.calendar_intervals!.push({ id: targetId, workspace_id: context.targetWorkspaceId, kind, local_date: localDate, start_minute: start, end_minute: start + 60, created_at: importedAt }); return [targetId];
        }); return [];
      }); return [];
    });
  }
  return { tables, representations: representations.sort((a, b) => a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0) };
}
