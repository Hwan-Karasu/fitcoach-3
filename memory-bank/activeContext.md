# Active context — 2026-10-23

Ветка `audit/training-fixes`. Продукт — «Дневник атлета». Владелец возобновил
работу («не спим, работаем»); цель переноса 2.0→3.0 и backup/restore ACTIVE.
Не объявлять 100% до фактических проверок. UI/темы — после функциональной работы.

Текущий task R06. Общий mobile `SqliteSnapshotEngine` используется host и Expo:
manifest, frozen snapshot migrations, typed hash, media и staging. WIP `1f47d45`
исправлен: REAL -0 не проходит через printf; INTEGER читается точным TEXT.
Node oracle и original migration checksums сохранены.

Текущие проверки: foundation 946/946, typecheck mobile, lint, arch,
source/secrets/diff и Android production JS bundle. Общий engine `b629fa1`
также прошёл spike typecheck и Android full `.atbackup` с фото: normal 19/19;
actual force-stop после swap до COMMITTED и recovery нового процесса 7/7.
Данные только синтетические. Установленная 2.0.0 (128) не заменялась;
её БД и личные backup-файлы не открывались. Metro и reverse 8096 остановлены.

Следующее: R06 application controller/boot recovery до repositories,
закрытие всех leases/workflow/scheduler, confirmation/reopen/read models;
SAF folder/file/publishing, rotation/Return и native negative/low-storage/
reinstall/full-owner matrix. Default app runtime пока не использует новый driver.
Реальный полный legacy migration engine также ещё не закончен; gates OPEN.
Нельзя считать R04 audits/projections полноценной записью всех owners 3.x.

Photo readiness исправлена: `storeLocalImage` ждёт copy/проверяет размер,
`RecipePhotoSession` блокирует save/remove/повторный picker и ждёт исход DB save
до cleanup при unmount. Семь регрессий проверяют async lifecycle/path guard;
ручной picker E2E не выполнялся. В backup/restore adapters await также есть.

После завершения backup/restore владелец запросил Excel import как в 2.0 и
workout export в Excel. Сначала исследовать GitHub solutions/libraries,
затем 2.0 как образец. Исследование/реализация ещё не начаты.

Подробно: `docs/HANDOFF_BACKUP_MIGRATION.md`, `docs/PROJECT_STATUS.md`,
`docs/spikes/R06_PORTABLE_SNAPSHOT.md`, `docs/EXCEL_IMPORT_EXPORT_PLAN.md`.
Прежняя память сохранена в `archive/activeContext-before-backup-2026-10-23.md`;
это исторические сведения, текущий статус берётся из этой записи и handoff.
