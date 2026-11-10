import { plural } from "../shared/format/clockText.ts";

/** Живые подписи карточек вкладки «Ещё» (UIX-10, UI-OWN-076): чистые функции без чтения данных. */
const MONTHS_SHORT = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."] as const;

const dayMonth = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS_SHORT[Number(date.slice(5, 7)) - 1] ?? ""}`;

/** «Заполнена на 80 %»; пустая анкета — «Не заполнена»; данных ещё нет (грузятся) — `null`, подпись не выдумывается. */
export function questionnaireCaption(percent: number | null): string | null {
  if (percent === null) return null;
  return percent <= 0 ? "Не заполнена" : `Заполнена на ${percent} %`;
}

/** «43 занятия, последнее 7 нояб.»: считаются только завершённые занятия (так же, как в «Истории занятий»), последнее — по дате факта. */
export function historyCaption(entries: readonly Readonly<{ status: string; actualDate: string | null }>[]): string {
  const done = entries.filter((entry) => entry.status === "COMPLETED");
  if (done.length === 0) return "Занятий пока нет";
  const last = done.flatMap((entry) => entry.actualDate !== null && /^\d{4}-\d{2}-\d{2}$/u.test(entry.actualDate) ? [entry.actualDate] : []).sort().at(-1);
  const count = `${done.length} ${plural(done.length, "занятие", "занятия", "занятий")}`;
  return last === undefined ? count : `${count}, последнее ${dayMonth(last)}`;
}
