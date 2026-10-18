import { useEffect, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, ConfirmDialog, InlineNotice, LoadingState, SelectionChip, TextField } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { TrainingProgram } from "../domain/ProgramModel.ts";
import { membersWord, PROGRAM_TITLE_MAX, programKindLabels } from "../domain/ProgramRules.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import type { ExerciseLookupPort } from "../domain/ExerciseLookupPort.ts";
import type { PlannedWorkout, SimplePlan } from "../domain/SimplePlanModel.ts";
import { weekTypeLabels, type PeriodizedPlan } from "../domain/PeriodizedModel.ts";
import { setsSummary } from "../domain/SimplePlanRules.ts";
import type { TrainingParticipantCandidate } from "./CreateProgramScreen.tsx";
import { useExerciseLookup } from "./useExerciseLookup.ts";

/** Неделя программы для панели недель (её рисует дневник — другой модуль). */
export interface ProgramWeeksView {
  /** Меняется при смене мезоцикла: панель начинает с его первой незакрытой недели. */
  readonly key: string;
  readonly weeks: readonly Readonly<{ index: number; caption: string | null; workouts: readonly PlannedWorkout[] }>[];
  readonly weekActions?: (weekIndex: number) => ReactNode;
}

/**
 * Открытая программа клиента (T01): открытие делает её выбранной у этого клиента. Простая — недели и
 * «Изменить программу»; Расширенная — мезоциклы этого участника (выбор хранится, §48.10), недели выбранного
 * и «Изменить неделю» (T04).
 */
export function ProgramScreen({ clientId, programId, repository, listCandidates, exercises, renderWeeks, onEditStructure,
  onAddMesocycle, onEditWeek, onArchived }: Readonly<{
  clientId: string;
  programId: string;
  repository: TrainingPlansRepositoryPort;
  listCandidates: () => Promise<readonly TrainingParticipantCandidate[]>;
  exercises: ExerciseLookupPort;
  /** Недели и тренировки со статусами выполнения (дневник — другой модуль, подставляет навигатор). */
  renderWeeks?: (view: ProgramWeeksView) => ReactNode;
  /** Открыть конструктор структуры (Простая — T02). */
  onEditStructure: () => void;
  /** Расширенная: «+ Мезоцикл» (T04). */
  onAddMesocycle: () => void;
  /** Расширенная: правка недели выбранного мезоцикла (T04). */
  onEditWeek: (mesocycleId: string, weekIndex: number) => void;
  onArchived: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [program, setProgram] = useState<TrainingProgram | null | undefined>(undefined);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [plan, setPlan] = useState<SimplePlan | null>(null);
  const [periodized, setPeriodized] = useState<PeriodizedPlan | null>(null);
  const lookup = useExerciseLookup(exercises);

  useEffect(() => {
    let active = true;
    repository.getProgram(clientId, programId).then((next) => {
      if (!active) return;
      setProgram(next);
      if (next !== null) void repository.selectProgram(clientId, programId).catch(() => undefined);
      if (next?.kind === "SIMPLE") {
        void repository.getSimplePlan(clientId, programId).then((loaded) => { if (active) setPlan(loaded?.draft.plan ?? null); });
      }
      if (next?.kind === "PERIODIZED") {
        void repository.getPeriodizedPlan(clientId, programId).then((loaded) => { if (active) setPeriodized(loaded); });
      }
    }).catch(() => { if (active) setProgram(null); });
    return () => { active = false; };
  }, [clientId, programId, repository, version]);

  useEffect(() => {
    let active = true;
    listCandidates().then((rows) => { if (active) setNames(new Map(rows.map((row) => [row.id, row.displayName]))); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [listCandidates]);

  useEffect(() => repository.subscribeCommittedChanges((change) => {
    if (change.clientIds.includes(clientId)) setVersion((value) => value + 1);
  }), [clientId, repository]);

  if (program === undefined) return <View style={[styles.center, { backgroundColor: colors.canvas }]}><LoadingState label="Открываем программу…" /></View>;
  if (program === null) {
    return (
      <View style={[styles.center, { backgroundColor: colors.canvas }]}>
        <InlineNotice kind="error">Программа не найдена в библиотеке этого клиента.</InlineNotice>
        <AppButton variant="secondary" label="К списку программ" onPress={onArchived} />
      </View>
    );
  }

  const rename = async () => {
    if (renaming === null) return;
    setBusy(true);
    try {
      setProgram(await repository.renameProgram(program.id, program.revision, renaming));
      setRenaming(null);
      setMessage(null);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setMessage(code === "DRAFT_INVALID" ? `Введите название (до ${PROGRAM_TITLE_MAX} символов).`
        : code === "PROGRAM_REVISION_CONFLICT" ? "Программа изменилась. Показана новая версия — повторите правку."
          : "Не удалось переименовать.");
      if (code === "PROGRAM_REVISION_CONFLICT") setVersion((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    setBusy(true);
    try {
      await repository.archiveForClient(clientId, program.id);
      setConfirmArchive(false);
      onArchived();
    } catch {
      setMessage("Не удалось перенести в архив. Программа не изменена.");
      setConfirmArchive(false);
    } finally {
      setBusy(false);
    }
  };

  const others = program.memberClientIds.filter((id) => id !== clientId);
  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>{program.title}</Text>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>
        {program.kind === "PERIODIZED" ? `${programKindLabels[program.kind]} · ${membersWord(program.memberClientIds.length)}`
          : programKindLabels[program.kind]}
      </Text>
      {message !== null ? <InlineNotice kind="error">{message}</InlineNotice> : null}
      {others.length > 0 ? (
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {`Также у: ${others.map((id) => names.get(id) ?? "клиент в архиве").join(", ")}`}
        </Text>
      ) : null}
      {program.kind === "SIMPLE" ? <>
        {plan !== null ? (
          <Text style={[styles.meta, { color: colors.textSecondary }]}>{`Недель: ${plan.weeks} · план недели повторяется`}</Text>
        ) : null}
        {plan !== null && renderWeeks !== undefined ? renderWeeks({ key: "simple", weeks: Array.from({ length: plan.weeks },
          (_, index) => ({ index: index + 1, caption: null, workouts: plan.workouts })) }) : plan?.workouts.map((workout) => (
          <View key={workout.id} style={[styles.workout, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.workoutTitle, { color: colors.textPrimary }]}>{workout.title}</Text>
            {workout.exercises.length === 0 ? (
              <Text style={[styles.meta, { color: colors.textMuted }]}>Упражнений нет</Text>
            ) : workout.exercises.map((exercise, index) => (
              <Text key={exercise.id} style={[styles.body, { color: colors.textPrimary }]}>
                {`${index + 1}. ${lookup?.get(exercise.exerciseId)?.name ?? "…"} — ${setsSummary(exercise)}`}
              </Text>
            ))}
          </View>
        ))}
        <AppButton label="Изменить программу" onPress={onEditStructure} />
      </> : periodized === null ? <LoadingState label="Открываем мезоциклы…" /> : (() => {
        const selected = periodized.mesocycles.find((item) => item.id === periodized.selectedMesocycleId) ?? periodized.mesocycles[0];
        return <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {periodized.mesocycles.map((item) => (
              <SelectionChip key={item.id} group="Мезоцикл" label={item.title} selected={item.id === selected?.id}
                onPress={() => { void repository.selectMesocycle(clientId, programId, item.id).catch(() => undefined); }} />
            ))}
            <SelectionChip group="Мезоцикл" label="+ Мезоцикл" selected={false} onPress={onAddMesocycle} />
          </ScrollView>
          {selected === undefined ? (
            <InlineNotice kind="info">Мезоциклов пока нет. Создайте первый: план первой недели скопируется во все недели.</InlineNotice>
          ) : renderWeeks?.({ key: selected.id,
            weeks: selected.weeks.map((week) => ({ index: week.index, caption: weekTypeLabels[week.type], workouts: week.workouts })),
            weekActions: (weekIndex) => (
              <AppButton variant="secondary" label="Изменить неделю" onPress={() => onEditWeek(selected.id, weekIndex)} />
            ) })}
        </>;
      })()}
      {renaming !== null ? (
        <View style={styles.rename}>
          <TextField label="Название" required value={renaming} onChangeText={setRenaming} />
          <View style={styles.row}>
            <View style={styles.grow}><AppButton variant="secondary" label="Отмена" onPress={() => setRenaming(null)} /></View>
            <View style={styles.grow}><AppButton label="Сохранить" busy={busy} onPress={() => { void rename(); }} /></View>
          </View>
        </View>
      ) : (
        <View style={styles.row}>
          <View style={styles.grow}><AppButton variant="secondary" label="Переименовать" onPress={() => setRenaming(program.title)} /></View>
          <View style={styles.grow}><AppButton variant="secondary" label="В архив" onPress={() => setConfirmArchive(true)} /></View>
        </View>
      )}
      <ConfirmDialog visible={confirmArchive} confirmBusy={busy} title="Перенести в архив?"
        description={others.length > 0
          ? "Программа уйдёт в архив этого клиента. У остальных участников она останется. Вернуть можно из списка программ."
          : "Программа уйдёт в архив клиента. Вернуть можно из списка программ."}
        confirmLabel="В архив" onCancel={() => setConfirmArchive(false)} onConfirm={() => { void archive(); }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, padding: 16, gap: 12, justifyContent: "center" },
  content: { padding: 16, gap: 12 },
  heading: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  rename: { gap: 10 },
  workout: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  workoutTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, marginBottom: 2 },
  row: { flexDirection: "row", gap: 10 },
  chips: { gap: 8, paddingRight: 8 },
  grow: { flex: 1 },
});
