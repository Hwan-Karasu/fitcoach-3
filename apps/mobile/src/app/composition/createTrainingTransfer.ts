import type { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";
import type { SqliteStatementPort } from "../../shared/db/SqlitePort.ts";
import { transferSummary, type TrainingTransfer, type TransferWorkout } from "../../shared/training-transfer/TrainingTransfer.ts";
import { visibleTrainingTransfer } from "../../shared/training-transfer/VisibleTrainingTransfer.ts";
import type { TrainingTransferPort, ExerciseImportMatch } from "../../features/import/public.ts";
import { ExerciseImportMatchStore, validateExerciseMatches } from "../../features/import/data/ExerciseImportMatchStore.ts";
import { exportTrainingPlans, importTrainingPlans, exportTrainingPlanHistory, importTrainingPlanHistory } from "../../features/training/plans/data/TrainingPlanTransfer.ts";
import { importTrainingExecutions } from "../../features/training/execution/data/TrainingExecutionTransfer.ts";
import type { DevTrainingExecutionRepository } from "../../features/training/execution/data/DevTrainingExecutionRepository.ts";
import type { DevTrainingPlansRepository } from "../../features/training/plans/data/DevTrainingPlansRepository.ts";
import type { DevExerciseCatalogRepository } from "../../features/exercises/data/DevExerciseCatalogRepository.ts";
import type { BuilderWorkbookCycle } from "../../shared/training-transfer/BuilderWorkbook.ts";
import { UUID_V4_BATCH_SQL } from "../../shared/db/SqlIds.ts";
import { assertValidTransfer, reidTransfer, settleImportedSessions, transferSourceIds } from "../../features/import/public.ts";

/** Импортированные результаты, чья тренировка убрана из плана при правке цикла до первого сохранения. */
function resultsOfRemovedWorkouts(cycle: BuilderWorkbookCycle) {
  const present = new Set(cycle.weeks.flatMap((week, at) => week.workouts.map((workout) => JSON.stringify([at + 1, workout.id]))));
  return (cycle.imported?.sessions ?? []).filter((session) => !present.has(JSON.stringify([session.weekIndex, session.plannedWorkoutId])));
}

export function createTrainingTransfer(database: SharedSqliteDatabase, workspace: string, plans: DevTrainingPlansRepository, execution: DevTrainingExecutionRepository, exercises: Pick<DevExerciseCatalogRepository, "get" | "list">): TrainingTransferPort {
  const matches = new ExerciseImportMatchStore(workspace);
  const activeExerciseIds = async () => new Set((await exercises.list()).filter((entry) => !entry.overlay.hidden).map((entry) => entry.definition.id));
  const checkMatches = async (input: readonly ExerciseImportMatch[]) => {
    const valid = validateExerciseMatches(input);
    if (!valid.length) return valid;
    const available = await activeExerciseIds();
    if (valid.some((match) => !available.has(match.targetId))) throw new Error("Выбранное упражнение удалено, скрыто или находится в архиве. Выберите замену.");
    return valid;
  };
  const transaction = async <T>(task: (tx: SqliteStatementPort) => Promise<T>): Promise<T> => { const lease = await database.acquire(); try { return await lease.writer.write(task); } finally { await database.release(); } };
  const exportInTransaction = async (tx: SqliteStatementPort, clientId: string, ids: readonly string[], visibleOnly = false): Promise<TrainingTransfer> => {
    const client = await tx.first<{ name: string }>(`SELECT display_name AS name FROM clients WHERE workspace_id=? AND id=?`, [workspace, clientId]);
    if (!client) throw new Error("Клиент не найден.");
    const programs = await exportTrainingPlans(tx, workspace, clientId, ids);
    let sessions = await execution.exportTransfer(tx, clientId, ids);
    for (const id of new Set(ids)) if (!programs.some((p) => p.id === id)) {
      if (visibleOnly) continue;
      const retained = sessions.filter((s) => s.programId === id); const origin = retained.find((s) => s.origin !== null)?.origin;
      if (!origin) throw new Error("Выбранная программа больше не доступна. Обновите список.");
      const createdAt = retained.map((s) => s.startedAt ?? (s.actualDate ? `${s.actualDate}T00:00:00.000Z` : "2000-01-01T00:00:00.000Z")).sort()[0]!;
      programs.push({ id, title: origin.programTitle, kind: origin.programKind, archivedAt: createdAt, createdAt, simple: origin.programKind === "SIMPLE" ? { weeks: Math.max(...retained.map((s) => s.weekIndex)), workouts: [] } : null, simpleWeeks: [], mesocycles: [] });
    }
    const planHistory = visibleOnly ? [] : await exportTrainingPlanHistory(tx, workspace, clientId, ids);
    if (visibleOnly) {
      const catalogIds = new Set(programs.flatMap((p) => [...p.simple?.workouts ?? [], ...p.simpleWeeks.flatMap((w) => w.workouts), ...p.mesocycles.flatMap((c) => c.weeks.flatMap((w) => w.workouts))]).flatMap((w) => w.exercises.map((e) => e.exerciseId)));
      const snapshot = visibleTrainingTransfer({ format: "athlete-training", version: 1, sourceId: "athlete-diary-3", client: { id: clientId, name: client.name }, programs, sessions, exercises: [...catalogIds].map((id) => ({ id, name: "Упражнение" })) });
      sessions = [...snapshot.sessions];
    }
    const needed = new Set(sessions.flatMap((s) => s.facts.map((f) => f.exerciseId)));
    const collect = (items: readonly TransferWorkout[]) => items.forEach((w) => w.exercises.forEach((e) => needed.add(e.exerciseId)));
    for (const p of programs) { if (p.simple) collect(p.simple.workouts); p.simpleWeeks.forEach((w) => collect(w.workouts)); p.mesocycles.forEach((c) => c.weeks.forEach((w) => collect(w.workouts))); }
    for (const h of planHistory) { h.simple?.weeks.forEach((w) => collect(w.workouts)); h.mesocycle?.weeks.forEach((w) => collect(w.workouts)); }
    const catalog = await Promise.all([...needed].sort().map(async (id) => { const entry = await exercises.get(id); if (!entry) throw new Error("Не найдено упражнение из истории. Экспорт остановлен."); return { id, name: entry.overlay.displayName?.trim() || entry.definition.name }; }));
    return { format: "athlete-training", version: 1, sourceId: "athlete-diary-3", client: { id: clientId, name: client.name }, programs, sessions, exercises: catalog, ...(planHistory.length ? { planHistory } : {}) };
  };
  return {
    async getExerciseMatches(sourceNames) {
      const available = await activeExerciseIds();
      return (await transaction((tx) => matches.read(tx, sourceNames))).map((match) => ({ ...match, available: available.has(match.targetId) }));
    },
    async saveBuilderWorkbook(request) {
      if (!request.cycles.length || new Set(request.cycles.map((c) => c.key)).size !== request.cycles.length || request.clientIds[0] !== request.clientId || new Set(request.clientIds).size !== request.clientIds.length) throw new Error("DRAFT_INVALID");
      const available = await activeExerciseIds();
      for (const cycle of request.cycles) for (const id of [...cycle.weeks.flatMap((w) => w.workouts.flatMap((x) => x.exercises.map((e) => e.exerciseId))),
        ...cycle.imported?.sessions.flatMap((s) => s.facts.map((f) => f.exerciseId)) ?? []]) {
        if (!available.has(id)) throw new Error("Выбранное упражнение удалено, скрыто или находится в архиве. Выберите замену.");
      }
      if (!request.resultsAction && request.cycles.some((c) => resultsOfRemovedWorkouts(c).length > 0)) throw new Error("WEEK_HAS_RESULTS");
      const remembered = await checkMatches(request.cycles.flatMap((c) => c.imported?.matches ?? []));
      // Повтор разрешён (решение владельца 2026-10-27): ни квитанций, ни хешей, ни круга через XLSX; каждый цикл получает новые UUID.
      const saved = await transaction(async (tx) => {
        const now = new Date();
        const program = request.scope.programId === null
          ? await plans.workbookSaveParticipant.create(tx, { title: request.programTitle, clientIds: request.clientIds, placements: request.placements }, now)
          : await plans.workbookSaveParticipant.check(tx, request.clientId, request.scope.programId, request.expectedRevision ?? -1);
        let revision = program.revision; let firstId = ""; let appended = false;
        let placements = request.placements;
        for (const [index, draft] of request.cycles.entries()) {
          if (draft.key === request.existingCycleKey && request.scope.mesocycleId !== null) {
            const edit = { clientId: request.clientId, programId: program.id, expectedRevision: revision,
              mesocycleId: request.scope.mesocycleId, clientIds: [request.clientId], mesocycle: { title: draft.title,
                cycleType: draft.settings?.cycleType ?? null, repRange: draft.settings?.repRange ?? null, startDate: draft.settings?.startDate ?? null, weeks: draft.weeks },
              ...(request.resultsAction ? { resultsAction: request.resultsAction } : {}) };
            const removed = await plans.mesocycleSaveParticipant.removedWorkouts(tx, edit);
            const executions = await execution.weekCopyParticipant.read(tx, removed.map((r) => ({ clientId: request.clientId, programId: program.id, weekIndex: r.weekIndex, plannedWorkoutId: r.plannedWorkoutId })));
            const withResults = removed.filter((_, at) => executions[at]?.session !== null && executions[at]?.session !== undefined || (executions[at]?.facts.size ?? 0) > 0);
            if (withResults.length) {
              if (!request.resultsAction) throw new Error("WEEK_HAS_RESULTS");
              const ids = withResults.map((r) => r.plannedWorkoutId);
              if (request.resultsAction === "DELETE") await execution.cleanupParticipant.remove(tx, request.clientId, program.id, ids);
              else await execution.cleanupParticipant.keepAsHistory(tx, request.clientId, program.id, (weekIndex, id) => {
                const r = withResults.find((r) => r.weekIndex === weekIndex && r.plannedWorkoutId === id)!;
                return { programTitle: r.programTitle, programKind: "PERIODIZED", mesocycleTitle: r.mesocycleTitle, workoutTitle: r.workoutTitle };
              }, now, ids);
            }
            const result = await plans.mesocycleSaveParticipant.save(tx, edit, now);
            revision = result.program.revision; firstId ||= result.mesocycleId; continue;
          }
          const cycleTransfer = (item: BuilderWorkbookCycle): TrainingTransfer => {
            const slot = (s: Readonly<{ weekIndex: number; plannedWorkoutId: string }>) => JSON.stringify([s.weekIndex, s.plannedWorkoutId]);
            const removed = new Set(resultsOfRemovedWorkouts(item).map(slot));
            const history = { programTitle: program.title, programKind: "PERIODIZED" as const, mesocycleTitle: item.title, workoutTitle: null };
            // Исход по записям (ADR-043): завершены тренировки с результатами и пустые тренировки недели, где результаты есть; неделя без записей не начата.
            const settled = settleImportedSessions(item.weeks.map((w, at) => ({ index: at + 1, workouts: w.workouts })), item.imported?.sessions ?? []);
            const sessions = settled.sessions.filter((s) => !(removed.has(slot(s)) && request.resultsAction === "DELETE"))
              .map((s) => ({ ...s, programId: "builder-program", ...(removed.has(slot(s)) ? { origin: history } : {}) }));
            for (const { weekIndex, workoutId } of settled.bare) sessions.push({ id: `empty:${workoutId}`, programId: "builder-program", weekIndex,
              plannedWorkoutId: workoutId, outcome: "COMPLETED", actualDate: null, startedAt: null, finishedAt: null, origin: null, facts: [], notes: [] });
            const ids = [...new Set([...item.weeks.flatMap((w) => w.workouts.flatMap((x) => x.exercises.map((e) => e.exerciseId))), ...sessions.flatMap((s) => s.facts.map((f) => f.exerciseId))])];
            return { format: "athlete-training", version: 1, sourceId: `builder:${program.id}`, client: { id: request.clientId, name: "Конструктор" }, exercises: ids.map((id) => ({ id, name: id })),
              programs: [{ id: "builder-program", title: program.title, kind: "PERIODIZED", createdAt: program.createdAt, archivedAt: null, simple: null, simpleWeeks: [],
                mesocycles: [{ id: item.key, lineageId: item.key, title: item.title, ...item.settings,
                  weeks: item.weeks.map((w, at) => ({ ...w, id: `${item.key}:week:${at}`, index: at + 1 })) }] }], sessions };
          };
          const source = cycleTransfer(draft); assertValidTransfer(source);
          const sourceIds = transferSourceIds(source);
          const fresh = await tx.all<{ id: string }>(UUID_V4_BATCH_SQL, [sourceIds.length]);
          const mapped = reidTransfer(source, request.clientId, Object.fromEntries(source.exercises.map((e) => [e.id, e.id])), new Map(sourceIds.map((id, at) => [id, fresh[at]!.id])));
          const cycle = mapped.programs[0]!.mesocycles[0]!;
          firstId ||= cycle.id;
          placements = await plans.workbookSaveParticipant.append(tx, { clientId: request.clientId, programId: program.id, cycle,
            clientIds: request.clientIds, placements, first: index === 0, imported: !!draft.imported }, now);
          await importTrainingExecutions(tx, workspace, request.clientId, mapped.sessions.map((s) => ({ ...s, programId: program.id }))); appended = true;
        }
        if (appended && request.scope.programId !== null && revision === program.revision) await plans.workbookSaveParticipant.bump(tx, program.id, revision, now);
        await matches.save(tx, remembered);
        await plans.workbookSaveParticipant.clear(tx, request.clientId, request.scope);
        return { programId: program.id, mesocycleId: firstId };
      });
      plans.mesocycleSaveParticipant.notify(request.clientIds); execution.notifyTransfer(request.clientId, saved.programId);
      return saved;
    },
    async rememberExerciseMatches(input) {
      const valid = await checkMatches(input);
      await transaction((tx) => matches.save(tx, valid));
    },
    exportClient: (clientId, ids) => transaction(async (tx) => visibleTrainingTransfer(await exportInTransaction(tx, clientId, ids, true))),
    /**
     * Книга целиком одной транзакцией. Каждый импорт создаёт НОВУЮ программу (решение владельца: повтор разрешён), поэтому нет ни
     * квитанций, ни отпечатков, ни хеша каждой строки: проверка — прямо над моделью, ID — случайные UUID одним запросом.
     */
    async importClient(clientId, input, mapping, options) {
      if (input.issues?.length) throw new Error(`Нужно проверить ${input.issues.length} значений. Исправьте их в блоке «Проверьте значения» перед подтверждением импорта.`);
      assertValidTransfer(input);
      const available = await activeExerciseIds();
      for (const id of new Set(Object.values(mapping))) if (!available.has(id)) throw new Error("Выбранное упражнение удалено, скрыто или находится в архиве. Выберите замену.");
      const remembered = await checkMatches(options?.rememberMatches ?? []);
      for (const match of remembered) {
        const sources = input.exercises.filter((exercise) => exercise.name.trim() === match.sourceName);
        if (!sources.length || sources.some((exercise) => mapping[exercise.id] !== match.targetId)) throw new Error("Сопоставление не относится к открытому листу.");
      }
      const mapped = await transaction(async (tx) => {
        const target = await tx.first<{ lifecycle: string }>(`SELECT lifecycle FROM clients WHERE workspace_id=? AND id=?`, [workspace, clientId]);
        if (target?.lifecycle !== "ACTIVE") throw new Error("Выберите действующего клиента.");
        const sourceIds = transferSourceIds(input);
        const fresh = await tx.all<{ id: string }>(UUID_V4_BATCH_SQL, [sourceIds.length]);
        const result = reidTransfer(input, clientId, mapping, new Map(sourceIds.map((id, at) => [id, fresh[at]!.id])));
        for (const program of result.programs) {
          await importTrainingPlans(tx, workspace, clientId, [program]);
          await importTrainingPlanHistory(tx, workspace, clientId, result.planHistory?.filter((h) => h.programId === program.id) ?? []);
          await importTrainingExecutions(tx, workspace, clientId, result.sessions.filter((s) => s.programId === program.id));
        }
        await matches.save(tx, remembered);
        return result;
      });
      plans.notifyTransfer(clientId); for (const p of mapped.programs) execution.notifyTransfer(clientId, p.id);
      return transferSummary(input);
    },
  };
}
