import assert from "node:assert/strict";
import test from "node:test";
import { inspectSensitiveLine, inspectSensitivePath } from "./sensitive-file-rules.ts";

test("blocks private key and database file types", () => {
  assert.deepEqual(inspectSensitivePath("android/upload.jks"), ["PRIVATE_KEY_FILE"]);
  assert.deepEqual(inspectSensitivePath("fixtures/live.sqlite3"), ["DATABASE_FILE"]);
  assert.deepEqual(inspectSensitivePath("fixtures/trainer.atbackup"), ["DATABASE_FILE"]);
  assert.deepEqual(inspectSensitivePath(".env.local"), ["ENV_FILE"]);
  assert.deepEqual(inspectSensitivePath(".env.example"), []);
});

test("recognizes high-confidence key formats without printing their value", () => {
  const aws = "AK" + "IA" + "A".repeat(16);
  const github = "gh" + "p_" + "A".repeat(36);
  const pem = "-----BEGIN " + "PRIVATE KEY-----";
  assert.deepEqual(inspectSensitiveLine(aws), ["AWS_ACCESS_KEY_ID"]);
  assert.deepEqual(inspectSensitiveLine(github), ["GITHUB_TOKEN"]);
  assert.deepEqual(inspectSensitiveLine(pem), ["PRIVATE_KEY_HEADER"]);
  assert.deepEqual(inspectSensitiveLine("ordinary source text"), []);
});
