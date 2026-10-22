# Точка остановки — 22 октября 2026

Работа приостановлена по просьбе владельца: «фиксируй на чем остановились, спать».
Полная цель переноса 2.0→3.0 и backup/restore не завершена; 100% не заявлено.
UI и темы остаются на последующую шлифовку. Продукт называется «Дневник атлета».

## Зафиксированный код

Ветка `audit/training-fixes`, последний implementation commit `be5f8f7`.

- `9d5bc34`: GuardedRestore, независимая SAFETY, сохранённый guard, host process-kill/recovery.
- `1e7d97a`: самостоятельный SQLite `.atbackup`, manifest, checksum, отдельный restore staging.
- `7a30313`: shared DB quiescence, ожидание readers/writers/native close перед заменой.
- `2539f29`: фото рецептов внутри SQLite блоками до 256 КиБ, восстановление байтов и URI с parity.
- `be5f8f7`: ExpoRestoreStorage, streaming SHA-256, нативные проверки на телефоне.

Последние завершённые проверки: foundation **934/934**, mobile и SQLite spike
typecheck, lint, arch:check, source:verify, secrets:check, diff --check,
Android production JS bundle. После них implementation не менялся.

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
compatibility. На остановке этот перенос **ещё не начат**, новых исходников
для него нет. Node и Expo должны использовать одинаковые правила manifest,
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
