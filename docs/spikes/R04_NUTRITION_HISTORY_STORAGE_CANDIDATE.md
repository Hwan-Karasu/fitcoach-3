# R04: самостоятельное хранение истории питания в формате 3.x

2026-10-24, база 522369a. R04→R03/D01; Product §§46.6/46.19,
49.5/49–50/53–56, INT-03–12/15; решение TRANSITION_RELEASE_2_TO_3.
Входы: validated private archive snapshots/receipt/IDmap, существующие native D01
facts, SqliteSnapshotEngine и pinned SQLite host. Production DDL/migration/overlay/
signing/release gates OPEN. Только isolated candidate schema, finalizable:false.

Цель: проверить самостоятельную модель истории 3.x, immutable source provenance
и passage через snapshot/restore без парсеров 2.0. Prototype DDL остаётся в scripts,
не регистрируется в production SCHEMA_OWNERS. Обычный production backup ещё не
объявляется совместимым с этой схемой; candidate engine получает явный каталог.

Архивный снимок и исходная строка принадлежат одному client/workspace. Source
metadata хранит только hashes/формат/время импорта, без raw общего файла с данными
всех клиентов. Это позволяет удалять всю клиентскую историю, не оставляя её PII
в глобальном source receipt. Подключение deletion participant остаётся gate
будущей production интеграции.

## Самостоятельная модель и чтение

NutritionHistorySnapshot/Port принадлежат обычному Nutrition domain 3.x. Модель
сохраняет exact decimal text, ABSENT/UNKNOWN/VALUE/UNSUPPORTED, date-only/unknown
даты, физические snapshot IDs и provenance locator. Не использует SQLite/JSON 2.0,
не создаёт факты и не меняет знаменатели статистики. LegacyNutritionArchive теперь
зависит от этой модели, обратной зависимости у обычного приложения нет.

SqliteNutritionHistoryReader читает только нормализованные таблицы 3.x. Перед
возвратом проверяет SHA снимка, сырой исходной строки и review; shape/version/IDs/
client/sourceKey и scope запроса. Сырые данные источника не возвращает в UI.
Плохая строка пропускается, остальные остаются доступны. Сообщение идёт через
существующий ReadIssues/DataReadNotice: «Не удалось прочитать часть записей.
Остальные данные доступны.» Без payload/PII/кодов ошибок в уведомлении.

## Изолированный storage prototype

NutritionHistoryStorageCandidate содержит candidate owner/ledger v1, отдельные
nutrition_history_sources и nutrition_history_weeks, indexes/FK/identity CHECKs и
immutable UPDATE triggers. DDL остаётся host-only, production SCHEMA_OWNERS и
prepareProductionDatabase не изменены. Новый reader не создаёт таблицы и пока
не подключён к runtime composition.

Sources содержат только digest/format/importTime, без общего raw файла всех клиентов.
Каждый week хранит normalized snapshot, его исходную physical row и review с
отдельными hashes. Полная исходная строка сохраняет также unknown columns и
исходный days_json; неопределённость не подменяется нулём/датой импорта.

copyNutritionHistoryCandidate требует отдельную caller-owned транзакцию,
проверенный private receipt и совпадающие account/source/workspace/import-time
bindings. Совпадающий SQLite handle или physical file (включая другое соединение)
отклоняется до записи; отдельные файлы проверены положительным сценарием. Сверяет
coverage, target IDs, связь source client→target client. Тот же ID
с другим содержимым блокирует запись; повтор идентичных строк не меняет файл.
Промежуточный сбой откатывается вместе с native D01 фактами. Issued hashes дают
проверку целостности; это не цифровая подпись источника.

Подготовлен nutritionHistoryClientDeletionParticipant: count/detach только по
workspace+client, включая строки, которые reader пропустил как повреждённые.
После удаления A его raw строк нет в глобальных sources или оставшихся B rows.
Это проверяет только владельца истории; общий полный delete-client workflow ещё
должен подключить участника при production admission.

## Доказательства и пределы

606/606 area+deps, пять новых интеграционных тестов, 35 Nutrition total.
Путь на синтетике: source2.0→R04 staging→candidate3.x nativefacts+history→native
SQLite backup→тот же SqliteSnapshotEngine seal/validate→.atbackup→отдельная
restore DB→engine.stageSnapshot→обычный SqliteNutritionHistoryReader.
Сверены native Nutrition/Measurement/client rows, snapshot IDs/значения/raw/review
hashes. Live и внешний backup сохраняют исходные bytes. В restored нет r04 tables.

После restore запускается чистый Worker isolate с resolve hook, запрещающим любые
scripts/r04 и Legacy modules. Запрет сначала проверяется намеренным импортом,
затем обычный reader успешно возвращает те же сведения. Проверен фактический
граф загруженных modules. Тест ждёт завершения isolate до уборки файлов.
Изначально запуск отдельного OS subprocess получил EPERM окружения; проверка
переведена на свежий isolate с более строгим запретом импортов, без skip/pass fallback.
Это proof только читателя Nutrition history; отсутствие импортера во всём APK
и bridge→normal release по-прежнему OPEN.

Каждый source/week checkpoint — полный rollback/retry, повтор — byte-identical.
Проверены immutable rows, mismatched context, client/workspace isolation, corrupted
snapshot/source/review hashes, shape corruption, сохранность исправных соседей,
обезличенный read notice и удаление A при сохранении B. Root/mobile TypeScript,
scoped ESLint, source73/secrets/arch/diff прошли. Fullfoundation/bundle/APK/Android/
phone не запускались, пользовательские данные и 2.0 не затрагивались.

**Production admission OPEN:** схема-кандидат передаётся движку явно; действующий
production backup намеренно отклоняет эту БД как несовместимую. Этот срез не
объявляет текущую функцию копирования приложения совместимой с новыми таблицами.
Осталось owner/DDL admission, native/Android и schema upgrade checks, подключение
reader/deletion participant в composition/UI и ordinary backup/restore при новой
approved schema. Другие owners/review representations/full legacy import и общий
release/removal proof остаются обязательными. finalizable:false, goal ACTIVE.
