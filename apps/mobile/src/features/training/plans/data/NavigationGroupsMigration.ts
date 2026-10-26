import type { MigrationStep } from "../../../../shared/db/MigrationRunner.ts";

/** P01: navigation is independent of plan ancestry. Never rewrites plan or execution rows. */
export const navigationGroupsMigration: MigrationStep = {
  version: 3, checksum: "p01-independent-navigation-v1-20261026",
  statements: [
    `CREATE TABLE training_navigation_groups (
      workspace_id TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(workspace_id, id)
    )`,
    `CREATE TABLE training_navigation_members (
      workspace_id TEXT NOT NULL, group_id TEXT NOT NULL, client_id TEXT NOT NULL,
      program_id TEXT NOT NULL, mesocycle_id TEXT NOT NULL,
      PRIMARY KEY(workspace_id, mesocycle_id), UNIQUE(workspace_id, group_id, client_id),
      FOREIGN KEY(workspace_id, group_id) REFERENCES training_navigation_groups(workspace_id, id) ON DELETE CASCADE,
      FOREIGN KEY(mesocycle_id, workspace_id) REFERENCES training_mesocycles(id, workspace_id) ON DELETE CASCADE
    )`,
    `CREATE TRIGGER training_navigation_member_scope BEFORE INSERT ON training_navigation_members
      WHEN NOT EXISTS(SELECT 1 FROM training_mesocycles m WHERE m.workspace_id = NEW.workspace_id
        AND m.id = NEW.mesocycle_id AND m.client_id = NEW.client_id AND m.program_id = NEW.program_id)
      BEGIN SELECT RAISE(ABORT, 'NAVIGATION_SCOPE_INVALID'); END`,
    `CREATE TRIGGER training_navigation_member_immutable BEFORE UPDATE ON training_navigation_members
      BEGIN SELECT RAISE(ABORT, 'NAVIGATION_MEMBER_IMMUTABLE'); END`,
    // Ambiguous historical ancestry is deliberately not turned into a navigation group.
    `INSERT INTO training_navigation_groups(workspace_id, id)
      SELECT m.workspace_id, 'copy:' || m.lineage_id FROM training_mesocycles m
      JOIN training_program_members p ON p.workspace_id = m.workspace_id AND p.program_id = m.program_id AND p.client_id = m.client_id
      WHERE m.group_left_at IS NULL
      GROUP BY m.workspace_id, m.lineage_id HAVING count(*) = count(DISTINCT m.client_id)`,
    `INSERT INTO training_navigation_members(workspace_id, group_id, client_id, program_id, mesocycle_id)
      SELECT m.workspace_id, g.id, m.client_id, m.program_id, m.id FROM training_mesocycles m
      JOIN training_navigation_groups g ON g.workspace_id = m.workspace_id AND g.id = 'copy:' || m.lineage_id
      JOIN training_program_members p ON p.workspace_id = m.workspace_id AND p.program_id = m.program_id AND p.client_id = m.client_id
      WHERE m.group_left_at IS NULL`,
    `CREATE TRIGGER training_navigation_empty_group AFTER DELETE ON training_navigation_members
      BEGIN DELETE FROM training_navigation_groups WHERE workspace_id = OLD.workspace_id AND id = OLD.group_id
        AND NOT EXISTS(SELECT 1 FROM training_navigation_members WHERE workspace_id = OLD.workspace_id AND group_id = OLD.group_id); END`,
  ],
};
