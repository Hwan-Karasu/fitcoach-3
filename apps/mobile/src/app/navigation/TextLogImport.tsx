import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChartColumn, Check, ChevronRight, Trash2 } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, DateField, InlineNotice, SelectionChip, TextField } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";
import { plural } from "../../shared/format/clockText.ts";
import { CYCLE_TYPES, ExerciseCardShell } from "../../features/training/public.ts";
import { assignLogExercise, copyLogSets, copySetsSource, duplicateLogExercise, editLogWorkout, logExercises, logStats, logWeeks, removeLogExercise,
  type LogExercise, type LogSet, type WorkoutLog } from "../../features/import/public.ts";

export type LogCycleType = (typeof CYCLE_TYPES)[number]["id"];
export type LogUpdate = (change: (log: WorkoutLog) => WorkoutLog) => void;
type LogStats = ReturnType<typeof logStats>;
/** Местная дата YYYY-MM-DD: дата без года в заметках — ближайшая прошедшая относительно неё. */
export const localToday = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
/** Пикер всегда показывает не меньше стольких номеров; наличие кнопки не создаёт тренировку. */
const PICKER_MIN = 4;
/** Ширина кнопки номера и промежуток — для прокрутки к выбранному. */
const PICK_STEP = 50;
const PER_WEEK_MAX = 7;
const range = (reps: (typeof CYCLE_TYPES)[number]["reps"]) => reps === null ? null : reps.max === null ? String(reps.min) : `${reps.min}–${reps.max}`;
/** Попадает ли упражнение в импорт: есть подходы или это плановая копия. */
const isIncluded = (exercise: LogExercise) => exercise.sets.length > 0 || (exercise.planSets ?? 0) > 0;
const number = (value: number) => value.toLocaleString("ru-RU");
const loadText = (sets: readonly LogSet[]) => {
  const loads = sets.flatMap((s) => s.loadKg === null ? [] : [s.loadKg]); if (!loads.length) return null;
  const low = Math.min(...loads); const high = Math.max(...loads);
  return low === high ? `${number(low)} кг` : `${number(low)}–${number(high)} кг`;
};
const counts = (stats: LogStats) => `${stats.exercises} ${plural(stats.exercises, "упражнение", "упражнения", "упражнений")}, ${stats.sets} ${plural(stats.sets, "подход", "подхода", "подходов")}`;
const workoutsText = (count: number) => `${count} ${plural(count, "тренировка", "тренировки", "тренировок")}`;
const weeksText = (count: number) => `${count} ${plural(count, "неделе", "неделях", "неделях")}`;

/** Шаг 1 импорта заметок (TEXT-LOG-2): вставка текста. */
export function TextLogInput({ text, error, busy, onText, onParse }: Readonly<{
  text: string; error: string; busy: boolean; onText: (text: string) => void; onParse: () => void;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <Text style={[styles.body, { color: colors.textSecondary }]}>Вставьте тренировки из заметок. Даты и названия тренировок необязательны: упражнения можно разложить на следующем шаге.</Text>
    <TextField label="Текст из заметок" multiline value={text} onChangeText={onText} placeholder="Вставьте текст" />
    {!!error && <InlineNotice kind="error">{error}</InlineNotice>}
    <AppButton label="Разобрать текст" busy={busy} disabled={!text.trim()} onPress={onParse} />
  </ScrollView>;
}

/**
 * Выбор тренировки упражнения: кнопки-номера «1 2 3 …» и «+» (новая тренировка); при многих тренировках ряд прокручивается.
 * Даты тренировок сюда не выводятся: они проставляются сами и правятся на шаге «Тренировки».
 */
function SessionPicker({ name, value, count, onPick }: Readonly<{ name: string; value: number; count: number; onPick: (index: number) => void }>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  const group = `Тренировка для «${name}»`;
  const shown = Math.max(PICKER_MIN, count, value + 1);
  const scroll = useRef<ScrollView>(null);
  const toSelected = useCallback(() => scroll.current?.scrollTo({ x: Math.max(0, (value - 1) * PICK_STEP), animated: false }), [value]);
  useEffect(toSelected, [toSelected]);
  const caption = <Text style={[styles.label, { color: colors.textMuted }]}>Тренировка</Text>;
  return <View style={styles.pickerLine}>{caption}
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" onContentSizeChange={toSelected}
      style={styles.picker} contentContainerStyle={styles.pickerRow}>
      {Array.from({ length: shown }, (_, i) => <View key={i} style={styles.pick}>
        <SelectionChip compact dense fill group={group} label={String(i + 1)} selected={i === value} onPress={() => onPick(i)} /></View>)}
      <View style={styles.pick}><SelectionChip compact dense fill group={group} label="+" selected={false} onPress={() => onPick(count)} /></View>
    </ScrollView>
  </View>;
}

/** Карточка упражнения единого списка: основа — карточка конструктора; подпись «подходы · повторы по типу цикла · вес». */
const ExercisePlacement = memo(function ExercisePlacement({ exercise, workout, count, repsText, clash, copyFrom, onAssign, onDuplicate, onCopySets, onRemove }: Readonly<{
  exercise: LogExercise; workout: number; count: number; repsText: string | null; clash: boolean; copyFrom: LogExercise | null;
  onAssign: (id: string, target: number) => void; onDuplicate: (id: string) => void; onCopySets: (id: string, from: string) => void; onRemove: (id: string) => void;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  const [confirm, setConfirm] = useState<"copy" | "remove" | null>(null);
  const sets = exercise.sets.length || exercise.planSets || 0;
  const subtitle = sets ? [`${sets} ${plural(sets, "подход", "подхода", "подходов")}`, repsText ? `${repsText} повт.` : null, loadText(exercise.sets)].filter(Boolean).join(" · ")
    : "Нет подходов — не попадёт в импорт";
  // Запись из текста с подходами убирается после подтверждения; плановая копия — сразу.
  const remove = () => { if (exercise.sets.length) setConfirm("remove"); else onRemove(exercise.id); };
  return <>
    <ExerciseCardShell name={exercise.name}
      subtitle={<>
        <Text style={[styles.hint, { color: sets ? colors.textSecondary : colors.danger }]}>{subtitle}</Text>
        {copyFrom && <Pressable accessibilityRole="button" accessibilityLabel={`Скопировать подходы: ${exercise.name}`} hitSlop={{ top: 8, bottom: 8 }} onPress={() => setConfirm("copy")} style={styles.link}>
          <Text style={[styles.actionText, { color: colors.accentInk }]}>Скопировать подходы</Text></Pressable>}
      </>}
      actions={<View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Дублировать: ${exercise.name}`} hitSlop={{ top: 8, bottom: 8 }} onPress={() => onDuplicate(exercise.id)} style={styles.textAction}>
          <Text style={[styles.actionText, { color: colors.accentInk }]}>Дублировать</Text></Pressable>
        <AppIconButton label={`Убрать: ${exercise.name}`} icon={<Trash2 size={18} color={colors.danger} />} onPress={remove} />
      </View>}>
      <SessionPicker name={exercise.name} value={workout} count={count} onPick={(index) => onAssign(exercise.id, index)} />
      {clash && <Text style={[styles.hint, { color: colors.danger }]}>Это упражнение уже есть в этой тренировке.</Text>}
    </ExerciseCardShell>
    <ConfirmDialog visible={confirm === "copy"} title="Скопировать подходы?"
      description={`Веса и повторы (${copyFrom?.sets.length ?? 0} ${plural(copyFrom?.sets.length ?? 0, "подход", "подхода", "подходов")}) будут перенесены из другой записи «${copyFrom?.name ?? ""}». Это факты из заметки, а не план.`}
      confirmLabel="Скопировать" onConfirm={() => { setConfirm(null); if (copyFrom) onCopySets(exercise.id, copyFrom.id); }} onCancel={() => setConfirm(null)} />
    <ConfirmDialog visible={confirm === "remove"} title="Убрать упражнение?" destructive
      description={`«${exercise.name}» (${sets} ${plural(sets, "подход", "подхода", "подходов")}) не попадёт в импорт. Текст заметки не изменится.`}
      confirmLabel="Убрать" onConfirm={() => { setConfirm(null); onRemove(exercise.id); }} onCancel={() => setConfirm(null)} />
  </>;
});

/**
 * Шаг 2 макета: тип цикла, похожие названия, единый список упражнений с пикером тренировки и нижняя панель. Недель здесь нет:
 * неделя — следствие даты тренировки, без дат — «тренировок в неделю».
 */
export function TextLogDistribution({ log, recognized, onUpdate, cycleType, onCycleType, perWeek, onPerWeek, similar, merged, onToggleMerge, busy, error, onContinue }: Readonly<{
  /** Итог первичного разбора; недели в нём показываются только если в заметках есть даты (иначе зависят от степпера). */
  log: WorkoutLog; recognized: LogStats & Readonly<{ dated: boolean }>; onUpdate: LogUpdate; cycleType: LogCycleType; onCycleType: (type: LogCycleType) => void;
  perWeek: number; onPerWeek: (count: number) => void;
  similar: readonly (readonly [string, string])[]; merged: ReadonlySet<number>; onToggleMerge: (index: number) => void;
  busy: boolean; error: string; onContinue: () => void;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  const items = useMemo(() => logExercises(log), [log]);
  const stats = useMemo(() => logStats(log, perWeek), [log, perWeek]);
  // Даты смотрим у тех же непустых тренировок, что и `logWeeks`: степпер нужен ровно тогда, когда недели считаются по порядку.
  const dated = log.workouts.some((w) => w.date && w.exercises.some(isIncluded));
  const count = log.workouts.length;
  const clashes = useMemo(() => {
    const seen = new Map<string, number>(); const key = (item: (typeof items)[number]) => `${item.workout}:${item.exercise.name.toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim()}`;
    for (const item of items) seen.set(key(item), (seen.get(key(item)) ?? 0) + 1);
    return new Set(items.filter((item) => seen.get(key(item))! > 1).map((item) => item.exercise.id));
  }, [items]);
  const sources = useMemo(() => new Map(items.filter((item) => !item.exercise.sets.length).map((item) => [item.exercise.id, copySetsSource(log, item.exercise.id)] as const)), [items, log]);
  const selectedType = CYCLE_TYPES.find((item) => item.id === cycleType)!; const repsText = range(selectedType.reps);
  const assign = useCallback((id: string, target: number) => onUpdate((l) => assignLogExercise(l, id, target)), [onUpdate]);
  const duplicate = useCallback((id: string) => onUpdate((l) => duplicateLogExercise(l, id)?.log ?? l), [onUpdate]);
  const copySets = useCallback((id: string, from: string) => onUpdate((l) => copyLogSets(l, id, from)), [onUpdate]);
  const remove = useCallback((id: string) => onUpdate((l) => removeLogExercise(l, id)), [onUpdate]);
  const renderItem = useCallback(({ item }: Readonly<{ item: (typeof items)[number] }>) => <ExercisePlacement exercise={item.exercise} workout={item.workout}
    count={count} repsText={repsText} clash={clashes.has(item.exercise.id)} copyFrom={sources.get(item.exercise.id) ?? null}
    onAssign={assign} onDuplicate={duplicate} onCopySets={copySets} onRemove={remove} />, [count, repsText, clashes, sources, assign, duplicate, copySets, remove]);
  const cycleRows = [CYCLE_TYPES.slice(0, 3), CYCLE_TYPES.slice(3)];
  const header = <View style={styles.stack}>
    <Text style={[styles.body, { color: colors.textSecondary }]}>Распознано: {workoutsText(recognized.workouts)}{recognized.dated ? ` в ${weeksText(recognized.weeks)}` : ""}, {counts(recognized)}.</Text>
    {!!log.unknownLines.length && <InlineNotice kind="warning">{`Не распознаны строки (${log.unknownLines.length}): `
      + log.unknownLines.slice(0, 5).map((l) => `${l.line} «${l.text}»`).join(", ") + (log.unknownLines.length > 5 ? "…" : "")
      + ". Исправьте текст и разберите заново, иначе эти строки не попадут в импорт."}</InlineNotice>}
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.heading, { color: colors.textPrimary }]}>Тип цикла</Text>
      {cycleRows.map((row, i) => <View key={i} style={styles.gridRow}>{row.map((item) => <SelectionChip key={item.id} compact fill group="Тип цикла" label={item.label}
        selected={item.id === cycleType} onPress={() => onCycleType(item.id)} />)}</View>)}
      <Text style={[styles.hint, { color: colors.textSecondary }]}>{repsText === null ? "Свой: план повторений останется пустым." : `${selectedType.label}: ${repsText} повторений.`}</Text>
      {!dated && <View style={styles.stepper}>
        <Text style={[styles.body, styles.stepperText, { color: colors.textPrimary }]}>Тренировок в неделю</Text>
        <AppButton compact variant="secondary" label="−" accessibilityLabel="Меньше тренировок в неделю" disabled={perWeek <= 1} onPress={() => onPerWeek(perWeek - 1)} />
        <Text style={[styles.heading, { color: colors.textPrimary }]}>{perWeek}</Text>
        <AppButton compact variant="secondary" label="+" accessibilityLabel="Больше тренировок в неделю" disabled={perWeek >= PER_WEEK_MAX} onPress={() => onPerWeek(perWeek + 1)} />
      </View>}
    </View>
    {!!similar.length && <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.heading, { color: colors.textPrimary }]}>Похожие названия</Text>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>Объединим похожие названия из заметки в одно упражнение:</Text>
      {similar.map(([keep, replace], i) => { const on = merged.has(i); const ink = on ? colors.onAccentFill : colors.textSecondary;
        return <Pressable key={`${keep}|${replace}`} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`Объединить «${replace}» с «${keep}»`}
          onPress={() => onToggleMerge(i)} style={[styles.pair, { backgroundColor: on ? colors.accentFill : colors.input, borderColor: on ? "transparent" : colors.border }]}>
          {on ? <Check size={20} color={ink} strokeWidth={2.2} /> : <View style={styles.pairGap} />}
          <Text numberOfLines={2} style={[styles.pairText, { color: ink }]}>«{replace}» → «{keep}»</Text>
          <ChevronRight size={18} color={ink} strokeWidth={2} />
        </Pressable>; })}
      <Text style={[styles.hint, { color: colors.textSecondary }]}>Нажми на вариант, если название определено неверно.</Text>
    </View>}
    <Text style={[styles.heading, styles.listTitle, { color: colors.textPrimary }]}>Упражнения ({items.length})</Text>
    {!!error && <InlineNotice kind="error">{error}</InlineNotice>}
  </View>;
  return <View style={styles.screen}>
    <FlatList data={items} keyExtractor={(item) => item.exercise.id} renderItem={renderItem} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" ListHeaderComponent={header} initialNumToRender={8} windowSize={9}
      ItemSeparatorComponent={Separator} />
    <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
      <View style={[styles.barIcon, { backgroundColor: colors.surfaceRaised }]}><ChartColumn size={22} color={colors.accentInk} strokeWidth={1.8} /></View>
      <View style={styles.barText}>
        <Text style={[styles.barTitle, { color: colors.textPrimary }]}>Будет создано: {workoutsText(stats.workouts)} в {weeksText(stats.weeks)}</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Распределено: {counts(stats)}</Text>
      </View>
      <AppButton compact label="Далее" busy={busy} disabled={!stats.sets} onPress={onContinue} />
    </View>
  </View>;
}

const Separator = () => <View style={styles.separator} />;

/** Шаг 3: название (обязательное) и дата (из заметок или пусто) каждой тренировки, когда упражнения уже разложены. */
export function TextLogWorkouts({ log, perWeek, onUpdate, busy, error, onContinue }: Readonly<{
  log: WorkoutLog; perWeek: number; onUpdate: LogUpdate; busy: boolean; error: string; onContinue: () => void;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  const weeks = useMemo(() => logWeeks(log, perWeek), [log, perWeek]);
  // Порядок — как в расчёте недель (при полных датах хронологический), чтобы подписи «неделя N» не шли вразнобой.
  const rows = [...weeks.keys()].map((index) => ({ workout: log.workouts[index]!, index }));
  const missing = rows.some(({ workout }) => !workout.title.trim());
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <View style={styles.stack}>
      <Text style={[styles.body, { color: colors.textSecondary }]}>Назовите тренировки. Дата из заметок подставлена, если она там была; неделя считается по дате.</Text>
      {rows.map(({ workout, index }) => <View key={index} style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.heading, { color: colors.textPrimary }]}>Тренировка {index + 1} · неделя {weeks.get(index)! + 1}</Text>
        <TextField label="Название" compact value={workout.title} error={workout.title.trim() ? undefined : "Введите название тренировки"}
          onChangeText={(title) => onUpdate((l) => editLogWorkout(l, index, { title }))} />
        <DateField label="Дата" value={workout.date ?? ""} placeholder="Без даты" onChange={(date) => onUpdate((l) => editLogWorkout(l, index, { date }))} />
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{workout.exercises.filter(isIncluded).map((e) => { const n = e.sets.length || e.planSets!;
          return `${e.name} — ${n} ${plural(n, "подход", "подхода", "подходов")}`; }).join("; ")}</Text>
      </View>)}
      {!!error && <InlineNotice kind="error">{error}</InlineNotice>}
      <AppButton label="Далее: сверка упражнений" busy={busy} disabled={!rows.length || missing} onPress={onContinue} />
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { padding: 16, paddingBottom: 24 }, stack: { gap: 10, paddingBottom: 12 }, separator: { height: 8 },
  panel: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 }, gridRow: { flexDirection: "row", gap: 8 },
  heading: { fontFamily: fonts.semibold, fontSize: 18 }, listTitle: { paddingTop: 4 }, body: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 }, label: { width: 84, fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  pair: { minHeight: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 12 },
  actions: { flexDirection: "row", alignItems: "center" }, textAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: 6 },
  link: { minHeight: 32, justifyContent: "center" }, actionText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 }, stepperText: { flex: 1 },
  pairGap: { width: 20 }, pairText: { flex: 1, fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
  pickerLine: { flexDirection: "row", alignItems: "center", gap: 12 }, picker: { flex: 1 }, pickerRow: { gap: 6, alignItems: "center" }, pick: { width: 44, flexDirection: "row" },
  bar: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 10 },
  barIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" }, barText: { flex: 1, minWidth: 0 },
  barTitle: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
});
