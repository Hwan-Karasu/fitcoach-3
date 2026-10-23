# R04 — книги, мезоциклы и плановые подходы 2.0 в staging

Продолжение2026-10-23: отдельный templates:true теперь пишет D01 шаблоны в той же
транзакции. Ниже зафиксирован исходный plans-only режим; актуальный дополнительный
контракт, доказательства и ограничения — [R04_TRAINING_TEMPLATES_STAGING.md](R04_TRAINING_TEMPLATES_STAGING.md).

Дата2026-10-23; база b077518. Task R04→R03; D03→D01/R04/R05.
Вход: Client/Exercise maps, Q/WorkData/catalog, raw plan tables, job time.
Product §§48.1–48.5.7/48.6/48.10/48.28/48.39,33,39,46.6/46.19,49–50,53–56;
Feature09/18. Migration/overlay/signing/release gates OPEN. **Synthetic rehearsal,
не production migration**. Новая production DDL, телефон и личные файлы не менялись.

## Подтверждённый источник

Readonly build120 e116b42e95f70a5a5e563420ab25394944c59ffd:

- [025_program_library.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/025_program_library.ts),
  [ProgramLibraryRepository](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/data/ProgramLibraryRepository.ts):
  root книги — client_id + COALESCE(NULLIF(book_id,''),id); library PK=(client_id,id).
- [TrainingProgramRepository](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/data/TrainingProgramRepository.ts),
  [bookPageOrder](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/model/bookPageOrder.ts):
  отдельные строки periodized program — страницы мезоциклов, порядок pageIndex/createdAt.
- [sharedProgram](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/model/sharedProgram.ts):
  sharedGroupId/participantIds относятся к копиям страниц, не книгам целиком.
- [setLogPlan](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/model/setLogPlan.ts),
  [exerciseDraftSetLogs](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/model/exerciseDraftSetLogs.ts),
  [saveSimpleProgram](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/application/saveSimpleProgram.ts):
  prescription в JSON plannedReps/targetReps/plan, plannedWeight/targetWeight и defaults
  упражнения. Колонки reps/weight/completed_at — факты. Simple материализует копии недель.

## Запись и семантика

LegacyPlansSourceReader читает raw program/week/workout/exercise/set и опциональные
library/workspace/view/preferences/archive rows в readonly snapshot. Отсутствие
опциональной таблицы — null. Shape/counts проверяются; JSON/triggers/auth не ремонтируются
и не воспроизводятся. LegacyPlansProjection повторно разбирает raw graph.

LegacyPlansStage использует настоящие текущие D01 TrainingPlans definitions только
в частном стенде. r04_plan_ids/source/receipt сохраняют maps, весь raw и target manifest.
plans:true требует profiles/questionnaires/workData/exercises:true; persisted binding
TRAINING_PLANS_REHEARSAL_V1. stageClientPlans пишет всех владельцев одной BEGIN IMMEDIATE.
Старые rehearsal-файлы не присваиваются новому режиму и не пересобираются.

| Source | Target/правило |
|---|---|
| Client-scoped library/book | Свои Program/member; одинаковый book ID другого клиента не сливается |
| Активная periodized program row | Свой mesocycle; порядок страниц сохранён, ID не зависит от позиции |
| sharedGroupId + согласованный participant set | Общее mesocycle lineage в разных программах; конфликт состава блокируется, вышедший участник не возвращается по одному gid |
| Periodized week/workout/exercise | Стабильные IDs/FK/номер/тип; неподтверждённое родство потомков не угадывается |
| free program | SIMPLE base + overrides других недель с отдельными physical exercise/set IDs |
| Повторяемый simple workout ordinal | Logical workout ID + разные weekIndex; это slot-связь плана, не dedup фактов |
| Plan JSON | Exact reps range/RIR/kg→grams; missing→null, не ноль; без working logs — только явный setCount |
| Actual values/warmup/deleted/template/free standalone | Raw + disposition для последующих владельцев; не выдуманные prescription/session |

Source pageIndex и весь raw сохраняются; target position — ранг исходного порядка.
Неоднозначные позиции/непредставимые значения/точность/имена/недели не обрезаются.
Deleted duplicate position не становится вторым active slot. RIR берётся из упражнения,
затем JSON первого активного set по legacy accessor; actual RPE не становится RIR.
Плановое указание и superset сохранены. Неизвестный per-exercise rest=null; timer
preferences этим не объявлены перенесёнными. Actual reps/weight/completion остаются raw
для Execution и не подменяют план.

Simple overrides сохраняют разные названия/упражнения/значения по неделям. SIMPLE
week target ID не выдумывается: source alias указывает program+weekIndex. Разный набор
workout ordinals по неделям пока не представим текущей schema и блокируется, не скрывается
base неделей. Mesocycle groups используют существующий Placement/MesocycleGroupStore.

Library archive не выбирается автоматически. Workspace active_program_id переходит
в точный root/mesocycle; неразрешённый выбор сохраняется UNRESOLVED_NOT_SELECTED без
fallback к соседу. Header date — source library; без library создаётся новый container
с явным import time/provenance, не выдуманной старой датой книги.

Retained deleted/warmup source aliases также сохраняют доказанную client-owned
книгу и номер недели, если такой root уже существует. Это контекст для дальнейших
фактов/архивов, не создание активной плановой сущности; targetId остаётся null.

## Проверки

Все columns/ID ledger/receipts и FK/integrity проверяются перед commit.
Родительские индексы и active lifecycle cache строятся один раз: для каждого
упражнения не сканируется заново весь набор старых подходов.
loadPlanDraftMappings выдаёт source aliases после повторной сверки plan tables,
source rows и IDs с manifest. Replay без UPDATE/REPLACE/новых UUID/дат; drift не лечится
перезаписью. Допущенный raw скопирован до callbacks.

- npm run r04:plans:test — **230/230**,18 новых plan tests плюс общий ledger, source
  structure/metrics, Client/Q/WorkData/catalog и обычные plan-store dependencies.
- Actual D01 synthetic:3programs/3mesocycles, разные client headers с одинаковым book ID,
  shared copies, SIMPLE overrides, Q/work/catalog. Production readMesocycles/readStructure/
  readSimpleWeeks/groupOfCopy читают staged rows; отдельный тест с custom Q history/answer.
- **14 injected failure checkpoints**: IDs, каждый из10 plan tables, source/receipt,
  перед commit. Всё откатывается вместе; retry проходит. Source SHA unchanged;
  target reopen/reordered replay byte-identical; target drift/missing IDs не перезаписываются.
  Это host exception proof, **не Android process death**.
- Root/mobile typecheck, changed ESLint, source/arch506/secrets/diff. Тест включён
  в r04/foundation. Fullfoundation/APK/bundle/Android fixture не запускались:
  runtime в этом срезе не менялся. Телефон/2.0/личные файлы untouched.

## Остаток полной цели

finalizable:false. Archives/template pages/deleted structure/free standalone сохранены
как source, не законченные operational records. Orphan library/workspace state/view/
preferences имеют deferred counts и полный raw. Историческая классификация, workout
annotations, остальная metadata/actor selection и неподтверждённое descendant lineage
ещё требуют mapping. Сохранение raw не объявлено законченным переносом этих владельцев.

Дальше реальные архивы/шаблоны и canonical Training facts с source fact dedup/segments/
date precision, остальные домены/full staging/parity/retry, runtime SQLite/JSON v1/v2
Restore и Android. Production WorkData/imported registry schema/commands/backup/deletion
wiring OPEN. Частная r04_* DB не fitcoach_v3.db и не публикуется common snapshot engine.
Общая цель ACTIVE/gates OPEN, не100%; UI/темы позже, Excel после backup/restore.
