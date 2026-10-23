# R04 — каталог 2.0, устойчивые ID и ссылки в общей staging-транзакции

Дата2026-10-23; база e123c13. Task R04→R03; D03→D01/R04/R05.
Product §§31.11,33,39.1–7,46.6/46.19,48.5.7,48.86.30,49–50,53–56.
Входы: readonly catalog/reference readers, Client ID map, Q/WorkData и job time.
Migration/overlay/signing/release gates OPEN. **Synthetic rehearsal, не production
migration**. Пользовательская БД, APK/телефон не изменялись.

## Источники и вход

Продолжение [source mapping](R04_EXERCISE_CATALOG_MAPPING.md) и
[WorkData](R04_CLIENT_WORK_DATA_STAGING.md). Readonly build120:
`e116b42e95f70a5a5e563420ab25394944c59ffd`.
[007_exercise_catalog.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/007_exercise_catalog.ts)
повторно прочитан: stock/user, category/equipment/aliases и даты soft deletion.
По решению владельца все упражнения2.0 используют LOAD_REPS независимо от профиля
похожего упражнения в современном RepDB. Имена/aliases не являются identity.

projectLegacyExerciseCatalogRow/projectLegacyExerciseReferences выделены из readers
для повторного разбора raw. Readers сохраняют shape/owner/cardinality проверки,
все исходники и targetWrites=0. Staging не доверяет derived name/bodyPart/status.

## Что записано

Явный exercises:true требует profiles/questionnaires/workData:true; persisted
EXERCISE_REGISTRY_REHEARSAL_V1. stageClientExerciseCatalog в одной BEGIN IMMEDIATE
пишет Client IDs/cards, Q history/profile, WorkData, каталог, overlay, reference
maps и receipts. Старые rehearsal DB не присваиваются новому режиму/не пересобираются.

- Каждому source catalog ID соответствует persisted UUID: CUSTOM→usr:UUID,
  stock→sys:legacy-v2:UUID с origin SYSTEM. Source provider LEGACY_V2 отличает
  прежний stock от RepDB. Совпавшие имена не объединяют самостоятельные записи.
- loadExerciseDraftIds предоставляет следующим владельцам source-key→target-ID
  map с проверкой scope/raw/origin/prefix/UUID. Candidate targetExerciseId остаётся
  null: read-only вход не мутируется ради результата записи.
- Полное имя, включая старое имя длиннее80символов, и точные aliases/порядок/
  повторы сохраняются. normalizeAliases с обрезанием/удалением строк не вызывается.
- Только Грудь/Спина/Плечи/Кор имеют доказанный BodyPart. Ноги/Руки/Кардио/Другое/
  пустое/произвольное остаются неуточнёнными, raw category сохранена. primaryMuscles
  не выводятся из текста. Equipment сохраняется из явного source, без классификации
  по названию. createdAt/updatedAt — исходные даты, target revision=1.
- deleted_at→archived_at, включая stock. Удалённая definition доступна истории,
  но не активному выбору. Физического удаления или возврата в каталог нет.
- Личный слой использует настоящую D01 exercise_overlay definition. Aliases exact,
  displayName=null/favorite=false/hidden=false — начальные defaults этого среза,
  **не** доказательство переноса preferences из других таблиц.
- training_exercises/training_exercise_history получают отдельные persisted links
  с source row/client/table, target client/exercise/workspace и полным raw snapshot,
  включая name/note/data_json/deleted_at. Явные ссылки сверяются повторно; чужой
  client/конфликт/неизвестный catalog не исправляются по имени или соседнему факту.

Registry/overlay/link rows и source/target manifests проходят read-back parity,
FK/integrity до commit. Шесть новых exercise/commit failure boundaries откатывают
каталог и предыдущие владельцы/IDs вместе. Reopen/reordered retry без allocator
оставляет target bytes неизменными. Source/target drift не приводит к UPDATE/REPLACE.

## Неизвестные metadata и граница production

ExerciseDefinition.bodyPart допускает null для сохранённого legacy import.
Обычный CreateCustom по-прежнему требует category и tracking profile. Пустое
legacy equipment получает null+equipmentUnspecified=true: неизвестность отличается
от доказанного none/bodyweight обычных definitions. Общие rules/search/ALL/MINE
принимают такие записи. Неизвестная группа не приписывается known muscle filters/
counts или full_body. Для оборудования unspecified key — пустая строка, которая
не является допустимым значением реального оборудования; none фильтруется отдельно.

Минимальные labels «Группа мышц не указана»/«Оборудование не указано» обеспечивают
читаемость; это не редизайн/темы. Training lookup не придумывает group для null,
а старое SYSTEM не получает атрибуцию RepDB. Уточнение metadata позднее не должно
переписывать snapshots старых фактов. Историческая классификация ещё не перенесена.

Текущий production custom_exercises требует NOT NULL body_part и короткое имя.
Он не ослаблен/не перестроен. Частный r04_exercise_registry — owner-shaped proposal
для импорта, **не approved production DDL**. r04_exercise_ids/links/receipt сохраняют
доказательства. readRehearsedExerciseCatalog читает реальные staged rows через
общие CatalogEntry/ExerciseDefinition, но runtime repository ещё не читает этот
реестр. Actual import/enrichment/archive commands, production schema/backup/deletion
participation и история source lifecycle должны быть подключены по gates.
ExpoRestoreJobs по-прежнему принимает3.0 snapshots; legacy branch отсутствует.
Частный r04_* DB не fitcoach_v3.db; результат finalizable:false.

## Фактические проверки

- npm run r04:exercise-stage:test — **153/153**,17 новых staging tests плюс source
  catalog/reference, Client/Q/WorkData/identity, обычный catalog store и history groups.
- Synthetic source→stage:5definitions/5links, active/archived clients, Notes/Tags/Q.
  Дополнительная полная композиция с custom Q history/draft/answer version1 и ID map.
- Шесть rollback boundaries; exact aliases/long name/source time, unknown metadata/
  filters/search, удалённые CUSTOM/SYSTEM, allocator collision, workspace FK,
  stale derived/callback mutation, source/target drift. Read-only source SHA unchanged;
  byte-identical target reopen/reorder. Это host exception proof, **не Android kill**.
- Downstream r04-source-fact-preflight.test.ts — **82/82**, включая полный read-only
  audit. Никакие IDs/имена/JSON не добавлены в aggregate report, targetWrites=0.
- Root/mobile typecheck, changed ESLint, source/arch506/secrets/diff. Android JS/Hermes
  bundle **5623modules/1185assets**. Fullfoundation/новая APK/Android fixture не запускались;
  установленная2.0 и личные файлы не затрагивались.

## Дальше по полной цели

Не обработаны все references из session exercises, library/archive JSON,
alias registry/exercise_identity_unresolved и preferences. Нельзя объявить их
перенесёнными по пяти связям synthetic fixture. Следующий R04 этап — structure/
program/library/archive→Plans с Client/Exercise ID maps, затем canonical Training
facts, остальные владельцы, full staging parity/checkpoints, runtime SQLite/JSON
v1/v2 Restore и interrupted retry/Android. WorkData production owner тоже OPEN.
Общая цель ACTIVE, не100%; UI/темы позже, Excel после backup/restore.
