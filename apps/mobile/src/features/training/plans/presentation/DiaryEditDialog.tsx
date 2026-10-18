import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { applyDiaryEdit, diaryEditTitles, type DiaryEdit } from "../domain/DiaryEdit.ts";
import type { ExerciseLookupPort } from "../domain/ExerciseLookupPort.ts";
import { WEEK_SCOPES, weekScopeLabels, type WeekEditPreview, type WeekScope, type WeekType } from "../domain/PeriodizedModel.ts";
import type { PlannedWorkout } from "../domain/SimplePlanModel.ts";
import { setFieldsOf } from "../domain/SimplePlanRules.ts";
import { simpleWorkoutScopeLabels, type SimpleWorkoutScope } from "../domain/SimpleWorkoutEdit.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import { newPlanId } from "./WorkoutsEditor.tsx";
import { useExerciseLookup } from "./useExerciseLookup.ts";

type Scope = SimpleWorkoutScope | WeekScope;

/** Загруженный план для правки: тренировка недели, ревизия программы; у Расширенной — неделя целиком и её тип. */
type Loaded = Readonly<{ revision: number; workout: PlannedWorkout; week?: Readonly<{ workouts: readonly PlannedWorkout[]; type: WeekType }> }>;

const errors: Readonly<Record<string, string>> = {
  PROGRAM_REVISION_CONFLICT: "Программа изменилась в другом месте. Откройте действие ещё раз.",
  DRAFT_INVALID: "Так нельзя: в тренировке должно остаться хотя бы одно упражнение с подходами.",
};

/**
 * Правка плана из дневника (UI-OWN-037): действие уже выбрано в дневнике, здесь — только область (§48.5 у Простой,
 * §48.6 у Расширенной, правка только у этого клиента) и сохранение. Недели с персональной структурой не
 * перезаписываются — об этом предупреждает предпросмотр.
 */
export function DiaryEditDialog({ clientId, programId, mesocycleId, weekIndex, workoutId, repository, exercises, edit,
  onClose, onDone }: Readonly<{
  clientId: string; programId: string; mesocycleId: string | null; weekIndex: number; workoutId: string;
  repository: TrainingPlansRepositoryPort; exercises: ExerciseLookupPort;
  edit: DiaryEdit | null;
  onClose: () => void;
  /** Сохранено: текст для подсказки в дневнике. */
  onDone: (text: string) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const lookup = useExerciseLookup(exercises);
  const scopes: readonly Scope[] = mesocycleId === null ? ["CURRENT", "FOLLOWING", "ALL"] : WEEK_SCOPES;
  const labelOf = (scope: Scope) => mesocycleId === null ? simpleWorkoutScopeLabels[scope as SimpleWorkoutScope] : weekScopeLabels[scope as WeekScope];
  const [scope, setScope] = useState<Scope>("CURRENT");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [preview, setPreview] = useState<WeekEditPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (edit === null) return undefined;
    let active = true;
    setScope("CURRENT"); setLoaded(null); setPreview(null); setMessage(null);
    void (async () => {
      if (mesocycleId === null) {
        const found = await repository.findWorkout(clientId, programId, workoutId, weekIndex);
        if (found === null) throw new Error("TARGET_NOT_FOUND");
        return { revision: found.program.revision, workout: found.workout };
      }
      const plan = await repository.getPeriodizedPlan(clientId, programId);
      const week = plan?.mesocycles.find((item) => item.id === mesocycleId)?.weeks.find((item) => item.index === weekIndex);
      const workout = week?.workouts.find((item) => item.id === workoutId);
      if (plan === null || week === undefined || workout === undefined) throw new Error("TARGET_NOT_FOUND");
      return { revision: plan.program.revision, workout, week: { workouts: week.workouts, type: week.type } };
    })().then((value) => { if (active) setLoaded(value); })
      .catch(() => { if (active) setMessage("Не удалось открыть план тренировки. Ничего не изменено."); });
    return () => { active = false; };
  }, [clientId, edit, mesocycleId, programId, repository, weekIndex, workoutId]);

  const edited = useMemo(() => loaded === null || edit === null || lookup === null ? null
    : applyDiaryEdit(loaded.workout, edit, newPlanId, (exerciseId) => setFieldsOf(lookup.get(exerciseId)?.metrics ?? [])),
  [edit, loaded, lookup]);

  const input = (target: Scope, value: PlannedWorkout, base: Loaded) => mesocycleId === null
    ? { kind: "simple" as const, edit: { weekIndex, workoutId, workout: value, scope: target as SimpleWorkoutScope, replaceConflicts: [] } }
    : { kind: "week" as const, edit: { mesocycleId, weekIndex, type: base.week!.type, scope: target as WeekScope, clientIds: [clientId],
      replaceConflicts: [], workouts: base.week!.workouts.map((item) => item.id === workoutId ? value : item) } };

  useEffect(() => {
    if (loaded === null || edited === null) return undefined;
    let active = true;
    const request = input(scope, edited, loaded);
    const preview = request.kind === "simple"
      ? repository.previewSimpleWorkout(clientId, programId, loaded.revision, request.edit)
      : repository.previewWeekEdit(clientId, programId, loaded.revision, request.edit);
    void preview.then((value) => { if (active) setPreview(value); }).catch(() => { if (active) setPreview(null); });
    return () => { active = false; };
  }, [clientId, edited, loaded, programId, repository, scope]);

  const save = async () => {
    if (loaded === null || edited === null || edit === null) return;
    setBusy(true); setMessage(null);
    try {
      const request = input(scope, edited, loaded);
      if (request.kind === "simple") await repository.saveSimpleWorkout(clientId, programId, loaded.revision, request.edit);
      else await repository.saveWeek(clientId, programId, loaded.revision, request.edit);
      onDone(`${diaryEditTitles[edit.kind]}: ${labelOf(scope).toLowerCase()}.`);
    } catch (error) {
      setMessage(errors[error instanceof Error ? error.message : ""] ?? "Не удалось сохранить. План не изменён.");
    } finally {
      setBusy(false);
    }
  };

  const weeks = preview?.affectedWeeks.find((item) => item.clientId === clientId)?.weeks ?? [];
  const kept = preview?.conflicts.filter((item) => item.clientId === clientId).length ?? 0;
  return (
    <Modal visible={edit !== null} transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
      <View style={styles.overlay}>
        <Pressable accessible={false} importantForAccessibility="no" onPress={() => { if (!busy) onClose(); }} style={styles.scrim} />
        <View accessibilityViewIsModal style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>
            {edit === null ? "" : diaryEditTitles[edit.kind]}
          </Text>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>Где изменить план? Результаты не меняются.</Text>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {scopes.map((item) => {
              const selected = item === scope;
              return (
                <Pressable key={item} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => setScope(item)}
                  style={[styles.option, { borderColor: selected ? colors.accentInk : colors.border, borderWidth: selected ? 2 : 1 }]}>
                  <View style={[styles.radio, { borderColor: selected ? colors.accentInk : colors.border }]}>
                    {selected ? <View style={[styles.dot, { backgroundColor: colors.accentInk }]} /> : null}
                  </View>
                  <Text style={[styles.optionText, { color: colors.textPrimary }]}>{labelOf(item)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {weeks.length > 0 ? (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>{`Недели: ${weeks.join(", ")}`}</Text>
          ) : null}
          {kept > 0 ? (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              {`В других неделях своя структура (${kept}) — там план останется прежним.`}
            </Text>
          ) : null}
          {message !== null ? <InlineNotice kind="error">{message}</InlineNotice> : null}
          <View style={styles.actions}>
            <View style={styles.grow}><AppButton compact variant="secondary" label="Отмена" disabled={busy} onPress={onClose} /></View>
            <View style={styles.grow}><AppButton compact label="Применить" busy={busy} disabled={edited === null}
              onPress={() => { void save(); }} /></View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", padding: 20 },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.48)" },
  card: { maxHeight: "90%", width: "100%", borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  title: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  list: { flexGrow: 0 },
  listContent: { gap: 8 },
  option: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 46, borderRadius: 10, paddingHorizontal: 12 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  optionText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 17 },
  actions: { flexDirection: "row", gap: 8, marginTop: 4 },
  grow: { flex: 1 },
});
