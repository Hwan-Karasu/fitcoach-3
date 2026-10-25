import type { DatabaseSync } from "node:sqlite";

const time = "2026-02-01T10:00:00.000Z", day = "2026-03-01";
const context = { sourceWorkspaceId: "source" };
export const planner = () => ({ workingDays: [1, 3, 0], startHour: 7, endHour: 22, dutySlots: { [day]: { "09:00": true, "10:00": false } }, blockedSlots: { [day]: { "14:00": true, "15:00": true } } });
export function seedLegacyCalendarSource(db: DatabaseSync, options: { readonly existingOwners?: boolean; readonly existingDays?: boolean; readonly existingSettings?: boolean } = {}) {
  if (!options.existingOwners) db.exec(`CREATE TABLE clients(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,created_at TEXT,updated_at TEXT,archived_at TEXT,deleted_at TEXT,birthdate TEXT,height TEXT,gender TEXT,avatar_emoji TEXT,profile_json TEXT,weight TEXT)`);
  if (!options.existingDays) db.exec(`CREATE TABLE client_day_facts(client_id TEXT,date_key TEXT,weight TEXT,steps TEXT,training TEXT)`);
  db.exec(`CREATE TABLE calendar_appointments(id TEXT PRIMARY KEY,date_key TEXT,start_time TEXT,end_time TEXT,duration_minutes INTEGER,client_id TEXT,guest_name TEXT,client_name TEXT,appointment_type TEXT,note TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT)`);
  if (!options.existingSettings) db.exec(`CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)`);

  if (!options.existingOwners) for (const id of ["a", "b"]) db.prepare("INSERT INTO clients VALUES(?,?,?,?,?,NULL,NULL,'','','','',?,'80')").run(id, context.sourceWorkspaceId, `Атлет ${id}`, time, time, '{"trainerNotes":"Рабочая заметка"}');
  if (!options.existingDays) db.prepare("INSERT INTO client_day_facts VALUES('a',?,'80.1','100','Да')").run(day);
  for (const [id, start, end, client, guest, type, removed] of [
    ["active-a", "09:00", "10:00", "a", "", "training", null], ["guest", "11:00", "12:00", null, "Атлет a", "guest_visit", null],
    ["removed", "09:00", "10:00", "a", "", "training", time], ["active-b", "13:00", "14:00", "b", "", "initial_instruction", null],
  ] as const) db.prepare("INSERT INTO calendar_appointments VALUES(?,?,?,?,60,?,?,?,?,?,?,?,?)").run(id, day, start, end, client, guest, client ? `Имя ${client} в старом календаре` : "", type, " Заметка\nбез обрезания ", time, time, removed);
  db.prepare("INSERT INTO app_settings VALUES('calendar_planner_settings',?,?)").run(JSON.stringify(planner()), time);
  db.prepare("INSERT INTO app_settings VALUES('other-owner',?,?)").run("not-calendar-owned", time);
}
