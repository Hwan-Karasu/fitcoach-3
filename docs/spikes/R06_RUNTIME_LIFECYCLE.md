# R06 — runtime maintenance и recovery до открытия базы

Дата: 2026-10-23. Статус R06/D05 остаётся OPEN.

Входы: существующий GuardedRestore, общий snapshot engine, D01 production
identity/preflight и SharedSqliteDatabase. Зависимости D05: D01/R06; реальная
миграция D03 зависит от R04/R05. Product refs: §46 (один файл, полная замена,
SAFETY/Return, устойчивость прерывания), §§52–56; порядок источников — AGENTS.md.
Срез не разрешает реальную миграцию, overlay APK или release.

## Что подключено

- `createLocalRepositories` — единая инвентаризация 15 repository holders.
  Её использует обычный runtime и файловый integration test. Workflow получает
  отдельный освобождаемый lease; неудачный acquire не кешируется навсегда.
- `RuntimeCommandGate` отслеживает целиком публичные async-команды, включая
  ожидания между SQL-запросами. Maintenance запрещает новые команды, дожидается
  принятых команд и сигналов таймеров, закрывает owners/workflow и shared DB.
  File operation выполняется только после физического close.
- После успешной операции runtime заново инициализирует repositories, очищает
  кеши exercise lookup/training history, затем допускает команды. Обычные экраны
  и их фоновые подписки размонтируются на время maintenance и открываются заново.
  Ошибка оставляет команды закрытыми до recovery; пути и исходные исключения
  не показываются пользователю.
- BootCoordinator вызывает recovery до prepareWorkspace/openDatabase. Холодное
  восстановление не создаёт repositories: штатный boot выполняет инициализацию
  после восстановления. Development DB имеет отдельный workspace/schema gate;
  production journal не привязывается к ней.

## Private journal и завершённые операции

Production reader ищет только фиксированный private `runtime-restore/production/
pending.json`. Отсутствие файла не создаёт каталогов и не открывает SQLite.
Допустимы только version, UUID v4 operationId и два SHA-256; пути из JSON не
принимаются. Job directory выводится из проверенного UUID. Будущий controller
должен записывать journal после явного подтверждения полной замены.

До PREPARED журнал допускает только точный исходный LIVE с подтверждённой
identity и без признаков начавшейся замены. Такая прерванная попытка получает
ROLLED_BACK receipt, чтобы последующие обычные записи не блокировали новый boot.
Существующий JSON null в journal/guard — повреждение, а не отсутствие файла.

COMPLETED/ROLLED_BACK receipts не сравнивают LIVE с прежним hash: база могла
получить новые законные записи. Требуется существующий непустой принадлежащий
приложению SQLite header; полную identity/integrity проверяет обычный preflight.
Receipt replay не выполняет файловую замену и допускает WAL от последующей
рабочей сессии. Sidecars проверяются перед первым физическим доступом к слотам
в незавершённой операции, а не до чтения receipt. WAL обрабатывает обычный SQLite
boot, он не удаляется вручную.

## Проверки и границы

- Foundation **973/973**. Новые сценарии: реальная инвентаризация owners + workflow
  close/replace/reopen, whole-command drain, запрет новых команд, ошибки file/reopen,
  cache invalidation, boot ordering, malformed journals, missing LIVE, guard mismatch.
- Host child process действительно завершён SIGKILL после COMPLETED и последующей
  записи в WAL. Receipt recovery сохраняет main/WAL bytes; нормальное открытие
  SQLite читает последнюю запись. Принудительное завершение — намеренное действие
  теста; самопроизвольного падения приложения в этом сценарии не наблюдалось.
- Typecheck, lint, arch:check (471 source files), source:verify (73 entries),
  secrets:check, diff --check; Android production JS bundle: 5582 modules,
  1185 assets. Это сборка JS, не release APK.
- Android API 36 / Expo Go 57.0.9: расширенный стенд использует ту же
  `createLocalRepositories` инвентаризацию всех 15 owners, настоящий workflow lease,
  RuntimeMaintenance и общий production journal/header reader в отдельном private
  namespace. Normal **25/25**: holders закрыты до файлов, reopen/cache invalidation,
  full-format фото и поздние записи после completed journal replay.
- После наблюдаемого checkpoint INCOMING→LIVE до COMMITTED тестовый Expo Go процесс
  намеренно force-stopped; отсутствие процесса подтверждено. Новый процесс прошёл
  **11/11**: BootCoordinator вызвал journal recovery до workspace/runtime open,
  точные исходные bytes/SAFETY сохранены, все owners открылись после recovery,
  workflow снова пишет, повтор не откатывает новые записи.
  [Фактический отчёт](R06_RUNTIME_ANDROID_REPORT.json). Время normal включает Dozing
  телефона; это не performance SLA. Metro и reverse 8096 после проверки остановлены.
- Это isolated native rehearsal, не E2E экранов обычного приложения и не полная
  заполненная owner matrix: все owners инициализированы, но каждый доменный тип
  истории не заполнялся. OS scheduler/rest signals, фактическое default-directory
  размещение production DB, native WAL после поздней записи и повторного kill,
  SAF/reinstall/low-storage пока этим отчётом не подтверждены. Прежние native
  отчёты 19/19 + 7/7 остаются отдельными историческими доказательствами.

`spikes/sqlite/tsconfig.check.json` выбирает одну копию React/RN types для общего
app source, как Metro выбирает один runtime. Этот mapping используется только
typecheck-командой; обычный tsconfig не направляет Metro в declaration files.

Ещё нужны пользовательский controller/confirmation, запись job/journal, SAF
выбор/публикация/права, scheduler/rotation и Return point; согласование оставшихся
OS-сигналов таймеров после замены без автоматического запроса разрешений;
native negative/low-storage/reinstall/full-owner matrix. Реальный полный перенос
2.0 и последующий Excel import/export не завершены. Установленная 2.0 и личные
backup-файлы не открывались и не изменялись.
