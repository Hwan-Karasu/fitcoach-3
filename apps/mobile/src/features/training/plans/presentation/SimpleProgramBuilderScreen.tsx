import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import Sortable from "react-native-sortables";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { ChevronRight, Dumbbell, GripVertical, Minus, Plus, Trash2 } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, InlineNotice, LoadingState, StickyEditorFooter,
  TextField } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ExerciseLookupPort } from "../domain/ExerciseLookupPort.ts";
import { addExercise, addSet, addWorkout, fillSets, newDraft, removeExercise, removeSet, removeWorkout, renameWorkout,
  reorderExercises, setTitle, setWeeks, updateSet } from "../domain/SimplePlanEdits.ts";
import { WEEKS_MAX, WEEKS_MIN, type PlannedExercise, type SimpleProgramDraft } from "../domain/SimplePlanModel.ts";
import { setFieldsOf, setsSummary, validateDraft } from "../domain/SimplePlanRules.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import { SetsEditorSheet } from "./SetsEditorSheet.tsx";
import { useExerciseLookup } from "./useExerciseLookup.ts";

/** Ключ черновика ещё не созданной программы (совпадает с хранилищем). */
const NEW_KEY = "new:SIMPLE";
const AUTOSAVE_MS = 800;

let counter = 0;
/** Новый стабильный ID строки структуры (тренировка, упражнение, подход). */
export function newPlanId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}:${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const errors: Readonly<Record<string, string>> = {
  DRAFT_INVALID: "Структура не сохранилась: проверьте название и тренировки.",
  PROGRAM_REVISION_CONFLICT: "Программа изменилась в другом месте. Откройте её заново — черновик сохранён.",
  TARGET_NOT_FOUND: "Программа или клиент не найдены.",
};

/**
 * Простой конструктор (§48.2, §48.4): название, число недель, тренировки базовой недели, упражнения из
 * каталога и плановые подходы. Несохранённое — в Recovery Draft (§48.29), публикация — только «Сохранить».
 */
export function SimpleProgramBuilderScreen({ clientId, programId, repository, exercises, picked, onPickExercise, onSaved }: Readonly<{
  clientId: string;
  programId: string | null;
  repository: TrainingPlansRepositoryPort;
  exercises: ExerciseLookupPort;
  /** Упражнение, выбранное в каталоге для тренировки (передаёт навигация). */
  picked: Readonly<{ token: string; workoutId: string; exerciseId: string }> | null;
  onPickExercise: (workoutId: string) => void;
  onSaved: (programId: string) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const lookup = useExerciseLookup(exercises);
  const key = programId ?? NEW_KEY;
  const [draft, setDraft] = useState<SimpleProgramDraft | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const sheet = useRef<BottomSheetModal>(null);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedPick = useRef<string | null>(null);

  // Загрузка: сохранённый план и, если есть, восстановленный черновик поверх него (§48.29 п. 2).
  useEffect(() => {
    let active = true;
    void (async () => {
      const saved = programId === null ? null : await repository.getSimplePlan(clientId, programId);
      const recovery = await repository.getBuilderDraft(clientId, key);
      if (!active) return;
      setRevision(saved?.program.revision ?? null);
      if (recovery !== null) { setDraft(recovery.draft); setRestored(true); }
      else setDraft(saved?.draft ?? newDraft(newPlanId("w")));
    })().catch(() => { if (active) setMessage("Не удалось открыть конструктор."); });
    return () => { active = false; };
  }, [clientId, key, programId, repository]);

  const change = useCallback((next: SimpleProgramDraft) => {
    setDraft(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void repository.saveBuilderDraft(clientId, key, revision, next).catch(() => undefined); }, AUTOSAVE_MS);
  }, [clientId, key, repository, revision]);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  // Выбранное в каталоге упражнение добавляется один раз.
  useEffect(() => {
    if (picked === null || draft === null || appliedPick.current === picked.token) return;
    appliedPick.current = picked.token;
    const plannedId = newPlanId("e");
    change(addExercise(draft, picked.workoutId, plannedId, picked.exerciseId, () => newPlanId("s")));
  }, [change, draft, picked]);

  const metricsOf = useCallback((exerciseId: string) => lookup?.get(exerciseId)?.metrics ?? null, [lookup]);
  const issues = useMemo(() => draft === null || lookup === null ? [] : validateDraft(draft, metricsOf), [draft, lookup, metricsOf]);
  const editingExercise = useMemo(() => draft?.plan.workouts.flatMap((workout) => workout.exercises)
    .find((exercise) => exercise.id === editing) ?? null, [draft, editing]);

  if (draft === null || lookup === null) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      {message !== null ? <InlineNotice kind="error">{message}</InlineNotice> : <LoadingState label="Открываем конструктор…" />}
    </View>;
  }

  const save = async () => {
    setShowIssues(true);
    if (issues.length > 0) { setMessage(issues[0]?.message ?? "Проверьте программу."); return; }
    if (timer.current !== null) clearTimeout(timer.current);
    setBusy(true);
    setMessage(null);
    try {
      const program = programId === null || revision === null
        ? await repository.createSimpleProgram(clientId, draft)
        : await repository.saveSimplePlan(clientId, programId, revision, draft);
      onSaved(program.id);
    } catch (error) {
      setMessage(errors[error instanceof Error ? error.message : ""] ?? "Не удалось сохранить. Черновик на месте.");
    } finally {
      setBusy(false);
    }
  };

  const discardRecovery = async () => {
    await repository.clearBuilderDraft(clientId, key);
    const saved = programId === null ? null : await repository.getSimplePlan(clientId, programId);
    setDraft(saved?.draft ?? newDraft(newPlanId("w")));
    setRestored(false);
  };

  const exerciseRow = ({ item }: Readonly<{ item: PlannedExercise }>) => {
    const info = lookup.get(item.exerciseId) ?? null;
    const broken = showIssues && issues.some((issue) => issue.exerciseId === item.id);
    return (
      <View style={[styles.exerciseRow, { borderTopColor: colors.border }]}>
        <Sortable.Handle>
          <View accessible accessibilityLabel={`Перетащить: ${info?.name ?? "упражнение"}`} style={styles.handle}>
            <GripVertical size={18} color={colors.textMuted} strokeWidth={1.8} />
          </View>
        </Sortable.Handle>
        <Pressable accessibilityRole="button" accessibilityLabel={`${info?.name ?? "Упражнение"}. ${setsSummary(item)}. Изменить подходы`}
          onPress={() => { setEditing(item.id); sheet.current?.present(); }}
          style={({ pressed }) => [styles.exercisePress, { backgroundColor: pressed ? colors.surfaceRaised : "transparent" }]}>
          <View style={[styles.thumb, { backgroundColor: colors.surfaceRaised }]}>
            {info?.thumbnail != null ? <Image source={info.thumbnail} style={styles.thumbImage} />
              : <Dumbbell size={16} color={colors.accentInk} strokeWidth={1.8} />}
          </View>
          <View style={styles.grow}>
            <Text numberOfLines={2} style={[styles.exerciseName, { color: broken ? colors.danger : colors.textPrimary }]}>
              {info?.name ?? "Упражнение не найдено в каталоге"}
            </Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{setsSummary(item)}</Text>
          </View>
          <ChevronRight size={18} color={colors.textMuted} strokeWidth={1.8} />
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.canvas }]}>
      <Animated.ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {restored ? (
          <InlineNotice kind="info">Восстановлен несохранённый черновик.</InlineNotice>
        ) : null}
        {restored ? <AppButton compact variant="secondary" label="Отменить несохранённые изменения" onPress={() => { void discardRecovery(); }} /> : null}
        <TextField label="Название программы" required value={draft.title} onChangeText={(title) => change(setTitle(draft, title))} />
        <View style={[styles.weeks, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.grow}>
            <Text style={[styles.weeksLabel, { color: colors.textPrimary }]}>Недель в программе</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>План недели повторяется каждую неделю</Text>
          </View>
          <AppIconButton compact label="Меньше недель" disabled={draft.plan.weeks <= WEEKS_MIN}
            icon={<Minus size={18} color={colors.textPrimary} strokeWidth={2} />} onPress={() => change(setWeeks(draft, draft.plan.weeks - 1))} />
          <Text accessibilityLabel={`Недель: ${draft.plan.weeks}`} style={[styles.weeksValue, { color: colors.textPrimary }]}>{draft.plan.weeks}</Text>
          <AppIconButton compact label="Больше недель" disabled={draft.plan.weeks >= WEEKS_MAX}
            icon={<Plus size={18} color={colors.textPrimary} strokeWidth={2} />} onPress={() => change(setWeeks(draft, draft.plan.weeks + 1))} />
        </View>

        {draft.plan.workouts.map((workout) => (
          <View key={workout.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.workoutHead}>
              <View style={styles.grow}>
                <TextField label="Тренировка" value={workout.title} onChangeText={(title) => change(renameWorkout(draft, workout.id, title))} />
              </View>
              <AppIconButton compact label={`Удалить тренировку ${workout.title}`} disabled={draft.plan.workouts.length === 1}
                icon={<Trash2 size={18} color={colors.textSecondary} strokeWidth={1.8} />} onPress={() => setRemoving(workout.id)} />
            </View>
            {workout.exercises.length > 0 ? (
              <Sortable.Grid data={[...workout.exercises]} keyExtractor={(item) => item.id} renderItem={exerciseRow}
                columns={1} rowGap={0} customHandle scrollableRef={scrollRef} activeItemScale={1.03}
                onDragEnd={({ data }) => change(reorderExercises(draft, workout.id, data.map((item) => item.id)))} />
            ) : (
              <Text style={[styles.empty, { color: colors.textMuted }]}>Упражнений пока нет.</Text>
            )}
            <Pressable accessibilityRole="button" accessibilityLabel={`Добавить упражнение в ${workout.title}`}
              onPress={() => onPickExercise(workout.id)}
              style={({ pressed }) => [styles.addRow, { borderTopColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : "transparent" }]}>
              <Plus size={16} color={colors.accentInk} strokeWidth={2} />
              <Text style={[styles.addText, { color: colors.accentInk }]}>Добавить упражнение</Text>
            </Pressable>
          </View>
        ))}
        <AppButton variant="secondary" label="Добавить тренировку" icon={(color) => <Plus size={18} color={color} strokeWidth={2} />}
          onPress={() => change(addWorkout(draft, newPlanId("w")))} />
      </Animated.ScrollView>

      <StickyEditorFooter actionLabel={programId === null ? "Создать программу" : "Сохранить"} busy={busy}
        onAction={() => { void save(); }} message={message} messageKind="error"
        note="Несохранённые изменения хранятся в черновике и не попадают в дневник" />

      <SetsEditorSheet ref={sheet} exercise={editingExercise}
        info={editingExercise === null ? null : lookup.get(editingExercise.exerciseId) ?? null}
        onDismiss={() => setEditing(null)}
        onChangeSet={(setId, field, value) => { if (editing !== null) change(updateSet(draft, editing, setId, field, value)); }}
        onAddSet={() => { if (editing !== null) change(addSet(draft, editing, newPlanId("s"))); }}
        onRemoveSet={(setId) => { if (editing !== null) change(removeSet(draft, editing, setId)); }}
        onFillAll={() => {
          if (editingExercise === null) return;
          const first = editingExercise.sets[0];
          const info = lookup.get(editingExercise.exerciseId);
          if (first === undefined || info === undefined) return;
          let next = draft;
          for (const field of setFieldsOf(info.metrics)) next = fillSets(next, editingExercise.id, field, first[field]);
          change(next);
          sheet.current?.dismiss();
        }}
        onRemoveExercise={() => { if (editing !== null) { change(removeExercise(draft, editing)); sheet.current?.dismiss(); } }} />
      <ConfirmDialog visible={removing !== null} destructive title="Удалить тренировку?"
        description="Тренировка и её упражнения уйдут из плана. Сохранение — кнопкой внизу; до него можно выйти без изменений."
        confirmLabel="Удалить" onCancel={() => setRemoving(null)}
        onConfirm={() => { if (removing !== null) change(removeWorkout(draft, removing)); setRemoving(null); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, padding: 16, justifyContent: "center" },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  grow: { flex: 1, minWidth: 0 },
  weeks: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 12, paddingLeft: 14, paddingRight: 4, paddingVertical: 8 },
  weeksLabel: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  weeksValue: { minWidth: 28, textAlign: "center", fontFamily: fonts.semibold, fontSize: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  card: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  workoutHead: { flexDirection: "row", alignItems: "flex-end", gap: 4, padding: 12, paddingRight: 4 },
  exerciseRow: { flexDirection: "row", alignItems: "stretch", minHeight: 60, borderTopWidth: StyleSheet.hairlineWidth },
  handle: { width: 40, flex: 1, alignItems: "center", justifyContent: "center" },
  exercisePress: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingRight: 12, paddingVertical: 8 },
  thumb: { width: 44, height: 44, borderRadius: 8, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  thumbImage: { width: 44, height: 44 },
  exerciseName: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  empty: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, paddingHorizontal: 12, paddingBottom: 8 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth },
  addText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19 },
});
