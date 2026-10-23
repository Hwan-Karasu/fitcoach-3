import { backupFilename, publicationTreeUri, type BackupDestination, type PublishedBackup } from "./BackupPublication.ts";
import { parseBackupLocation } from "./ManualBackupPort.ts";

export const AUTO_BACKUP_INTERVAL = 30 * 60 * 1000;
export type AutomaticBackupErrorCode = "AUTO_UNAVAILABLE" | "AUTO_NOT_READY" | "AUTO_FOLDER_UNAVAILABLE" | "AUTO_SOURCE_UNAVAILABLE"
  | "AUTO_VERIFICATION_FAILED" | "AUTO_STATE_UNAVAILABLE" | "AUTO_CLOCK_CHANGED" | "AUTO_CLEANUP_PENDING";
export class AutomaticBackupError extends Error {
  readonly code: AutomaticBackupErrorCode;
  constructor(code: AutomaticBackupErrorCode) { super(code); this.code = code; }
}
export interface PendingAutomatic {
  readonly backupId: string;
  readonly createdAt: string;
  readonly contentSha256: string;
  readonly sha256: string;
  readonly bytes: number;
}
export interface AutomaticEntry extends PendingAutomatic, PublishedBackup {
  readonly sequence: number;
  readonly completedAt: string;
  readonly day: string;
  readonly offsetMinutes: number;
}
export interface AutomaticCatalog {
  readonly version: 1;
  readonly destination: BackupDestination;
  readonly sequence: number;
  readonly checkedAt: number;
  readonly entries: readonly AutomaticEntry[];
  readonly retired: readonly AutomaticEntry[];
  readonly pending: PendingAutomatic | null;
}
export interface AutomaticBackupStore {
  read(): Promise<AutomaticCatalog | null>;
  readFailure(): Promise<AutomaticFailure | null>;
  writeFailure(failure: AutomaticFailure | null): Promise<void>;
  /** Preserve old location metadata/pending work before changing the managed destination. */
  archive(catalog: AutomaticCatalog): Promise<void>;
  /** Atomic publication plus exact readback; failure never authorizes deleting a file. */
  write(catalog: AutomaticCatalog): Promise<void>;
}
export interface AutomaticFailure { readonly code: AutomaticBackupErrorCode; readonly at: number }
export function parseAutomaticFailure(value: unknown): AutomaticFailure | null {
  if (value === null) return null;
  const f = object(value, "at,code");
  const codes: readonly unknown[] = ["AUTO_UNAVAILABLE", "AUTO_NOT_READY", "AUTO_FOLDER_UNAVAILABLE", "AUTO_SOURCE_UNAVAILABLE",
    "AUTO_VERIFICATION_FAILED", "AUTO_STATE_UNAVAILABLE", "AUTO_CLOCK_CHANGED", "AUTO_CLEANUP_PENDING"];
  if (!codes.includes(f.code) || typeof f.at !== "number" || !Number.isSafeInteger(f.at) || f.at < 0) invalid();
  return { code: f.code as AutomaticBackupErrorCode, at: f.at };
}
export interface AutomaticBackupFiles {
  readonly available: boolean;
  prepare(previousContentSha256: string | null): Promise<PendingAutomatic | null>;
  /** Idempotent native publication, bound to its private ownership receipt. */
  publish(pending: PendingAutomatic, destination: BackupDestination): Promise<PublishedBackup>;
  /** MISSING requires exact native ownership plus proven absence; access/IO errors throw. */
  inspect(entry: AutomaticEntry): Promise<"VALID" | "MISSING">;
  verify(entry: AutomaticEntry): Promise<void>;
  /** Only the native receipt's exact auto file. Manual/foreign files are ineligible. */
  remove(entry: AutomaticEntry): Promise<void>;
  cleanup(backupId: string): Promise<void>;
}
export interface AutomaticBackupState {
  readonly available: boolean;
  readonly phase: "IDLE" | "CHECKING" | "PREPARING" | "PUBLISHING";
  readonly nextCheckAt: number | null;
  readonly lastSaved: Readonly<{ createdAt: string; filename: string; day: string }> | null;
  readonly versions: number;
  readonly error: AutomaticBackupErrorCode | null;
}
export interface AutomaticBackupPort {
  readonly state: AutomaticBackupState;
  subscribe(listener: () => void): () => void;
  check(): Promise<void>;
  retry(): Promise<void>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const sha = /^[a-f0-9]{64}$/u;
function invalid(): never { throw new AutomaticBackupError("AUTO_STATE_UNAVAILABLE"); }
function object(value: unknown, keys: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== keys) invalid();
  return value as Record<string, unknown>;
}
function date(value: unknown): string {
  if (typeof value !== "string") invalid();
  try { if (new Date(value).toISOString() === value) return value; } catch { /* Invalid date. */ }
  return invalid();
}
export function parsePendingAutomatic(value: unknown): PendingAutomatic {
  const p = object(value, "backupId,bytes,contentSha256,createdAt,sha256");
  if (typeof p.backupId !== "string" || !uuid.test(p.backupId) || typeof p.sha256 !== "string" || !sha.test(p.sha256) ||
    typeof p.contentSha256 !== "string" || !sha.test(p.contentSha256) || typeof p.bytes !== "number" || !Number.isSafeInteger(p.bytes) || p.bytes < 100) invalid();
  return { backupId: p.backupId, createdAt: date(p.createdAt), contentSha256: p.contentSha256, sha256: p.sha256, bytes: p.bytes };
}
export function automaticFilename(pending: Pick<PendingAutomatic, "backupId" | "createdAt">): string {
  return backupFilename(pending).replace("athlete-diary-", "athlete-diary-auto-");
}
export function parseAutomaticPublication(value: unknown, p: PendingAutomatic): PublishedBackup {
  const r = object(value, "bytes,filename,sha256,uri");
  if (typeof r.uri !== "string" || r.uri.length > 8192 || !/^content:\/\/[a-zA-Z0-9._-]+\//u.test(r.uri) || r.bytes !== p.bytes || r.sha256 !== p.sha256 || r.filename !== automaticFilename(p)) invalid();
  return { uri: r.uri, filename: r.filename as string, bytes: p.bytes, sha256: p.sha256 };
}
export function automaticDay(utc: string, offsetMinutes: number): string {
  if (!Number.isSafeInteger(offsetMinutes) || Math.abs(offsetMinutes) > 14 * 60) invalid();
  return new Date(new Date(date(utc)).getTime() - offsetMinutes * 60_000).toISOString().slice(0, 10);
}
function entry(value: unknown): AutomaticEntry {
  const e = object(value, "backupId,bytes,completedAt,contentSha256,createdAt,day,filename,offsetMinutes,sequence,sha256,uri");
  const pending = parsePendingAutomatic({ backupId: e.backupId, bytes: e.bytes, contentSha256: e.contentSha256, createdAt: e.createdAt, sha256: e.sha256 });
  const publication = parseAutomaticPublication({ uri: e.uri, filename: e.filename, bytes: e.bytes, sha256: e.sha256 }, pending);
  if (typeof e.sequence !== "number" || !Number.isSafeInteger(e.sequence) || e.sequence < 1 || typeof e.offsetMinutes !== "number") invalid();
  const completedAt = date(e.completedAt);
  if (automaticDay(completedAt, e.offsetMinutes) !== e.day) invalid();
  return { ...pending, ...publication, completedAt, day: e.day as string, offsetMinutes: e.offsetMinutes, sequence: e.sequence };
}
export function parseAutomaticCatalog(value: unknown): AutomaticCatalog {
  const c = object(value, "checkedAt,destination,entries,pending,retired,sequence,version");
  if (c.version !== 1 || typeof c.sequence !== "number" || !Number.isSafeInteger(c.sequence) || c.sequence < 0 ||
    typeof c.checkedAt !== "number" || !Number.isSafeInteger(c.checkedAt) || c.checkedAt < 0 || !Array.isArray(c.entries) || c.entries.length > 3 ||
    !Array.isArray(c.retired) || c.retired.length > 3) invalid();
  let destination: BackupDestination;
  try { destination = parseBackupLocation({ version: 1, ...object(c.destination, (c.destination as { kind?: unknown })?.kind === "DIRECTORY" ? "kind,uri" : "kind") }); }
  catch { return invalid(); }
  const entries = c.entries.map(entry); const retired = c.retired.map(entry); const all = [...entries, ...retired];
  if (all.some((e) => e.sequence > (c.sequence as number)) || new Set(all.map((e) => e.backupId)).size !== all.length ||
    new Set(all.map((e) => e.sequence)).size !== all.length || entries.some((e, i) => i > 0 && entries[i - 1]!.sequence <= e.sequence) ||
    new Set(entries.map((e) => e.day)).size !== entries.length) invalid();
  const pending = c.pending === null ? null : parsePendingAutomatic(c.pending);
  if (pending !== null && all.some((e) => e.backupId === pending.backupId)) invalid();
  return { version: 1, destination, sequence: c.sequence, checkedAt: c.checkedAt, entries, retired, pending };
}
export function sameBackupDestination(a: BackupDestination, b: BackupDestination): boolean {
  return a.kind === b.kind && publicationTreeUri(a) === publicationTreeUri(b);
}
/** Success sequence, not wall time, determines freshness. Fallback retains the latest
 * available distinct older days in vacant historical slots, never labels them yesterday.
 * An ambiguous clock/zone stops publication/rotation before deleting any history. */
export function automaticRetention(entries: readonly AutomaticEntry[], completedAt: string, offsetMinutes: number): readonly AutomaticEntry[] {
  const latest = entries[0];
  if (latest && (completedAt < latest.completedAt || offsetMinutes !== latest.offsetMinutes)) throw new AutomaticBackupError("AUTO_CLOCK_CHANGED");
  const day = automaticDay(completedAt, offsetMinutes);
  const previous = [1, 2].map((n) => new Date(Date.parse(`${day}T00:00:00.000Z`) - n * 86_400_000).toISOString().slice(0, 10));
  const older = entries.filter((e) => e.day !== day); const kept: AutomaticEntry[] = [];
  for (const d of previous) { const e = older.find((item) => item.day === d); if (e) kept.push(e); }
  for (const e of older) if (kept.length < 2 && !kept.includes(e)) kept.push(e);
  return kept.sort((a, b) => b.sequence - a.sequence);
}
