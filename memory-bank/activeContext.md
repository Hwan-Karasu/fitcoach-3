# Active context — 2026-10-23

«Дневник атлета», audit/training-fixes. Goal ACTIVE: полный перенос 2.0→3.0 и
backup/restore ещё не завершён, не100%. Task R06→R03, D05→D01/R06, D03→R04/R05.
Product §46, §§53–56. Migration/overlay/signing/release gates OPEN. UI/темы позже.
Excel послеbackup: сначала GitHub библиотеки, затем2.0read-only reference.
Владелец просит targeted tests по области/зависимостям, fullsuite на milestones.
Не запускать весь foundation после каждой мелкой правки.

База текущего среза3fcd092. Уже есть D01 baselines/identity/FK/JSON/common full
snapshot/hash/media/staging; GuardedRestore/v2 one-use Return/completion receipts,
15 runtime holders+workflow/command drain/closed recovery before DB open.
RestoreActions/ExpoRestoreJobs/Return/delete UI, logical WAL pin/capacity/generation
remount/GC/private job lifecycle. Native prior restore35/rollback12/commitgap13,
actions24/focused3, Downloads20/SAF19/reinstall6. Legacy mapping всех доменов в
production staging ещё НЕ подключён; не выдавать backup инфраструктуру за перенос.

AutoService/Scheduler/AppState/production UI подключены: 30мин foreground/resume,
whole-command admission на весь job; обычные writes продолжаются. Stable private
online copy hashed до media embedding; unchanged не создаёт дубликат.
Atomic automatic.json pending→native receipt→managed set/retired→delete; entries≤3.
Daily actual local success date+offset, freshness sequence. Same-day replaces today,
предыдущие2дня; fallback старых разных дней технический кандидат, не APPROVED.
Clock backward/offset change безопасно останавливает ротацию, safe re-anchor для
поездки/DST ещё OPEN. Смена destination архивирует старые catalog/pending без
удаления/объявления переноса. Durable failure status после recreation, verifiedretry
снимает; global failure плашка. Native exact URI/hash/bytes/name/owner/SAF grant,
manual/foreign ineligible, tombstone/replay без source. SAF rename→receipt gap OPEN.

Текущий срез: native automaticProtocolVersion2, inspect VALID/MISSING/UNAVAILABLE/
INVALID. Только proven absence собственного receipt при доступном носителе/корне
provider даёт MISSING и tombstone. FileNotFound не доказательство: точный owned
MediaStore DATA path stat требует ENOENT/ENOTDIR, EACCES/EIO unavailable. Catalog и
receipt file formats остаютсяv1. Service проверяет entries+retired целиком до repair,
удаляет только missing metadata, promotes healthy retired predecessor; не чистит
историю до новой успешной копии. Перед каждым cleanup заново проверяет retained.
All missing→new full snapshot даже без business change, destination тот же.

Native19/19 за47471ms, fresh synthetic injected2001: 3versions/unknown receipt/
wronghash/missing history/latest/all; failed preparation сохраняет predecessor;
пустой UUID test directory реально удалён nonrecursive и recreated samePublisher;
все3clients в итоговом snapshot. Настоящий Download/Дневник атлета НЕ удалялся.
Debug-only fixture требует private marker/strict UUID/exact receipt/hash/owner/path.
Первый тест остановился: fixture ожидала stale row, но Android при unlink удаляет
и row. Исправлена fixture, итоговый ROW_ABSENT отражён в отчёте. Stale-row/stat ветка
отдельно НЕ доказана. Report docs/spikes/R06_AUTOMATIC_MISSING_ANDROID_REPORT.json.
Host52/52: auto21/scheduler4/manual12/restore15. Fullfoundation не запускался
(последний старый integration1086). Root/mobile/spike TS; changed lint; arch504/
source/secrets/diff; main Android bundle5622modules/1185assets. Kotlin compile и
arm64 debug APK success, install-r только com.fitcoach.r07sqlite0.0.1code1 SUCCESS;
legacy com.fitcoach.app2.0build128 цела. APK SHA
6b5c8915b388b5d17fcc2bcca42bf1db582b0cb170415b321a99395aa07f5fb0.
Prior native auto21/status3 остаются отдельными прежними отчётами.

NEXT: safe clock/timezone re-anchor и fallback tech acceptance, actual automatic
process-death/catalog/delete/SAF rename-gap/ENOSPC/providers/full histories; enabled
ordinary UI/AppState/native OS signals, first-run Restore choice. Затем full legacy
mapping/staging/stable IDs/provenance/parity/retry; LOAD_REPS для2.0(20×10кг), unknown
equipment/groups не угадывать. Не сводить общую цель к одним автокопиям.

Личные DB/backup/секреты не читать/коммитить; графический ключ не вводить/сохранять.
Dev64tables1150rows/oldfiles сохранены. NativeMetro8097 handle99958 confirmed live;
reverse8081→8097. Latest test PID30121, missing probe terminal, no pending kill.
Scrcpy оставить. MainMetro8096handle16439 старый/unverified. Не рестартовать из-за
observation timeout. Подробно docs/HANDOFF_BACKUP_MIGRATION.md. Commit R06 без push.
