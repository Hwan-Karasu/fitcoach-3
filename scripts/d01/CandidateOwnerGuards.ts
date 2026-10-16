/** D01 experiment only. Never apply this overlay to an app database or a user backup. */
export const candidateOwnerGuardsSql = `
CREATE TRIGGER candidate_appointment_session_type_insert
BEFORE INSERT ON calendar_appointments
WHEN NEW.session_type_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM session_types
  WHERE id = NEW.session_type_id AND workspace_id = NEW.workspace_id
)
BEGIN SELECT RAISE(ABORT, 'OWNER_APPOINTMENT_SESSION_TYPE'); END;

CREATE TRIGGER candidate_appointment_session_type_update
BEFORE UPDATE OF workspace_id, session_type_id ON calendar_appointments
WHEN NEW.session_type_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM session_types
  WHERE id = NEW.session_type_id AND workspace_id = NEW.workspace_id
)
BEGIN SELECT RAISE(ABORT, 'OWNER_APPOINTMENT_SESSION_TYPE'); END;

CREATE TRIGGER candidate_diary_source_insert
BEFORE INSERT ON food_diary_entries
WHEN NEW.source_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM clients c
  WHERE c.id = NEW.client_id AND (
    (NEW.source_type = 'PRODUCT' AND EXISTS (
      SELECT 1 FROM food_products p
      WHERE p.id = NEW.source_id AND p.workspace_id = c.workspace_id
    )) OR
    (NEW.source_type = 'RECIPE' AND EXISTS (
      SELECT 1 FROM nutrition_recipes r
      WHERE r.id = NEW.source_id AND r.workspace_id = c.workspace_id
    ))
  )
)
BEGIN SELECT RAISE(ABORT, 'OWNER_DIARY_SOURCE'); END;

CREATE TRIGGER candidate_diary_source_update
BEFORE UPDATE OF client_id, source_type, source_id ON food_diary_entries
WHEN NEW.source_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM clients c
  WHERE c.id = NEW.client_id AND (
    (NEW.source_type = 'PRODUCT' AND EXISTS (
      SELECT 1 FROM food_products p
      WHERE p.id = NEW.source_id AND p.workspace_id = c.workspace_id
    )) OR
    (NEW.source_type = 'RECIPE' AND EXISTS (
      SELECT 1 FROM nutrition_recipes r
      WHERE r.id = NEW.source_id AND r.workspace_id = c.workspace_id
    ))
  )
)
BEGIN SELECT RAISE(ABORT, 'OWNER_DIARY_SOURCE'); END;

CREATE TRIGGER candidate_program_cohort_insert
BEFORE INSERT ON training_programs
WHEN NEW.cohort_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM clients c JOIN program_cohorts g ON g.workspace_id = c.workspace_id
  WHERE c.id = NEW.client_id AND g.id = NEW.cohort_id
)
BEGIN SELECT RAISE(ABORT, 'OWNER_PROGRAM_COHORT'); END;

CREATE TRIGGER candidate_program_cohort_update
BEFORE UPDATE OF client_id, cohort_id ON training_programs
WHEN NEW.cohort_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM clients c JOIN program_cohorts g ON g.workspace_id = c.workspace_id
  WHERE c.id = NEW.client_id AND g.id = NEW.cohort_id
)
BEGIN SELECT RAISE(ABORT, 'OWNER_PROGRAM_COHORT'); END;

CREATE TRIGGER candidate_program_owner_update
BEFORE UPDATE OF client_id ON training_programs
WHEN NEW.client_id <> OLD.client_id AND EXISTS (
  SELECT 1 FROM workout_sessions WHERE source_program_id = OLD.id
)
BEGIN SELECT RAISE(ABORT, 'OWNER_PROGRAM_WITH_SESSIONS'); END;

CREATE TRIGGER candidate_measurement_primary_update
BEFORE UPDATE OF client_id, metric_key, local_date ON body_measurements
WHEN EXISTS (
  SELECT 1 FROM measurement_daily_primary p
  WHERE p.measurement_id = OLD.id AND (
    p.client_id <> NEW.client_id OR p.metric_key <> NEW.metric_key
    OR p.local_date <> NEW.local_date
  )
)
BEGIN SELECT RAISE(ABORT, 'OWNER_MEASUREMENT_PRIMARY'); END;

CREATE TRIGGER candidate_session_type_workspace_update
BEFORE UPDATE OF workspace_id ON session_types
WHEN NEW.workspace_id <> OLD.workspace_id AND (
  EXISTS (SELECT 1 FROM calendar_appointments WHERE session_type_id = OLD.id) OR
  EXISTS (SELECT 1 FROM service_tariffs WHERE session_type_id = OLD.id) OR
  EXISTS (SELECT 1 FROM client_session_packs WHERE session_type_id = OLD.id)
)
BEGIN SELECT RAISE(ABORT, 'OWNER_SESSION_TYPE_REFERENCED'); END;

CREATE TRIGGER candidate_product_workspace_update
BEFORE UPDATE OF workspace_id ON food_products
WHEN NEW.workspace_id <> OLD.workspace_id AND (
  EXISTS (SELECT 1 FROM food_diary_entries WHERE source_type = 'PRODUCT' AND source_id = OLD.id) OR
  EXISTS (SELECT 1 FROM recipe_ingredients WHERE food_product_id = OLD.id)
)
BEGIN SELECT RAISE(ABORT, 'OWNER_PRODUCT_REFERENCED'); END;

CREATE TRIGGER candidate_recipe_workspace_update
BEFORE UPDATE OF workspace_id ON nutrition_recipes
WHEN NEW.workspace_id <> OLD.workspace_id AND EXISTS (
  SELECT 1 FROM food_diary_entries WHERE source_type = 'RECIPE' AND source_id = OLD.id
)
BEGIN SELECT RAISE(ABORT, 'OWNER_RECIPE_REFERENCED'); END;

CREATE TRIGGER candidate_cohort_workspace_update
BEFORE UPDATE OF workspace_id ON program_cohorts
WHEN NEW.workspace_id <> OLD.workspace_id AND EXISTS (
  SELECT 1 FROM training_programs WHERE cohort_id = OLD.id
)
BEGIN SELECT RAISE(ABORT, 'OWNER_COHORT_REFERENCED'); END;
`;
