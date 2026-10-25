# R04: полный учёт таблиц и сохранение исходных SQL-значений

2026-10-25, база `6fcde02`. Входы: admitted canonical-v25 inspection copy,
полные снимки всех владельцев, schema objects/columns и проверенный SHA источника.
Зависимости: R03 fixtures, portable read/write plans, all-owner composition,
immutable copy/job runtime. R04→R03; Product §§46.6,48.5.7,49–50,53–56 / INT-03–12.
Production DDL, реальная миграция, overlay/signing/release gates OPEN. Только
private synthetic staging, finalizable:false. Телефон и личные данные не открывались.

## Проблема и граница доказательства

Manifest/schemaVersion/integrity/FK подтверждали допуск файла, но не учёт всех
физических таблиц. Domain collectors читали свои таблицы; другие stores могли
остаться только в sealed copy без явной записи об этом в staging.

Новый слой перечисляет **все таблицы и views**, сохраняет source DDL и column
metadata. Для каждой обычной таблицы сверяются физическое количество строк,
набор возвращённых колонок и полный multiset SQL-значений. Это учёт и сохранение
исходника, **не доказательство полного сопоставления полей с рабочей моделью 3.x**.
Индексы/триггеры источника не переносятся и не выполняются; целевая схема имеет
собственные constraints. Source SQL хранится как текст через bindings.

## Чтение

После admission и полного чтения владельцев, в том же pinned read transaction:

- Whole-table registry использует Clients, Exercise, Settings, Measurements,
  Calendar, Questionnaire, Plans/Execution/Nutrition source stores. Подмножество
  calendar_planner_settings не заменяет полного app_settings. Все неизвестные
  колонки SELECT * участвуют в проверке. Отсутствующий collector, несовпадающие
  количество строк или набор колонок блокируют результат.
- **CAPTURED:** строки уже получены полным collector, независимо сверены с
  физической cardinality и columns. Это не статус MAPPED или READY.
- **METADATA:** manifest/binding/schema_migrations/backup_state; их полные строки
  тоже сохраняются отдельно от агрегированной admission-информации.
- **REVIEW_REQUIRED:** остальные таблицы читаются без интерпретации содержимого,
  в том числе пустые, старые sync/import/permission stores и неизвестные extensions.
  Эти данные не активируют синхронизацию, роли или старые фоновые операции.
- Views сохраняются только как schema text, с rowCount=null. SELECT view не
  выполняется. Virtual/shadow tables требуют отдельного адаптера и пока безопасно
  отклоняются до generic row capture.
- SQLITE_INTERNAL явно учитывает sqlite_sequence/statistics: сохраняются
  schema/count, не содержимое внутренних оптимизационных/sequence stores.

Каждая обычная таблица, включая CAPTURED, получает сохранённый набор строк с SHA256.
SQL cells tagged: NULL, TEXT, NUMBER, BLOB hex. Текст похожий на JSON/BLOB envelope
остаётся TEXT; JSON из ячеек не разбирается. Дубли строк сохраняются, порядок строк
не участвует в идентичности; повтор и перестановка не создают новые IDs.
Двоичные значения копируются без преобразования в объект с числовыми ключами.
Явный JS -0 не сливается с +0. Unsafe INTEGER/nonfinite REAL отклоняются внутри
SQLite до передачи сырых значений в JS. INTEGER/REAL storage-class различие для
численно равного значения и скрытый rowid не утверждаются: сохраняются видимые
колонки native bridge, schema и tags NUMBER, а исходный SQLite-файл остаётся
byte-preserved. Raw ledger не заменяет исходный файл резервной копии.

Dynamic table names экранируются как identifiers; параметры передаются bindings.
Source table presence сравнивается через SQLite NOCASE, что поддерживает точное
физическое имя дополнительной таблицы, включая кавычки и смешанный регистр.

## Staging и повтор

App composition добавляет SourceCoverage последним владельцем той же транзакции.
Режим SOURCE_COVERAGE_REHEARSAL_V1 включает две **private** таблицы:
r04_source_coverage и r04_source_coverage_receipt. Полный candidate теперь84 tables.
Новых production DDL/миграций нет. Старые private candidates не обновляются на
месте: schema/mode guards отклоняют несовместимый файл до включения WAL.

Coverage source/columns и fingerprints владельцев захватываются до первого await.
Сверка CAPTURED повторяется с захваченными raw owner snapshots; receipt связан с
общим source SHA. Точный parity проверяет все coverage rows и receipt. Подмена
raw/schema/count/digest/manifest не разрешает overwrite, repair или частичный успех.
Rollback/retry используют существующий общий ID ledger; новых identity allocation
правил этот слой не вводит.

retainedTables/retainedRows включают raw snapshots уже CAPTURED таблиц и metadata;
их нельзя складывать с capturedTables. reviewTables/reviewRows/reviewViews выделяют
неинтерпретированные stores. Число таких строк не является количеством workouts,
facts или ошибок пользователя. Никаких raw SQL, имён таблиц с PII или source cell
values в пользовательский UI/логи слой не отправляет.

## Источники 2.0

Проверены pinned `e116b42e95f70a5a5e563420ab25394944c59ffd` migrations001–028,
включая schema creation и последующие table additions; test/temp helpers не
приняты за постоянные stores. Ключевые первичные источники:

- [001_initial.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/001_initial.ts):
  domain tables, sync queues/cursors/revisions и import_jobs.
- [017_client_program_changes.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/017_client_program_changes.ts):
  program_change_requests/inbox_events; новый offline V1 не запускает старый workflow.
- [025_program_library.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/025_program_library.ts):
  library/preferences/view-state/permissions; наличие таблицы не означает перенос
  её бизнес-семантики или повторное разрешение старых ролей.

## Проверки и оставшийся объём

Новые tests: scripts/r04-source-coverage.test.ts. Node/async report parity, полный
SQL table census, full raw source-versus-staged values для каждой обычной таблицы,
пустые/duplicate/quoted/mixed-case stores, BLOB/TEXT/null/numbers, неисполняемые
views, unsafe integers/virtual rejection, native insert/receipt failures,
каждый новый checkpoint rollback/retry, captured source и source/target tamper.
Actual Expo adapters проверяются через SDK mocks на host-файлах; restart без
selected-source/allocator и реальный host Worker termination на двух checkpoints.
Это не Android/process-kill/power-loss proof.

77/77 targeted tests PASS, в том числе8 новых. После исправления различий порядка
Unicode имён в JS/SQLite финальные8/8 PASS, включая BMP/astral table names.
Ранее отдельно33/33 reader/workspace/JSON dependency tests PASS. Root/mobile
TypeScript, scoped lint, source baseline73/arch617, secrets и staged diff PASS.
Общий foundation/full R04 profile/bundle/APK/Android
не запускались. Полный raw ledger увеличивает размер staging; actual ENOSPC,
capacity, streaming и GC остаются отдельными проверками. Копия raw rows не заменяет
постоянные WorkData/Exercise/Execution/provenance/review модели, полноценный обычный
3.x backup/removal proof, UI/cutover, JSON/другие source variants и Android gates.
Goal ACTIVE; полный перенос ещё не завершён.
