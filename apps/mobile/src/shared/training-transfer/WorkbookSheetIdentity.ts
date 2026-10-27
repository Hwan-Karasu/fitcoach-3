import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { TransferCycle, TransferSession } from "./TrainingTransfer.ts";
import { canonicalJson } from "./CanonicalJson.ts";

export function workbookSheetHash(cycle: TransferCycle, sessions: readonly TransferSession[], mapping: Readonly<Record<string, string>>): string {
  const workouts = new Set(cycle.weeks.flatMap((w) => w.workouts.map((x) => x.id)));
  const facts = sessions.filter((s) => workouts.has(s.plannedWorkoutId));
  const names = new Set([...cycle.weeks.flatMap((w) => w.workouts.flatMap((x) => x.exercises.map((e) => e.exerciseId))), ...facts.flatMap((s) => s.facts.map((f) => f.exerciseId))]);
  return bytesToHex(sha256(utf8ToBytes(canonicalJson([{ ...cycle, cycleType: cycle.cycleType ?? null, repRange: cycle.repRange ?? null, startDate: cycle.startDate ?? null },
    facts.map((s) => ({ ...s, programId: "source" })), Object.fromEntries(Object.entries(mapping).filter(([id]) => names.has(id)))]))));
}
