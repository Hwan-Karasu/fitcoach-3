import assert from "node:assert/strict";
import test from "node:test";
import { clearRestSignals } from "../src/app/runtime/ClearRestSignals.ts";

const request = (identifier: string, kind: string) => ({ identifier, content: { data: { kind } } });
test("R06 restore removes only actual OS rest requests, presented alerts and a rest launch response", async () => {
  const cancelled: string[] = []; const dismissed: string[] = []; let response = true;
  await clearRestSignals({ scheduled: async () => [request("rest", "rest-timer"), request("calendar", "calendar"), request("unknown", "other")],
    presented: async () => [{ request: request("shown-rest", "rest-timer") }, { request: request("shown-calendar", "calendar") }],
    response: async () => ({ notification: { request: request("tap-rest", "rest-timer") } }),
    cancel: async (id) => { cancelled.push(id); }, dismiss: async (id) => { dismissed.push(id); }, clearResponse: async () => { response = false; } });
  assert.deepEqual(cancelled, ["rest"]); assert.deepEqual(dismissed, ["shown-rest"]); assert.equal(response, false);
});
test("R06 restore preserves a calendar launch response and notifications without the rest ownership kind", async () => {
  const touched: string[] = [];
  await clearRestSignals({ scheduled: async () => [{ identifier: "no-data", content: {} }, { identifier: "wrong-data", content: { data: "rest-timer" } }],
    presented: async () => [], response: async () => ({ notification: { request: request("calendar", "calendar") } }),
    cancel: async (id) => { touched.push(id); }, dismiss: async (id) => { touched.push(id); }, clearResponse: async () => { touched.push("response"); } });
  assert.deepEqual(touched, []);
});
test("R06 partial OS failure still attempts remaining owned cleanup and reports a fixed error", async () => {
  const touched: string[] = [];
  await assert.rejects(clearRestSignals({ scheduled: async () => [request("fails", "rest-timer"), request("works", "rest-timer")],
    presented: async () => [{ request: request("shown", "rest-timer") }], response: async () => null,
    cancel: async (id) => { touched.push(id); if (id === "fails") throw new Error("private platform details"); },
    dismiss: async (id) => { touched.push(id); }, clearResponse: async () => undefined }), { message: "REST_SIGNALS_UNAVAILABLE" });
  assert.deepEqual(touched.sort(), ["fails", "shown", "works"]);
});
