import type { CreateProgramInput, ProgramCard, ProgramKind } from "./ProgramModel.ts";

export const PROGRAM_TITLE_MAX = 80;

export const programKindLabels: Readonly<Record<ProgramKind, string>> = {
  SIMPLE: "Простая",
  PERIODIZED: "Расширенная",
};

/** Название обязательно и без пробелов по краям. Ошибка — `DRAFT_INVALID`. */
export function normalizeTitle(title: string): string {
  const value = title.trim().replace(/\s+/g, " ");
  if (value.length === 0 || value.length > PROGRAM_TITLE_MAX) throw new Error("DRAFT_INVALID");
  return value;
}

/**
 * §48.1, §48.2: простая программа — ровно один клиент, расширенная — один или несколько выбранных.
 * Повторы участников убираются, порядок первого упоминания сохраняется.
 */
export function validateCreate(input: CreateProgramInput): CreateProgramInput {
  const clientIds = [...new Set(input.clientIds.map((id) => id.trim()).filter((id) => id.length > 0))];
  if (clientIds.length === 0) throw new Error("DRAFT_INVALID");
  if (input.kind === "SIMPLE" && clientIds.length !== 1) throw new Error("PARTICIPANT_CONFLICT");
  return { kind: input.kind, title: normalizeTitle(input.title), clientIds };
}

/** Новые сверху; при одинаковом времени — по названию, чтобы порядок не прыгал. */
export function compareCards(a: ProgramCard, b: ProgramCard): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.title.localeCompare(b.title, "ru");
}

/** Библиотека: новые (ещё не упорядоченные) сверху, затем — в порядке, заданном перетаскиванием. */
export function compareLibrary(a: ProgramCard, b: ProgramCard): number {
  if (a.sortPosition === null || b.sortPosition === null) {
    if (a.sortPosition !== b.sortPosition) return a.sortPosition === null ? -1 : 1;
    return compareCards(a, b);
  }
  return a.sortPosition - b.sortPosition;
}

/** A reorder must contain every current item exactly once. */
export function validateOrder(currentIds: readonly string[], orderedIds: readonly string[]): void {
  const current = new Set(currentIds);
  if (orderedIds.some((id) => !current.has(id))) throw new Error("TARGET_NOT_FOUND");
  if (orderedIds.length !== currentIds.length || new Set(orderedIds).size !== orderedIds.length) {
    throw new Error("DRAFT_INVALID");
  }
}

export function membersWord(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return `${count} участников`;
  if (count % 10 === 1) return `${count} участник`;
  return count % 10 >= 2 && count % 10 <= 4 ? `${count} участника` : `${count} участников`;
}
