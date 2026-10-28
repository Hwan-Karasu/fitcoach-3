import { useRef, useState } from "react";
import { FlatList, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, DateField, DropdownMenu, InlineNotice, SelectionChip, TextField } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";
import { CYCLE_TYPES, ExerciseCardShell } from "../../features/training/public.ts";
import { editLogWorkout, moveLogExercise, type LogExercise, type WorkoutLog } from "../../features/import/public.ts";

export type LogCycleType = (typeof CYCLE_TYPES)[number]["id"];
/** Местная дата YYYY-MM-DD: дата без года в заметках — ближайшая прошедшая относительно неё. */
export const localToday = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
/** Больше тренировок — выбор списком, а не чипами в каждой карточке. */
const CHIPS_MAX = 6;
const range = (reps: (typeof CYCLE_TYPES)[number]["reps"]) => reps === null ? "пусто" : reps.max === null ? String(reps.min) : `${reps.min}–${reps.max}`;
const kg = (value: number | null) => value === null ? "" : `${value.toLocaleString("ru-RU")} кг × `;

/** Шаг 1 импорта заметок (TEXT-LOG-2): вставка текста. */
export function TextLogInput({ text, error, busy, onText, onParse }: Readonly<{
  text: string; error: string; busy: boolean; onText: (text: string) => void; onParse: () => void;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <Text style={[styles.body, { color: colors.textSecondary }]}>
      Вставьте тренировки из заметок. Строка с датой — тренировка («Фуллбоди 26.07.2026»), строка с буквами — упражнение,
      «22 на 15» — подход: вес на повторы. Комментарий в скобках сохранится заметкой. Если дат нет, упражнения можно разложить по тренировкам на следующем шаге.
    </Text>
    <TextField label="Текст из заметок" multiline value={text} onChangeText={onText} placeholder={"Фуллбоди 26.07.2026\nЭкстензия\n0 на 15\n0 на 15"} />
    {!!error && <InlineNotice kind="error">{error}</InlineNotice>}
    <AppButton label="Разобрать текст" busy={busy} disabled={!text.trim()} onPress={onParse} />
  </ScrollView>;
}

function WorkoutChoice({ log, workout, exercise, name, onChange }: Readonly<{
  log: WorkoutLog; workout: number; exercise: number; name: string; onChange: (log: WorkoutLog) => void;
}>) {
  const anchor = useRef<View>(null); const [open, setOpen] = useState(false);
  const move = (target: number) => onChange(moveLogExercise(log, workout, exercise, target));
  if (log.workouts.length <= CHIPS_MAX) return <View style={styles.chips}>
    {log.workouts.map((_, i) => <SelectionChip key={i} compact dense group={`Тренировка для «${name}»`} label={String(i + 1)} selected={i === workout} onPress={() => move(i)} />)}
    <SelectionChip compact dense group={`Тренировка для «${name}»`} label="+" selected={false} onPress={() => move(log.workouts.length)} />
  </View>;
  const options = [...log.workouts.map((w, i) => ({ value: String(i), label: `${i + 1}. ${w.title}${w.date ? ` · ${w.date.split("-").reverse().join(".")}` : ""}` })),
    { value: "new", label: "Новая тренировка" }];
  return <View ref={anchor} collapsable={false}>
    <AppButton compact variant="secondary" label={`Тренировка ${workout + 1}`} onPress={() => setOpen(true)} />
    <DropdownMenu visible={open} anchor={anchor} title={`Тренировка для «${name}»`} searchable options={options} selected={String(workout)}
      onSelect={(value) => { setOpen(false); move(value === "new" ? log.workouts.length : Number(value)); }} onClose={() => setOpen(false)} />
  </View>;
}

/** Шаг 2: тип цикла, похожие названия и раскладка упражнений по тренировкам — карточками конструктора. */
export function TextLogDistribution({ log, onChange, cycleType, onCycleType, similar, merged, onToggleMerge, busy, error, onContinue }: Readonly<{
  log: WorkoutLog; onChange: (log: WorkoutLog) => void; cycleType: LogCycleType; onCycleType: (type: LogCycleType) => void;
  similar: readonly (readonly [string, string])[]; merged: ReadonlySet<number>; onToggleMerge: (index: number) => void;
  busy: boolean; error: string; onContinue: () => void;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  const exercises = log.workouts.reduce((sum, w) => sum + w.exercises.length, 0);
  const sets = log.workouts.reduce((sum, w) => sum + w.exercises.reduce((n, e) => n + e.sets.length, 0), 0);
  const selectedType = CYCLE_TYPES.find((item) => item.id === cycleType)!;
  const card = (exercise: LogExercise, workout: number, index: number) => <ExerciseCardShell key={`${workout}:${index}:${exercise.line}`} name={exercise.name}
    subtitle={<Text style={[styles.hint, { color: exercise.sets.length ? colors.textSecondary : colors.danger }]}>
      {exercise.sets.length ? exercise.sets.map((s) => `${kg(s.loadKg)}${s.reps}`).join(", ") : "Нет подходов — не попадёт в импорт"}</Text>}>
    <Text style={[styles.label, { color: colors.textMuted }]}>Тренировка</Text>
    <WorkoutChoice log={log} workout={workout} exercise={index} name={exercise.name} onChange={onChange} />
  </ExerciseCardShell>;
  const header = <View style={styles.stack}>
    <Text style={[styles.body, { color: colors.textSecondary }]}>Распознано: тренировок {log.workouts.length}, упражнений {exercises}, подходов {sets}.</Text>
    {!!log.unknownLines.length && <InlineNotice kind="warning">{`Не распознаны строки (${log.unknownLines.length}): `
      + log.unknownLines.slice(0, 5).map((l) => `${l.line} «${l.text}»`).join(", ") + (log.unknownLines.length > 5 ? "…" : "")
      + ". Исправьте текст и разберите заново, иначе эти строки не попадут в импорт."}</InlineNotice>}
    <Text style={[styles.heading, { color: colors.textPrimary }]}>Тип цикла</Text>
    <View style={styles.chips}>{CYCLE_TYPES.map((item) => <SelectionChip key={item.id} compact group="Тип цикла" label={item.label}
      selected={item.id === cycleType} onPress={() => onCycleType(item.id)} />)}</View>
    <Text style={[styles.hint, { color: colors.textSecondary }]}>{selectedType.reps === null ? "План повторений останется пустым — задайте его в конструкторе."
      : `План повторений: ${range(selectedType.reps)}. Факты из текста сохранятся как результаты.`}</Text>
    {!!similar.length && <>
      <Text style={[styles.heading, { color: colors.textPrimary }]}>Похожие названия</Text>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>Отмеченные пары станут одним упражнением с первым названием.</Text>
      {similar.map(([keep, replace], i) => <SelectionChip key={`${keep}|${replace}`} compact group="Объединить" label={`«${replace}» → «${keep}»`}
        selected={merged.has(i)} onPress={() => onToggleMerge(i)} />)}
    </>}
    <Text style={[styles.hint, { color: colors.textSecondary }]}>Номер в карточке — тренировка, куда попадёт упражнение; «+» создаёт новую.</Text>
  </View>;
  return <FlatList data={log.workouts} keyExtractor={(w, i) => `${i}:${w.line}`} contentContainerStyle={styles.content}
    keyboardShouldPersistTaps="handled" ListHeaderComponent={header} initialNumToRender={4} windowSize={7}
    ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
    renderItem={({ item, index }) => <View style={[styles.workout, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.heading, { color: colors.textPrimary }]}>Тренировка {index + 1}</Text>
      <TextField label="Название" compact value={item.title} onChangeText={(title) => onChange(editLogWorkout(log, index, { title }))} />
      <DateField label="Дата" value={item.date ?? ""} placeholder="Без даты" onChange={(date) => onChange(editLogWorkout(log, index, { date }))} />
      {item.exercises.length ? item.exercises.map((exercise, i) => card(exercise, index, i))
        : <Text style={[styles.hint, { color: colors.textSecondary }]}>Пусто — тренировка не попадёт в импорт.</Text>}
    </View>}
    ListFooterComponent={<View style={[styles.stack, { paddingTop: 12 }]}>
      {!!error && <InlineNotice kind="error">{error}</InlineNotice>}
      <AppButton label="Далее: сверка упражнений" busy={busy} disabled={!sets} onPress={onContinue} />
    </View>} />;
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 }, stack: { gap: 10, paddingBottom: 12 },
  workout: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  heading: { fontFamily: fonts.semibold, fontSize: 16 }, body: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 }, label: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, paddingBottom: 4 },
});
