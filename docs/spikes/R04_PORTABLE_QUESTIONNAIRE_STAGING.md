# R04: асинхронная запись анкет в общей транзакции клиентов

2026-10-24, база `76ab152`. Входы: общий client write plan/isolated SQLite adapter,
проверенные profile/Q projections, QuestionnaireComposition и host profile writer,
D01 client/questionnaire baseline, canonical25 admission/mobile source snapshots.
R04 зависит от R03; Product §§48.5.7, 49–50, 53–56, INT-03–12. Production DDL,
реальная миграция, overlay/signing/release gates OPEN. Только synthetic private
staging, `finalizable:false`; без UI/телефона и переключения действующей базы.

## Реализация

`LegacyQuestionnaireComposition` перемещён в questionnaire/domain/legacy-import.
Алгоритм сохраняет исторические версии, промежутки номеров, source publication
times, semantic epochs и original draft отдельно от новой migration publication.
Script entry point — re-export, Node зависимостей в composition нет.

`LegacyClientProfileStagePlan` содержит общий генератор schema/write/parity запросов.
Ранее существовавший R04/D01 schema setup перемещён, production baseline не менялся.
Prerequisite clients_id_workspace index создаёт client owner. Questionnaire writer
получает только shared bridge contracts, не импортирует другой feature.
Host `LegacyClientProfileStage` стал thin wrapper и исполняет тот же план внутри
прежней общей транзакции полного CandidateIdentityLedger.

Profile projection всегда пересчитывается из raw profile_json, производные
legacyProfile/fields не разрешают менять сохраняемые ответы. Source/target receipts,
сортировка, immutable publication triggers и прежние parity checks сохранены.
WorkData/excluded candidates остаются в private receipt: они не объявлены готовой
записью операционных заметок/меток. Числовая точность произвольных Q JSON answers,
unknown BLOB provenance и полная permanent storage/backup модель не доказаны этим
срезом; raw source preservation не заменяет их проверку.

`LegacyStageExtension` — shared internal контракт подключения владельца к клиентской
транзакции. Mode tags, expected objects и schema задаются до создания job, входят
в его неизменяемый binding. `LegacyClientStaging` вызывает owner stage после записи
clients/IDs, затем проверяет общую integrity/FK/parity и выполняет COMMIT. Дополнительный
owner и асинхронные checkpoints обязательно ожидаются; ошибка не может завершить
клиентскую транзакцию раньше анкеты. Результат owner возвращается как extensionResult.

`legacyQuestionnaireStagingExtension` захватывает raw SQL input и проецирует Q до
первого await. undefined означает прежний profile-only mode; null — включённый Q
mode с отсутствующими stores. Отсутствие источника не создаёт ложных исторических
публикаций. Включённая Q должна прийти из той же проверенной inspection copy/SHA;
в полном coordinator нельзя передавать null вместо реально имеющегося owner.
Смена mode требует новой отдельной DB, существующий client/profile-only job не
пересобирается. Partial clients+Q DB по-прежнему не готова к cutover.

## Доказательства

8 новых `r04-portable-questionnaire-staging.test.ts` используют реальные Node SQLite
файлы через async native-compatible port и существующий isolated adapter. Shared
`scripts/support/legacy-staging-native.ts` извлечён из предыдущих client tests;
10 предыдущих client tests продолжают проходить. Это host contract proof, не Android.

- canonical25 admission → mobile clients/Q raw → общий async writer: все clients,
  IDs, publications, drafts, answers, source/target receipts равны host ledger;
  исходный файл SHA не меняется, handle закрываются;
- fixture охватывает семь типов ответов, zero/false/whitespace/choice order,
  deleted/null answers, removed answered field/option и несовместимые epochs;
  номера старых publications 1/4 сохранены, новая 5 имеет import time, draft
  остаётся draft; тип number→text получает отдельный field ID;
- awaited failure after-profile/before-commit откатывает clients, новые IDs,
  versions/drafts/answers/receipt; retry/reopen/reordered replay не вызывает allocator;
- уже исполненный COMMIT с потерей подтверждения повторяется без дубликатов;
- mutation caller schema/answer/change history после capture не меняет source receipt;
- неверный pointer/revision/owner/JSON/change workspace блокирует весь batch;
- profile-only и Q modes не присваивают binding друг друга; absent Q не создаёт
  source history;
- target answer drift выявляется без overwrite; immutable versions trigger работает;
- failure создания Q schema откатывает всю initial schema, повтор восстанавливается.

467/467 owner/dependency profile `r04:plans:test` PASS, initial41/18 PASS.
Root/mobile TypeScript, scoped lint, source73/arch553/secrets/staged diff PASS.
Полный foundation/bundle/APK/Hermes runtime/Android не запускались.

## Остаётся

Portable WorkData/registry/Plans/Execution/Measurement/Nutrition/Calendar writers и
другие projections, полная source coverage/preferences/lineage, permanent historical
Execution/review/provenance модель, schema admission/app composition/cutover,
ordinary backup/restore всех перенесённых данных, JSON/other2.0 variants,
Android interruption/retry/low disk/concurrency, GC/powerloss/removal/release proof.
R04/D03 и общий goal остаются открытыми, не100%.
