# Точка продолжения — 23 октября 2026

Работа возобновлена по просьбе владельца: «не спим, работаем». Цель ACTIVE.
Полный перенос 2.0→3.0 и backup/restore не завершён; 100% не заявлено.
UI и темы остаются на последующую шлифовку. Продукт — «Дневник атлета».

## Последний завершённый этап R06 — общий snapshot engine

Ветка `audit/training-fixes`. Ранее: `be5f8f7` (native guarded restore),
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

Проверки текущего этапа: foundation **939/939**, mobile и spike typecheck,
lint, arch:check (463 source files), source:verify, secrets:check и diff --check.
Отдельный Android production bundle в этом срезе не запускался; фактически
собран и запущен development bundle SQLite spike на устройстве.

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

Продолжить **R06** с application controller и lifecycle обычного приложения:
recovery до открытия repositories, остановка всех владельцев leases (включая
workflow lease) и scheduler, блокировка новых команд, reopen и read-model
invalidation, подтверждение полной замены. Default runtime пока не использует
новый Expo driver. Нужны SAF/Downloads выбор/публикация/права, rotation, Return
point, negative/low-storage/reinstall/full-owner native matrix. R06/D05 OPEN.

Известный отдельный дефект готовности фото: в `shared/media/LocalImageStore.ts`
`File.copy` ещё вызывается без await, RecipeEditor может сохранить URI раньше
завершения копирования. Исправить async lifecycle, блокировку save во время copy
и освобождение позднего результата при unmount. В новых backup/restore adapters
копирование уже ожидается.

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
