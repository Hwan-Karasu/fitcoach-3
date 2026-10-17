import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import * as Sharing from "expo-sharing";
import { ScrollView } from "react-native-gesture-handler";
import { captureRef } from "react-native-view-shot";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronDown, CircleHelp, ClipboardPaste, Copy, Share2, Trash2, Undo2, X } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, InlineNotice,
  TimeWheelPicker } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { Appointment, CalendarInterval, ClearWeekSummary, GuestLinkRequest, LocalDate,
  WeekTemplate } from "../domain/CalendarModel.ts";
import type { CalendarCreditPort } from "../domain/CalendarCreditPort.ts";
import type { CalendarParticipantDirectoryPort } from "../domain/CalendarParticipantDirectoryPort.ts";
import type { CalendarRepositoryPort } from "../domain/CalendarRepositoryPort.ts";
import { addMonths, monthGridWeeks } from "../domain/CalendarGeometry.ts";
import { addDays, formatMinute, localDateOf, mondayOf, templateSize,
  weekDates } from "../domain/CalendarRules.ts";
import { AppointmentEditorScreen } from "./AppointmentEditorScreen.tsx";
import { calendarErrorMessage, dayTitle, useCalendarWeek, useMonthCounts,
  useParticipants, useSessionTypeColors, weekdayShort } from "./calendarPresentation.ts";
import { MonthGrid } from "./MonthGrid.tsx";
import { ShareWeekPoster } from "./ShareWeekPoster.tsx";
import type { TimelineHandlers } from "./TimelineGrid.tsx";
import { WeekPager } from "./WeekPager.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";

export interface OpenAppointmentParams {
  readonly appointmentId?: string;
  readonly localDate: LocalDate;
  readonly startMinute?: number;
  readonly durationMinutes?: number;
}

type Mode = "WEEK" | "DAY";

const monthGenitive = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
  "сентября", "октября", "ноября", "декабря"] as const;
const monthPrepositional = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе",
  "сентябре", "октябре", "ноябре", "декабре"] as const;

function weekTitle(monday: LocalDate): string {
  const sunday = addDays(monday, 6);
  const month = (date: LocalDate) => monthGenitive[Number(date.slice(5, 7)) - 1];
  return monday.slice(5, 7) === sunday.slice(5, 7)
    ? `${Number(monday.slice(8, 10))}–${Number(sunday.slice(8, 10))} ${month(sunday)}`
    : `${Number(monday.slice(8, 10))} ${month(monday)} – ${Number(sunday.slice(8, 10))} ${month(sunday)}`;
}

/** Плашка счётчика: подпись сверху, число крупно. */
function StatTile({ label, value }: Readonly<{ label: string; value: string }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`}
      style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text numberOfLines={1} style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.statValue, { color: colors.textPrimary }]}>{value}</Text>
    </View>
  );
}

/** Кнопка шапки недели: значок над подписью, рамка, радиус 8 (UI-OWN-017). */
function ToolButton({ label, icon, onPress, disabled = false, busy = false, danger = false }: Readonly<{
  label: string; icon: (color: string) => ReactNode; onPress: () => void; disabled?: boolean; busy?: boolean; danger?: boolean;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const ink = danger ? colors.danger : colors.textPrimary;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [styles.tool, { borderColor: colors.border,
        backgroundColor: pressed ? colors.surfaceRaised : colors.surface, opacity: disabled ? 0.45 : 1 }]}>
      {icon(ink)}
      <Text numberOfLines={1} style={[styles.toolLabel, { color: ink }]}>{busy ? "…" : label}</Text>
    </Pressable>
  );
}

/**
 * §13 Calendar: счётчики, рабочие дни и окно дня, месяц и плотная неделя/день на одном экране.
 * Месяц и неделя листаются только свайпом; запись открывается окном поверх календаря.
 */
export function CalendarScreen({ repository, participants, credit, onCreateClientFromGuest }: Readonly<{
  repository: CalendarRepositoryPort;
  participants: CalendarParticipantDirectoryPort;
  credit: CalendarCreditPort;
  onCreateClientFromGuest?: (request: GuestLinkRequest) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const now = new Date();
  const today = localDateOf(now);
  const [selected, setSelected] = useState(today);
  const [viewMonth, setViewMonth] = useState(`${today.slice(0, 7)}-01`);
  const [mode, setMode] = useState<Mode>("WEEK");
  const [scrollLocked, setScrollLocked] = useState(false);
  const [clipboard, setClipboard] = useState<Readonly<{ template: WeekTemplate; from: LocalDate }> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearPreview, setClearPreview] = useState<ClearWeekSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [timePicker, setTimePicker] = useState<"start" | "end" | null>(null);
  const [editor, setEditor] = useState<OpenAppointmentParams | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [removing, setRemoving] = useState<CalendarInterval | null>(null);
  const posterRef = useRef<View>(null);
  const monday = mondayOf(selected);
  const days = weekDates(monday);
  const { data, failed, retry } = useCalendarWeek(repository, monday, selected);
  const people = useParticipants(participants);
  const typeColors = useSessionTypeColors(repository);
  const gridFirst = useMemo(() => monthGridWeeks(addMonths(viewMonth, -1))[0]?.[0] ?? viewMonth, [viewMonth]);
  const gridLast = useMemo(() => {
    const weeks = monthGridWeeks(addMonths(viewMonth, 1));
    return weeks[weeks.length - 1]?.[6] ?? viewMonth;
  }, [viewMonth]);
  const monthCounts = useMonthCounts(repository, gridFirst, gridLast);
  const monthTotal = [...monthCounts.entries()].filter(([date]) => date.slice(0, 7) === viewMonth.slice(0, 7))
    .reduce((sum, [, count]) => sum + count, 0);
  const settings = data?.settings ?? null;
  const dayWindow = { startMinute: settings?.dayStartMinute ?? 420, endMinute: settings?.dayEndMinute ?? 1380 };
  const visibleDays = days.filter((_, index) => settings?.visibleWeekdays[index] ?? true);
  const columns = mode === "WEEK" ? visibleDays : [selected];
  const timelineHeight = Math.round(Math.min(Math.max(screenHeight - 300, 380), 760));

  // §13.18: the poster renders off-screen for one frame, is captured and handed to the system share
  // sheet. Sharing never changes Calendar state.
  useEffect(() => {
    if (!sharing) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          if (!(await Sharing.isAvailableAsync())) throw new Error("SHARE_UNAVAILABLE");
          const uri = await captureRef(posterRef, { format: "png", quality: 1, result: "tmpfile", width: 1080 });
          await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Расписание недели" });
        } catch {
          if (!cancelled) setError("Не удалось подготовить картинку недели. Календарь не изменён.");
        } finally {
          if (!cancelled) setSharing(false);
        }
      })();
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [sharing]);

  const perDay = useMemo(() => {
    const counts = new Map<LocalDate, number>();
    for (const row of data?.appointments ?? []) counts.set(row.localDate, (counts.get(row.localDate) ?? 0) + 1);
    return counts;
  }, [data]);
  const hiddenWithAppointments = days.filter((date, index) =>
    !(settings?.visibleWeekdays[index] ?? true) && (perDay.get(date) ?? 0) > 0);
  const outsideWindow = (data?.appointments ?? []).filter((row) => columns.includes(row.localDate)
    && (row.startMinute < dayWindow.startMinute || row.startMinute + row.durationMinutes > dayWindow.endMinute)).length;

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

  const createInterval = (kind: "DUTY" | "BLOCKED", date: LocalDate, start: number, end: number) => {
    void run(async () => {
      await repository.createInterval({ kind, localDate: date, startMinute: start, endMinute: end });
      setNotice(`${kind === "DUTY" ? "Дежурство" : "Блокировка"} ${formatMinute(start)}–${formatMinute(end)} добавлено. `
        + "Убрать — долгим нажатием на него в сетке.");
    });
  };

  const handlers: TimelineHandlers = {
    onTapSlot: (date, startMinute) => setEditor({ localDate: date, startMinute }),
    onTapBlocked: setRemoving,
    onLongPressInterval: setRemoving,
    onOpenAppointment: (row) => setEditor({ appointmentId: row.id, localDate: row.localDate }),
    onRangeSelected: (date, start, end, kind) => { setSelected(date); createInterval(kind, date, start, end); },
    onMove: (row: Appointment, date, start) => {
      void run(async () => {
        await repository.updateAppointment(row.id, row.revision, { localDate: date, startMinute: start,
          durationMinutes: row.durationMinutes, clientId: row.clientId, guestName: row.guestName,
          sessionTypeId: row.sessionTypeId, note: row.note, creditBypass: row.creditBypass });
        setNotice(`Запись перенесена: ${dayTitle(date)}, ${formatMinute(start)}.`);
      });
    },
    onResize: (row: Appointment, durationMinutes) => {
      void run(async () => {
        await repository.updateAppointment(row.id, row.revision, { localDate: row.localDate, startMinute: row.startMinute,
          durationMinutes, clientId: row.clientId, guestName: row.guestName, sessionTypeId: row.sessionTypeId,
          note: row.note, creditBypass: row.creditBypass });
        setNotice(`Длительность изменена: ${formatMinute(row.startMinute)}–${formatMinute(row.startMinute + durationMinutes)}.`);
      });
    },
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

  const timeButton = (kind: "start" | "end", label: string, value: number) => (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label} дня: ${formatMinute(value)}. Изменить`}
      disabled={busy || settings === null} onPress={() => setTimePicker(kind)}
      style={({ pressed }) => [styles.timeButton, { borderColor: colors.border,
        backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
      <Text numberOfLines={1} style={[styles.timeLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.timeValue, { color: colors.textPrimary }]}>{formatMinute(value)}</Text>
      <ChevronDown size={14} color={colors.textSecondary} strokeWidth={2} />
    </Pressable>
  );

  const segment = (value: Mode, label: string) => (
    <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: mode === value }} accessibilityLabel={label}
      onPress={() => setMode(value)}
      style={[styles.segment, mode === value ? { backgroundColor: colors.accentFill } : null]}>
      <Text style={[styles.segmentText, { color: mode === value ? colors.onAccentFill : colors.textPrimary }]}>{label}</Text>
    </Pressable>
  );

  const viewMonthIndex = Number(viewMonth.slice(5, 7)) - 1;
  return (
    <>
      <ScrollView scrollEnabled={!scrollLocked} style={{ backgroundColor: colors.canvas }}
        contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.stats}>
          <StatTile label="На неделе" value={data ? String(data.appointments.length) : "…"} />
          <StatTile label={`В ${monthPrepositional[viewMonthIndex] ?? "месяце"}`} value={String(monthTotal)} />
        </View>
        {settings !== null ? <>
          <View style={styles.weekdays}>
            {weekdayShort.map((label, index) => {
              const on = settings.visibleWeekdays[index] ?? true;
              const last = on && settings.visibleWeekdays.filter(Boolean).length === 1;
              return (
                <Pressable key={label} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: busy || last }}
                  accessibilityLabel={`Рабочий день: ${label}`} disabled={busy || last}
                  onPress={() => saveDisplay({ visibleWeekdays: settings.visibleWeekdays.map((flag, at) => (at === index ? !flag : flag)) })}
                  style={[styles.dayToggle, { backgroundColor: on ? colors.accentFill : colors.surface,
                    borderColor: on ? colors.accentFill : colors.border }]}>
                  <Text style={[styles.dayToggleText, { color: on ? colors.onAccentFill : colors.textSecondary }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.window}>
            {timeButton("start", "Начало", settings.dayStartMinute)}
            {timeButton("end", "Конец", settings.dayEndMinute)}
          </View>
        </> : null}

        <MonthGrid viewMonth={viewMonth} selected={selected} today={today} counts={monthCounts}
          onBrowse={setViewMonth} onSelect={select} onToday={() => select(today)} />

        {/* Рамка второго календаря: шапка (как в 2.0) — «Сегодня» и режим, затем действия с неделей. */}
        <View style={[styles.frame, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.toolbarRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Вернуться к сегодняшнему дню"
            disabled={selected === today} onPress={() => select(today)}
            style={({ pressed }) => [styles.todayButton, { borderColor: colors.border,
              backgroundColor: pressed ? colors.surfaceRaised : colors.surface, opacity: selected === today ? 0.45 : 1 }]}>
            <Undo2 size={16} color={colors.textPrimary} strokeWidth={2} />
            <Text style={[styles.todayText, { color: colors.textPrimary }]}>Сегодня</Text>
          </Pressable>
          <View style={[styles.segments, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            {segment("WEEK", "Неделя")}
            {segment("DAY", "День")}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={showHint ? "Скрыть подсказку по жестам" : "Подсказка по жестам"}
            accessibilityState={{ expanded: showHint }} onPress={() => setShowHint((value) => !value)}
            style={({ pressed }) => [styles.helpButton, { borderColor: showHint ? colors.accentInk : colors.border,
              backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
            <CircleHelp size={18} color={showHint ? colors.accentInk : colors.textSecondary} strokeWidth={1.8} />
          </Pressable>
        </View>
        {showHint ? (
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            Касание — запись. Зажать и протянуть — дежурство, протянуть и подержать — блокировка. Долгое нажатие на
            записи — перенос, у нижнего края — длительность; на дежурстве или блокировке — удалить. Свайп влево-вправо —
            другая неделя.
          </Text>
        ) : null}
        <View style={styles.toolbarRow}>
          <ToolButton label="Поделиться" busy={sharing} disabled={busy || data === null}
            icon={(color) => <Share2 size={14} color={color} strokeWidth={1.8} />}
            onPress={() => { setError(null); setSharing(true); }} />
          <ToolButton label="Копировать" disabled={busy} icon={(color) => <Copy size={14} color={color} strokeWidth={1.8} />}
            onPress={() => { void copy(); }} />
          <ToolButton label={clipboard === null ? "Вставить" : `Вставить (${templateSize(clipboard.template)})`}
            disabled={busy || clipboard === null}
            icon={(color) => <ClipboardPaste size={14} color={color} strokeWidth={1.8} />} onPress={() => { void paste(); }} />
          <ToolButton label="Очистить" danger disabled={busy}
            icon={(color) => <Trash2 size={14} color={color} strokeWidth={1.8} />} onPress={() => { void askClear(); }} />
        </View>
        {data !== null ? (
          <WeekPager repository={repository} mode={mode} selected={selected} today={today} scrollLocked={scrollLocked}
            onSelect={select} visibleWeekdays={settings?.visibleWeekdays ?? []} window={dayWindow} people={people}
            typeColors={typeColors} now={now} height={timelineHeight} handlers={handlers} />
        ) : null}
        </View>

        {hiddenWithAppointments.length > 0 && mode === "WEEK" ? <InlineNotice kind="info">
          {`Есть записи в скрытых днях: ${hiddenWithAppointments.map((date) => `${weekdayShort[days.indexOf(date)]} (${perDay.get(date) ?? 0})`).join(", ")}.`}
        </InlineNotice> : null}
        {outsideWindow > 0 ? <InlineNotice kind="info">
          {`Записей вне окна ${formatMinute(dayWindow.startMinute)}–${formatMinute(dayWindow.endMinute)}: ${outsideWindow}. Расширьте начало или конец дня, чтобы их увидеть.`}
        </InlineNotice> : null}
        {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}
        {error !== null || failed ? <InlineNotice kind="error">
          {error ?? "Не удалось обновить календарь. Показаны последние загруженные данные."}
        </InlineNotice> : null}
        {failed ? <AppButton variant="secondary" label="Повторить" onPress={retry} /> : null}

        <ConfirmDialog visible={removing !== null} destructive confirmBusy={busy}
          title={removing?.kind === "BLOCKED" ? "Снять блокировку?" : "Удалить дежурство?"}
          description={removing === null ? "" : `${dayTitle(removing.localDate)}, ${formatMinute(removing.startMinute)}–${formatMinute(removing.endMinute)}.`}
          confirmLabel={removing?.kind === "BLOCKED" ? "Снять блокировку" : "Удалить"}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const chosen = removing;
            if (chosen === null) return;
            void run(async () => { await repository.removeInterval(chosen.id); setRemoving(null); });
          }} />
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
        {sharing && data !== null ? (
          <View pointerEvents="none" style={styles.offscreen}>
            <ShareWeekPoster posterRef={posterRef} title={`Расписание: ${weekTitle(monday)}`} dates={visibleDays}
              window={dayWindow} appointments={data.appointments} intervals={data.intervals} people={people} />
          </View>
        ) : null}
      </ScrollView>

      {settings !== null ? <>
        <TimeWheelPicker visible={timePicker === "start"} title="Начало дня" value={settings.dayStartMinute}
          min={0} max={settings.dayEndMinute - 60} onClose={() => setTimePicker(null)}
          onConfirm={(minute) => saveDisplay({ dayStartMinute: minute })} />
        <TimeWheelPicker visible={timePicker === "end"} title="Конец дня" value={settings.dayEndMinute}
          min={settings.dayStartMinute + 60} max={1440} onClose={() => setTimePicker(null)}
          onConfirm={(minute) => saveDisplay({ dayEndMinute: minute })} />
      </> : null}

      {/* Запись открывается окном поверх календаря, а не отдельным экраном (решение владельца). */}
      <Modal visible={editor !== null} transparent animationType="slide" statusBarTranslucent
        onRequestClose={() => setEditor(null)}>
        <Pressable accessibilityLabel="Закрыть запись" style={[StyleSheet.absoluteFill, styles.sheetScrim]}
          onPress={() => setEditor(null)} />
        <View style={[styles.sheet, { marginTop: insets.top + 40, backgroundColor: colors.canvas, borderColor: colors.border }]}>
          <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
            <Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.textPrimary }]}>
              {editor?.appointmentId ? "Запись" : "Новая запись"}
            </Text>
            <AppIconButton compact label="Закрыть" icon={<X size={22} color={colors.textPrimary} strokeWidth={1.8} />}
              onPress={() => setEditor(null)} />
          </View>
          {editor !== null ? (
            <View style={[styles.sheetBody, { paddingBottom: insets.bottom }]}>
              <AppointmentEditorScreen repository={repository} participants={participants} credit={credit}
                appointmentId={editor.appointmentId} localDate={editor.localDate} startMinute={editor.startMinute}
                durationMinutes={editor.durationMinutes} onClose={() => setEditor(null)}
                onCreateClientFromGuest={onCreateClientFromGuest === undefined ? undefined
                  : (request) => { setEditor(null); onCreateClientFromGuest(request); }} />
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  offscreen: { position: "absolute", left: -10000, top: 0 },
  stats: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, minHeight: 40, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, flexDirection: "row",
    alignItems: "center", justifyContent: "space-between", gap: 6 },
  statLabel: { flexShrink: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  statValue: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  weekdays: { flexDirection: "row", gap: 4 },
  dayToggle: { flex: 1, minHeight: 32, borderWidth: 1, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  dayToggleText: { fontSize: 12, lineHeight: 16, fontFamily: fonts.semibold },
  window: { flexDirection: "row", gap: 8 },
  timeButton: { flex: 1, minHeight: 40, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, flexDirection: "row",
    alignItems: "center", gap: 6 },
  timeLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  timeValue: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  // Рамка недели чуть шире отступов экрана: колонка часов узкая, пустого места слева меньше.
  frame: { marginHorizontal: -8, borderWidth: 1, borderRadius: 12, overflow: "hidden", paddingTop: 6, gap: 6 },
  toolbarRow: { flexDirection: "row", gap: 6, paddingHorizontal: 6 },
  todayButton: { minHeight: 34, borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, flexDirection: "row",
    alignItems: "center", gap: 5 },
  todayText: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  segments: { flex: 1, flexDirection: "row", borderWidth: 1, borderRadius: 6, padding: 2, gap: 2 },
  segment: { flex: 1, minHeight: 28, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  segmentText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  tool: { flex: 1, minHeight: 42, borderWidth: 1, borderRadius: 6, alignItems: "center", justifyContent: "center",
    gap: 2, paddingHorizontal: 2 },
  toolLabel: { fontFamily: fonts.medium, fontSize: 10, lineHeight: 13 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, paddingHorizontal: 8 },
  helpButton: { width: 34, minHeight: 34, borderWidth: 1, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  sheetScrim: { backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { flex: 1, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, overflow: "hidden" },
  sheetHeader: { minHeight: 52, paddingLeft: 16, paddingRight: 4, flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", borderBottomWidth: 1 },
  sheetTitle: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22 },
  sheetBody: { flex: 1 },
});
