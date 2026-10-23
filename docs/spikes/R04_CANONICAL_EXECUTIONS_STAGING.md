# R04 — единые факты выполнений и точность дат

2026-10-23, база12381f4. TaskR04→R03, D03→D01/R04/R05; Product48.5.7,
33/39/46.6/46.19/49–50/53–56, INT03–12. Входы: Client/Q/WorkData/catalog/Plans/
templates/archives staging, raw session/current/history/archive и segment stores.
Migration/overlay/signing/release gates OPEN. Только synthetic rehearsal.

## Первичные источники

Readonly build120 e116b42e95f70a5a5e563420ab25394944c59ffd:

- [trainingSetFacts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/model/trainingSetFacts.ts)
  и [TrainingSetLogRepository](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/data/TrainingSetLogRepository.ts):
  completedAt следует полноте всех segments; DROP требует минимум2. Плановая правка
  сохраняет подтверждение, частичные значения не равны выполнению.
- [writeTrainingExerciseHistory](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/data/writeTrainingExerciseHistory.ts):
  рабочая история записывается для completedAt+полных segments; warmup отдельно
  не создаёт рабочую историю. historyOriginId сохраняет идентичность восстановления.
- [021_training_sessions](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/021_training_sessions.ts):
  persisted cache содержит отобранные факты, но мог подставлять estimated даты.
  Старый implicit completion относится к полным actual values без plannedReps/
  plannedWeight и без factCompletionExplicit. Его нельзя распространить на новые
  частично заполненные/явно неподтверждённые подходы.
- [022_imported_history_dates](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/022_imported_history_dates.ts):
  imported-unknown отделяет неизвестную дату от технического времени импорта.
  Мигратор читает имеющиеся метки; старый эвристический backfill не запускается.
- [TrainingExerciseHistoryRepository](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/archive/data/TrainingExerciseHistoryRepository.ts):
  ручное изменение даты отмечает exact, сохраняет старые часы либо добавляет полдень.
  Значит, такое действие доказывает DAY, а не точное время тренировки.

Старые name/metrics/date matching и выбор «последней удобной версии» не переносятся.
Все raw stores сохраняются в receipt, не переписываются старым кодом/триггерами.

## Реализованная запись

LegacyExecutionSourceReader читает все колонки session/exercise/set, current segments
и history в том же readonly snapshot, что Plans. Отсутствующий optional store=null;
из3 session tables допускаются все либо ни одной. Partial cache блокируется.
История сверяется с raw Exercise links, Plans — с source receipt предыдущего владельца.

LegacyExecutionOccurrences повторно разбирает raw и подтверждение, затем
LegacyExecutionProjection строит normalized facts, segments и связи представлений.
LegacyExecutionStage пишет6 частных r04_execution_* tables: IDs, sessions, facts,
segments, representations и receipt. Это предложение import-owner для сохранения
семантики; **не D01 training_sessions/training_performed_sets и не новая production DDL**.

executions:true требует всех предыдущих режимов и отдельного persisted binding
TRAINING_EXECUTIONS_REHEARSAL_V1. stageClientExecutions проводит весь pipeline одной
BEGIN IMMEDIATE. Старый job не присваивается новому режиму; укороченный entry point
не может обойти запись execution owner. Все входы клонируются до callbacks/allocator.

| Данные/сигнал | Правило |
|---|---|
| Source fact ID | Ключ account+client+ID; одинаковый ID другого клиента — другая цель |
| История без sourceFactId | Явный data.id старой записи может восстановить исходный physical ID |
| Архив без ID | Свой physical path; root/cycle mirror доказан отдельно. Нет cross-source merge по метрикам |
| Workout/session | Граф связей только по physical workout reference либо общему доказанному fact ID |
| Logical SIMPLE workout ID | Никогда не ключ dedup выполнений разных недель |
| Метрики | Exact integer reps/kg→grams; сравниваются все segments, тип, effort и непустой RPE |
| DROP | Один факт, отдельные mini-set rows; главный segment сверяется с базовыми колонками |
| Warmup | Свой факт; working_facts не включает разминку, итог COMPLETED не выдумывается |
| Partial/unconfirmed/template | Retained representation, без performed fact |
| Deleted representation | Не единственный источник положительного факта; raw сохраняется, конфликт lifecycle требует review |
| Имена | Все snapshot names сохранены; primary label имеет source basis, не заменяется текущим catalog name |
| Пустые имена | Не уничтожают доказанные метрики; nullable snapshot + compatibility marker |

Архивный source program другого клиента не доказывает владение фактами. Требуется
совпадающий ID и непротиворечивое подтверждение из current/session/history **того же
клиента**. Без него — OWNERSHIP_REVIEW без fact/session ID. Второй архив не заменяет
эту проверку. Outer client и live program не соединяются по имени/дате/общей книге.

## Даты

Typed precision: INSTANT, LOCAL_DATETIME, DAY, DERIVED, UNKNOWN. Неизвестные значения
не становятся текущим днём, полночью, временем создания программы или архива.
imported-unknown действует даже без importedAt и не превращает cached timestamps
в actual date. Явная ручная DAY correction приоритетнее старой import annotation.
Противоречащие ручные даты/точные instants блокируют запись без выбора победителя.

INSTANT сохраняет offset и все дробные цифры; сравнение не округляет до миллисекунд.
LOCAL_DATETIME не получает выдуманный offset. DERIVED хранит только estimated_date;
actual_date/timestamp=null. UNKNOWN сохраняет provenance/importedAt отдельно.
У INSTANT actual_date отражает день записанных часов; это **не утверждение о местном
тренировочном дне**. Перевод в бизнес-день/часовой пояс ещё требует runtime policy,
поэтому INSTANT_DAY_TIMEZONE_POLICY_REQUIRED запрещает считать D01 projection готовой.
Session first/last_known_date — обзор известных дат графа, не придуманный outcome.

## Проверки и незакрытые требования

- npm run r04:plans:test: **306/306**, включая19 новых execution tests и текущие
  Plans/archive/template/catalog/Q/client/preflight/domain dependencies.
- Синтетические12 representations становятся5 фактами/3 компонентами workout graph:
  одна запись имеет5 копий, другие недели/клиенты не сливаются; DROP сохраняет2 segments.
- Все22 границы Plans/archive/Execution/commit: полный rollback владельцев и чистый
  retry, включая Client IDs. Source read-only/hash unchanged; target reopen/reorder
  byte-identical и IDs reuse без allocator. Проверены cloning/shape/drift/conflicts.
- Guarded read сверяет facts/segments/representations/IDs и SHA256 полного source
  payload. Corrupt source receipt/target manifest/target rows не проходят.
- Root/mobile TypeScript, changed ESLint/source73/arch506/secrets/diff pass. Runtime source/production schema,
  APK/телефон/реальные базы не менялись; fullfoundation/bundle/native не запускались.

Текущий D01 требует известный день, ограничивает метрики и не хранит DROP/WARMUP
одновременно с failure effort. Canonical private rows сохраняют эти сведения без
обрезки; compatibility_json перечисляет ограничения, а не объявляет их решёнными.
Сюда же относятся unresolved physical identity/plan binding/snapshot label и lifecycle.
Количество private graph components **не объявлено** числом завершённых тренировок.
Исходы, execution notes, неподтверждённые editable values и runtime projections ещё
нужно полностью сопоставить. Конфликтующие snapshots не исправляются автоматически.

Далее: согласовать и реализовать runtime representation точности дат/identity/effort
в допустимых gates; закончить недостающие состояния/owners и full parity. Phase1
archives без workouts, unresolved catalog identity, extra template settings/variation,
WorkData/registry production wiring, runtime SQLite/JSON1/2 Restore и Android остаются.
finalizable:false, D01 facts created=0, общая цель ACTIVE, не100%.
