import { durationText } from "../../../../shared/format/clockText.ts";
import { sessionDurationSec } from "./ExecutionRules.ts";

/**
 * Строка под отметками времени в шапке дневника: длительность, подсказка про дату или пусто. Экран всегда резервирует
 * под неё одну строку, поэтому высота шапки не зависит от данных недели и прокрутка при смене недели не прыгает.
 */
export function diaryTimeNote(session: Readonly<{ actualDate: string | null; startedAt: string | null; finishedAt: string | null }>): string {
  if (session.startedAt !== null && session.finishedAt !== null) {
    const seconds = sessionDurationSec(session.startedAt, session.finishedAt);
    return seconds === null ? "Длительность: нет данных" : durationText(seconds);
  }
  return session.actualDate === null ? "Для времени сначала укажите дату" : "";
}
