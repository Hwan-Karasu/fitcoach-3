# R04 — структура архивных программ 2.0 в staging

2026-10-23; входная база74fa6cf. Task R04→R03, D03→D01/R04/R05.
Вход: полный Plans snapshot, Client/Exercise IDs, Client/Q/WorkData/catalog/Plans/
templates staging. Product §§48.5.7,48.28,48.39,49–50 (особенно50.1–50.3),53–56;
INT03–12. Открыты migration/overlay/signing/release gates. Только isolated synthetic
rehearsal, finalizable:false. Production DDL, реальная база и Android не менялись.

## Источник и граница семантики

Readonly build120 e116b42e95f70a5a5e563420ab25394944c59ffd:

- [archiveTypes](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/archive/model/archiveTypes.ts)
  описывает snapshots: недели, тренировки, упражнения, подходы, settings, cycles.
- [buildTrainingArchiveSnapshot](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/archive/model/buildTrainingArchiveSnapshot.ts)
  сохраняет план вместе с actual strings/segments/completion. sourceFactId берётся
  из historyOriginId либо исходного set.id. Это происхождение, не новая идентичность.
- [archiveTrainingProgram](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/archive/application/archiveTrainingProgram.ts)
  объединяет всю книгу: root weeks/workouts повторяют циклы, weekIndex смещён
  на длину предыдущих циклов. После snapshot старые страницы tombstone.
- [TrainingArchiveRepository](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/archive/data/TrainingArchiveRepository.ts)
  задаёт outer client_id/lifecycle. Его fallback corrupt JSON→empty не переносится.
- [restoreTrainingProgram](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/archive/application/restoreTrainingProgram.ts)
  после успешного legacy restore удаляет архивную запись. Старое автоматическое
  переключение active program не переносится: Product50.2 требует сохранить выбор.

Этот срез создаёт **архивный план**, но не canonical Training executions. Доказанное
совпадение root/cycle используется для одной структуры плана и aliases. Оно само
по себе не доказывает факт выполнения и не заменяет sourceFactId dedup между
session/current/history/archive. Actual данные остаются доступны в исходном виде.

## Преобразование

LegacyArchivePlansProjection создаёт только локальные adapter rows для повторного
использования уже проверенной Plans projection. Это не физические legacy rows.
Их IDs находятся в отдельном archive-plans namespace; совпадение текста source ID
с live row не объединяет цели. В r04_plan_source выходят **оригинальные** raw archive
rows и точные JSON paths, а не adapter payload. Plan bases также возвращаются к
оригинальным paths. Synthetic library metadata не выдаётся за старую library row.

| Источник | Целевая структура |
|---|---|
| Live archive entry | Своя Program/member, archived_at исходный; никаких selection rows |
| periodized cycles | Мезоциклы в порядке cycles; свои недели/типы и плановые descendants |
| periodized root без cycles | Один мезоцикл из полного root snapshot |
| free root | SIMPLE base + настоящие weekly overrides, включая разные prescriptions |
| Root/cycle mirrors | Общие target plan IDs, отдельные source paths и точный raw |
| Root weekIndex с offset | Сохранён raw; alias содержит соответствующий local target weekIndex |
| Явные templateExerciseId/data.catalogId | Проверенный imported registry ID; конфликт/missing/unknown блокирует |
| Plan JSON | Exact reps/ranges/RIR/kg→grams/instruction/rest; actual не становится планом |
| Warmup/actual/segments/completion | Raw provenance; warmup не становится planned working slot |
| Deleted archive | Retained raw, без Program и без оживления повреждённого payload |

Outer archive client определяет владельца архивного плана. Старый source programId
может указывать на исходную общую страницу другого клиента; это не join на его
живую программу, участников или факты. Старые sharedGroupId/participantIds остаются
в raw, не создают живую группу. Для будущих фактов требуется отдельное подтверждение
account/client/sourceFactId; этот срез их не создаёт.

Target root/page created_at явно означает создание реконструированной структуры
в import time, а не неизвестную старую дату программы. Исходный archived_at хранится
отдельно. Даты тренировок не синтезируются из archive/import timestamps.
Одинаковые заголовки разных archive entries не сливаются.

Если cycles присутствуют, root weeks/workouts должны точно совпадать с их
конкатенацией и смещением недель; сравнение JSON учитывает значения и порядок
массивов, не порядок object keys. Count/completedCount/недельные counts сверяются.
Нельзя выбрать одну конфликтующую копию и молча отбросить другую.
Обход зеркал использует список pointers каждой страницы, без полного повторного
сканирования всех страниц; большие списки не передаются spread-аргументами push.

## Транзакция, retry и доказательства

archives:true требует всех предыдущих режимов, включая templates:true. Persisted
TRAINING_ARCHIVES_REHEARSAL_V1 отклоняет старые jobs без пересборки/присвоения.
stageClientPlans добавляет архивы к тем же11 D01 tables и r04 IDs/source/receipt
в общей BEGIN IMMEDIATE с Client/Q/WorkData/catalog/live Plans/templates. Перед
commit — полная сверка заявленных rows, ID ledger, source и FK/integrity.
loadPlanDraftMappings проверяет архивные aliases тем же manifest. Не заявленные
draft/history rows остаются пустыми. Числа архивов и зеркал включены в receipt
только этого режима, прежние plans/template manifests не меняются.

- npm run r04:plans:test: **287/287**, включая15 новых archive-stage tests,
  прежние Plans/template/domain/dependency tests и24 archive/fact-ledger preflight.
- Production readMesocycles/readStructure/readSimpleWeeks читают actual staged
  D01 rows: архивная книга с2 циклами, typed weeks, SIMPLE weekly differences.
- Все16 границ allocation/tables/source/receipt/commit: injected failure откатывает
  Client/Q/work/catalog/live plans/archive сразу; retry создаёт единственный результат.
- Source открыт read-only/query_only; hash не меняется. Reopen/reordered replay
  сохраняет target file byte-identical и все IDs, без вызова allocator.
- Проверены lifecycle/owner/count/JSON/refs/conflicting mirrors, отсутствие optional
  archive table, deleted payload, unchanged selection, separate same-title entries,
  colliding live source text ID, target/source drift и mode/dependency binding.
- Root/mobile TypeScript, changed ESLint/source73/arch506/secrets/diff pass. Full foundation/APK/bundle/нативные
  проверки не запускались; runtime source приложения не менялся.

## Не закрытые требования

Canonical executions/sets/segments/date precision и sourceFactId dedup ещё не
реализованы. targetFactsCreated=0. Несколько source representations нельзя считать
разными выполнениями; их возможные разные plan-view contexts ещё нужно сопоставить.
Restore archive action 3.0 и backup/restore2.0 runtime этим срезом не подключены.

Требуется полный snapshot с workouts/exercises/sets. Старые phase1 archives могли
не сохранять workouts вообще: этот случай пока блокируется без изменения источника;
не объявлен пустой успешно перенесённой программой. Нужна проверка возможности
восстановить структуру по сохранённым week IDs и tombstone rows, либо явный учёт
действительно отсутствующей в источнике информации. Неизвестные упражнения без
явного catalog ID также требуют отдельной модели unresolved identity, а не name match.

Source orphan library/workspace/view/preferences/annotations и historical classification
сохраняются raw, но не все являются операционными свойствами. Полное покрытие SIMPLE
templates и их extra settings, остальные owners, production WorkData/registry wiring,
full staging/parity/runtimeSQLite/JSON1/2 Restore/Android остаются открытыми.
Частная r04 DB не публикуется как fitcoach_v3.db; общая цель ACTIVE, не100%.
