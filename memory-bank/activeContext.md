# Active context — 2026-10-23

Ветка `audit/training-fixes`. Продукт — «Дневник атлета». Владелец возобновил
работу («не спим, работаем»); цель переноса 2.0→3.0 и backup/restore ACTIVE.
Не объявлять 100% до фактических проверок. UI/темы — после функциональной работы.

Текущий task R06. Общий mobile `SqliteSnapshotEngine` используется host и Expo:
manifest, frozen snapshot migrations, typed hash, media и staging. WIP `1f47d45`
исправлен: REAL -0 не проходит через printf; INTEGER читается точным TEXT.
Node oracle и original migration checksums сохранены.

Текущий WIP: local Expo Android `athlete-backup-storage` (MediaStore default + SAF
publication), NativeBackupPublisher и receipt binding. Autolinking app/spike видит
module; controller/UI пока не подключены. Foundation 984/984, mobile/spike
typecheck/lint/arch (473 sources)/source/secrets/diff. Native compile не дошла до
Kotlin: cached foojay plugin отсутствует, Java Maven даёт Permission denied;
PowerShell HEAD plugin POM 200. Агентский HTTPS_PROXY — заглушка, не решение.
TLS/framework проверки не ослаблялись. Нужны доступная native toolchain и APK proof.
Подробно `docs/spikes/R06_ANDROID_PUBLICATION.md`. Android JS bundle WIP собран:
5583 modules/1185 assets; это не Kotlin compile/APK.
R06 runtime lifecycle: gate целых команд, единая инвентаризация 15 owners,
освобождаемый workflow lease, close/reopen/cache reset; production boot читает
private journal до открытия DB. Receipt сохраняет последующие записи/WAL;
missing LIVE/invalid journal блокируют boot без создания пустой базы.
Расширенный Android rehearsal с теми же 15 owners/workflow/maintenance/journal
reader: normal 25/25, deliberate force-stop до COMMITTED и новый boot/recovery
11/11. Это не обычный UI E2E, не полная заполненная owner matrix и не OS scheduler.
Отчёт `docs/spikes/R06_RUNTIME_ANDROID_REPORT.json`. Общий engine `b629fa1`
также прошёл spike typecheck и Android full `.atbackup` с фото: normal 19/19;
actual force-stop после swap до COMMITTED и recovery нового процесса 7/7.
Данные только синтетические. Установленная 2.0.0 (128) не заменялась;
её БД и личные backup-файлы не открывались. Metro и reverse 8096 остановлены.

Следующее: R06 application controller/confirmation
и job/journal writer; SAF folder/file/publishing, autoscheduler/rotation/Return,
reconcile OS rest-timer signals и native negative/low-storage/reinstall/full-owner.
Обычный app пока не предоставляет пользователю backup/restore.
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
`docs/spikes/R06_RUNTIME_LIFECYCLE.md`, `docs/EXCEL_IMPORT_EXPORT_PLAN.md`.
Вопрос владельца о падении относился к описанию намеренного force-stop теста;
самопроизвольного падения в нём не было. Формулировать это явно.
Владелец разблокировал телефон сам, попросил работать дальше. Scrcpy «Phone screen»
оставлен открытым. Ключ/рисунок не сохранять в проект и не повторять попытки.
Прежняя память сохранена в `archive/activeContext-before-backup-2026-10-23.md`;
это исторические сведения, текущий статус берётся из этой записи и handoff.
