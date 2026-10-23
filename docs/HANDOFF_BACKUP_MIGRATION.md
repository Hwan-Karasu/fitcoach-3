# Точка остановки — 23 октября 2026

Работа приостановлена по просьбе владельца: «фиксируй на чем остановились, спать».
Полная цель переноса 2.0→3.0 и backup/restore не завершена; 100% не заявлено.
UI и темы остаются на последующую шлифовку. Продукт называется «Дневник атлета».

## Зафиксированный код

Ветка `audit/training-fixes`. Последний полностью проверенный implementation commit — `be5f8f7`;
следующий checkpoint сохраняет незавершённый portable snapshot отдельно, без подключения к приложению.

- `9d5bc34`: GuardedRestore, независимая SAFETY, сохранённый guard, host process-kill/recovery.
- `1e7d97a`: самостоятельный SQLite `.atbackup`, manifest, checksum, отдельный restore staging.
- `7a30313`: shared DB quiescence, ожидание readers/writers/native close перед заменой.
- `2539f29`: фото рецептов внутри SQLite блоками до 256 КиБ, восстановление байтов и URI с parity.
- `be5f8f7`: ExpoRestoreStorage, streaming SHA-256, нативные проверки на телефоне.

Последние завершённые проверки для `be5f8f7`: foundation **934/934**, mobile и SQLite spike
typecheck, lint, arch:check, source:verify, secrets:check, diff --check,
Android production JS bundle. Эти результаты не распространяются на новый незавершённый модуль.

## Незавершённый этап R06, сохранённый 23 октября

Начат перенос формата в общий код приложения: `SnapshotManifest.ts`, `SnapshotCatalog.ts`,
`SnapshotPhotoRules.ts`, `SnapshotSqlPort.ts`, `SnapshotContentHash.ts`; добавлены host adapter
`scripts/r06/NodeSnapshotSql.ts` и `scripts/r06-portable-snapshot.test.ts`.
Существующие host backup/restore и default runtime их пока не используют.
Входы: текущий D01 catalog и host snapshot format; Product §46.3/46.20;
R06, D05 и migration gates остаются OPEN. Рабочая схема и пользовательские данные не менялись.

На остановке `npm run typecheck`, `npm run arch:check` (456 source files),
`npm run lint`, `npm run secrets:check` и `git diff --check` прошли.
Новый отдельный тест: **1 passed / 1 failed**, повторено перед паузой. Catalog checksums совпали;
portable content hash расходится с независимым Node oracle на SQLite fixture с int64,
крайними REAL, TEXT/BLOB/NULL и дубликатами. Тест ещё не добавлен в r06:test/foundation.
Новый полный foundation и Android bundle после этого переноса не запускались.

Воспроизведение из корня репозитория:

```powershell
.\node_modules\.bin\node.cmd --experimental-strip-types --test-isolation=none --test scripts/r06-portable-snapshot.test.ts
```

Actual digest: `d37df3b78e94f604bc0b4ea1ddd4aa7b3392a7028282f58d5e3f104c19c6b7d7`;
oracle: `adda84d1ba96c774abb99d0351bce08228c4e24f4722026f35534b8967a11560`.
Первое действие после возобновления: локализовать расхождение, отдельно сравнив типы и биты REAL.
В новом коде REAL проходит через SQLite `printf('%!.26g')` и Number; проверить возможность
передавать REAL исходным JS number, оставив CAST AS TEXT только для INTEGER. Это гипотеза,
причина ещё не доказана. Не ослаблять fixture и не заменять независимый oracle.

Замороженные snapshot migration checksums:

- v1: `10a8e7f4fc13630bc00babb545f4ea63180f279ec409115ab08dd431ea68933d`.
- v2: `48661e54e04ce637d4fdb467e23b4a6db7904cffb0c2e43cc0fd1bde540d0195`.

Сохранить их независимыми golden assertions перед заменой старого host catalog.

Телефон: Android API 36, Expo Go 57.0.9. Только свежие синтетические private
базы отдельного стенда: normal **9/9**; настоящий force-stop после смены файла
до COMMITTED и recovery в новом процессе **7/7**. Восстановлены точные старые
байты, SAFETY и прежний клиент; повтор не затирает последующие записи.
Источник: [R06_NATIVE_REPORT.json](spikes/R06_NATIVE_REPORT.json).
Metro стенда остановлен, его ADB reverse tcp:8096 снят после проверки.

Установленная 2.0.0 (128) не заменялась, её БД не открывалась.
Реальная миграция/overlay/signing gates остаются открытыми.

## Следующее действие

Продолжить **R06**: вынести host-format из `scripts/r06/SqliteBackup.ts` и
`SqliteBackupMedia.ts` в общий mobile engine, сохранив format/checksum/backward
compatibility. Перенос начат, но ещё не завершён; сначала устранить описанный выше failing test.
Node и Expo должны использовать одинаковые правила manifest,
всех строк/типов, media coverage, проверки блоков и допустимого переноса URI.

Нужны portable SQL/file ports и Expo adapter для создания/проверки/подготовки
полного `.atbackup`, включая фото. Особенность: Expo не имеет open-readonly,
поэтому внешний файл сначала копируется в private staging. int64 нельзя
терять через JS number; при переносе checksum нужно доказать равенство с
нынешним Node oracle на реальных SQLite-значениях. Перед изменением catalog
сохранить checksum уже существующих snapshot migrations 1/2.

Затем проверить полный файл на Android, подключить boot recovery/остановку
repositories и workflow lease/scheduler, подтверждение замены и read models;
SAF/публикация, ротация и пользовательская Return point ещё не реализованы.
Native file copy должен обязательно ожидаться: на устройстве выявлено, что
текущий Expo File.copy возвращает Promise; в ExpoRestoreStorage это исправлено.
В `shared/media/LocalImageStore.ts` ещё есть старый вызов copy без await —
проверить готовность фото перед сохранением URI и выходом из редактора.

## Общая цель по-прежнему шире R06

R04 содержит сопоставления/аудиты старых данных и изолированную rehearsal-запись
карточек со стабильными IDs и исходным profile_json. Это **не** полноценная
запись всех данных 2.0 в рабочую схему 3.x. Нужно закончить смысловое
сопоставление и staging всех owners/историй без дублей, parity, retry/kill/
low-storage, затем реальный upgrade/restore и Android release gates.

Упражнения 2.0 трактуются по решению владельца как повторы + рабочий вес:
20×10кг = 20 повторов, 10 кг; отсутствующие оборудование/группы мышц не угадывать.
Анкеты, Calendar, Workout и Ledger сохраняют независимую семантику.

Авторитетны AGENTS.md и пакет `FitCoach_3_DOCUMENTS_SYNCED_2026-10-14`, особенно
Product §§46, 52–56. Не отмечать R06/D05/D03 готовыми по узкому стенду.
Не открывать/копировать личные `.atbackup`, JKS/PEM/keystore в родительской
папке; не запускать production overlay или реальную миграцию до gates.
