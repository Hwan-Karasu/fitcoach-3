# Точка продолжения — 23 октября 2026

Работа возобновлена по просьбе владельца: «не спим, работаем». Цель ACTIVE.
Полный перенос 2.0→3.0 и backup/restore не завершён; 100% не заявлено.
UI и темы остаются на последующую шлифовку. Продукт — «Дневник атлета».

## Последний завершённый срез R06 — runtime lifecycle и boot recovery

`RuntimeCommandGate` дожидается целых публичных async-команд; общая инвентаризация
15 owners и workflow lease освобождаются до физического close. После замены
reopen очищает кеши и заново открывает экраны. Production boot выполняет private
journal recovery до workspace/DB, development file остаётся отдельным.
Completed receipt допускает последующие записи/WAL; отсутствующий LIVE или
повреждённый journal не подменяется пустой базой. Подробно:
[R06_RUNTIME_LIFECYCLE.md](spikes/R06_RUNTIME_LIFECYCLE.md).

Текущие проверки: **973/973** foundation, typecheck/lint/arch/source/secrets/diff,
Android production JS bundle **5582 modules/1185 assets**. Native rehearsal с той
же инвентаризацией 15 owners + workflow, RuntimeMaintenance и production journal
reader в отдельном namespace: normal **25/25**, deliberate force-stop до COMMITTED
и recovery нового процесса через BootCoordinator **11/11**. Все holders закрыты
до файлов; точные прежние bytes/SAFETY и поздние записи после replay сохранены.
[Фактический отчёт](spikes/R06_RUNTIME_ANDROID_REPORT.json). Это не обычный UI E2E,
не заполненная история каждого owner и не проверка OS scheduler/SAF/low-storage.
Намеренное завершение тестовых процессов не является обнаруженным падением.

## Предыдущий срез — общий snapshot engine

Ветка `audit/training-fixes`. Общий engine: `b629fa1`; ранее `be5f8f7` (native guarded restore),
`1f47d45` (WIP checkpoint). WIP-ошибка checksum исправлена: SQLite printf терял
знак REAL -0; теперь REAL читается исходным double, INTEGER — точным TEXT.
Старый Node hash остался независимым oracle. Checksum snapshot migrations 1/2
закреплены golden assertions, SQL миграций не менялся.

`SqliteSnapshotEngine` в mobile общий для Node и Expo: manifest, content hash
всех строк/типов, media chunks/coverage/digest и staging/photoUri parity.
Host больше не содержит отдельного второго media алгоритма. Добавлены
`ExpoSnapshotSql`, `ExpoSnapshotMedia`, `ExpoSqliteBackup`: внешний файл сначала
копируется в новый private slot; SQLite backup API создаёт согласованную копию.
Mutable рабочая БД не передаётся в seal/stage и не получает snapshot metadata.
Исходный metadata-only snapshot остаётся читаемым, D01 рабочая схема не менялась.

Проверки общего engine: foundation **939/939**, mobile и spike typecheck,
lint, arch:check, source:verify, secrets:check и diff --check; development
bundle SQLite spike запущен на устройстве. После исправления photo readiness:
foundation **946/946**, mobile typecheck, lint, arch:check (465 source files),
source/secrets/diff и Android production JS bundle (5561 modules/1185 assets).
Это сборка JS, не release APK и не ручной E2E редактора с picker.

Телефон: Android API 36, Expo Go 57.0.9. Новый полный формат на синтетических
private данных: **19/19**, включая Node scalar oracle, embedded photo >512 КиБ,
потерю исходного фото, точные байты после restore, Android image decoder,
архив/revision/JSON и guarded replacement/replay без merge. Настоящий force-stop
после physical swap до COMMITTED: отсутствие процесса подтверждено; новый процесс
recovery **7/7**, точные прежние bytes/client/SAFETY и idempotent replay.
Время normal run включает dozing телефона, не является performance SLA.

Доказательства: [R06_PORTABLE_SNAPSHOT.md](spikes/R06_PORTABLE_SNAPSHOT.md),
[R06_FULL_SNAPSHOT_REPORT.json](spikes/R06_FULL_SNAPSHOT_REPORT.json).
Metro стенда остановлен; ADB reverse tcp:8096 снят после проверки.
Установленная 2.0.0 (128) не заменялась; её БД и личные backup-файлы не открывались.

## Следующее действие

Продолжить **R06**: application controller с явным подтверждением полной замены и atomic private job/journal
writer. Runtime использует ExpoRestoreStorage для cold recovery, но пользователь
пока не может запустить backup/restore из обычного приложения. Нужны SAF/Downloads
выбор/публикация/права, changed-data autoscheduler, rotation, Return point,
negative/low-storage/reinstall/full-owner native matrix. После замены также
согласовать старые/восстановленные OS-сигналы таймеров без запроса разрешений
при обычном boot. R06/D05 OPEN. Metro/reverse 8096 остановлены; по просьбе
владельца оставлено открытым окно scrcpy «Экран телефона» на ПК.

Дефект готовности фото исправлен: `storeLocalImage` ждёт copy, проверяет размер
и не публикует URI частичной копии. `RecipePhotoSession` блокирует save/remove/
второй picker во время copy, удаляет позднюю готовую копию после unmount;
если экран ушёл во время DB save, cleanup ждёт исход транзакции, сохраняя фото
успешной записи. Ошибка/отмена сохраняют прошлый выбор. Удаление принимает только
файл своего плоского каталога без traversal/encoded separators. Семь новых
регрессий проверяют эти lifecycle/path сценарии. Ручной picker E2E ещё не выполнен.

## Общая цель по-прежнему шире R06

R04 содержит сопоставления/аудиты старых данных и изолированную rehearsal-запись
карточек со стабильными IDs и исходным profile_json. Это не полноценная запись
всех данных 2.0 в рабочую схему 3.x. Нужно закончить смысловое сопоставление и
staging всех owners/историй без дублей, parity, retry/kill/low-storage, затем
реальный upgrade/restore и Android release gates.

Упражнения 2.0 по решению владельца — повторы + рабочий вес: 20×10кг = 20 повторов,
10 кг; отсутствующие оборудование/группы мышц не угадывать. Анкеты, Calendar,
Workout и Ledger сохраняют независимую семантику.

Авторитетны AGENTS.md и пакет `FitCoach_3_DOCUMENTS_SYNCED_2026-10-14`, особенно
Product §§46, 52–56. Не отмечать R06/D05/D03 готовыми по узкому стенду.
Не открывать/копировать личные `.atbackup`, JKS/PEM/keystore в родительской папке;
не запускать production overlay или реальную миграцию до gates.

## Следующий этап по запросу владельца — Excel

После завершения backup/restore: импорт таблиц как в 2.0 и экспорт тренировки
в Excel. Сначала GitHub-исследование готовых решений/библиотек, затем сверка с
2.0 как образцом. Исследование ещё не выполнено, реализация не начата.
[Зафиксированные требования](EXCEL_IMPORT_EXPORT_PLAN.md). UI/темы остаются позже.
