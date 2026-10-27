import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { TransferCycle, TransferSession, TrainingTransfer } from "./TrainingTransfer.ts";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function workbookSheetHash(cycle: TransferCycle, sessions: readonly TransferSession[], mapping: Readonly<Record<string, string>>): string {
  const workouts = new Set(cycle.weeks.flatMap((w) => w.workouts.map((x) => x.id)));
  const facts = sessions.filter((s) => workouts.has(s.plannedWorkoutId));
  const names = new Set([...cycle.weeks.flatMap((w) => w.workouts.flatMap((x) => x.exercises.map((e) => e.exerciseId))), ...facts.flatMap((s) => s.facts.map((f) => f.exerciseId))]);
  return bytesToHex(sha256(utf8ToBytes(canonical([{ ...cycle, cycleType: cycle.cycleType ?? null, repRange: cycle.repRange ?? null, startDate: cycle.startDate ?? null },
    facts.map((s) => ({ ...s, programId: "source" })), Object.fromEntries(Object.entries(mapping).filter(([id]) => names.has(id)))]))));
}
export function workbookCycleSnapshot(value: TrainingTransfer, id: string): unknown {
  const cycle = value.programs.flatMap((p) => p.mesocycles).find((c) => c.id === id);
  const workouts = new Set(cycle?.weeks.flatMap((w) => w.workouts.map((x) => x.id)) ?? []);
  return { cycle, sessions: value.sessions.filter((s) => workouts.has(s.plannedWorkoutId)) };
}
