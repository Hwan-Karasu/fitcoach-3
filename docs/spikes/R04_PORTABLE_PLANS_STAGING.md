# R04: переносимая запись Plans, Templates и Archives

2026-10-24, база `f7ccdf9`. Входы: проверенные host Plan/Template/Archive projections,
prescription conversion, D01 plan baseline, host write/parity/mapping reader,
общая async client/Q/WorkData/registry chain и admitted canonical25 raw snapshots.
R04 зависит от R03; Product §§48.5.7, 49–50, 53–56; INT-03–12. Production DDL,
реальная миграция, overlay/signing/release gates OPEN. Только private synthetic
staging, `finalizable:false`; без UI/телефона и переключения действующей базы.

## Реализация

Plan source contracts перенесены в shared/migration/LegacyPlanSources, старые
exports SourceSnapshots сохранены. Pure Plans/ArchivePlans/PlanPrescription moved
к training/plans domain; script entries re-export. Exact text kg→grams/reps helper
вынесен в shared/migration/LegacySetMetricConversion без dependency на другой
feature или runtime. Сам преобразователь и правила projection не менялись.

`LegacyPlansStagePlan` содержит прежние schema/write/parity/mapping-read операции
как generator Node/async SQLite. Production baseline неизменен, schema создаётся
только в явно bound R04 staging. Старый Node stage/loader — wrappers; полный
CandidateIdentityLedger сохраняет прежний API, mode versions и общую transaction.

Identity callback теперь чистый: реальные UUID выделяются в том же traversal order,
сразу участвуют в исходных source keys (в частности template-set-slot содержит
реальный parent exercise ID). Новые rows собираются в pending list. После успешных
live/archive projections generator проверяет UUID collisions с client/work ID maps
в SQLite и сохраняет IDs до записи plan rows и прежних checkpoints. Нет fake IDs,
preflight projection с временными ключами или повторного разбора на каждую identity.
Если проекция/проверка/запись падает, вся общая tx откатывается; потреблённые UUID
незавершённой операции не выходят в результат. Committed ID rows переиспользуются.

`LegacyPlansStaging` фиксирует full mode и raw snapshot до первого await. Требует
предыдущие profile/Q/WorkData/registry tags. По умолчанию включены Templates/Archives;
архивы без template mode недопустимы, изменение mode существующего файла блокируется.
Все stages используют общий allocator/tx/checkpoint driver. Plan mappings reader
также переносим и проверяет сохранённую parity перед использованием будущим Execution.

Сохранены простые weekly overrides, periodized structure/lineage, template ownership
и omission of execution fields, archived containers/aliases/root-cycle mirrors и
deleted unreadable archive source. Реальные reps/weight/completed_at не становятся
prescription или выполненной работой только из-за переноса структуры.

## Проверки

8 новых `r04-portable-plans-staging.test.ts`: реальные Node SQLite файлы через async
native-compatible port и existing isolated adapter. Не Android/native Expo proof.
Fixture содержит actual Q, WorkData, registry, simple2weeks с override, periodized
program другого клиента, шаблон, simple/periodized archives, verified root-cycle
mirror и soft-deleted unreadable archive.

- admission → async full chain равна host по всем tables/ID maps/source-target
  receipts; общий mappings reader совпадает с Node; source SHA/FK/handles чистые;
- actual readStructure/readSimpleWeeks/readMesocycles/storedTemplate видят данные:
  недели дают 8–12×2,5 и 15×2,5; source actual20×15 не подставляется в план;
- template ID keys используют настоящий parent ID; execution fields не попадают
  в template, targetFactsCreated=0;
- archive, ссылающийся на old program ID другого клиента, остаётся у владельца
  архива, а не присоединяется к чужой живой программе;
- все plan/archive checkpoints и before-commit откатывают предыдущих owners/IDs/
  receipts; retry/reopen/reordered replay не вызывает allocator;
- исполненный COMMIT с потерей acknowledgement повторяется без дубликатов;
- raw/options mutation после capture не меняет структуру; invalid template binding,
  archive mirror, exact prescription и deferred cross-owner ID collision блокируют batch;
- mode mismatch, target row/source alias/receipt drift и schema/INSERT failures
  не перезаписывают данные, не оставляют partial init и допускают retry.

491/491 owner/dependency profile `r04:plans:test` PASS; initial45/latest8 PASS.
Root/mobile TypeScript, scoped lint, source73/arch569/secrets/staged diff PASS.
Полный foundation/bundle/APK/Hermes runtime/Android
не запускались, реальные пользовательские DB не открывались.

## Остаётся

Переносимые Execution/Measurement/Nutrition/Calendar writers/projections, остальная
source coverage/preferences/lineage, permanent Execution/WorkData/registry/review/
provenance модели и admission, app composition/cutover, ordinary backup/restore
всех imported rows, JSON/other2.0 variants, Android interruption/retry/low disk/
concurrency, GC/powerloss/removal/release proof. Точность произвольных числовых
Q/Plan JSON metadata не доказывается raw retention или безопасностью SQL numbers;
требуется отдельный token/value parity audit до допуска в production.
R04/D03 и полный goal остаются открытыми, не100%.
