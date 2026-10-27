import type { MigrationStep } from "../../../../shared/db/MigrationRunner.ts";

/**
 * Отдых упражнений мезоциклов по типу цикла (решение владельца 2026-10-27): гипертрофия 2:00, сила 3:00, мощность 4:00,
 * выносливость 1:00, рекомпозиция и «свой» 1:30. Одноразово выставляется у уже сохранённых упражнений мезоциклов с известным
 * типом; дальше тренер правит любое упражнение сам. Простые программы и циклы без типа не меняются. Значения — те же, что в
 * `CYCLE_REST_SEC` (`shared/training-transfer/CycleRest.ts`): совпадение проверяет тест.
 */
export const CYCLE_REST_SQL = `UPDATE training_planned_exercises SET rest_sec = (
    SELECT CASE m.cycle_type WHEN 'hypertrophy' THEN 120 WHEN 'strength' THEN 180 WHEN 'power' THEN 240 WHEN 'endurance' THEN 60 ELSE 90 END
    FROM training_workouts w JOIN training_weeks k ON k.id = w.week_id AND k.workspace_id = w.workspace_id
      JOIN training_mesocycles m ON m.id = k.mesocycle_id AND m.workspace_id = k.workspace_id
    WHERE w.id = training_planned_exercises.workout_id AND w.workspace_id = training_planned_exercises.workspace_id)
  WHERE workout_id IN (SELECT w.id FROM training_workouts w JOIN training_weeks k ON k.id = w.week_id AND k.workspace_id = w.workspace_id
    JOIN training_mesocycles m ON m.id = k.mesocycle_id AND m.workspace_id = k.workspace_id WHERE m.cycle_type IS NOT NULL)`;

export const cycleRestMigration: MigrationStep = { version: 5, checksum: "plans-v5-cycle-rest-20261027", statements: [CYCLE_REST_SQL] };
