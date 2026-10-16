import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, ConfirmDialog, InlineNotice, StatusTag } from "../../../shared/ui/components/public.ts";
import { EmptyPanel, PrototypeNotice, PrototypeScreen, SectionHeading } from
  "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { ClearWeekSummary, LocalDate, WeekTemplate } from "../domain/CalendarModel.ts";
import type { CalendarParticipantDirectoryPort } from "../domain/CalendarParticipantDirectoryPort.ts";
import type { CalendarRepositoryPort } from "../domain/CalendarRepositoryPort.ts";
import { addDays, appointmentLabel, formatMinute, localDateOf, mondayOf, templateSize,
  weekDates } from "../domain/CalendarRules.ts";
import { dayTitle, monthTitle, useCalendarWeek, useParticipants, weekdayShort } from
  "./calendarPresentation.ts";

export interface OpenAppointmentParams {
  readonly appointmentId?: string;
  readonly localDate: LocalDate;
  readonly startMinute?: number;
}

/**
 * Dev Calendar: week strip, counters, day agenda and week bulk commands on real local data.
 * The dense 7-column timeline with 30-minute gestures is K02 after the R09 spike.
 */
export function CalendarScreen({ repository, participants, onOpenSettings, onOpenAppointment,
  onOpenInterval }: Readonly<{
  repository: CalendarRepositoryPort;
  participants: CalendarParticipantDirectoryPort;
  onOpenSettings: () => void;
  onOpenAppointment: (params: OpenAppointmentParams) => void;
  onOpenInterval: (localDate: LocalDate) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const today = localDateOf(new Date());
  const [selected, setSelected] = useState(today);
  const [clipboard, setClipboard] = useState<Readonly<{ template: WeekTemplate; from: LocalDate }> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearPreview, setClearPreview] = useState<ClearWeekSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const monday = mondayOf(selected);
  const days = weekDates(monday);
  const { data, failed, retry } = useCalendarWeek(repository, monday, selected);
  const people = useParticipants(participants);

  const perDay = useMemo(() => {
    const counts = new Map<LocalDate, number>();
    for (const row of data?.appointments ?? []) counts.set(row.localDate, (counts.get(row.localDate) ?? 0) + 1);
    return counts;
  }, [data]);
  const visibleDays = days.filter((_, index) => data?.settings.visibleWeekdays[index] ?? true);
  const hiddenWithAppointments = days.some((date, index) =>
    !(data?.settings.visibleWeekdays[index] ?? true) && (perDay.get(date) ?? 0) > 0);
  const agenda = useMemo(() => [
    ...(data?.intervals ?? []).filter((row) => row.localDate === selected)
      .map((row) => ({ kind: "interval" as const, start: row.startMinute, row })),
    ...(data?.appointments ?? []).filter((row) => row.localDate === selected)
      .map((row) => ({ kind: "appointment" as const, start: row.startMinute, row })),
  ].sort((a, b) => a.start - b.start || (a.kind === "interval" ? -1 : 1)), [data, selected]);
  const outsideRange = data !== null && agenda.some((item) => item.kind === "appointment"
    && (item.row.startMinute < data.settings.dayStartMinute
      || item.row.startMinute + item.row.durationMinutes > data.settings.dayEndMinute));

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try { await task(); }
    catch { setError("Операция не выполнена. Данные календаря не изменены."); }
    finally { setBusy(false); }
  };

  const copy = () => run(async () => {
    const template = await repository.copyWeek(monday);
    setClipboard({ template, from: monday });
    setNotice(templateSize(template) === 0 ? "На неделе нет записей и интервалов для копирования."
      : `Скопировано: ${templateSize(template)}. Шаблон можно вставлять в несколько недель.`);
  });

  const paste = () => run(async () => {
    if (clipboard === null) return;
    const eligible = new Set((await participants.listParticipants())
      .filter((row) => row.active).map((row) => row.id));
    const result = await repository.pasteWeek(monday, clipboard.template, eligible);
    setNotice(`Добавлено: ${result.inserted}. Пропущено из-за занятости: ${result.skippedBusy}`
      + (result.skippedUnavailable > 0
        ? `. Пропущено (клиент в архиве или тип недоступен): ${result.skippedUnavailable}` : "") + ".");
  });

  const askClear = () => run(async () => { setClearPreview(await repository.previewClearWeek(monday)); });

  const confirmClear = () => run(async () => {
    const result = await repository.clearWeek(monday);
    setClearPreview(null);
    setNotice(`Неделя очищена: записей отменено ${result.scheduledAppointments}, `
      + `дежурств ${result.duty}, блокировок ${result.blocked}.`);
  });

  return (
    <PrototypeScreen>
      <View style={styles.headerRow}>
        <View style={styles.counters}>
          <Text style={[styles.counter, { color: colors.textPrimary }]}>
            Неделя: {data ? data.appointments.length : "…"}
          </Text>
          <Text style={[styles.counter, { color: colors.textPrimary }]}>
            {monthTitle(selected)}: {data ? data.monthCount : "…"}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Настройки календаря"
          onPress={onOpenSettings} style={styles.iconButton}>
          <Text style={[styles.gear, { color: colors.accentInk }]}>⚙</Text>
        </Pressable>
      </View>
      <View style={styles.weekHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="Предыдущая неделя"
          onPress={() => setSelected(addDays(selected, -7))} style={styles.iconButton}>
          <Text style={[styles.arrow, { color: colors.accentInk }]}>‹</Text>
        </Pressable>
        <Text style={[styles.monthTitle, { color: colors.textPrimary }]}>{monthTitle(selected)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Следующая неделя"
          onPress={() => setSelected(addDays(selected, 7))} style={styles.iconButton}>
          <Text style={[styles.arrow, { color: colors.accentInk }]}>›</Text>
        </Pressable>
      </View>
      {selected !== today ? (
        <AppButton variant="ghost" label="Сегодня" onPress={() => setSelected(today)} />
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weekRow}>
        {visibleDays.map((date) => {
          const index = days.indexOf(date);
          const isSelected = date === selected;
          const count = perDay.get(date) ?? 0;
          return (
            <Pressable key={date} accessibilityRole="button"
              accessibilityLabel={`${dayTitle(date)}${date === today ? ", сегодня" : ""}, записей: ${count}`}
              accessibilityState={{ selected: isSelected }} onPress={() => setSelected(date)}
              style={[styles.day, {
                backgroundColor: isSelected ? colors.accentFill : colors.surface,
                borderColor: date === today ? colors.accentInk : isSelected ? colors.accentFill : colors.border,
                borderWidth: date === today ? 2 : 1,
              }]}>
              <Text style={[styles.weekday, { color: isSelected ? colors.onAccentFill : colors.textSecondary }]}>
                {weekdayShort[index]}
              </Text>
              <Text style={[styles.dayNumber, { color: isSelected ? colors.onAccentFill : colors.textPrimary }]}>
                {Number(date.slice(8, 10))}
              </Text>
              <Text style={[styles.dayCount, { color: isSelected ? colors.onAccentFill : colors.textMuted }]}>
                {count > 0 ? count : " "}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {hiddenWithAppointments ? <InlineNotice kind="info">
        В скрытых днях недели есть записи; они учтены в счётчиках.
      </InlineNotice> : null}
      <View style={styles.actions}>
        <AppButton variant="secondary" label="Копировать неделю" disabled={busy} onPress={() => { void copy(); }} />
        <AppButton variant="secondary" disabled={busy || clipboard === null}
          disabledReason="Сначала скопируйте неделю"
          label={clipboard === null ? "Вставить неделю" : `Вставить неделю (${templateSize(clipboard.template)})`}
          onPress={() => { void paste(); }} />
        <AppButton variant="destructive" label="Очистить неделю" disabled={busy} onPress={() => { void askClear(); }} />
      </View>
      {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}
      {error !== null || failed ? <InlineNotice kind="error">
        {error ?? "Не удалось обновить календарь. Показаны последние загруженные данные."}
      </InlineNotice> : null}
      {failed ? <AppButton variant="secondary" label="Повторить" onPress={retry} /> : null}
      <SectionHeading>{dayTitle(selected)}</SectionHeading>
      {outsideRange ? <InlineNotice kind="info">Есть записи вне рабочего окна дня.</InlineNotice> : null}
      {data !== null && agenda.length === 0 ? (
        <EmptyPanel title="Свободный день" body="Записей, дежурств и блокировок нет." />
      ) : null}
      {agenda.map((item) => item.kind === "interval" ? (
        <View key={item.row.id} style={[styles.interval, {
          borderColor: item.row.kind === "BLOCKED" ? colors.danger : colors.border,
          backgroundColor: colors.surfaceRaised,
        }]}>
          <Text style={[styles.intervalText, { color: colors.textPrimary }]}>
            {item.row.kind === "BLOCKED" ? "Заблокировано" : "Дежурство"} · {formatMinute(item.row.startMinute)}–{formatMinute(item.row.endMinute)}
          </Text>
          <AppButton variant="ghost" label={item.row.kind === "BLOCKED" ? "Снять блок" : "Удалить"}
            disabled={busy}
            onPress={() => { void run(async () => { await repository.removeInterval(item.row.id); }); }} />
        </View>
      ) : (
        <Pressable key={item.row.id} accessibilityRole="button"
          accessibilityLabel={`Запись ${formatMinute(item.row.startMinute)}, ${appointmentLabel(item.row,
            item.row.clientId ? people.get(item.row.clientId)?.displayName ?? null : null)}`}
          onPress={() => onOpenAppointment({ appointmentId: item.row.id, localDate: item.row.localDate })}
          style={({ pressed }) => [styles.appointment, {
            backgroundColor: pressed ? colors.surfaceRaised : colors.surface, borderColor: colors.border,
          }]}>
          <Text style={[styles.time, { color: colors.accentInk }]}>
            {formatMinute(item.row.startMinute)}–{formatMinute(item.row.startMinute + item.row.durationMinutes)}
          </Text>
          <View style={styles.appointmentText}>
            <Text style={[styles.name, { color: colors.textPrimary }]}>
              {item.row.clientId && people.get(item.row.clientId)?.emoji
                ? `${people.get(item.row.clientId)?.emoji} ` : ""}
              {appointmentLabel(item.row, item.row.clientId ? people.get(item.row.clientId)?.displayName ?? null : null)}
            </Text>
            <Text style={[styles.detail, { color: colors.textSecondary }]}>
              {item.row.sessionTypeName}{item.row.guestName ? " · гость" : ""}
              {item.row.creditBypass ? " · без списания" : ""}
            </Text>
            {item.row.note ? <Text style={[styles.detail, { color: colors.textSecondary }]}>{item.row.note}</Text> : null}
          </View>
          {item.row.lifecycle === "COMPLETED" ? <StatusTag kind="success" label="Проведена" /> : null}
        </Pressable>
      ))}
      <AppButton label="Записать" onPress={() => onOpenAppointment({ localDate: selected })} />
      <AppButton variant="secondary" label="Дежурство или блокировка" onPress={() => onOpenInterval(selected)} />
      <PrototypeNotice>
        Плотная недельная сетка с выбором времени касанием и жестами появится после отдельной проверки на устройстве (K02).
      </PrototypeNotice>
      <ConfirmDialog visible={clearPreview !== null} destructive confirmBusy={busy}
        title="Очистить неделю?"
        description={clearPreview === null ? "" : [
          `Будущих и незакрытых записей будет отменено: ${clearPreview.scheduledAppointments}.`,
          `Дежурств будет удалено: ${clearPreview.duty}. Блокировок: ${clearPreview.blocked}.`,
          `Проведённые записи останутся без изменений: ${clearPreview.completedKept}.`,
          "Карточки клиентов не удаляются.",
        ].join("\n")}
        confirmLabel="Очистить неделю"
        onCancel={() => setClearPreview(null)} onConfirm={() => { void confirmClear(); }} />
    </PrototypeScreen>
  );
}

export function CalendarSettingsPreview() {
  return (
    <PrototypeScreen description="Локальные параметры отображения и работы календаря">
      <PrototypeNotice>
        Рабочее окно 07:00–23:00, все дни недели и копирование/очистка всех категорий пока заданы значениями по умолчанию. Управление типами занятий и этими параметрами появится отдельной задачей.
      </PrototypeNotice>
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  counters: { flex: 1, gap: 2 },
  counter: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  iconButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  gear: { fontSize: 26, lineHeight: 30 },
  weekHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  arrow: { fontSize: 30, lineHeight: 34 },
  monthTitle: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  weekRow: { flexDirection: "row", gap: 4, paddingBottom: 4 },
  day: { minWidth: 48, minHeight: 72, borderRadius: 8, alignItems: "center", justifyContent: "center", gap: 2 },
  weekday: { fontSize: 11, lineHeight: 15, fontWeight: "600" },
  dayNumber: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
  dayCount: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
  actions: { gap: 8 },
  interval: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4, borderStyle: "dashed" },
  intervalText: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  appointment: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", gap: 12, alignItems: "flex-start" },
  time: { width: 92, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  appointmentText: { flex: 1, gap: 2 },
  name: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  detail: { fontSize: 12, lineHeight: 18 },
});
