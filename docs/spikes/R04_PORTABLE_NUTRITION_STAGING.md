# R04 — общий SQLite writer питания и архивов

2026-10-24, база `d854a31`, `work/r04-legacy-restore`. R04 → R03;
Product §§49–50, 53–56; зависимости и сохранность связей §§48.5.7/INT-03–12.
Private synthetic staging, `finalizable:false`. Production DDL, реальная миграция,
overlay/signing/release gates OPEN. Пользовательские данные и телефон не читались.

Входы: шесть raw stores (продукты, рецепты, дневник, дневные значения, калькулятор,
архивные недели), client identities/cards и immutable import time. Нужна полная
предшествующая цепочка Profile/Questionnaire/WorkData/registry/Plans/Templates/
Archives/Executions/Measurements. Дневные строки должны совпасть с measurement
source receipt, включая отсутствие/пустоту и все сохранённые SQL cells.

## Реализация

Чистые projections/values/calculator/archive перенесены к Nutrition owner;
старые script paths — re-exports. Source DTO/SQL row contracts в shared.
Точный JSON lexer остаётся общим; обычные reader/domain paths его не импортируют.
Legacy date validator сохраняет прежние MeasurementRules semantics, включая
особенности годов 00xx; Nutrition не импортирует feature Measurements.

Один generator содержит schema/write/parity/guarded diary+archive read для Node
и async SQLite. Existing D01 baseline исполняется только внутри private staging;
три служебных CREATE выполняются отдельно. SHA256 через уже установленный noble,
новых зависимостей/lockfiles нет. Nutrition mode V3 и raw cells захватываются до
await, без превращения файла предыдущего владельца в другой mode.

Чистая projection получает реальные UUID в прежнем порядке. Pending SQL collision
checks/reservations выполняются после projection перед rows/checkpoints в той же
общей транзакции. Нет временных ID и повторного projection. Тест collision между
archive week/day теперь берёт ID из независимого committed witness; он продолжает
проверять выход ID collision из JSON handling и полный rollback, не требуя SQL
внутри чистой projection/allocator callback.

Семантика прежняя: дневник сохраняет исторический snapshot и saved portion totals
через override без пересчёта каталога; удалённый исходный продукт не создаётся
фиктивно, recipe ingredients не становятся отдельными diary facts. Daily marks
не создают Workout/Credit. Недатированные calculator body inputs/manual macros
не превращаются в measurements/targets. Архивы — исторические snapshots с exact
decimal tokens, исходными датами/неизвестностью/overlap, без новых daily facts.

## Проверено

10 новых tests с настоящим SQLite через асинхронный Expo-shaped port и
`openIsolatedSqliteConnection`; host proof, не Android/Expo runtime.

- Admitted canonical-v25 source проходит full owner chain: published/draft Q,
  ответ, WorkData, registry, программы/архивы, фактические тренировки, замеры,
  продукты/рецепты/дневник/калькулятор/пищевые архивы. Async == Node по всем rows,
  ID и receipts. Source SHA неизменен; FK check пуст; handles закрыты.
- 1 food/1 recipe/4 diary/2 water/5 step/1 mark/2 calc/3 archive rows.
  Исторические 17.4 г имеют per100 kcal100 и saved kcal17, текущий catalog kcal300
  не меняется. Snapshot missing product сохранён; recipe ingredients не удваивают
  еду. Пищевые архивы не добавляют execution facts; остаётся шесть фактов источника.
- Каждое повторение after-nutrition-rows (по каждой target table), after-ids,
  after-receipt и before-commit откатывает всех владельцев; retry/reopen/reordered
  replay не выделяет новых ID. COMMIT/close acknowledgement loss не даёт дублей.
- Capture, daily source mismatch, чужой owner, duplicate source key, cross-owner
  UUID collision, mode before-WAL, schema/row I/O rollback/retry проверены.
- Guarded diary/archive reads проверяют все target tables и receipt/hash;
  факт/catalog/recipe/ingredient/water/calc/archive/ID/source/target/SHA drift
  отклоняет read и replay без перезаписи. Archive reader проверяет client owner.
- Live decimal `17.000000000000001` остаётся raw review без округлённой записи;
  archive decimal `81.2500000000000001` остаётся exact snapshot. Проверены годы
  0000/0099/0100, leap day, invalid day, 9999 без изменения старой семантики.

Одноразовое независимое сравнение с прежним writer из
`git show d854a31:scripts/r04/LegacyNutritionStage.ts`: empty, full observations,
unsupported precision — по 65 таблиц целиком совпали, включая ID и receipts.
Ignored scripts/logs `.cache/r04-nutrition-baseline` содержат только synthetic data.

| Сценарий | SHA256 сериализованных rows |
| --- | --- |
| empty | `400d37d48ebfe81c84d5bc6380deb35f5853b8756627d13c4eb87b594980ba64` |
| observations | `7d8b562a93a7301d10905f76ebd6a617a9035c1d67b2ba520f12d3e6ff6911ec` |
| precision | `19cfc12de87232010f39d647123d9022442ae7b3d3ac56ae3bd734969fb09861` |

`r04:plans:test` 519/519, новые 10/10, исходные Nutrition+SourceJson 43/43.
Root/mobile TypeScript, scoped lint, source baseline73, boundaries596 прошли.
В профиле также прошли прежние ordinary native-field backup и candidate history
snapshot/fresh-isolate reader tests с заблокированными importer imports. Это не
production admission и не fullbackup private provenance/review.
Foundation/bundle/Hermesruntime/APK/Android не запускались.

## Осталось

Calendar portable writer, полное source coverage/preferences/lineage и Q/Plan
numeric JSON audit, постоянные Execution/provenance/review модели и schema gates,
композиция/cutover/пользовательский перенос, ordinary backup/restore всего результата,
normal3.x без importer, Android interruption/retry/low disk/concurrency/GC/power loss,
signing/release. Полная цель ACTIVE; R04 не DONE и готовность не 100%.
