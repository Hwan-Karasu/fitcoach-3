import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, backup } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { stageLegacyImportCandidate } from "../apps/mobile/src/app/composition/stageLegacyImportCandidate.ts";
import { prepareProductionDatabase, PRODUCTION_IDENTITY, inspectProductionDatabase } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { SCHEMA_OWNERS } from "../apps/mobile/src/app/composition/schema.ts";
import { readLegacyNativeWorkData } from "../apps/mobile/src/features/clients/data/legacy-import/LegacyNativeWorkData.ts";
import { installInitialClientWorkData } from "../apps/mobile/src/features/clients/data/InitialClientWorkData.ts";
import { SqliteClientWorkDataRepository } from "../apps/mobile/src/features/clients/data/SqliteClientWorkDataRepository.ts";
import { WORK_DATA_TABLES, type WorkDataRows } from "../apps/mobile/src/features/clients/data/ClientWorkDataRows.ts";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { devClientCatalog, DEV_CLIENTS_LEDGER } from "../apps/mobile/src/features/clients/data/DevClientCatalog.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { runMigrationsInTransaction } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import { SqliteSnapshotEngine } from "../apps/mobile/src/features/backup/data/SqliteSnapshotEngine.ts";
import { clearReadIssues, readIssueCount, subscribeReadIssues } from "../apps/mobile/src/shared/diagnostics/ReadIssues.ts";
import { clientWorkDataCandidateOwner as owner } from "./r04/ClientWorkDataCandidateSchema.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { nodeSnapshotSql } from "./r06/NodeSnapshotSql.ts";
import { fixture as baseFixture, referenceDay } from "./support/legacy-nutrition-staging.ts";
import { seedLegacyCalendarSource } from "./support/legacy-calendar-source.ts";
import { allocator, importedAt, digest } from "./support/legacy-training-staging.ts";

const workspaceId = "local-trainer", now = "2026-10-25T12:00:00.000Z";
const engine = () => new SqliteSnapshotEngine({ identity: PRODUCTION_IDENTITY, owners: [...SCHEMA_OWNERS, owner] });
const nativeRows = (db: DatabaseSync) => WORK_DATA_TABLES.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]);
type Base = Parameters<Parameters<typeof baseFixture>[0]>[0];
async function setup(f: Base, full: boolean) {
  await stageLegacyImportCandidate({ openStaging: f.native.open, source: f.snapshots, context: f.context, importedAt, referenceDay, allocate: allocator() });
  const stage = new DatabaseSync(f.stagePath); let seed: WorkDataRows;
  try { seed = await nodeSqlitePort(stage).exclusive((tx) => readLegacyNativeWorkData(tx, f.context, importedAt)); }
  finally { stage.close(); }
  const file = join(f.dir, "work-data-candidate.sqlite"), db = new DatabaseSync(file), port = nodeSqlitePort(db);
  const shared = new SharedSqliteDatabase(async () => ({ ...port, close: async () => undefined }));
  if (full) await prepareProductionDatabase(shared);
  await port.exclusive(async (tx) => {
    if (!full) {
      await runMigrationsInTransaction(tx, devClientCatalog, DEV_CLIENTS_LEDGER);
      await tx.run("INSERT INTO workspaces VALUES(?,?,?)", [workspaceId, "Synthetic", now]);
    }
    await runMigrationsInTransaction(tx, owner.chain, owner.ledger);
    const stage = new DatabaseSync(f.stagePath, { readOnly: true });
    try { for (const row of stage.prepare("SELECT * FROM clients").all()) {
      const columns = Object.keys(row); await tx.run(`INSERT INTO clients(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`, Object.values(row) as (string | number | null)[]);
    } } finally { stage.close(); }
    await installInitialClientWorkData(tx, workspaceId, seed);
  });
  const a = seed.trainer_notes.find((r) => (r.body as string).includes("First"))!.client_id as string;
  const b = seed.trainer_notes.find((r) => (r.body as string).includes("Second"))!.client_id as string;
  const repo = new SqliteClientWorkDataRepository(shared, workspaceId, () => now);
  return { ...f, file, db, port, shared, seed, repo, a, b };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
const fixture = (run: (f: Fixture) => Promise<void>, full = true) => baseFixture(async (f) => {
  const prepared = await setup(f, full);
  try { await run(prepared); assert.equal(digest(f.sourcePath), f.sha); }
  finally { await prepared.repo.close(); prepared.db.close(); }
}, (db) => {
  seedLegacyCalendarSource(db, { existingOwners: true, existingDays: true, existingSettings: true });
  for (const [id, profile] of [["a", { trainerNotes: "  First note\nExact body  ", trainerTags: [" Утро ", "VIP"], pain: "Old knee answer", unwantedLoad: "Exact source text" }],
    ["b", { trainerNotes: "Second note", trainerTags: ["утро", "Private"], injuries: "Historical injury" }]] as const) db.prepare("UPDATE clients SET profile_json=? WHERE id=?").run(JSON.stringify(profile), id);
});

test("native WorkData retains stable notes, shared manual tags, pending reviews and per-client import evidence", () => fixture(async (f) => {
  const notes = await f.repo.listNotes(f.a), tagsA = await f.repo.listClientTags(f.a), tagsB = await f.repo.listClientTags(f.b);
  assert.equal(notes[0]!.body, "  First note\nExact body  "); assert.equal(notes[0]!.revision, 1); assert.equal(notes[0]!.createdAt, importedAt);
  assert.equal(notes[0]!.context?.type, "LEGACY_IMPORT"); assert.equal(tagsA.length, 2); assert.equal(tagsB.length, 2);
  assert.equal(tagsA.find((t) => t.normalizedName === "утро")!.id, tagsB.find((t) => t.normalizedName === "утро")!.id);
  const reviews = await f.repo.listSafetyImportReviews(f.a); assert.equal(reviews.length, 2); assert.ok(reviews.every((r) => r.status === "PENDING_REVIEW"));
  const evidence = (await f.repo.getImportEvidence(f.a))[0]!; assert.equal(evidence.sourceSha256, f.sha);
  assert.equal((JSON.parse(evidence.projectionJson) as { noteTimeBasis: string }).noteTimeBasis, "IMPORT_TIME_SOURCE_NOTE_TIME_UNKNOWN");
  assert.equal((JSON.parse(evidence.sourceJson) as { profile_json: string }).profile_json, JSON.stringify({ trainerNotes: "  First note\nExact body  ", trainerTags: [" Утро ", "VIP"], pain: "Old knee answer", unwantedLoad: "Exact source text" }));
  const before = nativeRows(f.db); await f.port.exclusive((tx) => installInitialClientWorkData(tx, workspaceId, f.seed)); assert.deepEqual(nativeRows(f.db), before);
  assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE 'r04_%'").get()!.n, 0);
  // Candidate-only schema is deliberately NOT admitted by the production registry.
  await assert.rejects(inspectProductionDatabase(f.port), /DATABASE_INCOMPATIBLE/u);
}));

test("ordinary note editing keeps context/identity/time, uses revisions, searches literal text and isolates client scope", () => fixture(async (f) => {
  const original = (await f.repo.listNotes(f.a))[0]!, evidence = await f.repo.getImportEvidence(f.a);
  const other = await f.repo.createNote(f.a, "New 100%_literal мысль"); assert.equal(other.context, null);
  const patched = await f.repo.updateNote(f.a, original.id, 1, { body: "  Corrected\nbody  ", pinned: true });
  assert.equal(patched.id, original.id); assert.equal(patched.createdAt, original.createdAt); assert.equal(patched.updatedAt, now);
  assert.deepEqual(patched.context, original.context); assert.equal(patched.revision, 2); assert.equal((await f.repo.listNotes(f.a))[0]!.id, original.id);
  assert.equal((await f.repo.listNotes(f.a, "%_literal МЫСЛЬ"))[0]!.id, other.id);
  assert.equal((await f.repo.listNotes(f.a, "absent" )).length, 0);
  await assert.rejects(f.repo.updateNote(f.a, original.id, 1, { body: "stale", pinned: false }), /STALE_OR_WRONG_SCOPE/u);
  await assert.rejects(f.repo.updateNote(f.b, original.id, 2, { body: "foreign", pinned: false }), /STALE_OR_WRONG_SCOPE/u);
  await assert.rejects(f.repo.createNote(f.a, " \n "), /BODY_REQUIRED/u);
  assert.deepEqual(await f.repo.getImportEvidence(f.a), evidence);
  await assert.rejects(f.port.exclusive((tx) => installInitialClientWorkData(tx, workspaceId, f.seed)), /INITIAL_PARITY_MISMATCH/u);
  assert.equal((await f.repo.listNotes(f.a))[0]!.body, "  Corrected\nbody  ");
}));

test("manual tag rename updates shared presentation without changing assignments or merging different entities", () => fixture(async (f) => {
  const tag = (await f.repo.listTags()).find((t) => t.normalizedName === "утро")!;
  const before = f.db.prepare("SELECT * FROM client_tag_assignments").all();
  const changed = await f.repo.updateTag(tag.id, 1, { name: "  Раннее   утро ", color: "#123456", lifecycle: "ACTIVE" });
  assert.equal(changed.id, tag.id); assert.equal(changed.normalizedName, "раннее утро");
  for (const id of [f.a, f.b]) assert.equal((await f.repo.listClientTags(id)).find((t) => t.id === tag.id)!.name, "Раннее утро");
  assert.deepEqual(f.db.prepare("SELECT * FROM client_tag_assignments").all(), before);
  await assert.rejects(f.repo.createTag("РАННЕЕ  УТРО"), /TAG_NAME_CONFLICT/u);
  const vip = (await f.repo.listTags()).find((t) => t.name === "VIP")!;
  await assert.rejects(f.repo.updateTag(vip.id, 1, { name: "раннее утро", color: null, lifecycle: "ACTIVE" }), /TAG_NAME_CONFLICT/u);
  await assert.rejects(f.repo.updateTag(tag.id, 1, { name: "stale", color: null, lifecycle: "ACTIVE" }), /STALE_OR_WRONG_SCOPE/u);
  const archived = await f.repo.updateTag(tag.id, 2, { name: changed.name, color: null, lifecycle: "ARCHIVED" }); assert.equal(archived.revision, 3);
  assert.equal((await f.repo.listTags()).some((t) => t.id === tag.id), false); assert.equal((await f.repo.listTags(true)).some((t) => t.id === tag.id), true);
  assert.equal((await f.repo.listClientTags(f.a)).find((t) => t.id === tag.id)!.lifecycle, "ARCHIVED");
  await assert.rejects(f.repo.assignTag(f.a, tag.id), /TAG_UNAVAILABLE/u); await f.repo.unassignTag(f.a, tag.id);
  assert.equal((await f.repo.listClientTags(f.b)).some((t) => t.id === tag.id), true);
  const fresh = await f.repo.createTag("ё"); await f.repo.assignTag(f.a, fresh.id); await f.repo.assignTag(f.a, fresh.id);
  assert.equal((await f.repo.listClientTags(f.a)).filter((t) => t.id === fresh.id).length, 1); assert.notEqual((await f.repo.createTag("е")).id, fresh.id);
}));

test("archive/deletion manifest removes only client-owned records atomically and retains workspace tags", () => fixture(async (f) => {
  const clientRepo = new DevClientRepository(f.shared, workspaceId, [f.repo.deletionParticipant()]);
  try {
    await clientRepo.initialize(); const client = await clientRepo.setArchived(f.a, 1, true);
    assert.equal((await f.repo.listNotes(f.a)).length, 1);
    await assert.rejects(f.repo.createNote(f.a, "forbidden"), /CLIENT_ARCHIVED/u);
    await assert.rejects(f.repo.assignTag(f.a, (await f.repo.listTags())[0]!.id), /CLIENT_ARCHIVED/u);
    const manifest = await clientRepo.previewPermanentDelete(f.a); assert.equal(manifest.owners.find((o) => o.owner === "clients.workData")!.rows, 6);
    const before = nativeRows(f.db), participant = f.repo.deletionParticipant();
    await assert.rejects(f.port.exclusive(async (tx) => { await participant.detach(tx, workspaceId, f.a, now); throw Error("after-detach"); }), /after-detach/u);
    assert.deepEqual(nativeRows(f.db), before);
    await assert.rejects(f.port.exclusive((tx) => participant.detach(tx, workspaceId, f.b, now)), /CLIENT_NOT_ARCHIVED/u);
    await clientRepo.deleteArchivedPermanently(f.a, client.revision);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM clients WHERE id=?").get(f.a)!.n, 0);
    assert.equal((await f.repo.listNotes(f.b)).length, 1); assert.equal((await f.repo.listTags()).length, 3);
    for (const table of participant.tables) assert.equal(f.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE client_id=?`).get(f.a)!.n, 0);
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { await clientRepo.close(); }
}, false));

test("scope/FK/JSON/immutable evidence guards reject cross-workspace mutation and malformed writes", () => fixture(async (f) => {
  f.db.prepare("INSERT INTO workspaces VALUES('foreign','Foreign',?)").run(now);
  const foreign = new SqliteClientWorkDataRepository(f.shared, "foreign");
  try {
    assert.deepEqual(await foreign.listTags(), []); await assert.rejects(foreign.listNotes(f.a), /CLIENT_NOT_FOUND/u);
    const tag = await foreign.createTag("Private"); await assert.rejects(f.repo.assignTag(f.a, tag.id), /TAG_UNAVAILABLE/u);
    assert.throws(() => f.db.prepare("INSERT INTO client_tag_assignments VALUES(?,?,?)").run(workspaceId, f.a, tag.id), /FOREIGN KEY/u);
    assert.throws(() => f.db.prepare("UPDATE trainer_notes SET client_id=? WHERE client_id=?").run(f.b, f.a), /OWNER_SCOPE_IMMUTABLE/u);
    assert.throws(() => f.db.exec("UPDATE client_work_import_evidence SET source_json='{}'"), /EVIDENCE_IMMUTABLE/u);
    assert.throws(() => f.db.prepare("INSERT INTO trainer_notes VALUES('bad',?,?,?, ?,?,0,?,1)").run(workspaceId, f.a, "body", now, now, '{"type":"LEGACY_IMPORT"}'), /CHECK/u);
  } finally { await foreign.close(); }
}));

test("a corrupt persisted JSON row is skipped with a content-free issue while valid notes remain usable", () => fixture(async (f) => {
  clearReadIssues(); let events = 0; const stop = subscribeReadIssues(() => { events++; });
  try {
    f.db.exec("PRAGMA ignore_check_constraints=ON");
    f.db.prepare("INSERT INTO trainer_notes VALUES('corrupt',?,?,?,?,?,0,'PRIVATE invalid JSON',1)").run(workspaceId, f.a, "hidden body", now, now);
    f.db.exec("PRAGMA ignore_check_constraints=OFF");
    assert.equal((await f.repo.listNotes(f.a)).length, 1); assert.equal(readIssueCount(), 1); assert.equal(events, 1);
    await f.repo.listNotes(f.a); assert.equal(events, 1);
    assert.equal((await f.repo.createNote(f.a, "Still works")).body, "Still works");
  } finally { stop(); clearReadIssues(); }
}));

test("native import seed rolls back completely on write failure and rejects source/receipt/context drift", () => fixture(async (f) => {
  await f.port.exclusive(async (tx) => { for (const table of [...WORK_DATA_TABLES].reverse()) await tx.run(`DELETE FROM ${table}`); });
  let failed = false;
  await assert.rejects(f.port.exclusive((tx) => installInitialClientWorkData({ ...tx, run: async (sql, args) => {
    if (sql.startsWith("INSERT INTO client_safety_import_reviews")) { failed = true; throw Error("injected"); } return tx.run(sql, args);
  } }, workspaceId, f.seed)), /injected/u); assert.equal(failed, true);
  for (const table of WORK_DATA_TABLES) assert.equal(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0);
  await f.port.exclusive(async (tx) => {
    const mutable = structuredClone(f.seed), pending = installInitialClientWorkData(tx, workspaceId, mutable);
    Object.assign(mutable.trainer_notes[0]!, { body: "caller mutation after capture" }); await pending;
  });
  const before = nativeRows(f.db); const changed = structuredClone(f.seed); Object.assign(changed.trainer_notes[0]!, { body: "drift" });
  await assert.rejects(f.port.exclusive((tx) => installInitialClientWorkData(tx, workspaceId, changed)), /INITIAL_PARITY_MISMATCH/u); assert.deepEqual(nativeRows(f.db), before);
  const stage = new DatabaseSync(f.stagePath), source = nodeSqlitePort(stage);
  try {
    await assert.rejects(source.exclusive((tx) => readLegacyNativeWorkData(tx, { ...f.context, sourceSha256: "f".repeat(64) }, importedAt)), /NATIVE_PARITY_MISMATCH/u);
    stage.exec("UPDATE r04_work_notes SET body='drift'"); await assert.rejects(source.exclusive((tx) => readLegacyNativeWorkData(tx, f.context, importedAt)), /NATIVE_PARITY_MISMATCH/u);
  } finally { stage.close(); }
}));

test("schema format admission is read-only and failed initialization releases its lease", () => fixture(async (f) => {
  await f.repo.close(); f.db.exec("UPDATE client_work_data_format SET tag_name_policy='foreign-policy'"); const before = digest(f.file);
  await assert.rejects(f.repo.initialize(), /FORMAT_UNSUPPORTED/u); assert.equal(digest(f.file), before);
  await f.repo.close(); f.db.exec("UPDATE client_work_data_format SET tag_name_policy='NFC_WHITESPACE_RU_CASE_V1'");
  await f.repo.initialize(); assert.equal((await f.repo.listNotes(f.a)).length, 1);
}));

test("Client Card creation, its first note and manual tags commit or roll back in one transaction", () => fixture(async (f) => {
  const clients = new DevClientRepository(f.shared, workspaceId); await clients.initialize();
  const lease = await f.shared.acquire();
  try {
    const tag = (await f.repo.listTags())[0]!, before = nativeRows(f.db), clientCount = f.db.prepare("SELECT count(*) AS n FROM clients").get()!.n;
    await assert.rejects(lease.writer.write(async (tx) => {
      const created = await clients.cardParticipant.create(tx, { displayName: "Rolled back" });
      await f.repo.creationParticipant.create(tx, created.id, { noteBody: "First thought", tagIds: [tag.id, "missing-tag"] });
    }), /TAG_UNAVAILABLE/u);
    assert.deepEqual(nativeRows(f.db), before); assert.equal(f.db.prepare("SELECT count(*) AS n FROM clients").get()!.n, clientCount);
    const created = await lease.writer.write(async (tx) => {
      const client = await clients.cardParticipant.create(tx, { displayName: "Created together" });
      const note = await f.repo.creationParticipant.create(tx, client.id, { noteBody: "  First thought\n", tagIds: [tag.id] }); return { client, note };
    });
    assert.equal((await f.repo.listNotes(created.client.id))[0]!.body, "  First thought\n"); assert.equal(created.note!.context, null);
    assert.equal((await f.repo.listClientTags(created.client.id))[0]!.id, tag.id);
    assert.deepEqual(await f.repo.listSafetyImportReviews(created.client.id), []); assert.deepEqual(await f.repo.getImportEvidence(created.client.id), []);
  } finally { await f.shared.release(); await clients.close(); }
}));

test("owner parity is re-derived from source when a private receipt and its rows were edited together", () => fixture(async (f) => {
  const stage = new DatabaseSync(f.stagePath), port = nodeSqlitePort(stage);
  try {
    const before = digest(f.stagePath);
    await port.exclusive((tx) => readLegacyNativeWorkData({ ...tx, run: async () => assert.fail("native preparation wrote source stage") }, f.context, importedAt));
    assert.equal(digest(f.stagePath), before);
    const receipt = JSON.parse(stage.prepare("SELECT target_json FROM r04_work_receipt").get()!.target_json as string) as { notes: { id: string; body: string }[] };
    const id = receipt.notes[0]!.id;
    stage.prepare("UPDATE r04_work_notes SET body=? WHERE id=?").run("coherently changed", id);
    stage.prepare("UPDATE r04_work_receipt SET target_json=json_set(target_json,'$.notes[0].body',?)").run("coherently changed");
    await assert.rejects(port.exclusive((tx) => readLegacyNativeWorkData(tx, f.context, importedAt)), /NATIVE_PARITY_MISMATCH/u);
  } finally { stage.close(); }
}));

test("WorkData timeline and per-client evidence use scoped indexes", () => fixture(async (f) => {
  const timeline = f.db.prepare("EXPLAIN QUERY PLAN SELECT * FROM trainer_notes WHERE workspace_id=? AND client_id=? ORDER BY pinned DESC,created_at DESC,id").all(workspaceId, f.a);
  assert.ok(timeline.some((r) => String(r.detail).includes("USING INDEX trainer_notes_timeline")));
  assert.equal(timeline.some((r) => String(r.detail).includes("TEMP B-TREE")), false);
  const evidence = f.db.prepare("EXPLAIN QUERY PLAN SELECT * FROM client_work_import_evidence WHERE workspace_id=? AND client_id=? ORDER BY source_sha256,source_key").all(workspaceId, f.a);
  assert.ok(evidence.some((r) => String(r.detail).includes("SEARCH client_work_import_evidence USING INDEX")));
  assert.equal(evidence.some((r) => String(r.detail).includes("TEMP B-TREE")), false);
}));

test("actual host Worker termination rolls back a partial native seed; restart retains the same imported IDs", () => fixture(async (f) => {
  await f.repo.close(); await f.port.exclusive(async (tx) => { for (const table of [...WORK_DATA_TABLES].reverse()) await tx.run(`DELETE FROM ${table}`); });
  const script = `import{parentPort,workerData as d}from'node:worker_threads';import{DatabaseSync}from'node:sqlite';
    const{nodeSqlitePort}=await import(d.port),{installInitialClientWorkData}=await import(d.writer),db=new DatabaseSync(d.file),port=nodeSqlitePort(db);
    await port.exclusive(tx=>installInitialClientWorkData({...tx,run:async(sql,args)=>{const result=await tx.run(sql,args);
      if(sql.startsWith('INSERT INTO client_work_import_evidence')){parentPort.postMessage('paused');await new Promise(()=>{});}return result;}},d.workspace,d.seed));`;
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(script)}`), { execArgv: ["--experimental-strip-types"], workerData: { file: f.file, workspace: workspaceId, seed: f.seed,
    port: new URL("./support/node-sqlite-port.ts", import.meta.url).href, writer: new URL("../apps/mobile/src/features/clients/data/InitialClientWorkData.ts", import.meta.url).href } });
  try { await new Promise<void>((resolve, reject) => { worker.once("message", () => resolve()); worker.once("error", reject); worker.once("exit", () => reject(Error("NO_PAUSE"))); }); }
  finally { await worker.terminate(); }
  for (const table of WORK_DATA_TABLES) assert.equal(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0);
  await f.port.exclusive((tx) => installInitialClientWorkData(tx, workspaceId, f.seed));
  assert.deepEqual((await f.repo.listNotes(f.a)).map((n) => n.id), f.seed.trainer_notes.filter((n) => n.client_id === f.a).map((n) => n.id));
}));

test("candidate 3.x snapshot restores all WorkData/evidence and a fresh ordinary reader edits it with the importer blocked", () => fixture(async (f) => {
  await f.repo.close(); const snapshot = join(f.dir, "work.atbackup"), restored = join(f.dir, "restored.sqlite"); await backup(f.db, snapshot);
  const copy = new DatabaseSync(snapshot); try { await engine().sealSnapshot(nodeSnapshotSql(copy), { backupId: "99999999-9999-4999-8999-999999999999", createdAt: now }); await engine().validateSnapshot(nodeSnapshotSql(copy)); await backup(copy, restored); } finally { copy.close(); }
  const hash = digest(snapshot), candidate = new DatabaseSync(restored);
  try { await engine().stageSnapshot(nodeSnapshotSql(candidate)); assert.deepEqual(nativeRows(candidate), nativeRows(f.db)); } finally { candidate.close(); }
  const script = `import{parentPort,workerData as d}from'node:worker_threads';import{registerHooks}from'node:module';import{DatabaseSync}from'node:sqlite';
    registerHooks({resolve(s,c,n){const r=n(s,c);if(/legacy-import|shared\\/migration|scripts\\/r04\\//.test(r.url))throw Error('IMPORTER_REMOVED');return r;}});
    let blocked=false;try{await import(d.probe);}catch(e){blocked=e.message==='IMPORTER_REMOVED';}if(!blocked)throw Error('GUARD_INACTIVE');
    const{SqliteClientWorkDataRepository}=await import(d.reader),{SharedSqliteDatabase}=await import(d.shared),{nodeSqlitePort}=await import(d.port),db=new DatabaseSync(d.file);
    const repo=new SqliteClientWorkDataRepository(new SharedSqliteDatabase(async()=>({...nodeSqlitePort(db),close:async()=>{}})),d.workspace,()=>d.now);
    const before=await repo.listNotes(d.client),reviews=await repo.listSafetyImportReviews(d.client),evidence=await repo.getImportEvidence(d.client),tags=await repo.listClientTags(d.client);
    const note=await repo.updateNote(d.client,before[0].id,1,{body:'Edited after restore',pinned:true}),tag=await repo.updateTag(tags[0].id,1,{name:'Renamed after restore',color:null,lifecycle:'ACTIVE'});
    parentPort.postMessage({blocked,before,reviews,evidence,note,tag});await repo.close();db.close();`;
  const result = await new Promise<{ blocked: boolean; before: { id: string; body: string }[]; reviews: unknown[]; evidence: unknown[]; note: { id: string; body: string }; tag: { id: string } }>((resolve, reject) => {
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(script)}`), { execArgv: ["--experimental-strip-types"], workerData: { file: restored, client: f.a, workspace: workspaceId, now,
      probe: new URL("../apps/mobile/src/features/clients/data/legacy-import/LegacyNativeWorkData.ts", import.meta.url).href,
      reader: new URL("../apps/mobile/src/features/clients/data/SqliteClientWorkDataRepository.ts", import.meta.url).href,
      shared: new URL("../apps/mobile/src/shared/db/SharedSqliteDatabase.ts", import.meta.url).href, port: new URL("./support/node-sqlite-port.ts", import.meta.url).href } });
    let result: Parameters<typeof resolve>[0] | undefined; worker.once("message", (v: Parameters<typeof resolve>[0]) => { result = v; }); worker.once("error", reject);
    worker.once("exit", (code) => code || !result ? reject(Error(`WORK_DATA_READER_EXIT_${code}`)) : resolve(result));
  });
  assert.equal(result.blocked, true); assert.equal(result.before[0]!.body, "  First note\nExact body  "); assert.equal(result.note.id, result.before[0]!.id); assert.equal(result.note.body, "Edited after restore");
  assert.equal(result.reviews.length, 2); assert.deepEqual(result.evidence, await f.repo.getImportEvidence(f.a)); assert.equal(digest(snapshot), hash);
}));
