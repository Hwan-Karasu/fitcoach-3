import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AppButton, ConfirmDialog, InlineNotice, SelectionChip, StatusTag } from "../../../shared/ui/components/public.ts";
import { EmptyPanel, PrototypeNotice, PrototypeScreen, SectionHeading } from
  "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { SLOT_MINUTES, type Appointment, type ClearWeekSummary, type LocalDate,
  type WeekTemplate } from "../domain/CalendarModel.ts";
import type { CalendarParticipantDirectoryPort } from "../domain/CalendarParticipantDirectoryPort.ts";
import type { CalendarRepositoryPort } from "../domain/CalendarRepositoryPort.ts";
import { monthGridWeeks } from "../domain/CalendarGeometry.ts";
import { addDays, appointmentLabel, formatMinute, localDateOf, mondayOf, templateSize,
  weekDates } from "../domain/CalendarRules.ts";
import { calendarErrorMessage, dayTitle, monthTitle, outcomeTag, useCalendarWeek, useMonthCounts,
  useParticipants, weekdayShort } from "./calendarPresentation.ts";
import { MonthGrid } from "./MonthGrid.tsx";
import { TimelineGrid, type TimelineHandlers } from "./TimelineGrid.tsx";

export interface OpenAppointmentParams {
  readonly appointmentId?: string;
  readonly localDate: LocalDate;
  readonly startMinute?: number;
  readonly durationMinutes?: number;
}

type Mode = "WEEK" | "DAY";

const monthGenitive = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
  "сентября", "октября", "ноября", "декабря"] as const;

function weekTitle(monday: LocalDate): string {
  const sunday = addDays(monday, 6);
  const month = (date: LocalDate) => monthGenitive[Number(date.slice(5, 7)) - 1];
  return monday.slice(5, 7) === sunday.slice(5, 7)
    ? `${Number(monday.slice(8, 10))}–${Number(sunday.slice(8, 10))} ${month(sunday)}`
    : `${Number(monday.slice(8, 10))} ${month(monday)} – ${Number(sunday.slice(8, 10))} ${month(sunday)}`;
}

/**
 * §13 Calendar: operational header (counters, display days, day window), Month Grid and the dense
 * Week/Day timeline on one screen. Selected date, mode and month viewport survive data refreshes.
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
  const { height: screenHeight } = useWindowDimensions();
  const now = new Date();
  const today = localDateOf(now);
  const [selected, setSelected] = useState(today);
  const [viewMonth, setViewMonth] = useState(`${today.slice(0, 7)}-01`);
  const [mode, setMode] = useState<Mode>("WEEK");
  const [scrollLocked, setScrollLocked] = useState(false);
  const [range, setRange] = useState<Readonly<{ date: LocalDate; start: number; end: number }> | null>(null);
  const [clipboard, setClipboard] = useState<Readonly<{ template: WeekTemplate; from: LocalDate }> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearPreview, setClearPreview] = useState<ClearWeekSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const monday = mondayOf(selected);
  const days = weekDates(monday);
  const { data, failed, retry } = useCalendarWeek(repository, monday, selected);
  const people = useParticipants(participants);
  const gridWeeks = useMemo(() => monthGridWeeks(viewMonth), [viewMonth]);
  const gridFirst = gridWeeks[0]?.[0] ?? viewMonth;
  const gridLast = gridWeeks[gridWeeks.length - 1]?.[6] ?? viewMonth;
  const monthCounts = useMonthCounts(repository, gridFirst, gridLast);
  const monthTotal = [...monthCounts.entries()].filter(([date]) => date.slice(0, 7) === viewMonth.slice(0, 7))
    .reduce((sum, [, count]) => sum + count, 0);
  const settings = data?.settings ?? null;
  const dayWindow = { startMinute: settings?.dayStartMinute ?? 420, endMinute: settings?.dayEndMinute ?? 1380 };
  const visibleDays = days.filter((_, index) => settings?.visibleWeekdays[index] ?? true);
  const columns = mode === "WEEK" ? visibleDays : [selected];
  const timelineHeight = Math.round(Math.min(Math.max(screenHeight - 300, 380), 760));

  useEffect(() => { setRange(null); }, [selected, mode]);

  const perDay = useMemo(() => {
    const counts = new Map<LocalDate, number>();
    for (const row of data?.appointments ?? []) counts.set(row.localDate, (counts.get(row.localDate) ?? 0) + 1);
    return counts;
  }, [data]);
  const hiddenWithAppointments = days.filter((date, index) =>
    !(settings?.visibleWeekdays[index] ?? true) && (perDay.get(date) ?? 0) > 0);
  const outsideWindow = (data?.appointments ?? []).filter((row) => columns.includes(row.localDate)
    && (row.startMinute < dayWindow.startMinute || row.startMinute + row.durationMinutes > dayWindow.endMinute)).length;
  const agenda = useMemo(() => [
    ...(data?.intervals ?? []).filter((row) => row.localDate === selected)
      .map((row) => ({ kind: "interval" as const, start: row.startMinute, row })),
    ...(data?.appointments ?? []).filter((row) => row.localDate === selected)
      .map((row) => ({ kind: "appointment" as const, start: row.startMinute, row })),
  ].sort((a, b) => a.start - b.start || (a.kind === "interval" ? -1 : 1)), [data, selected]);

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try { await task(); }
    catch (failure) { setError(calendarErrorMessage(failure)); }
    finally { setBusy(false); }
  };

  const select = (date: LocalDate) => {
    setSelected(date);
    setViewMonth(`${date.slice(0, 7)}-01`);
  };

  const saveDisplay = (patch: Partial<Readonly<{ visibleWeekdays: readonly boolean[]; dayStartMinute: number;
    dayEndMinute: number }>>) => {
    if (settings === null) return;
    void run(async () => {
      await repository.updateDisplaySettings({ visibleWeekdays: settings.visibleWeekdays,
        dayStartMinute: settings.dayStartMinute, dayEndMinute: settings.dayEndMinute, ...patch });
    });
  };

  const handlers: TimelineHandlers = {
    onTapSlot: (date, startMinute) => onOpenAppointment({ localDate: date, startMinute }),
    onTapBlocked: (interval) => {
      setError(null);
      setNotice(`Время заблокировано: ${formatMinute(interval.startMinute)}–${formatMinute(interval.endMinute)}. `
        + "Снять блок можно в списке дня ниже.");
    },
    onOpenAppointment: (row) => onOpenAppointment({ appointmentId: row.id, localDate: row.localDate }),
    onRangeSelected: (date, start, end) => { setSelected(date); setRange({ date, start, end }); },
    onMove: (row: Appointment, date, start) => {
      void run(async () => {
        await repository.updateAppointment(row.id, row.revision, { localDate: date, startMinute: start,
          durationMinutes: row.durationMinutes, clientId: row.clientId, guestName: row.guestName,
          sessionTypeId: row.sessionTypeId, note: row.note, creditBypass: row.creditBypass });
        setNotice(`Запись перенесена: ${dayTitle(date)}, ${formatMinute(start)}.`);
      });
    },
    onSwipe: (direction) => select(addDays(selected, direction * (mode === "WEEK" ? 7 : 1))),
    onLockScroll: setScrollLocked,
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

  const createInterval = (kind: "DUTY" | "BLOCKED") => {
    if (range === null) return;
    const chosen = range;
    void run(async () => {
      await repository.createInterval({ kind, localDate: chosen.date, startMinute: chosen.start, endMinute: chosen.end });
      setRange(null);
      setNotice(`${kind === "DUTY" ? "Дежурство" : "Блокировка"} ${formatMinute(chosen.start)}–${formatMinute(chosen.end)} добавлено.`);
    });
  };

  const stepper = (label: string, value: number, onChange: (next: number) => void, min: number, max: number) => (
    <View style={styles.stepper}>
      <Text style={[styles.stepperLabel, { color: colors.textSecondary }]}>{label === "Начало дня" ? "с" : "до"}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: на 30 минут раньше`} disabled={busy || value <= min}
        onPress={() => onChange(value - SLOT_MINUTES)} style={styles.stepButton} hitSlop={6}>
        <Text style={[styles.stepGlyph, { color: value <= min ? colors.textMuted : colors.accentInk }]}>−</Text>
      </Pressable>
      <Text style={[styles.stepValue, { color: colors.textPrimary }]}>{formatMinute(value)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: на 30 минут позже`} disabled={busy || value >= max}
        onPress={() => onChange(value + SLOT_MINUTES)} style={styles.stepButton} hitSlop={6}>
        <Text style={[styles.stepGlyph, { color: value >= max ? colors.textMuted : colors.accentInk }]}>+</Text>
      </Pressable>
    </View>
  );

  return (
    <ScrollView scrollEnabled={!scrollLocked} style={{ backgroundColor: colors.canvas }}
      contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.headerRow}>
        <View style={styles.counters}>
          <Text style={[styles.counter, { color: colors.textPrimary }]}>Неделя: {data ? data.appointments.length : "…"}</Text>
          <Text style={[styles.counter, { color: colors.textPrimary }]}>{monthTitle(viewMonth)}: {monthTotal}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Настройки календаря"
          onPress={onOpenSettings} style={styles.iconButton}>
          <Text style={[styles.gear, { color: colors.accentInk }]}>⚙</Text>
        </Pressable>
      </View>
      {settings !== null ? <>
        <View style={styles.weekdays}>
          {weekdayShort.map((label, index) => {
            const on = settings.visibleWeekdays[index] ?? true;
            const last = on && settings.visibleWeekdays.filter(Boolean).length === 1;
            return (
              <Pressable key={label} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: busy || last }}
                accessibilityLabel={`Показывать ${label} в неделе`} disabled={busy || last}
                onPress={() => saveDisplay({ visibleWeekdays: settings.visibleWeekdays.map((flag, at) => (at === index ? !flag : flag)) })}
                style={[styles.dayToggle, { backgroundColor: on ? colors.accentFill : colors.surface,
                  borderColor: on ? colors.accentFill : colors.border }]}>
                <Text style={[styles.dayToggleText, { color: on ? colors.onAccentFill : colors.textSecondary }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.window}>
          {stepper("Начало дня", settings.dayStartMinute, (value) => saveDisplay({ dayStartMinute: value }), 0,
            settings.dayEndMinute - 60)}
          {stepper("Конец дня", settings.dayEndMinute, (value) => saveDisplay({ dayEndMinute: value }),
            settings.dayStartMinute + 60, 1440)}
        </View>
      </> : null}

      <MonthGrid viewMonth={viewMonth} selected={selected} today={today} counts={monthCounts}
        onBrowse={setViewMonth} onSelect={select} />
      {selected !== today || viewMonth.slice(0, 7) !== today.slice(0, 7) ? (
        <AppButton variant="ghost" label="Сегодня" onPress={() => select(today)} />
      ) : null}

      <View style={styles.modeRow}>
        <SelectionChip group="Режим" label="Неделя" selected={mode === "WEEK"} onPress={() => setMode("WEEK")} />
        <SelectionChip group="Режим" label="День" selected={mode === "DAY"} onPress={() => setMode("DAY")} />
      </View>
      <View style={styles.pager}>
        <Pressable accessibilityRole="button" accessibilityLabel={mode === "WEEK" ? "Предыдущая неделя" : "Предыдущий день"}
          onPress={() => select(addDays(selected, mode === "WEEK" ? -7 : -1))} style={styles.iconButton}>
          <Text style={[styles.arrow, { color: colors.accentInk }]}>‹</Text>
        </Pressable>
        <Text style={[styles.pagerTitle, { color: colors.textPrimary }]}>
          {mode === "WEEK" ? weekTitle(monday) : dayTitle(selected)}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={mode === "WEEK" ? "Следующая неделя" : "Следующий день"}
          onPress={() => select(addDays(selected, mode === "WEEK" ? 7 : 1))} style={styles.iconButton}>
          <Text style={[styles.arrow, { color: colors.accentInk }]}>›</Text>
        </Pressable>
      </View>
      {hiddenWithAppointments.length > 0 && mode === "WEEK" ? <InlineNotice kind="info">
        {`Есть записи в скрытых днях: ${hiddenWithAppointments.map((date) => `${weekdayShort[days.indexOf(date)]} (${perDay.get(date) ?? 0})`).join(", ")}.`}
      </InlineNotice> : null}
      {outsideWindow > 0 ? <InlineNotice kind="info">
        {`Записей вне окна ${formatMinute(dayWindow.startMinute)}–${formatMinute(dayWindow.endMinute)}: ${outsideWindow}. Они видны в списке дня.`}
      </InlineNotice> : null}
      {data !== null ? (
        <TimelineGrid dates={columns} window={dayWindow} appointments={data.appointments} intervals={data.intervals}
          people={people} now={now} height={timelineHeight} handlers={handlers} />
      ) : null}
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        Касание — запись на это время. Долгое нажатие и протягивание — интервал. Долгое нажатие на будущей записи — перенос.
      </Text>

      {range !== null ? (
        <View style={[styles.rangeBar, { borderColor: colors.accentInk, backgroundColor: colors.surface }]}>
          <Text style={[styles.rangeTitle, { color: colors.textPrimary }]}>
            {`${dayTitle(range.date)}, ${formatMinute(range.start)}–${formatMinute(range.end)}`}
          </Text>
          <AppButton label="Записать клиента" disabled={busy}
            onPress={() => { const chosen = range; setRange(null);
              onOpenAppointment({ localDate: chosen.date, startMinute: chosen.start, durationMinutes: chosen.end - chosen.start }); }} />
          <View style={styles.rangeActions}>
            <AppButton variant="secondary" label="Дежурство" disabled={busy} onPress={() => createInterval("DUTY")} />
            <AppButton variant="secondary" label="Блокировка" disabled={busy} onPress={() => createInterval("BLOCKED")} />
            <AppButton variant="ghost" label="Отмена" disabled={busy} onPress={() => setRange(null)} />
          </View>
        </View>
      ) : null}

      {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}
      {error !== null || failed ? <InlineNotice kind="error">
        {error ?? "Не удалось обновить календарь. Показаны последние загруженные данные."}
      </InlineNotice> : null}
      {failed ? <AppButton variant="secondary" label="Повторить" onPress={retry} /> : null}

      {mode === "WEEK" ? (
        <View style={styles.actions}>
          <AppButton variant="secondary" label="Копировать неделю" disabled={busy} onPress={() => { void copy(); }} />
          <AppButton variant="secondary" disabled={busy || clipboard === null}
            disabledReason="Сначала скопируйте неделю"
            label={clipboard === null ? "Вставить неделю" : `Вставить неделю (${templateSize(clipboard.template)})`}
            onPress={() => { void paste(); }} />
          <AppButton variant="destructive" label="Очистить неделю" disabled={busy} onPress={() => { void askClear(); }} />
        </View>
      ) : null}

      <SectionHeading>{dayTitle(selected)}</SectionHeading>
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
            {(() => {
              const tag = outcomeTag(item.row, now);
              return tag === null ? null : <View style={styles.tag}><StatusTag kind={tag.kind} label={tag.label} /></View>;
            })()}
          </View>
        </Pressable>
      ))}
      <AppButton label="Записать" onPress={() => onOpenAppointment({ localDate: selected })} />
      <AppButton variant="secondary" label="Дежурство или блокировка" onPress={() => onOpenInterval(selected)} />
      <ConfirmDialog visible={clearPreview !== null} destructive confirmBusy={busy}
        title="Очистить неделю?"
        description={clearPreview === null ? "" : [
          `Будущих записей будет отменено: ${clearPreview.scheduledAppointments}.`,
          `Будущих дежурств будет удалено: ${clearPreview.duty}. Блокировок: ${clearPreview.blocked}.`,
          `Прошедшие и идущие записи останутся без изменений: ${clearPreview.pastKept}.`,
          "Карточки клиентов не удаляются.",
        ].join("\n")}
        confirmLabel="Очистить неделю"
        onCancel={() => setClearPreview(null)} onConfirm={() => { void confirmClear(); }} />
    </ScrollView>
  );
}

/** Only the undo prompt is editable so far; the other parameters stay at defaults (§13, §18.7). */
export function CalendarSettingsPreview({ repository }: Readonly<{ repository: CalendarRepositoryPort }>) {
  const [prompt, setPrompt] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void repository.getSettings().then((settings) => { if (active) setPrompt(settings.undoCancelPrompt); },
      () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [repository]);
  const toggle = (next: boolean) => {
    setPrompt(next);
    void repository.setUndoCancelPrompt(next).catch(() => { setPrompt(!next); setFailed(true); });
  };
  return (
    <PrototypeScreen description="Локальные параметры отображения и работы календаря">
      <SectionHeading>После отмены записи</SectionHeading>
      {prompt !== null ? (
        <SelectionChip group="После отмены записи" label="Предлагать «Вернуть» 3 секунды" selected={prompt}
          onPress={() => toggle(!prompt)} />
      ) : null}
      {failed ? <InlineNotice kind="error">Не удалось прочитать или сохранить настройку.</InlineNotice> : null}
      <PrototypeNotice>
        Отображаемые дни и рабочее окно настраиваются прямо в календаре. Копирование/очистка всех категорий и типы занятий пока заданы значениями по умолчанию.
      </PrototypeNotice>
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  counters: { flex: 1, gap: 2 },
  counter: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  iconButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  gear: { fontSize: 26, lineHeight: 30 },
  weekdays: { flexDirection: "row", gap: 4 },
  dayToggle: { flex: 1, minHeight: 40, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dayToggleText: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  window: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepperLabel: { fontSize: 13, lineHeight: 18 },
  stepButton: { width: 36, height: 40, alignItems: "center", justifyContent: "center" },
  stepGlyph: { fontSize: 22, lineHeight: 26, fontWeight: "700" },
  stepValue: { fontSize: 15, lineHeight: 20, fontWeight: "700", minWidth: 46, textAlign: "center" },
  modeRow: { flexDirection: "row", gap: 8 },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pagerTitle: { flex: 1, textAlign: "center", fontSize: 16, lineHeight: 22, fontWeight: "700" },
  arrow: { fontSize: 30, lineHeight: 34 },
  hint: { fontSize: 12, lineHeight: 17 },
  rangeBar: { borderWidth: 2, borderRadius: 12, padding: 12, gap: 8 },
  rangeTitle: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
  rangeActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actions: { gap: 8 },
  interval: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4, borderStyle: "dashed" },
  intervalText: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  appointment: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", gap: 12, alignItems: "flex-start" },
  time: { width: 104, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  appointmentText: { flex: 1, gap: 2 },
  tag: { flexDirection: "row", marginTop: 4 },
  name: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  detail: { fontSize: 12, lineHeight: 18 },
});
