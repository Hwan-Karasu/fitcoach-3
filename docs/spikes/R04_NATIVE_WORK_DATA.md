# R04 — самостоятельное хранилище заметок и ручных тегов 3.x

2026-10-26; база `d3ea65a`; R04→R03 / Product §§20.2,22.2–22.3,48.5.7,49–50,53–56,
INT03–12. Предыдущий goal turn — PROGRESS: перенос restSeconds и85 целевых tests.
Входы: проверенный WorkData stage/receipt, Client ID map, workspace/source SHA и
явный importedAt. Зависимости: Clients, shared writer, обычный snapshot engine.
Production DDL/admission, реальная миграция, overlay/signing/release gates OPEN.

## Обычный владелец

`ClientWorkDataPort` и `SqliteClientWorkDataRepository` читают и изменяют отдельные
TrainerNote, workspace TrainerTag и ClientTagAssignment. ID, createdAt и контекст
импортированной заметки сохраняются при правке; updatedAt/revision меняются.
Предусмотрены pin/unpin, поиск буквального текста с Unicode NFC/ru casefold и
сортировка pinned → время создания → ID. Body сохраняется точно, без обрезки.
Повтор со старой revision или чужими client/workspace не перезаписывает запись.

Теги переименовываются как общая сущность: назначения сохраняют tag ID. Действует
та же versioned NFC_WHITESPACE_RU_CASE_V1 policy, что при переносе. Конфликт имени
останавливает команду; ё/е не объединяются. Архивный тег сохраняется в существующих
назначениях и недоступен для нового назначения. Цвет — только presentation.
Архивный клиент доступен для чтения, обычные команды записи отклоняются.

ClientWorkDataCreationParticipant позволяет создать первую заметку и назначения
в той же транзакции, что Client Card. Это проверено с обычным cardParticipant:
ошибка одного тега откатывает и клиента, и заметку, и уже записанные назначения.
Actual Client Card workflow/composition пока не подключает нового участника.

Client safety import reviews остаются PENDING_REVIEW и доступны отдельно от Notes
и Questionnaire. Чтение/правка заметок не превращают старые injuries/pain/diagnoses
в ACTIVE limitation или roster indicator. Подтверждение/отклонение review, first-class
Safety commands и соответствующий экран ещё предстоит реализовать.

Происхождение переносится в per-client `client_work_import_evidence`: source SHA,
opaque source key, importedAt, исходная SQL-shaped карточка и initial projection с
note/tag/review IDs, точными labels/позициями и unknown note-time basis. Это
неизменяемые данные 3.x, сохраняемые обычным backup, без чтения старого файла.
Обычный repository не содержит парсера 2.0 и не обращается к r04_* таблицам.

Повреждённая persisted строка пропускается, остальные записи читаются. Подаётся
существующий bounded/content-free ReadIssues signal без body/ID/raw JSON. Сам UI
нового владельца пока не подключён. Невалидные новые записи отклоняются.

Deletion participant включается в явный manifest архивного клиента. Одна
транзакция удаляет его Notes, assignments, reviews и per-client evidence;
workspace теги и данные другого клиента остаются. Проверка использует обычный
DevClientRepository с новым participant. Это не подключение нового владельца ко
всем production deletion/restore/maintenance holders.

## Граница схемы и записи

`scripts/r04/ClientWorkDataCandidateSchema.ts` — исключительно private synthetic
schema candidate. Шесть таблиц владельца, собственный ledger, FK/unique/CHECK,
индексы, immutable identity/context/evidence guards. Она не добавлена в runtime
SCHEMA_OWNERS, baseline или createServices. Production registry правильно
отклоняет этот candidate как DATABASE_INCOMPATIBLE; соответствующий test проходит.
Repository сам не создаёт/не мигрирует схему и не создаёт workspace, а проверяет
format marker/name policy. Неуспешное initialize освобождает lease и допускает Retry.

LegacyNativeWorkData читает private stage в caller-owned transaction, проверяет
binding/source SHA/importedAt и повторно исполняет исходный owner projection/parity
с запрещёнными writes/allocator. Поэтому совместная подмена target receipt и rows
не выдаётся за успешное преобразование. Исходные source values не переписываются.
ID/контекст и точный JSON context перенесены из проверенных rows; revision стартует1.

InitialClientWorkData устанавливает уже подготовленные native rows в новую
admitted candidate-транзакцию без DDL и allocation. Input захватывается до await.
Идентичный повтор только проверяет parity. Любая имеющаяся разница, включая
редактирование заметки после импорта, отклоняется вместо повторного overwrite.
Существующий all-owner private stage и его84table mode в этом срезе не менялись.

## Проверки и точные границы

- 50/50 targeted PASS:13 новых + старые WorkData/portable writers, Client store,
  portable snapshot dependencies. Финальный повтор новых13 после type-only правки
  также PASS; root/mobile TypeScript, scoped lint, source73 и arch624 проверены.
- SQL FK/JSON/scope/evidence guards; readonly admission/parity; исходный SHA;
  stale writes, rename/assign/archive, per-client deletion и atomic card creation.
- EXPLAIN использует scoped timeline/evidence индексы без временной сортировки.
- Actual host Worker завершается после частичной записи native evidence до COMMIT;
  SQLite откатывает весь seed, restart устанавливает прежние ID.
- Actual Node SQLite backup → тот же SqliteSnapshotEngine с явно добавленным
  **candidate owner** → отдельная восстановленная копия. Все пять data tables,
  raw/projection evidence и ID совпадают. Оригинал backup не меняется.
- Fresh Worker с importer-ban и positive probe читает и правит Notes/Tags, reviews
  и evidence через обычный repository, без legacy-import/shared migration/r04 кода.

Это доказательство native WorkData candidate и формата snapshot; текущий обычный
production snapshot registry эту схему ещё не принимает. Не доказаны production
schema admission/upgrade, общая cutover, весь Execution/custom catalog/provenance
других owners, полный UI/restore holders, APK/Android/Hermes, SAF publication,
power loss/low disk/cross-instance concurrency. Foundation/full R04 profile и
телефон в этом срезе не запускались. Полный goal ACTIVE, не100%.

Далее: довести permanent Exercise/Execution и остальные retained/review owners,
schema admission, app workflow/holders/deletion registration, полный путь
2.0 → bridge → self-contained3.x backup → ordinary build without importer и Android.
Не удалять импортёр до полного доказательства этого пути.
