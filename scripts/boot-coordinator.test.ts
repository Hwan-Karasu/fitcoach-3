import assert from "node:assert/strict";
import test from "node:test";
import { BootCoordinator, BootGateError, type BootDependencies, type BootState } from
  "../apps/mobile/src/app/bootstrap/BootCoordinator.ts";
import type { ThemePreference } from "../apps/mobile/src/shared/ui/theme/resolver.ts";

const preference: ThemePreference = { themeId: "slate-blue", accentId: "violet" };

test("R06 interrupted restore recovery precedes workspace/database creation and failure blocks all normal boot work", async () => {
  const events: string[] = []; let failed = true;
  const boot = new BootCoordinator({ fallbackThemeId: "night-mocha",
    recoverBeforeOpen: async () => { events.push("recover"); if (failed) throw new Error("PRIVATE_RECOVERY_PATH"); },
    prepareWorkspace: async () => { events.push("workspace"); return { id: "local" }; },
    openDatabase: async () => { events.push("database"); },
    loadThemePreference: async () => { events.push("theme"); return preference; },
  });
  assert.deepEqual(await boot.start(), { kind: "BOOT_FAILED", attempt: 1, code: "RESTORE_RECOVERY_REQUIRED" });
  assert.deepEqual(events, ["recover"]);
  failed = false; assert.equal((await boot.retry()).kind, "APP_READY");
  assert.deepEqual(events, ["recover", "recover", "workspace", "database", "theme"]);
});

test("critical DB and theme gate precedes APP_READY; background starts afterward", async () => {
  const events: string[] = [];
  const states: string[] = [];
  let releasePreference: (value: ThemePreference) => void = () => {};
  const waitingPreference = new Promise<ThemePreference>((resolve) => { releasePreference = resolve; });
  const dependencies: BootDependencies = {
    fallbackThemeId: "night-mocha",
    prepareWorkspace: async () => { events.push("workspace"); return { id: "local-workspace" }; },
    openDatabase: async () => { events.push("database"); },
    loadThemePreference: async () => { events.push("preference"); return await waitingPreference; },
    startBackgroundServices: async () => { events.push("background"); },
  };
  const gate = new BootCoordinator(dependencies);
  gate.subscribe((state) => { states.push(state.kind); });
  let reentrant: Promise<BootState> | null = null;
  gate.subscribe((state) => {
    if (state.kind === "BOOT_PENDING" && state.attempt === 1) reentrant = gate.start();
  });
  const first = gate.start();
  assert.strictEqual(gate.start(), first, "duplicate boot call shares one attempt");
  assert.strictEqual(reentrant, first, "reentrant observer cannot launch a second attempt");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(gate.state.kind, "DB_READY");
  assert.deepEqual(events, ["workspace", "database", "preference"]);
  releasePreference(preference);
  const ready = await first;
  assert.equal(ready.kind, "APP_READY");
  if (ready.kind !== "APP_READY") return;
  assert.equal(ready.palette.themeId, "slate-blue");
  assert.equal(ready.palette.accentId, "cobalt");
  assert.deepEqual(states, ["BOOT_PENDING", "BOOT_PENDING", "DB_READY", "APP_READY"]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["workspace", "database", "preference", "background"]);
});

test("fatal DB error is typed and retry does not delete data", async () => {
  let attempts = 0;
  const gate = new BootCoordinator({
    fallbackThemeId: "night-mocha",
    prepareWorkspace: async () => ({ id: "local-workspace" }),
    openDatabase: async () => {
      attempts += 1;
      if (attempts === 1) throw new BootGateError("MIGRATION_INCOMPLETE");
    },
    loadThemePreference: async () => preference,
  });
  const failed = await gate.start();
  assert.deepEqual(failed, { kind: "BOOT_FAILED", attempt: 1, code: "MIGRATION_INCOMPLETE" });
  assert.equal(gate.state.kind, "BOOT_FAILED");
  assert.strictEqual(await gate.start(), failed, "ordinary start cannot silently retry a failed boot");
  assert.equal(attempts, 1);
  const ready = await gate.retry();
  assert.equal(ready.kind, "APP_READY");
  assert.equal(ready.attempt, 2);
  assert.equal(attempts, 2);
});

test("background failure and observer failure cannot roll back a ready boot", async () => {
  const reports: string[] = [];
  const gate = new BootCoordinator({
    fallbackThemeId: "night-mocha",
    prepareWorkspace: async () => ({ id: "local-workspace" }),
    openDatabase: async () => {},
    loadThemePreference: async () => ({ themeId: "retired-theme", accentId: "retired-accent" }),
    startBackgroundServices: async () => { throw new Error("private diagnostic detail"); },
    reportBackgroundFailure: (code) => { reports.push(code); },
  });
  gate.subscribe(() => { throw new Error("broken view observer"); });
  const ready = await gate.start();
  assert.equal(ready.kind, "APP_READY");
  if (ready.kind !== "APP_READY") return;
  assert.equal(ready.palette.usedThemeFallback, true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(reports, ["BACKGROUND_SERVICE_FAILED"]);
  assert.equal(gate.state.kind, "APP_READY");
});
