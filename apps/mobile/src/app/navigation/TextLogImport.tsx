import { memo, useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChartColumn, Check, ChevronRight, Ellipsis } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, DateField, DropdownMenu, InlineNotice, SelectionChip, TextField } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";
import { plural } from "../../shared/format/clockText.ts";
import { CYCLE_TYPES, ExerciseCardShell } from "../../features/training/public.ts";
import { assignLogExercise, copyLogSets, copySetsSource, duplicateLogExercise, editLogWorkout, logExercises, logStats, removeLogExercise,
  type LogExercise, type LogSet, type WorkoutLog } from "../../features/import/public.ts";

export type LogCycleType = (typeof CYCLE_TYPES)[number]["id"];
export type LogUpdate = (change: (log: WorkoutLog) => WorkoutLog) => void;
type LogStats = ReturnType<typeof logStats>;
/** Местная дата YYYY-MM-DD: дата без года в заметках — ближайшая прошедшая относительно неё. */
export const localToday = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
/** Пикер всегда показывает не меньше стольких номеров; наличие кнопки не создаёт тренировку. */
const PICKER_MIN = 4;
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

/** Выбор тренировки упражнения: номера и «+»; при многих тренировках пикер прокручивается внутри карточки. */
function WorkoutPicker({ id, name, workout, count, onAssign }: Readonly<{ id: string; name: string; workout: number; count: number; onAssign: (id: string, target: number) => void }>) {
  const shown = Math.max(PICKER_MIN, count, workout + 1); const group = `Тренировка для «${name}»`;
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.picker} contentContainerStyle={styles.pickerRow}>
    {Array.from({ length: shown }, (_, i) => <View key={i} style={styles.pick}>
      <SelectionChip compact dense group={group} label={String(i + 1)} selected={i === workout} onPress={() => onAssign(id, i)} /></View>)}
    <View style={styles.pick}><SelectionChip compact dense group={group} label="+" selected={false} onPress={() => onAssign(id, shown)} /></View>
  </ScrollView>;
}

type MenuAction = "duplicate" | "copy" | "remove";

/** Карточка упражнения единого списка: основа — карточка конструктора; подпись «подходы · повторы по типу цикла · вес». */
const ExercisePlacement = memo(function ExercisePlacement({ exercise, workout, workouts, repsText, clash, copyFrom, onAssign, onDuplicate, onCopySets, onRemove }: Readonly<{
  exercise: LogExercise; workout: number; workouts: number; repsText: string | null; clash: boolean; copyFrom: LogExercise | null;
  onAssign: (id: string, target: number) => void; onDuplicate: (id: string) => void; onCopySets: (id: string, from: string) => void; onRemove: (id: string) => void;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  const anchor = useRef<View>(null); const [menu, setMenu] = useState(false); const [confirm, setConfirm] = useState(false);
  const isCopy = exercise.id.includes("+"); const sets = exercise.sets.length || exercise.planSets || 0;
  const subtitle = sets ? [`${sets} ${plural(sets, "подход", "подхода", "подходов")}`, repsText ? `${repsText} повт.` : null, loadText(exercise.sets)].filter(Boolean).join(" · ")
    : "Нет подходов — не попадёт в импорт";
  const options: readonly Readonly<{ value: MenuAction; label: string }>[] = [{ value: "duplicate", label: "Дублировать" },
    ...(copyFrom ? [{ value: "copy" as const, label: "Скопировать подходы" }] : []), ...(isCopy ? [{ value: "remove" as const, label: "Убрать копию" }] : [])];
  const choose = (action: MenuAction) => {
    setMenu(false);
    if (action === "duplicate") onDuplicate(exercise.id); else if (action === "remove") onRemove(exercise.id); else setConfirm(true);
  };
  return <>
    <ExerciseCardShell name={exercise.name}
      subtitle={<Text style={[styles.hint, { color: sets ? colors.textSecondary : colors.danger }]}>{subtitle}</Text>}
      actions={<View ref={anchor} collapsable={false}><AppIconButton label={`Действия: ${exercise.name}`} icon={<Ellipsis size={20} color={colors.textPrimary} />} onPress={() => setMenu(true)} /></View>}>
      <View style={styles.pickerLine}>
        <Text style={[styles.label, { color: colors.textMuted }]}>Тренировка</Text>
        <WorkoutPicker id={exercise.id} name={exercise.name} workout={workout} count={workouts} onAssign={onAssign} />
      </View>
      {clash && <Text style={[styles.hint, { color: colors.danger }]}>Это упражнение уже есть в этой тренировке.</Text>}
    </ExerciseCardShell>
    <DropdownMenu visible={menu} anchor={anchor} title={`Действия: ${exercise.name}`} options={options} selected={"" as MenuAction} onSelect={choose} onClose={() => setMenu(false)} />
    <ConfirmDialog visible={confirm} title="Скопировать подходы?"
      description={`Веса и повторы (${copyFrom?.sets.length ?? 0} ${plural(copyFrom?.sets.length ?? 0, "подход", "подхода", "подходов")}) будут перенесены из другой записи «${copyFrom?.name ?? ""}». Это факты из заметки, а не план.`}
      confirmLabel="Скопировать" onConfirm={() => { setConfirm(false); if (copyFrom) onCopySets(exercise.id, copyFrom.id); }} onCancel={() => setConfirm(false)} />
  </>;
});

/** Шаг 2 макета: тип цикла, похожие названия, единый список упражнений с пикером тренировки и нижняя панель. */
export function TextLogDistribution({ log, recognized, onUpdate, cycleType, onCycleType, similar, merged, onToggleMerge, busy, error, onContinue }: Readonly<{
  log: WorkoutLog; recognized: LogStats; onUpdate: LogUpdate; cycleType: LogCycleType; onCycleType: (type: LogCycleType) => void;
  similar: readonly (readonly [string, string])[]; merged: ReadonlySet<number>; onToggleMerge: (index: number) => void;
  busy: boolean; error: string; onContinue: () => void;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  const items = useMemo(() => logExercises(log), [log]);
  const stats = useMemo(() => logStats(log), [log]);
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
  const workouts = log.workouts.length;
  const renderItem = useCallback(({ item }: Readonly<{ item: (typeof items)[number] }>) => <ExercisePlacement exercise={item.exercise} workout={item.workout} workouts={workouts}
    repsText={repsText} clash={clashes.has(item.exercise.id)} copyFrom={sources.get(item.exercise.id) ?? null}
    onAssign={assign} onDuplicate={duplicate} onCopySets={copySets} onRemove={remove} />, [workouts, repsText, clashes, sources, assign, duplicate, copySets, remove]);
  const cycleRows = [CYCLE_TYPES.slice(0, 3), CYCLE_TYPES.slice(3)];
  const header = <View style={styles.stack}>
    <Text style={[styles.body, { color: colors.textSecondary }]}>Распознано: {workoutsText(recognized.workouts)}, {counts(recognized)}.</Text>
    {!!log.unknownLines.length && <InlineNotice kind="warning">{`Не распознаны строки (${log.unknownLines.length}): `
      + log.unknownLines.slice(0, 5).map((l) => `${l.line} «${l.text}»`).join(", ") + (log.unknownLines.length > 5 ? "…" : "")
      + ". Исправьте текст и разберите заново, иначе эти строки не попадут в импорт."}</InlineNotice>}
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.heading, { color: colors.textPrimary }]}>Тип цикла</Text>
      {cycleRows.map((row, i) => <View key={i} style={styles.gridRow}>{row.map((item) => <SelectionChip key={item.id} fill group="Тип цикла" label={item.label}
        selected={item.id === cycleType} onPress={() => onCycleType(item.id)} />)}</View>)}
      <Text style={[styles.hint, { color: colors.textSecondary }]}>{repsText === null ? "Свой: план повторений останется пустым." : `${selectedType.label}: ${repsText} повторений.`}</Text>
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
        <Text style={[styles.barTitle, { color: colors.textPrimary }]}>Будет создано: {workoutsText(stats.workouts)}</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Распределено: {counts(stats)}</Text>
      </View>
      <AppButton compact label="Далее" busy={busy} disabled={!stats.sets} onPress={onContinue} />
    </View>
  </View>;
}

const Separator = () => <View style={styles.separator} />;

/** Шаг 3: название (обязательное) и дата (из заметок или пусто) каждой тренировки, когда упражнения уже разложены. */
export function TextLogWorkouts({ log, onUpdate, busy, error, onContinue }: Readonly<{
  log: WorkoutLog; onUpdate: LogUpdate; busy: boolean; error: string; onContinue: () => void;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  const rows = log.workouts.map((workout, index) => ({ workout, index })).filter(({ workout }) => workout.exercises.some(isIncluded));
  const missing = rows.some(({ workout }) => !workout.title.trim());
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <View style={styles.stack}>
      <Text style={[styles.body, { color: colors.textSecondary }]}>Назовите тренировки. Дата из заметок подставлена, если она там была.</Text>
      {rows.map(({ workout, index }) => <View key={index} style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.heading, { color: colors.textPrimary }]}>Тренировка {index + 1}</Text>
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
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 }, label: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  pair: { minHeight: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 12 },
  pairGap: { width: 20 }, pairText: { flex: 1, fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
  pickerLine: { flexDirection: "row", alignItems: "center", gap: 12 }, picker: { flex: 1 }, pickerRow: { gap: 6, alignItems: "center" }, pick: { width: 44 },
  bar: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 10 },
  barIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" }, barText: { flex: 1, minWidth: 0 },
  barTitle: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
});
