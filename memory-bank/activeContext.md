# Active context — 2026-10-23

«Дневник атлета», branch audit/training-fixes. Goal ACTIVE: полный перенос 2.0→3.0
и backup/restore ещё не завершён. Не 100%. Task R06→R03, D05→D01/R06,
D03→R04/R05. Product §46, §§53–56. Migration/overlay/signing/release gates OPEN.
UI/темы позже. Excel после backup/restore: GitHub библиотеки, затем 2.0 read-only.

Владелец просит целевые tests по изменённой области и зависимостям; full foundation
только на крупных контрольных этапах. Не гонять весь набор после мелких изменений.

База нового среза fafe3e5: connected Restore/Return/delete UI, ExpoRestoreJobs,
logical WAL pin/capacity, native actions24 + focused recovery3; OS rest reconcile.
D01/common snapshot media/GuardedRestore/v2 Return point/15 holders+workflow готовы
в пределах прежних отчётов. Legacy mapping/staging всех данных ещё НЕ подключён.

Новый срез: AutomaticBackupService + AutomaticBackupScheduler/AppState host,
production composition и UI automatic/manual/status/общая failure плашка.
Первая проверка задаёт 30мин; foreground/resume проверяет persisted checkedAt.
Неизменённый logical hash стабильной private online copy не создаёт новый snapshot.
Whole-command gate ждёт весь job; обычные writes продолжаются. Foreground timer
ограничен 30мин даже при backward clock, фон не обещает периодической записи.

Atomic automatic.json вне SQLite: pending до native publication, затем entries≤3
и retired queue до удаления старых. Native receipt replay выдаёт тот же URI,
даже без private source. Same-day replacement, предыдущие два дня; fallback на
реальные старые разные дни (технический кандидат, не APPROVED). UTC+offset/day
actual success, sequence для freshness. Clock backwards/offset change: безопасная
пауза, re-anchor при постоянной поездке/DST ещё не сделан.
Смена папки atomically архивирует старый catalog/pending metadata, старые файлы
не трогает/не объявляет перенесёнными. Archived pending IDs защищают private jobs.
Failure status отдельный atomic файл, сохраняется после recreation; verified retry
снимает. AUTO_NOT_READY не сохраняется как неисправность.

Kotlin AutomaticPublications + native automaticProtocolVersion1/publish/verify/remove.
Отдельный auto filename prefix. Installation-private exact URI/hash/bytes/tree
receipt, MediaStore owner package/persisted SAF grant, removed tombstones.
Нет внешнего scanning/удаления manual/foreign URI. Expo SDK generic MediaStore
delete не поддерживает, поэтому нужна native операция. Downloads receipt до
IS_PENDING0; SAF rename→receipt gap ещё OPEN. Прежний manual API сохранён.

Новый arm64 debug APK com.fitcoach.r07sqlite0.0.1 собран и обновлён install-r SUCCESS,
без key prompt; legacy com.fitcoach.app build128/version2.0.0 не затронута.
APK SHA a3134c9d079b7109e082d913bdcab81919365fb3640fc217c42382e54c86bcfb.
Native automatic21/21 (71393ms, календарь injected2000, не реальное ожидание дней):
online consistent snapshot/late write, same-day/unchanged/3days, exact native
ownership negatives, receipt without source/tombstone, manual export untouched,
все5 клиентов и точный PNG после удаления оригинала,15 holders usable.
После status change focused3/3 за448ms на прежней fixture, без новых публикаций.
Reports R06_AUTOMATIC_ANDROID_REPORT.json; контракт R06_AUTOMATIC_BACKUP.md.

Host: automatic15/15, scheduler4/4, manual12/12, restore15/15.
45/45 в одном targeted run до final clock case; final scheduler4/4 отдельно.
Full foundation НЕ запускался (последний старый integration1086).
Root/mobile/spike TS, lint/arch503/source/secrets/diff; bundle5622/1185.
Новый срез зафиксировать R06 commit, без push.

СЛЕДУЮЩЕЕ: отсутствующий старый файл сейчас даёт verification failure и блокирует
возобновление в удалённой штатной папке. Нужен native inspect VALID/MISSING/
UNAVAILABLE с ownership: только доказанно missing исключать из current catalog,
сохранять остальные версии; если нет пригодной свежей копии, создать новую даже
без business change. Permission/provider failure сохраняет прежний набор и паузу.
Затем clock re-anchor/fallback technical acceptance; real kill/catalog/SAF/ENOSPC/
providers, ordinary enabled UI/AppState E2E, native OS signals, first-run choice.
Full legacy mapping/staging/stable IDs/provenance/parity/retry остаётся OPEN.
LOAD_REPS для2.0(20×10кг), unknown equipment/groups не угадывать.

Личные DB/backup/секреты не читать/коммитить, графический ключ не вводить/сохранять.
Dev64tables1150rows/oldfiles сохранены. NativeMetro8097 handle99958 WATCH жив,
reverse8081→8097. Старый PID9181 после APKupdate не использовать; проверять pid.
Последний auto STATUS report terminal, pending kill probe нет. Scrcpy оставить.
MainMetro8096 handle16439 старый, проверить перед использованием. Не рестартовать
процессы из-за timeout. Подробно docs/HANDOFF_BACKUP_MIGRATION.md.
