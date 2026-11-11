import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import DateTimePicker from "react-native-ui-datepicker";
import { AppButton } from "./AppButton.tsx";
import { BottomSheet } from "./BottomSheet.tsx";
import { useDatePickerStyles } from "./DateRangeCalendar.tsx";
import { localDateOfPicker, localMidnight } from "./dateRange.ts";
import { clampDate, datePickSnapshot, finishDatePick, registerDatePickHost, subscribeDatePick, type DatePickRequest } from "./datePickStore.ts";

/**
 * Лист выбора даты поверх приложения (UIX-FIT-10): один на всё приложение, монтируется в корне оболочки; запросы — через `pickDate`.
 * Календарь `react-native-ui-datepicker` в тонах темы; «Готово» возвращает выбранную дату, «Отмена», жест вниз и «Назад» — `null`.
 */
export function DatePickerHost() {
  const request = useSyncExternalStore(subscribeDatePick, datePickSnapshot, datePickSnapshot);
  const styles = useDatePickerStyles();
  // Выбор привязан к запросу: новый запрос начинается со своей стартовой даты (не с прежнего выбора), вне min/max она подтягивается к границе.
  const [choice, setChoice] = useState<{ request: DatePickRequest | null; value: string | null }>({ request: null, value: null });
  // Пока лист уезжает вниз, он показывает прежний запрос, а не пустоту.
  const last = useRef(request);
  if (request !== null) last.current = request;
  const shown = request ?? last.current;
  const picked = request === null ? null : choice.request === request ? choice.value : clampDate(request.value, request.min, request.max);
  useEffect(() => registerDatePickHost(), []);
  return (
    <BottomSheet visible={request !== null} title={shown?.title ?? "Выберите дату"} onClose={() => finishDatePick(null)}
      footer={<View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><AppButton variant="secondary" label="Отмена" onPress={() => finishDatePick(null)} /></View>
        <View style={{ flex: 1 }}><AppButton label={shown?.confirmLabel ?? "Готово"} disabled={picked === null} onPress={() => finishDatePick(picked)} /></View>
      </View>}>
      {shown === null ? null : <DateTimePicker mode="single" locale="ru" firstDayOfWeek={1} styles={styles}
        date={localMidnight(picked ?? clampDate(shown.value, shown.min, shown.max))}
        minDate={shown.min === undefined ? undefined : localMidnight(shown.min)} maxDate={shown.max === undefined ? undefined : localMidnight(shown.max)}
        onChange={({ date }) => { if (request !== null) setChoice({ request, value: localDateOfPicker(date) }); }} />}
    </BottomSheet>
  );
}
