import { Platform } from "react-native";
import { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";

const pad = (value: number) => String(value).padStart(2, "0");
const toDate = (local: string) => {
  const [year, month, day] = local.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
};
const toLocal = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * Системный выбор даты Android (UI-OWN-023 — все поля ввода даты через него, без самописных календарей).
 * Даты — локальные `YYYY-MM-DD`; `min`/`max` включительно. Отмена — `null`.
 */
export function pickDate(input: Readonly<{ value: string; min?: string; max?: string; title?: string; confirmLabel?: string }>):
  Promise<string | null> {
  if (Platform.OS !== "android") return Promise.resolve(null);
  return new Promise((resolve) => {
    DateTimePickerAndroid.open({
      value: toDate(input.value),
      mode: "date",
      title: input.title,
      minimumDate: input.min === undefined ? undefined : toDate(input.min),
      maximumDate: input.max === undefined ? undefined : toDate(input.max),
      firstDayOfWeek: 1,
      positiveButton: { label: input.confirmLabel ?? "Готово" },
      negativeButton: { label: "Отмена" },
      onChange: (event: DateTimePickerEvent, date?: Date) => resolve(event.type === "set" && date ? toLocal(date) : null),
      onError: () => resolve(null),
    });
  });
}
