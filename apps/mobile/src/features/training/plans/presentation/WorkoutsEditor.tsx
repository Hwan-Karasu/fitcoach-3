import { forwardRef, useEffect, useRef, useState, type Ref } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type Animated from "react-native-reanimated";
import type { AnimatedRef } from "react-native-reanimated";
import Sortable from "react-native-sortables";
import { ArrowLeftRight, ArrowUpDown, Check, Dumbbell, GripVertical, Link2, Plus, X } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, TextField } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ExerciseInfo } from "../domain/ExerciseLookupPort.ts";
import { addWorkout, fillSets, removeExercise, removeWorkout, renameWorkout, reorderExercises, reorderWorkouts,
  setInstruction, setRepsRange, setRir, setSetCount } from "../domain/SimplePlanEdits.ts";
import { INSTRUCTION_MAX, type PlannedExercise, type PlannedWorkout, type SimpleProgramDraft } from "../domain/SimplePlanModel.ts";
import { formatDuration, formatRange, parseDuration, parseRange, sanitizeRange, setFieldsOf, type PlanIssue } from
  "../domain/SimplePlanRules.ts";
import { applySupersetPress, IDLE_SUPERSET_PICK, pressSuperset, supersetNumber, type SupersetPick } from "../domain/SupersetRules.ts";

let counter = 0;
/** Новый стабильный ID строки структуры (тренировка, упражнение, подход). */
export function newPlanId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}:${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

type FieldKind = "count" | "range" | "duration" | "number";

/** Только допустимые символы: буквы в поля конструктора не вводятся (решение владельца 2026-10-18). */
function sanitize(kind: FieldKind, text: string): string {
  if (kind === "range") return sanitizeRange(text);
  if (kind === "duration") return text.replace(/[^\d:]/gu, "");
  return text.replace(/\D/gu, "");
}

/**
 * Поле карточки упражнения (как в 2.0): правится на месте. Свой текст ввода, пока поле в фокусе; кнопка
 * клавиатуры «Далее» переводит в следующее поле карточки, на последнем — «Готово».
 */
const InlineField = forwardRef(function InlineField({ label, value, placeholder, kind, last, onNext, onCommit }: Readonly<{
  label: string; value: string; placeholder: string; kind: FieldKind; last: boolean; onNext: () => void;
  /** Возвращает false, если ввод пока не годится (подсветка ошибкой). */
  onCommit: (text: string) => boolean;
}>, ref: Ref<TextInput>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) { setText(value); setInvalid(false); } }, [value]);
  return (
    <View style={styles.field}>
      <Text numberOfLines={1} style={[styles.fieldLabel, { color: colors.textMuted }]}>{label}</Text>
      <TextInput ref={ref} value={text} placeholder={placeholder} placeholderTextColor={colors.textMuted} selectTextOnFocus
        accessibilityLabel={label} keyboardType={kind === "duration" || kind === "range" ? "numbers-and-punctuation" : "number-pad"}
        returnKeyType={last ? "done" : "next"} submitBehavior={last ? "blurAndSubmit" : "submit"}
        onSubmitEditing={() => { if (!last) onNext(); }}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(value); setInvalid(false); }}
        onChangeText={(next) => {
          const clean = sanitize(kind, next);
          setText(clean);
          setInvalid(!onCommit(clean));
        }}
        style={[styles.fieldInput, { color: colors.textPrimary, backgroundColor: colors.input,
          borderColor: invalid ? colors.danger : colors.border }]} />
    </View>
  );
});

/** Общее значение у всех подходов; если подходы различаются — пусто с подсказкой «разные». */
function shared(values: readonly string[]): Readonly<{ value: string; placeholder: string }> {
  const first = values[0] ?? "";
  return values.every((value) => value === first) ? { value: first, placeholder: "—" } : { value: "", placeholder: "разные" };
}

/**
 * Карточка упражнения конструктора (как в 2.0): «Подходов», повторы (или время/метры — по профилю), RIR;
 * «⇄» — заменить из каталога, «×» — убрать из тренировки. Вес и отдых в конструкторе не задаются: вес —
 * результат дневника, отдых — в самой тренировке (решение владельца 2026-10-18).
 */
function ExerciseCard({ item, workout, info, broken, draft, change, onReplace, setState, onSet }: Readonly<{
  item: PlannedExercise; info: ExerciseInfo | null; broken: boolean; draft: SimpleProgramDraft;
  workout: PlannedWorkout;
  change: (next: SimpleProgramDraft) => void; onReplace: () => void;
  /** Кнопка «Сет» (UI-OWN-028): выбрано / можно собрать / обычное состояние. */
  setState: "idle" | "picked" | "ready"; onSet: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const metrics = info?.metrics ?? [];
  const fields = setFieldsOf(metrics).filter((field) => field !== "loadGrams");
  const withReps = fields.includes("reps");
  const [showInstruction, setShowInstruction] = useState(item.instruction !== null);
  const refs = useRef<(TextInput | null)[]>([]);
  const group = supersetNumber(workout, item);
  const inputs: Readonly<{ key: string; label: string; kind: FieldKind; value: string; placeholder: string;
    commit: (text: string) => boolean }>[] = [
    { key: "count", label: "Подходов", kind: "count", value: String(item.sets.length), placeholder: "3",
      commit: (text) => {
        if (text === "") return false;
        change(setSetCount(draft, item.id, Number(text), () => newPlanId("s")));
        return true;
      } },
    ...fields.map((field) => {
      if (field === "reps") {
        const value = shared(item.sets.map((set) => formatRange(set.reps === null ? null : { min: set.reps, max: set.repsMax })
          .replace("–", "-")));
        return { key: field, label: "Повторы", kind: "range" as const, ...value, placeholder: value.placeholder === "—" ? "8-12" : value.placeholder,
          commit: (text: string) => {
            const range = parseRange(text);
            if (range === "invalid") return false;
            change(setRepsRange(draft, item.id, range));
            return true;
          } };
      }
      const duration = field === "durationSec";
      const value = shared(item.sets.map((set) => set[field] === null ? "" : duration ? formatDuration(set[field] as number) : String(set[field])));
      return { key: field, label: duration ? "Время" : "Метры", kind: duration ? "duration" as const : "number" as const, ...value,
        commit: (text: string) => {
          const parsed = text === "" ? null : duration ? parseDuration(text) : Number(text);
          if (parsed === "invalid" || (parsed !== null && (!Number.isInteger(parsed) || parsed <= 0))) return false;
          change(fillSets(draft, item.id, field, parsed));
          return true;
        } };
    }),
    ...(withReps ? [{ key: "rir", label: "RIR", kind: "range" as const, value: formatRange(item.rir).replace("–", "-"), placeholder: "1-2",
      commit: (text: string) => {
        const range = parseRange(text);
        if (range === "invalid" || (range !== null && (range.min > 10 || (range.max ?? 0) > 10))) return false;
        change(setRir(draft, item.id, range));
        return true;
      } }] : []),
  ];
  const name = info?.name ?? "упражнение";
  const active = setState !== "idle";
  return (
    // Каждое упражнение — своя карточка (как в 2.0); участники суперсета — с акцентной полосой слева. Полоса —
    // отдельный слой: смена толщины рамки на лету у скруглённой карточки на Android оставляла её пустой.
    <View style={[styles.exerciseRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      {/* Название и действия — на фоне карточки; поля ввода ниже — отдельной полосой другого тона (UI-OWN-028). */}
      <View style={styles.exerciseHead}>
        <Sortable.Handle>
          <View accessible accessibilityLabel={`Перетащить: ${name}`} style={styles.handle}>
            <GripVertical size={16} color={colors.textMuted} strokeWidth={1.8} />
          </View>
        </Sortable.Handle>
        <View style={[styles.thumb, { backgroundColor: colors.surfaceRaised }]}>
          {info?.thumbnail != null ? <Image source={info.thumbnail} style={styles.thumbImage} />
            : <Dumbbell size={14} color={colors.accentInk} strokeWidth={1.8} />}
        </View>
        <View style={styles.grow}>
          <Text style={[styles.exerciseName, { color: broken ? colors.danger : colors.textPrimary }]}>
            {info?.name ?? "Упражнение не найдено в каталоге"}
          </Text>
          {group !== null ? <Text style={[styles.supersetTag, { color: colors.accentInk }]}>{`Суперсет ${group}`}</Text> : null}
        </View>
        <AppIconButton compact label={`Заменить: ${name}`}
          icon={<ArrowLeftRight size={17} color={colors.textSecondary} strokeWidth={1.8} />} onPress={onReplace} />
        <AppIconButton compact label={`Убрать из тренировки: ${name}`}
          icon={<X size={19} color={colors.danger} strokeWidth={2} />} onPress={() => change(removeExercise(draft, item.id))} />
      </View>
      <View style={[styles.exerciseBody, { backgroundColor: colors.surfaceRaised, borderTopColor: colors.border }]}>
        <View style={styles.fields}>
          {inputs.map((input, index) => (
            <InlineField key={input.key} ref={(node) => { refs.current[index] = node; }} label={input.label} kind={input.kind}
              value={input.value} placeholder={input.placeholder} last={index === inputs.length - 1}
              onNext={() => refs.current[index + 1]?.focus()} onCommit={input.commit} />
          ))}
          <View style={styles.setCell}>
            <Text numberOfLines={1} style={[styles.fieldLabel, { color: colors.textMuted }]}>Сет</Text>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: active }}
              accessibilityLabel={setState === "ready" ? "Собрать сет" : group !== null ? `Сет: ${name}, в суперсете ${group}` : `Сет: ${name}`}
              onPress={onSet} hitSlop={6}
              style={({ pressed }) => [styles.setButton, { borderColor: active || group !== null ? colors.accentInk : colors.border,
                backgroundColor: active ? colors.accentFill : pressed ? colors.surface : colors.input }]}>
              {setState === "ready" ? <Check size={18} color={colors.onAccentFill} strokeWidth={2.2} />
                : <Link2 size={18} color={active ? colors.onAccentFill : group !== null ? colors.accentInk : colors.textSecondary} strokeWidth={2} />}
            </Pressable>
          </View>
        </View>
        {showInstruction ? (
          <TextInput defaultValue={item.instruction ?? ""} multiline maxLength={INSTRUCTION_MAX} accessibilityLabel="Указание к упражнению"
            placeholder="Указание: темп, на что обратить внимание" placeholderTextColor={colors.textMuted}
            autoFocus={item.instruction === null} onChangeText={(text) => change(setInstruction(draft, item.id, text))}
            onBlur={() => { if (item.instruction === null) setShowInstruction(false); }}
            style={[styles.instruction, { color: colors.textPrimary, backgroundColor: colors.input, borderColor: colors.border }]} />
        ) : (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setShowInstruction(true)} style={styles.instructionAdd}>
            <Plus size={13} color={colors.textSecondary} strokeWidth={2} />
            <Text style={[styles.instructionAddText, { color: colors.textSecondary }]}>Указание</Text>
          </Pressable>
        )}
      </View>
      {group !== null ? <View pointerEvents="none" style={[styles.supersetStripe, { backgroundColor: colors.accentInk }]} /> : null}
    </View>
  );
}

/**
 * Редактор тренировок одной недели: общий для Простого и Расширенного конструкторов. Упражнения
 * перетаскиваются внутри тренировки, тренировки — в режиме «Порядок тренировок».
 */
export function WorkoutsEditor({ draft, change, lookup, issues, showIssues, scrollRef, onPickExercise, onReplaceExercise, singleWorkout = false }: Readonly<{
  draft: SimpleProgramDraft;
  change: (next: SimpleProgramDraft) => void;
  lookup: ReadonlyMap<string, ExerciseInfo>;
  issues: readonly PlanIssue[];
  showIssues: boolean;
  singleWorkout?: boolean;
  scrollRef: AnimatedRef<Animated.ScrollView>;
  onPickExercise: (workoutId: string) => void;
  /** «⇄»: выбрать в каталоге упражнение на замену этого. */
  onReplaceExercise: (workoutId: string, plannedExerciseId: string) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [removing, setRemoving] = useState<string | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [pick, setPick] = useState<SupersetPick>(IDLE_SUPERSET_PICK);
  const [dissolving, setDissolving] = useState<Readonly<{ workoutId: string; groupId: string }> | null>(null);
  const pressSet = (workout: PlannedWorkout, exerciseId: string) => {
    const result = pressSuperset(pick, workout, exerciseId);
    setPick(result.pick);
    if (result.action.type === "dissolve") setDissolving({ workoutId: workout.id, groupId: result.action.groupId });
    else if (result.action.type !== "none") change(applySupersetPress(draft, workout.id, result.action));
  };
  const setStateOf = (workoutId: string, exerciseId: string): "idle" | "picked" | "ready" => {
    if (pick.mode === "picking" && pick.workoutId === workoutId && pick.ids.includes(exerciseId)) {
      return pick.ids.length >= 2 && pick.ids[pick.ids.length - 1] === exerciseId ? "ready" : "picked";
    }
    return pick.mode === "leaving" && pick.workoutId === workoutId && pick.id === exerciseId ? "picked" : "idle";
  };
  const hintOf = (workoutId: string): string | null => {
    if (pick.mode === "leaving" && pick.workoutId === workoutId) return "Ещё раз «Сет» — вынуть из сета. На другом упражнении сета — расформировать.";
    if (pick.mode !== "picking" || pick.workoutId !== workoutId) return null;
    return pick.ids.length < 2 ? "Теперь «Сет» на соседнем упражнении." : "Ещё раз «Сет» на последнем — собрать сет. Или добавьте соседнее.";
  };

  if (ordering) {
    return <>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>Перетащите тренировки за ручку, затем нажмите «Готово».</Text>
      <Sortable.Grid data={[...draft.plan.workouts]} keyExtractor={(item) => item.id} columns={1} rowGap={8} customHandle
        scrollableRef={scrollRef} activeItemScale={1.03}
        renderItem={({ item }: Readonly<{ item: PlannedWorkout }>) => (
          <View style={[styles.orderRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Sortable.Handle>
              <View accessible accessibilityLabel={`Перетащить тренировку ${item.title}`} style={styles.handle}>
                <GripVertical size={20} color={colors.textMuted} strokeWidth={1.8} />
              </View>
            </Sortable.Handle>
            <Text numberOfLines={1} style={[styles.orderTitle, { color: colors.textPrimary }]}>{item.title}</Text>
            <Text style={[styles.hint, { color: colors.textMuted }]}>{`упражнений: ${item.exercises.length}`}</Text>
          </View>
        )}
        onDragEnd={({ data }) => change(reorderWorkouts(draft, data.map((item) => item.id)))} />
      <AppButton label="Готово" onPress={() => setOrdering(false)} />
    </>;
  }

  return <>
    {draft.plan.workouts.length > 1 ? (
      <AppButton compact variant="ghost" label="Порядок тренировок" icon={(color) => <ArrowUpDown size={18} color={color} strokeWidth={2} />}
        onPress={() => setOrdering(true)} />
    ) : null}
    {draft.plan.workouts.map((workout) => (
      <View key={workout.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {/* Шапка как в 2.0 (UI-OWN-026): акцентная полоса, название без подписи, «×» удаляет тренировку. */}
        <View style={styles.workoutHead}>
          <View style={[styles.stripe, { backgroundColor: colors.accentFill }]} />
          <View style={styles.grow}>
            <TextField label="Название тренировки" hideLabel value={workout.title}
              onChangeText={(title) => change(renameWorkout(draft, workout.id, title))} />
          </View>
          {!singleWorkout && draft.plan.workouts.length > 1 ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Удалить тренировку ${workout.title}`}
              onPress={() => setRemoving(workout.id)}
              style={({ pressed }) => [styles.removeWorkout, { borderColor: colors.danger, opacity: pressed ? 0.7 : 1 }]}>
              <X size={20} color={colors.danger} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
        {hintOf(workout.id) !== null ? (
          <Text accessibilityLiveRegion="polite" style={[styles.setHint, { color: colors.accentInk }]}>{hintOf(workout.id)}</Text>
        ) : null}
        {workout.exercises.length > 0 ? (
          <View style={styles.exercises}>
          <Sortable.Grid data={[...workout.exercises]} keyExtractor={(item) => item.id} columns={1} rowGap={8} customHandle
            scrollableRef={scrollRef} activeItemScale={1.03}
            renderItem={({ item }: Readonly<{ item: PlannedExercise }>) => (
              <ExerciseCard item={item} workout={workout} info={lookup.get(item.exerciseId) ?? null} draft={draft} change={change}
                broken={showIssues && issues.some((issue) => issue.exerciseId === item.id)}
                onReplace={() => onReplaceExercise(workout.id, item.id)}
                setState={setStateOf(workout.id, item.id)} onSet={() => pressSet(workout, item.id)} />
            )}
            onDragEnd={({ data }) => change(reorderExercises(draft, workout.id, data.map((item) => item.id)))} />
          </View>
        ) : null}
        <View style={styles.addExercise}>
          <AppButton variant="secondary" label="Добавить упражнение" accessibilityLabel={`Добавить упражнение в ${workout.title}`}
            icon={(color) => <Plus size={18} color={color} strokeWidth={2} />} onPress={() => onPickExercise(workout.id)} />
        </View>
      </View>
    ))}
    {!singleWorkout ? <AppButton variant="secondary" label="Добавить тренировку" icon={(color) => <Plus size={18} color={color} strokeWidth={2} />}
      onPress={() => change(addWorkout(draft, newPlanId("w")))} /> : null}
    <ConfirmDialog visible={removing !== null} destructive title="Удалить тренировку?"
      description="Тренировка и её упражнения уйдут из плана. Сохранение — кнопкой внизу; до него можно выйти без изменений."
      confirmLabel="Удалить" onCancel={() => setRemoving(null)}
      onConfirm={() => { if (removing !== null) change(removeWorkout(draft, removing)); setRemoving(null); }} />
    <ConfirmDialog visible={dissolving !== null} destructive title="Расформировать сет?"
      description="Упражнения останутся в тренировке по отдельности." confirmLabel="Расформировать"
      onCancel={() => setDissolving(null)}
      onConfirm={() => {
        if (dissolving !== null) change(applySupersetPress(draft, dissolving.workoutId, { type: "dissolve", groupId: dissolving.groupId }));
        setDissolving(null);
      }} />
  </>;
}

/** The constructor's cards in import-review mode. Choosing a catalog match is the only edit. */
export function WorkoutsReview({ workouts, names, matches, onMatch, disabled = false }: Readonly<{
  workouts: readonly PlannedWorkout[]; names: ReadonlyMap<string, string>; matches: ReadonlyMap<string, ExerciseInfo>;
  onMatch: (sourceExerciseId: string) => void; disabled?: boolean;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  const planText = (set: PlannedExercise["sets"][number]) => [
    set.reps === null ? null : formatRange({ min: set.reps, max: set.repsMax }),
    set.loadGrams === null ? null : `${(set.loadGrams / 1000).toLocaleString("ru-RU")} кг`,
    set.durationSec === null ? null : `${set.durationSec} с`, set.distanceM === null ? null : `${set.distanceM} м`,
  ].filter(Boolean).join(" × ") || "План не задан";
  return <View style={{ gap: 12 }}>{workouts.map((workout) => <View key={workout.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
    <View style={styles.workoutHead}>
      <View style={[styles.stripe, { backgroundColor: colors.accentFill }]} />
      <Text style={[styles.grow, styles.exerciseName, { color: colors.textPrimary }]}>{workout.title}</Text>
    </View>
    <View style={[styles.exercises, { gap: 8, paddingBottom: 10 }]}>{workout.exercises.map((item) => {
      const match = matches.get(item.exerciseId); const name = names.get(item.exerciseId) ?? item.exerciseId; const group = supersetNumber(workout, item);
      return <View key={item.id} style={[styles.exerciseRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <View style={[styles.exerciseHead, { paddingHorizontal: 8 }]}>
          <View style={[styles.thumb, { backgroundColor: colors.surfaceRaised }]}>{match?.thumbnail != null ? <Image source={match.thumbnail} style={styles.thumbImage} /> : <Dumbbell size={16} color={colors.accentInk} />}</View>
          <View style={styles.grow}>
            <Text style={[styles.exerciseName, { color: colors.textPrimary }]}>{name}</Text>
            <Text style={[styles.hint, { color: match ? colors.accentInk : colors.danger }]}>{match ? `Каталог: ${match.name}` : "Выберите упражнение из каталога"}</Text>
            {group !== null && <Text style={[styles.supersetTag, { color: colors.accentInk }]}>Суперсет {group}</Text>}
          </View>
          <AppIconButton compact disabled={disabled} label={`${match ? "Заменить" : "Выбрать"}: ${name}`} icon={<ArrowLeftRight size={19} color={colors.accentInk} />} onPress={() => onMatch(item.exerciseId)} />
        </View>
        <View style={[styles.exerciseBody, { backgroundColor: colors.surfaceRaised, borderTopColor: colors.border }]}>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{item.sets.length ? `Подходов: ${item.sets.length}${item.rir ? ` · RIR ${formatRange(item.rir)}` : ""}` : "Сохранено в истории"}</Text>
          {item.sets.map((set, i) => <Text key={set.id} style={[styles.exerciseName, { color: colors.textPrimary, paddingVertical: 3 }]}>{i + 1}. {planText(set)}</Text>)}
          {!!item.instruction && <Text style={[styles.hint, { color: colors.textSecondary }]}>{item.instruction}</Text>}
        </View>
        {group !== null && <View pointerEvents="none" style={[styles.supersetStripe, { backgroundColor: colors.accentInk }]} />}
      </View>;
    })}</View>
  </View>)}</View>;
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  card: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  workoutHead: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 },
  stripe: { width: 4, alignSelf: "stretch", borderRadius: 2 },
  removeWorkout: { width: 42, height: 42, borderWidth: 1, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  addExercise: { padding: 10 },
  exercises: { paddingHorizontal: 10 },
  exerciseRow: { borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  handle: { width: 28, minHeight: 44, alignItems: "center", justifyContent: "center" },
  exerciseHead: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4, paddingHorizontal: 2 },
  exerciseBody: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4 },
  supersetStripe: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  supersetTag: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  setCell: { width: 44, gap: 3 },
  setButton: { minHeight: 36, borderWidth: 1, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  setHint: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, paddingHorizontal: 12, paddingBottom: 6 },
  thumb: { width: 32, height: 32, borderRadius: 6, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  thumbImage: { width: 32, height: 32 },
  exerciseName: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
  fields: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  field: { flex: 1, minWidth: 0, gap: 3 },
  fieldLabel: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, textAlign: "center" },
  fieldInput: { minHeight: 36, borderWidth: 1, borderRadius: 8, textAlign: "center", fontFamily: fonts.medium, fontSize: 14,
    paddingHorizontal: 4, paddingVertical: 0 },
  instruction: { minHeight: 36, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginTop: 6,
    textAlignVertical: "top", fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  instructionAdd: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", minHeight: 30 },
  instructionAddText: { fontFamily: fonts.medium, fontSize: 12 },
  orderRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingRight: 12, minHeight: 56 },
  orderTitle: { flex: 1, fontFamily: fonts.semibold, fontSize: 14 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
