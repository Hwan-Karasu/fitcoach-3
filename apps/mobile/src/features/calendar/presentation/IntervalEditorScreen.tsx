import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice, LoadingState, SelectionChip } from "../../../shared/ui/components/public.ts";
import { PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { SLOT_MINUTES, type CalendarSettings, type IntervalKind, type LocalDate } from "../domain/CalendarModel.ts";
import type { CalendarRepositoryPort } from "../domain/CalendarRepositoryPort.ts";
import { formatMinute } from "../domain/CalendarRules.ts";
import { calendarErrorMessage, dayTitle } from "./calendarPresentation.ts";

/** §13.7.11 compact Duty/Blocked editor; the gesture path is part of K02. */
export function IntervalEditorScreen({ repository, localDate, onClose }: Readonly<{
  repository: CalendarRepositoryPort;
  localDate: LocalDate;
  onClose: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [settings, setSettings] = useState<CalendarSettings | null>(null);
  const [kind, setKind] = useState<IntervalKind>("BLOCKED");
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void repository.getSettings().then((loaded) => {
      if (!active) return;
      setSettings(loaded);
      setStart(loaded.dayStartMinute);
      setEnd(Math.min(loaded.dayStartMinute + 60, loaded.dayEndMinute));
    }, () => { if (active) setError("Не удалось загрузить настройки календаря."); });
    return () => { active = false; };
  }, [repository]);

  if (settings === null) {
    return <PrototypeScreen>
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : <LoadingState label="Загрузка…" />}
      <AppButton variant="ghost" label="Отмена" onPress={onClose} />
    </PrototypeScreen>;
  }

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await repository.createInterval({ kind, localDate, startMinute: start, endMinute: end });
      onClose();
    } catch (failure) {
      setError(calendarErrorMessage(failure));
      setBusy(false);
    }
  };

  const stepper = (label: string, value: number, set: (next: number) => void, min: number, max: number) => (
    <View style={styles.stepper}>
      <AppButton variant="secondary" label="−30" accessibilityLabel={`${label}: на 30 минут раньше`}
        disabled={value - SLOT_MINUTES < min} onPress={() => set(value - SLOT_MINUTES)} />
      <Text accessibilityLabel={`${label}: ${formatMinute(value)}`}
        style={[styles.value, { color: colors.textPrimary }]}>{label} {formatMinute(value)}</Text>
      <AppButton variant="secondary" label="+30" accessibilityLabel={`${label}: на 30 минут позже`}
        disabled={value + SLOT_MINUTES > max} onPress={() => set(value + SLOT_MINUTES)} />
    </View>
  );

  return (
    <PrototypeScreen>
      <SectionHeading>{dayTitle(localDate)}</SectionHeading>
      <View style={styles.chips}>
        <SelectionChip group="Интервал" label="Блокировка" selected={kind === "BLOCKED"}
          onPress={() => setKind("BLOCKED")} />
        <SelectionChip group="Интервал" label="Дежурство" selected={kind === "DUTY"}
          onPress={() => setKind("DUTY")} />
      </View>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        {kind === "BLOCKED" ? "Блокировка запрещает записи в этом интервале и не ставится поверх существующей записи."
          : "Дежурство — фон смены: записи внутри него разрешены."}
      </Text>
      {stepper("С", start, (next) => { setStart(next); if (end <= next) setEnd(next + SLOT_MINUTES); },
        settings.dayStartMinute, settings.dayEndMinute - SLOT_MINUTES)}
      {stepper("До", end, setEnd, start + SLOT_MINUTES, settings.dayEndMinute)}
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      <AppButton label="Сохранить" busy={busy} onPress={() => { void save(); }} />
      <AppButton variant="ghost" label="Отмена" disabled={busy} onPress={onClose} />
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hint: { fontSize: 12, lineHeight: 18 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  value: { flex: 1, textAlign: "center", fontSize: 17, lineHeight: 24, fontWeight: "700" },
});
