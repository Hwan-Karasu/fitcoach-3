import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/foundation.yml", import.meta.url), "utf8");

test("foundation workflow runs for every PR with read-only permissions", () => {
  assert.match(workflow, /^ {2}pull_request:\s*$/mu);
  assert.match(workflow, /^ {2}contents: read\s*$/mu);
  assert.match(workflow, /node-version: 24\.3\.0/u);
  assert.doesNotMatch(workflow, /\bsecrets\./u);
});

test("foundation workflow installs locked packages and runs all local contracts", () => {
  for (const command of [
    "npm ci", "npm ci --prefix apps/mobile", "npm ci --prefix spikes/sqlite",
    "npm ci --prefix spikes/navigation", "npm run typecheck", "npm run lint",
    "npm run test:foundation", "npm run arch:check", "npm run theme:check",
    "npm run secrets:check", "npm --prefix apps/mobile run doctor",
    "npm --prefix apps/mobile run android:bundle",
  ]) {
    assert.ok(workflow.includes(command), `${command} must be in the workflow`);
  }
});
