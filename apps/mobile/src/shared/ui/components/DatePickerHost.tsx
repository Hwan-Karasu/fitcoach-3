import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { AppButton } from "./AppButton.tsx";
import { BottomSheet } from "./BottomSheet.tsx";
import { AppCalendar } from "./calendar/AppCalendar.tsx";
import { todayLocal } from "./calendar/today.ts";
import { datePickSnapshot, finishDatePick, registerDatePickHost, resolveDatePick, subscribeDatePick } from "./datePickStore.ts";

/**
 * Лист выбора даты поверх приложения (UIX-FIT-10, UI-OWN-094): один на всё приложение, монтируется в корне оболочки; запросы — через `pickDate`.
 * Внутри единый календарь `AppCalendar`; что в нём включено (год, ввод цифрами, «Сегодня», границы, точки), решает профиль запроса.
 * «Готово» возвращает выбранную дату, «Отмена», жест вниз и «Назад» — `null`.
 */
export function DatePickerHost() {
  const request = useSyncExternalStore(subscribeDatePick, datePickSnapshot, datePickSnapshot);
  // Выбор привязан к запросу: новый запрос начинается со своей стартовой даты, а не с прежнего выбора.
  const [choice, setChoice] = useState<{ id: number; value: string } | null>(null);
  // Пока лист уезжает вниз, он показывает прежний запрос, а не пустоту.
  const last = useRef(request);
  if (request !== null) last.current = request;
  const shown = request ?? last.current;
  const today = todayLocal();
  const resolved = useMemo(() => (shown === null ? null : resolveDatePick(shown, today)), [shown, today]);
  const picked = resolved === null ? null : choice !== null && choice.id === shown?.id ? choice.value : resolved.value;
  useEffect(() => registerDatePickHost(), []);
  return (
    <BottomSheet visible={request !== null} title={resolved?.title ?? "Выберите дату"} onClose={() => finishDatePick(null)}
      footer={<View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><AppButton variant="secondary" label="Отмена" onPress={() => finishDatePick(null)} /></View>
        <View style={{ flex: 1 }}><AppButton label={resolved?.confirmLabel ?? "Готово"} disabled={picked === null} onPress={() => finishDatePick(picked)} /></View>
      </View>}>
      {shown === null || resolved === null ? null : (
        <AppCalendar key={shown.id} mode="single" min={resolved.min} max={resolved.max} today={today} startView={resolved.startView} startAt={resolved.cursor}
          markers={resolved.markers} showToday={resolved.showToday} typing={resolved.typing} value={picked}
          onChange={(value) => setChoice({ id: shown.id, value })} />
      )}
    </BottomSheet>
  );
}
