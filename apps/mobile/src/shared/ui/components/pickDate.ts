import { requestDate, type DatePickInput } from "./datePickStore.ts";

/**
 * Выбор даты (UIX-FIT-10, заменяет системное окно Android из UI-OWN-023): календарь в стиле приложения (`DatePickerHost`) — месяц сеткой,
 * стрелки, выбор месяца и года, неделя с понедельника. Даты — локальные `YYYY-MM-DD`; `min`/`max` включительно. Отмена, второй запрос
 * и отсутствие хоста — `null` (промис не отклоняется: вызывающие не обязаны ловить отказ).
 */
export function pickDate(input: DatePickInput): Promise<string | null> {
  return requestDate(input);
}
