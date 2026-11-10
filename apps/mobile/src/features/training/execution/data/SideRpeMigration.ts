import type { MigrationStep } from "../../../../shared/db/MigrationRunner.ts";

/**
 * RPE по сторонам одностороннего подхода (левая и правая ноги оцениваются отдельно). Столбец добавляется ALTER'ом, прежний RPE подхода
 * копируется в обе стороны — ничего не теряется; значение в самой строке подхода у односторонних больше не читается и не пишется.
 */
export const sideRpeMigration: MigrationStep = {
  version: 5, checksum: "execution-v5-side-rpe-20261110",
  statements: [
    "ALTER TABLE training_performed_sides ADD COLUMN rpe INTEGER CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10)",
    `UPDATE training_performed_sides SET rpe = (SELECT s.rpe FROM training_performed_sets AS s
      WHERE s.id = training_performed_sides.set_id AND s.workspace_id = training_performed_sides.workspace_id)`,
  ],
};
