# R04: общий перенос каталога упражнений и его ссылок

2026-10-24, база `fa44bc3`. Входы: catalog/reference projections и host registry
schema/write/parity/read model, общий client/Q/WorkData async writer, canonical25
admission и pinned mobile raw snapshots. R04 зависит от R03; Product §§48.5.7,
49–50, 53–56; INT-03–12. Production DDL/реальная миграция/overlay/signing/release
gates OPEN. Только private synthetic staging, `finalizable:false`; без UI/телефона.

## Изменение

Table presence/xinfo/full-row/count/unsafe SQL number read core вынесен из
legacy-import data в `shared/migration/LegacyReadPlan`. Старые exports сохранены,
algorithms/pragmas/transaction ownership предыдущих readers не менялись.
Это даёт exercise owner общий reader без feature-to-feature data imports.

`LegacyExerciseReferenceReadPlan` читает physical clients/workouts/exercises/history
с прежними минимальными полями, SQL ordering и теми же raw/number/count guards.
Node reference reader исполняет этот план. Pure `LegacyExerciseReferences` перенесён
к exercise domain и строит owner joins в памяти по точным ID. Mobile factory берёт
те же physical строки из уже admitted8owners; повторного независимого snapshot нет.
Достаточные поля уже обязательны в Plans/Execution readers, их shapes не расширялись.

Важное усиление: physical duplicate clients/workouts, включая неиспользованные,
отклоняются как неоднозначная идентичность. Зарезервированные client_id (в exercises)
и owner_client_id (в exercises/history) не могут быть затёрты join aliases — такой
вариант schema останавливается с фиксированной ошибкой. Raw source copy сохраняется;
это отказ от неподдержанного варианта, не его полная миграция. Unmatched/malformed
ссылки остаются unresolved и блокируют запись вместо name-based matching.

`LegacyExerciseCatalogStagePlan` содержит прежние private schema/write/parity,
catalog read model и ID loader как общий generator Node/async SQLite. Source/target
receipts, usr:/sys:legacy-v2: IDs, deleted catalog visibility, old snapshot links и
alias values сохранены. Host stage/reader wrappers и CandidateIdentityLedger
исполняют те же планы; полный Node transaction всех owners сохранён.

`LegacyExerciseCatalogStaging` захватывает raw catalog/reference input до await,
пересчитывает candidates и требует profile/Q/WorkData dependencies при инициализации
нового job. Registry, overlay, links, IDs и receipt пишутся после прежних owners в
одной tx; все checkpoints ожидаются. Existing WorkData-only mode не перестраивается.

Все старые упражнения сохраняют LOAD_REPS. Known exact category mappings не менялись;
unknown category/equipment остаются NULL/unspecified, мышцы/техника не придумываются.
Same-name catalog IDs не объединяются; instance/history ownership остаётся точным.
Reader использует текущий ExerciseDefinition/CatalogEntry, includeArchived нужен
истории; deleted source не становится активным pick.

Registry — прежний R04 proposal, не production custom_exercises (его текущие NOT NULL
поля не обходятся). Наличие domain read proof не подключает реальную библиотеку,
ordinary backup/restore, редактирование/deletion или importer removal. Все эти
проверки и постоянная модель остаются открытыми.

## Проверки

8 новых `r04-portable-exercise-staging.test.ts`: реальные Node SQLite файлы через
async native-compatible port/existing isolated adapter, не native Expo proof.
Source fixture включает actual custom Q publication/draft/answer, same-name clients,
archived client, WorkData, same-name custom/stock catalog entries, удалённое используемое
упражнение, два клиента с одним catalog ID и history с raw exact JSON digits.

- admitted source → async clients/Q/WorkData/catalog chain равна host по всем
  rows/IDs/receipts; native-compatible catalog/ID read plans дают прежнюю domain
  модель, archived visibility и unspecified metadata; source SHA/FK/handles чистые;
- все пять exercise checkpoints и before-commit rollback откатывают предыдущих
  owners/IDs/receipts, retry/reopen/reordered replay не вызывает allocator;
- исполненный COMMIT с потерей подтверждения повторяется без дубликатов;
- caller mutation после capture не заменяет catalog/reference source values;
- conflicting catalog IDs, foreign-client instance, malformed catalog и ID collision
  блокируют общий batch; одинаковые названия не разрешают заимствовать запись;
- reserved source aliases и duplicate physical workouts блокируются до file open;
- target registry/link/receipt drift обнаруживается без overwrite/new IDs;
- schema/INSERT failure откатывает initial schema/весь batch; incompatible owner
  mode не присваивается новой версии job.

483/483 owner/dependency profile `r04:plans:test` PASS; initial55/focused8 PASS.
Root/mobile TypeScript, scoped lint, source73/arch562/secrets/staged diff PASS.
Полный foundation/bundle/APK/Hermes runtime/Android
и реальные пользовательские DB не запускались/не открывались.

## Остаётся

Portable Plans/Execution/Measurement/Nutrition/Calendar writers и другие projections,
полная source coverage/preferences/lineage, permanent historical Execution/
WorkData/registry/review/provenance schema admission, app composition/cutover,
ordinary backup/restore всех imported data, JSON/other2.0 variants, Android
interruption/retry/low disk/concurrency, GC/powerloss/removal/release proof.
R04/D03 и полный goal остаются открытыми, не100%.
