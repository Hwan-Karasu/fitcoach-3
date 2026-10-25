import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";
import type { DatabaseSync } from "node:sqlite";
import { parseRoundTripSourceJson } from "../apps/mobile/src/shared/migration/SourceJson.ts";
import { projectLegacyQuestionnaire } from "../apps/mobile/src/features/questionnaire/domain/legacy-import/LegacyQuestionnaireCandidates.ts";
import { legacyQuestionnaireId } from "../apps/mobile/src/features/questionnaire/domain/legacy-import/LegacyQuestionnaireProjection.ts";
import { stageLegacyImportCandidate } from "../apps/mobile/src/app/composition/stageLegacyImportCandidate.ts";
import { fixture as nutritionFixture, referenceDay } from "./support/legacy-nutrition-staging.ts";
import { seedLegacyCalendarSource } from "./support/legacy-calendar-source.ts";
import { importedAt, allocator, digest, inspect } from "./support/legacy-training-staging.ts";

test("native source numbers preserve decimal meaning, exact integers, exponents and string types", () => {
  for (const token of ["0", "0.000", "0e999999999999999999999999999999999", "0e-999999999999999999999999999999999",
    "1", "-12", "0.1", "1.1000", "2.500e+02", "1.25E-000000000000002", "9007199254740991", "9007199254740992", "1e20", "1e21", "5e-324"]) {
    assert.equal(parseRoundTripSourceJson(token), Number(token), token);
  }
  const source = '{"__proto__":1.1000,"a":[null,false,"0.10000000000000001","-0"],"x":1.0000000000000001,"x":2}';
  const value = parseRoundTripSourceJson(source) as Record<string, unknown>;
  assert.deepEqual(value, JSON.parse(source) as unknown);
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(Object.hasOwn(value, "__proto__"), true);
});

test("unrepresentable source numbers never pass through rounded, overflowed, underflowed or negative-zero values", () => {
  for (const token of ["1.0000000000000001", "0.10000000000000001", "1.234567890123456789", "9007199254740993",
    "1000000000000000100", "1e23", "1e400", "-1e400", "1e-400", "-1e-400", "-0", "-0.000e9999999999999999999"]) {
    assert.throws(() => parseRoundTripSourceJson(`{"private-note":"Synthetic only","values":[${token}]}`),
      { name: "RangeError", message: "IMPORT_SOURCE_JSON_NUMBER_UNREPRESENTABLE" }, token);
  }
  assert.equal(String(Number("1000000000000000100")), "1000000000000000100", "shortest spelling hides the rounding");
  assert.equal(BigInt(Number("1000000000000000100")), 1000000000000000128n);
  for (const invalid of ["01", "+1", "[1,]", '{"secret":"Synthetic only","n":1e}', "NaN"]) {
    assert.throws(() => parseRoundTripSourceJson(invalid), { name: "SyntaxError", message: "IMPORT_SOURCE_JSON_INVALID" });
  }
});

test("native number guard works in a fresh runtime without source-aware JSON reviver support", async () => {
  const script = `import {parentPort,workerData} from 'node:worker_threads';
    const original=JSON.parse;let callbacks=0;
    JSON.parse=(text,reviver)=>original(text,typeof reviver==='function'?function(key,value){callbacks++;return reviver.call(this,key,value);}:undefined);
    const {parseRoundTripSourceJson}=await import(workerData.url);
    const accepted=parseRoundTripSourceJson('{"n":1.1000,"x":1e20,"text":"1.0000000000000001"}');
    let rejected=null;try{parseRoundTripSourceJson('{"n":1.0000000000000001}');}catch(error){rejected=error.message;}
    parentPort.postMessage({accepted,rejected,callbacks});`;
  const observed = await new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(script)}`), { execArgv: ["--experimental-strip-types"],
      workerData: { url: new URL("../apps/mobile/src/shared/migration/SourceJson.ts", import.meta.url).href } });
    let result: unknown;
    worker.once("message", (value: unknown) => { result = value; });
    worker.once("error", reject);
    worker.once("exit", (code) => code || result === undefined ? reject(new Error(`NUMBER_GUARD_WORKER_EXIT_${code}`)) : resolve(result));
  });
  assert.deepEqual(observed, { accepted: { n: 1.1, x: 1e20, text: "1.0000000000000001" }, rejected: "IMPORT_SOURCE_JSON_NUMBER_UNREPRESENTABLE", callbacks: 0 });
});

type Fixture = Parameters<Parameters<typeof nutritionFixture>[0]>[0];
const fixture = (amend: (db: DatabaseSync) => void, run: (f: Fixture) => Promise<void>) => nutritionFixture(run, (db) => {
  seedLegacyCalendarSource(db, { existingOwners: true, existingDays: true, existingSettings: true }); amend(db);
});
const stage = (f: Fixture) => stageLegacyImportCandidate({ openStaging: f.native.open, context: f.context, source: f.snapshots, importedAt, referenceDay, allocate: allocator() });
function empty(f: Fixture) {
  inspect(f.stagePath, (db) => {
    for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)<>'sqlite_' ORDER BY name").all()) {
      if (!["r04_candidate_identity", "r04_candidate_ids", "workspaces"].includes(name as string)) {
        assert.equal(db.prepare(`SELECT count(*) AS n FROM ${name as string}`).get()!.n, 0, name as string);
      }
    }
    assert.equal(db.prepare("SELECT count(*) AS n FROM r04_candidate_ids WHERE kind='CLIENT'").get()!.n, 0);
    assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  });
  assert.equal(f.native.handles.size, 0); assert.equal(digest(f.sourcePath), f.sha);
}
function numericAnswer(db: DatabaseSync, value: string) {
  db.exec("UPDATE questionnaire_revisions SET schema_json=replace(schema_json,'short_text','number')");
  db.prepare("UPDATE client_questionnaire_answers SET value_json=?").run(value);
}

test("questionnaire candidate retains exact raw answer and issue; actual all-owner staging refuses rounded numbers atomically", async () => {
  for (const token of ["0.10000000000000001", "9007199254740993", "1000000000000000100", "1e-400", "1e400", "-0"]) {
    await fixture((db) => numericAnswer(db, token), async (f) => {
      const candidates = projectLegacyQuestionnaire(f.snapshots.questionnaire!);
      assert.equal(candidates.answers[0]!.raw.value_json, token);
      assert.equal(candidates.answers[0]!.projection, null);
      assert.deepEqual(candidates.answers[0]!.issues, ["R04_QUESTIONNAIRE_NUMBER_UNREPRESENTABLE"]);
      for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(stage(f), { message: "R04_ID_LEDGER_QUESTIONNAIRE_NUMBER_UNREPRESENTABLE" }); empty(f);
      }
    });
  }
});

test("fractional questionnaire version cannot become version one in projection or staging", () => fixture((db) => {
  db.exec("UPDATE questionnaire_revisions SET schema_json=replace(schema_json,'\"version\":1','\"version\":1.0000000000000001')");
}, async (f) => {
  const candidates = projectLegacyQuestionnaire(f.snapshots.questionnaire!);
  for (const revision of candidates.revisions) {
    assert.match(revision.raw.schema_json as string, /1\.0000000000000001/u);
    assert.equal(revision.projection, null); assert.deepEqual(revision.issues, ["R04_QUESTIONNAIRE_NUMBER_UNREPRESENTABLE"]);
  }
  await assert.rejects(stage(f), { message: "R04_ID_LEDGER_QUESTIONNAIRE_NUMBER_UNREPRESENTABLE" }); empty(f);
}));

test("valid numeric answers survive native JSON storage and replay with the same field ID", async () => {
  for (const token of ["0", "0.1000", "1.1000", "2.5e+2", "1.25e-3", "999999999"]) {
    await fixture((db) => numericAnswer(db, token), async (f) => {
      const first = await stage(f), fieldId = legacyQuestionnaireId([f.context.accountScope, f.context.sourceWorkspaceId, "question", "custom-question"]);
      const read = () => inspect(f.stagePath, (db) => db.prepare("SELECT * FROM questionnaire_answers WHERE field_id=?").all(fieldId));
      const rows = read(); assert.equal(rows.length, 1); assert.equal(rows[0]!.value_json, JSON.stringify(Number(token)));
      const replay = await stage(f); assert.deepEqual(replay.ids, first.ids); assert.deepEqual(read(), rows);
      assert.equal(first.finalizable, false); assert.equal(digest(f.sourcePath), f.sha); assert.equal(f.native.handles.size, 0);
    });
  }
});

test("exact large native numbers still obey the questionnaire's existing value limits", () => fixture((db) => numericAnswer(db, "1e20"), async (f) => {
  await assert.rejects(stage(f), { message: "R04_ID_LEDGER_QUESTIONNAIRE_ANSWER_INVALID" }); empty(f);
}));

test("rounded structural numbers in plans, archive snapshots and retained metadata roll back all earlier owners", async () => {
  const cases: readonly { amend: (db: DatabaseSync) => void; error: string }[] = [
    { amend: (db) => db.exec("UPDATE training_programs SET settings_json='{\"totalWeeks\":2.0000000000000001}' WHERE id='p-a'"), error: "R04_ID_LEDGER_PLANS_NUMBER_UNREPRESENTABLE" },
    { amend: (db) => db.exec("UPDATE training_weeks SET data_json='{\"unsupportedMetadata\":9007199254740993}' WHERE id='week-a0'"), error: "R04_ID_LEDGER_PLANS_NUMBER_UNREPRESENTABLE" },
    { amend: (db) => db.exec("UPDATE training_archive_entries SET data_json=replace(data_json,'\"totalWeeks\":1','\"totalWeeks\":1.0000000000000001')"), error: "R04_ID_LEDGER_ARCHIVE_PLANS_NUMBER_UNREPRESENTABLE" },
    { amend: (db) => db.exec("UPDATE training_archive_entries SET data_json=replace(data_json,'\"sortIndex\":0','\"sortIndex\":1e-400')"), error: "R04_ID_LEDGER_ARCHIVE_PLANS_NUMBER_UNREPRESENTABLE" },
  ];
  for (const item of cases) await fixture(item.amend, async (f) => {
    for (let attempt = 0; attempt < 2; attempt++) { await assert.rejects(stage(f), { message: item.error }); empty(f); }
  });
});

test("equivalent structural exponents and native decimals in plan metadata remain supported", () => fixture((db) => {
  db.exec("UPDATE training_programs SET settings_json='{\"totalWeeks\":2.000e0,\"nativeMetadata\":1.1000}' WHERE id='p-a'; UPDATE training_archive_entries SET data_json=replace(data_json,'\"totalWeeks\":1','\"totalWeeks\":1e0')");
}, async (f) => {
  const first = await stage(f), replay = await stage(f);
  assert.deepEqual(replay.ids, first.ids); assert.equal(first.owners.executions.performedFacts, 6);
  assert.equal(first.finalizable, false); assert.equal(f.native.handles.size, 0); assert.equal(digest(f.sourcePath), f.sha);
}));
