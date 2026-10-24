import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { parseSourceJson } from "../apps/mobile/src/features/legacy-import/domain/SourceJson.ts";
import { parseLegacyExecutionMetricJson } from "./r04/LegacyExecutionMetricJson.ts";
import { nutritionJson } from "./r04/LegacyNutritionValues.ts";
import { projectNutritionArchive } from "./r04/LegacyNutritionArchive.ts";
import { composeLegacyCalendar } from "./r04/LegacyCalendarProjection.ts";

test("source JSON retains numeric spelling, numeric keys and the last duplicate property", () => {
  const source = '{"10":1e+2,"2":9007199254740993,"":-0,"weight":1.00000000000000001,"weight":2.00000000000000001,"values":[1e400,1e-400,0.1000]}';
  const calls: string[][] = [];
  const actual = parseSourceJson(source, (key, value) => { calls.push([key, value]); return { decimal: value }; });
  assert.deepEqual(actual, { "2": { decimal: "9007199254740993" }, "10": { decimal: "1e+2" }, "": { decimal: "-0" },
    weight: { decimal: "2.00000000000000001" }, values: [{ decimal: "1e400" }, { decimal: "1e-400" }, { decimal: "0.1000" }] });
  assert.deepEqual(calls, [["2", "9007199254740993"], ["10", "1e+2"], ["", "-0"], ["weight", "2.00000000000000001"],
    ["0", "1e400"], ["1", "1e-400"], ["2", "0.1000"]]);
  for (const value of ["0", "-0", "2.500", "1E+08"]) assert.equal(parseSourceJson(value, (key, token) => { assert.equal(key, ""); return token; }), value);
});

test("source strings cannot collide with numeric tags or be mistaken for numbers", () => {
  const value = { "": "", escaped: JSON.stringify({ weight: "1.000000000001", note: '"quoted"' }), strings: ["12", "-0", "1e400", "\u0000source-number:1", "\u0000source-number::1", "\u0000source-number:::"],
    unicode: "Атлет 🏋️", flags: [true, false, null], nested: { number: 1 } };
  const actual = parseSourceJson(JSON.stringify(value), (_key, token) => Number(token));
  assert.deepEqual(actual, value);
  assert.equal(parseSourceJson('"\\u0000source-number:123"', () => assert.fail("string is not a number")), "\u0000source-number:123");
});

test("invalid JSON is rejected before callbacks and exposes no source text", () => {
  const invalid = ["", " ", "01", "-01", "+1", "1.", ".1", "1e", "1e+", "NaN", "Infinity", "undefined", "[1,]", "{1:2}", '{"a":1,}',
    "[1 2]", '"bad\\x20"', '"line\nbreak"', '{"name":"Личная заметка","weight":1e}', '"unfinished', "true false", "[--1]", "[1]x", "\ufeff1"];
  for (const source of invalid) {
    let called = false;
    assert.throws(() => parseSourceJson(source, () => { called = true; }), { name: "SyntaxError", message: "IMPORT_SOURCE_JSON_INVALID" });
    assert.equal(called, false);
  }
});

test("native object semantics and literal __proto__ fields remain intact", () => {
  const actual = parseSourceJson('{"__proto__":9007199254740993,"constructor":{"prototype":{"polluted":1}},"a":[-0]}', (_key, token) => token) as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(actual), Object.prototype);
  assert.equal(Object.hasOwn(actual, "__proto__"), true);
  assert.equal(actual.__proto__, "9007199254740993");
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
  assert.deepEqual(actual.a, ["-0"]);
});

test("caller errors propagate and caller objects are not recursively reprocessed", () => {
  for (const error of [new Error("IDENTITY_COLLISION"), new SyntaxError("CALLER_VALIDATION")]) {
    assert.throws(() => parseSourceJson("1", () => { throw error; }), (found) => found === error);
  }
  const result = { number: "\u0000source-number:4" };
  assert.equal(parseSourceJson("1", () => result), result);
});

test("large and deeply nested input does not recurse in the token traversal", () => {
  const deep = "[".repeat(4000) + "1.00000000000000001" + "]".repeat(4000);
  let result = parseSourceJson(deep, (_key, token) => token);
  for (let index = 0; index < 4000; index++) result = (result as unknown[])[0];
  assert.equal(result, "1.00000000000000001");
  const large = "[" + Array.from({ length: 10000 }, (_, index) => `${index}.00000000000000001`).join(",") + "]";
  const items = parseSourceJson(large, (_key, token) => token) as string[];
  assert.equal(items.length, 10000); assert.equal(items[9999], "9999.00000000000000001");
});

test("portable numeric callbacks agree with Node's source-aware parser on a mixed corpus", () => {
  const numbers = ["0", "-0", "1.00", "0.10000000000000001", "9007199254740993", "-1.1234567890123456789", "1e400", "1E-400", "2.5e+4"];
  const strings = ['"1e400"', JSON.stringify('"1"'), '"\\u0000source-number:2"', '"Атлет"', '"\\u0030"'];
  for (let index = 0; index < 1000; index++) {
    const a = numbers[index % numbers.length]!, b = numbers[Math.floor(index / numbers.length) % numbers.length]!;
    const source = `{"10":${a},"2":${b},"note":${strings[index % strings.length]},"v":[true,null,{"weight":${a}},${b}],"weight":${b},"weight":${a}}`;
    const actual = parseSourceJson(source, (_key, token) => ({ source: token }));
    const expected = JSON.parse(source, (_key: string, value: unknown, context?: { source?: string }) => typeof value === "number" ? { source: context!.source } : value) as unknown;
    assert.deepEqual(actual, expected);
    assert.deepEqual(parseSourceJson(source, (_key, token) => Number(token)), JSON.parse(source) as unknown);
  }
});

test("execution, nutrition, archive and calendar projections work with only two reviver arguments", async () => {
  const context = { sourceSha256: "a".repeat(64), accountScope: "portable-synthetic", sourceWorkspaceId: "source", targetWorkspaceId: "local-trainer" };
  const archive = { id: "week", client_id: "client", start_date: "2026-10-19", end_date: "2026-10-25", saved_at: "2026-10-24T12:00:00Z",
    days_json: '[{"dateKey":"2026-10-19","weight":80.10000000000000001,"steps":9007199254740993,"training":"Нет"}]' };
  const calendar = { accountScope: context.accountScope, appointments: [], unsupportedAccountingTables: [], plannerRows: [{ key: "calendar_planner_settings", updated_at: "2026-10-24T12:00:00Z",
    value: '{"startHour":7.00000000000000001,"endHour":22,"workingDays":[0,1],"dutySlots":{"2026-10-24":{"08:00":true}},"blockedSlots":{}}' }] };
  const execution = '{"reps":9007199254740993,"weight":10.00000000000000001,"rpe":-0,"note":"1e400"}';
  const nutrition = '{"calories":1.00000000000000001,"protein":-0,"grams":9007199254740993,"name":"1e400"}';
  const expected = {
    execution: parseLegacyExecutionMetricJson(execution), nutrition: nutritionJson(nutrition),
    archive: projectNutritionArchive(archive, "source-week", "client", "week", (position) => `day-${position}`),
    calendar: composeLegacyCalendar(context, "2026-10-24T12:00:00Z", calendar, new Map(), (kind, key) => JSON.stringify([kind, key])),
  };
  const worker = `import {parentPort,workerData} from 'node:worker_threads';
    const nativeParse=JSON.parse;let reviverCalls=0;
    JSON.parse=function(text,reviver){return nativeParse(text,typeof reviver==='function'?function(key,value){reviverCalls++;return reviver.call(this,key,value);}:undefined);};
    let probe=false;JSON.parse('1',function(){probe=arguments.length===2;return arguments[1];});if(!probe)throw Error('TWO_ARGUMENT_GUARD_INACTIVE');
    const {parseLegacyExecutionMetricJson}=await import(workerData.urls.execution);
    const {nutritionJson}=await import(workerData.urls.nutrition);
    const {projectNutritionArchive}=await import(workerData.urls.archive);
    const {composeLegacyCalendar}=await import(workerData.urls.calendar);
    const result={execution:parseLegacyExecutionMetricJson(workerData.execution),nutrition:nutritionJson(workerData.nutrition),
      archive:projectNutritionArchive(workerData.archive,'source-week','client','week',position=>'day-'+position),
      calendar:composeLegacyCalendar(workerData.context,'2026-10-24T12:00:00Z',workerData.calendar,new Map(),(kind,key)=>JSON.stringify([kind,key]))};
    parentPort.postMessage({result,reviverCalls});`;
  const observed = await new Promise<{ result: unknown; reviverCalls: number }>((resolve, reject) => {
    const task = new Worker(new URL(`data:text/javascript,${encodeURIComponent(worker)}`), { execArgv: ["--experimental-strip-types"],
      workerData: { context, archive, calendar, execution, nutrition, urls: Object.fromEntries([
        ["execution", "LegacyExecutionMetricJson"], ["nutrition", "LegacyNutritionValues"], ["archive", "LegacyNutritionArchive"], ["calendar", "LegacyCalendarProjection"],
      ].map(([key, filename]) => [key, new URL(`./r04/${filename}.ts`, import.meta.url).href])) } });
    let received: { result: unknown; reviverCalls: number } | null = null;
    task.once("message", (value) => { received = value as typeof received; });
    task.once("error", reject);
    task.once("exit", (code) => { if (code || received === null) reject(new Error(`SOURCE_JSON_ISOLATE_EXIT_${code}`)); else resolve(received); });
  });
  assert.deepEqual(observed.result, expected);
  assert.equal(observed.reviverCalls, 1, "the importer needs no native reviver; the single call is the guard probe");
  assert.deepEqual((expected.execution as Record<string, unknown>).weight, "10.00000000000000001");
  assert.deepEqual(expected.archive.days[0]!.values.weight, { state: "VALUE", sourceDecimal: "80.10000000000000001" });
  assert.equal(expected.calendar.tables.calendar_settings!.length, 0, "an inexact integer must not silently become 7");
  assert.equal(expected.calendar.tables.calendar_intervals!.length, 1, "independent valid flags survive");
});
