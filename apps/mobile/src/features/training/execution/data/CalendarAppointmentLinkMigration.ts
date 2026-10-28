import type { MigrationStep } from "../../../../shared/db/MigrationRunner.ts";

/**
 * ADR-048: какую запись календаря отметила эта тренировка («Завершить тренировку»). Нужна, чтобы «Отменить завершение» снимало
 * исход именно этой записи. Колонка без внешнего ключа (записи принадлежит календарь) и без значения у прежних сессий.
 */
export const calendarAppointmentLinkMigration: MigrationStep = {
  version: 4, checksum: "execution-v4-calendar-appointment-link-20261028",
  statements: ["ALTER TABLE training_sessions ADD COLUMN calendar_appointment_id TEXT"],
};
