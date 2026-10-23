# Active context — 2026-10-23

«Дневник атлета», audit/training-fixes. Goal ACTIVE: full2.0→3.0 + backup/restore,
не100%. Task R06→R03, D05→D01/R06, D03→R04/R05. Product §46, §§53–56.
Migration/overlay/signing/release gates OPEN; production DDL/real migration/overlay
не начинать до соответствующих gates. Excel послеbackup: GitHub first,2.0read-only.
UI/темы позже. Targeted tests области+зависимостей; fullsuite milestones (владелец).
Владелец спросил о необходимости проверок; пояснены data safety/retry и optional
provider matrix; ответил «да нет, продолжай» — работу не останавливать.

Основа: D01 baselines/identity/FK/JSON/common full snapshot/hash/media/staging;
GuardedRestore/v2 one-use Return/completion receipts, runtime15holders+workflow и
command drain/closed recovery before DB open. Connected RestoreActions/ExpoJobs/
Return/delete/UI, WAL logical pin/capacity/generation/GC. Earlier native restore35/
rollback12/commitgap13, actions24/focused3; Downloads20/SAF19/reinstall6. All-owner
populated histories и legacy mapping в runtime ещё НЕ доказаны.

AutoService/Scheduler/AppState/UI:30мин foreground/resume, wholecommand admission,
ordinary writes continue, stable online copy hashed before embedded media, unchanged
no duplicates. Atomic pending→native receipt→managed entries≤3/retired→delete.
Actual success day/offset + freshness sequence. Daily fallback older distinct days
technical candidate, not APPROVED; clock backward/offset pauses, safe re-anchor OPEN.
New destination archives prior catalog/pending without deleting/transferring files.
Durable failure/status/global banner. Exact native URI/hash/bytes/name/owner/grant,
manual/foreign ineligible; receipt replay without source, tombstones.

6091dcb: native capability2 inspect VALID/MISSING/UNAVAILABLE/INVALID, only proven
absence changes metadata. FileNotFound alone insufficient; stale owned Downloads
path stat ENOENT/ENOTDIR vs EACCES/EIO. Catalog/receiptfilev1 retained. Whole catalog
inspected before repair; healthy retired predecessor promoted and all retained files
rechecked before destructive cleanup. Allmissing→freshfullcopy without business
change, same destination. Host52/52(auto21/scheduler4/manual12/restore15), Android
missing19/19(47471ms) isolated UUID folder deleted/recreated, realdefault untouched.
This Android unlink deletes MediaStore row too; stale-row/stat branch not exercised.
Prior auto21/status3 remain separate reports; last old fullfoundation1086.

NEW based6091dcb: actual automatic force-stop boundaries. Native debug-only latch
inside publisher AFTER synced/renamed receipt BEFORE IS_PENDING0; strict private
UUID marker/control, production folder never arms. Independent pending/receipt
read before stop; PID32506 absent→1641; freshprocess seespendingvisibility1 and
replays same ID/URI, no prepare. Recovery15/15 за8362ms. Then readback committed
catalog/retired BEFORE cleanup; PID1641 absent→3837. Freshprocess no prepare/pub,
samecurrentURI and safe retirement, recovery14/14 за7694ms. Explicit unchangedretry
no duplicate, private source/orphan GC. Snapshot2 then4clients (incl prior latewrite);
final LIVE5 tracked clients. All15holders initialized, only clientwrites/read checked.
Fixture COMPLETE/no pending retired/no armed pause, no process awaiting kill.
Report docs/spikes/R06_AUTOMATIC_INTERRUPTION_ANDROID_REPORT.json; raw .cache/
r06-auto-kill-{receipt,catalog}-{arm,report}.json. DebugAPK code1/version0.0.1 only
com.fitcoach.r07sqlite updated, legacycom.fitcoach.app2.0build128 unchanged. SHA
 e30725f0e2d70c15f1aec0a43778c40b26facc7655eb750ba4783d5721986bfc.
Hostauto21 fresh, root/mobile/spike TS, changedlint/arch505/source/secrets/diff,
Kotlin/arm64 build. Mainbundle/fullfoundation NOT rerun; new TS only debugprobe via
Metro. Historicalmainbundle5622/1185. New native moduleversion remains2.

NEXT PRIMARY: full legacy mapping/staging/stable IDs/provenance/parity/retry.
Actual ExpoRestoreJobs only3.0 engine, no legacy branch. scripts/r04 partial source
readers/projections/identity ledger teststage (clients only) notfullconverter. Must
connect fulladapter, not merely reject2.0 or preserve rawblob. LOAD_REPS for2.0
(20×10кг), equipment/groups unknown notguessed. Read R04/task deps/source refs
before next code. Remain OPEN: clock/timezone re-anchor, copy/delete/tombstone death,
SAF rename→receipt gap/ENOSPC/providers, ordinaryUI/AppState/OS signals/first-run.

Личные DB/backup/secrets не читать/коммитить; patternkey не вводить/сохранять.
Dev64tables1150rows/oldfiles сохранены. NativeMetro8097 handle99958 confirmedlive;
reverse8081→8097. TestPID3837 terminal; scrcpy оставить. MainMetro8096handle16439
старый/unverified. Timeout не повод restart. Handoff docs/HANDOFF_BACKUP_MIGRATION.md.
Commit R06 безpush.
