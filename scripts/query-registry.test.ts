import assert from "node:assert/strict";
import { writeWithChanges } from "../apps/mobile/src/read-models/CommittedChangeWriter.ts";
import { QueryRegistry, type DomainChangeManifest } from "../apps/mobile/src/read-models/QueryRegistry.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from "../apps/mobile/src/shared/db/SqlitePort.ts";
import { WriterCoordinator } from "../apps/mobile/src/shared/db/WriterCoordinator.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const clientA: DomainChangeManifest = { domain: "clients", workspaceId: "w1", clientId: "A", entityIds: ["A"] };
const registry = new QueryRegistry();
let rosterLoads = 0;
let clientALoads = 0;
let clientBLoads = 0;
let otherWorkspaceLoads = 0;
const roster = registry.register({ kind: "roster", workspaceId: "w1", parameters: "active" },
  [{ domain: "clients", workspaceId: "w1" }], async () => ++rosterLoads);
const a = registry.register({ kind: "home", workspaceId: "w1", clientId: "A" },
  [{ domain: "clients", workspaceId: "w1", clientId: "A", entityIds: ["A"] }], async () => ++clientALoads);
const b = registry.register({ kind: "home", workspaceId: "w1", clientId: "B" },
  [{ domain: "clients", workspaceId: "w1", clientId: "B", entityIds: ["B"] }], async () => ++clientBLoads);
const other = registry.register({ kind: "roster", workspaceId: "w2" },
  [{ domain: "clients", workspaceId: "w2" }], async () => ++otherWorkspaceLoads);
await tick();
assert.deepEqual([rosterLoads, clientALoads, clientBLoads, otherWorkspaceLoads], [1, 1, 1, 1]);

const firstRoster = roster.getSnapshot();
const firstA = a.getSnapshot();
const firstB = b.getSnapshot();
registry.publish([clientA, clientA]);
await tick();
assert.deepEqual([rosterLoads, clientALoads, clientBLoads, otherWorkspaceLoads], [2, 2, 1, 1], "one batched change refreshes only overlapping queries once");
assert.equal(b.getSnapshot(), firstB, "unrelated query keeps its snapshot identity");
assert.equal(other.getSnapshot().revision, 1, "another workspace keeps its revision");
assert.notEqual(roster.getSnapshot(), firstRoster);
assert.notEqual(a.getSnapshot(), firstA);
assert.equal(a.getSnapshot().revision, 2);
registry.publish([{ domain: "sets", workspaceId: "w1", clientId: "A" }]);
await tick();
assert.deepEqual([rosterLoads, clientALoads, clientBLoads, otherWorkspaceLoads], [2, 2, 1, 1]);
registry.publish([{ domain: "clients", workspaceId: "w1", clientId: "A", entityIds: ["unrelated-id"] }]);
await tick();
assert.deepEqual([rosterLoads, clientALoads, clientBLoads, otherWorkspaceLoads], [3, 2, 1, 1], "entity ID dependency filters client detail without suppressing roster");
registry.publish([{ domain: "clients", workspaceId: "w1" }]);
await tick();
assert.deepEqual([rosterLoads, clientALoads, clientBLoads, otherWorkspaceLoads], [4, 3, 2, 1], "broad workspace change refreshes all local clients");

let pending = deferred<string>();
const slow = registry.register({ kind: "history", workspaceId: "w1", clientId: "A", localDate: "2026-10-15" },
  [{ domain: "sets", workspaceId: "w1", clientId: "A" }], () => pending.promise);
await tick();
pending.resolve("initial");
await tick();
const ready = slow.getSnapshot();
assert.equal(ready.status, "ready");
if (ready.status !== "ready") throw new Error("EXPECTED_READY");
const older = deferred<string>();
pending = older;
slow.refresh();
await tick();
assert.deepEqual(slow.getSnapshot(), { ...ready, refreshing: true, refreshFailed: false }, "refresh retains valid data");
const newer = deferred<string>();
pending = newer;
slow.refresh();
await tick();
older.resolve("stale A");
await tick();
assert.equal(slow.getSnapshot().status, "ready");
const afterStale = slow.getSnapshot();
assert.equal(afterStale.status, "ready");
if (afterStale.status !== "ready") throw new Error("EXPECTED_READY");
assert.equal(afterStale.refreshing, true);
newer.resolve("current A");
await tick();
assert.deepEqual(slow.getSnapshot(), { status: "ready", revision: 2, data: "current A", refreshing: false, refreshFailed: false });

const failing = deferred<string>();
pending = failing;
slow.refresh();
await tick();
failing.reject(new Error("READ_FAILED"));
await tick();
assert.deepEqual(slow.getSnapshot(), { status: "ready", revision: 2, data: "current A", refreshing: false, refreshFailed: true });

const never = deferred<string>();
pending = never;
slow.refresh();
await tick();
slow.dispose();
never.resolve("disposed result");
await tick();
const afterDispose = slow.getSnapshot();
if (afterDispose.status !== "ready") throw new Error("EXPECTED_READY");
assert.notEqual(afterDispose.data, "disposed result");
assert.throws(() => slow.subscribe(() => undefined), /QUERY_DISPOSED/u);
assert.throws(() => registry.register({ kind: "home", workspaceId: "w1", clientId: "A" },
  [{ domain: "clients", workspaceId: "w1" }], async () => 0), /QUERY_ALREADY_REGISTERED/u);

const committed = deferred<void>();
const connection: SqliteConnectionPort = {
  run: async () => ({ changes: 1, lastInsertRowId: 0 }),
  first: async <Row>() => null as Row | null,
  all: async <Row>() => [] as Row[],
  exclusive: async <T>(task: (tx: SqliteStatementPort) => Promise<T>) => {
    const result = await task(connection);
    await committed.promise; // Simulated COMMIT barrier after task completion.
    return result;
  },
  close: async () => undefined,
};
const writer = new WriterCoordinator(connection);
let published = 0;
const publisher = { publish: (changes: readonly DomainChangeManifest[]) => { published += changes.length; registry.publish(changes); } };
const operation = writeWithChanges(writer, async () => ({ value: "saved", changes: [clientA] }), publisher);
await tick();
assert.equal(published, 0, "a pending commit cannot publish a change");
committed.resolve();
assert.equal(await operation, "saved");
assert.equal(published, 1);
await assert.rejects(writeWithChanges(writer, async () => { throw new Error("WRITE_FAILED"); }, publisher), /WRITE_FAILED/u);
assert.equal(published, 1, "failed write cannot publish a success change");

registry.dispose();
console.log("Read-model registry: scoped refresh, stale result, retained snapshot, post-commit checks passed");
