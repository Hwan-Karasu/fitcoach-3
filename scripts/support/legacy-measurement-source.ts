import type { DatabaseSync } from "node:sqlite";
import { legacyMeasurementFields } from "../../apps/mobile/src/shared/migration/LegacyMeasurementSources.ts";

const day = "2026-03-01", importedAt = "2026-10-24T12:00:00Z";
export function seedMeasurementSource(db: DatabaseSync) {
  db.exec(`ALTER TABLE clients ADD COLUMN weight TEXT;
    UPDATE clients SET weight='80.1' WHERE id='a';
    CREATE TABLE client_measurements(id TEXT PRIMARY KEY,client_id TEXT,date_key TEXT,${legacyMeasurementFields.map((field) => `${field} TEXT`).join(",")},created_at TEXT,updated_at TEXT,extra_json TEXT);
    CREATE TABLE client_day_facts(client_id TEXT,date_key TEXT,weight TEXT,steps TEXT,training TEXT,updated_at TEXT,source_hint TEXT,PRIMARY KEY(client_id,date_key));`);
  const add = (id: string, client: string, fields: Record<string, string>, date = day) => db.prepare(`INSERT INTO client_measurements VALUES(${Array.from({ length: 14 }, () => "?").join(",")})`)
    .run(id, client, date, ...legacyMeasurementFields.map((field) => fields[field] ?? null), "2026-03-01T22:13:00Z", "2026-04-01T10:00:00Z", '{"source":"retained"}');
  add("one", "a", Object.fromEntries(legacyMeasurementFields.map((field) => [field, "35,5000"]))); add("two", "a", { neck: "35.5" }); add("other", "b", { neck: "35.5" });
  add("fine", "a", { neck: "35.55", waist: "0" }); add("future", "a", { neck: "35" }, "2027-01-01"); add("invalid", "a", { neck: "35" }, "2026-02-30");
  for (const [client, date, weight] of [["a", day, "80,1000"], ["b", day, "80.1"], ["a", "2026-03-02", "78.25"], ["a", "2026-03-03", "-0"], ["a", "2026-03-04", ""]])
    db.prepare("INSERT INTO client_day_facts VALUES(?,?,?,'1234','',?,'Retained daily source')").run(client!, date!, weight!, importedAt);
}
