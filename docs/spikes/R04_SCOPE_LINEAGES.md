# R04: связи для правок недель и участников

2026-10-25, база `c5efd03`. Входы: validated physical Plans rows, parent graph,
Exercise registry links и reciprocal shared membership. Зависимости: R03 fixtures,
Plans/archives projector, ID ledger, all-owner staging, обычные WeekEdit/3.x backup
ports. R04→R03; Product §§48.5.7,48.6,48.8,49–50,53–56 / INT-03–12. Production
DDL/migration/overlay/signing/release gates OPEN; private synthetic/finalizable:false.
Телефон, 2.0 и личные данные не открывались.

## Проблема

У native Periodized plan родство тренировок/упражнений определяет область правки
недель и участников. Раньше staging создавал отдельное родство каждой physical
source row. После переноса общие правки не находили соответствующие строки
других недель/копий. При этом их обычные IDs и фактические результаты должны
оставаться самостоятельными.

2.0 не сохраняет отдельный descendant lineage ID. Поэтому срез создаёт **новые
native edit groups по доказанной текущей семантике source-команд**, не заявляя
восстановление неизвестной исторической цепочки копирований. Чтение, факты и их
дедупликация не получают идентичность из названий, позиций или совпадающих чисел.

## Правила

- Source builder определяет workout scope по trim(name), persisted scope command
  дополнительно требует exact name/sort_index. Связь создаётся только в их
  однозначном пересечении: одна тренировка данного имени в каждой source week,
  совпадающие exact name и position. Различающиеся пробелы/positions или несколько
  таких workouts в одной неделе отмечаются WORKOUT_SELECTORS_DISAGREE либо
  WORKOUT_SCOPE_AMBIGUOUS, без объединения этих строк.
- Граница — одна physical source page/mesocycle. Общий book ID, текущая программа,
  одинаковые названия/каталог/метрики не связывают разные частные мезоциклы.
- Между клиентами разрешена только заранее проверенная shared page family:
  exact sharedGroupId, одинаковый reciprocal participant set с включёнными owners,
  не более одной page данного gid у каждого owner. Проверка вынесена до descendant
  projection; прежние SHARED_* guards не ослаблены. Отсутствующие участники не
  создаются, stale membership не реактивируется.
- Source shared navigation имеет более слабый by-index/name/first fallback.
  Миграция не объявляет его доказательством lineage: разное имя одного shared slot
  даёт SHARED_COUNTERPART_NAME_DIFFERS. Однозначные подгруппы внутри каждой page
  сохраняются, но source family не объявляется полностью сопоставленной.
- Exercise group определяется проверенным registry exercise ID **внутри workout
  group**. Один catalog exercise должен встречаться не более одного раза в каждом
  workout. Повторения одного catalog ID не спариваются по ordinal/весу/повторам:
  EXERCISE_SCOPE_AMBIGUOUS, отдельные lineage IDs, raw остаётся для разбора.
- Один catalog ID в разных тренировках получает разные edit groups. Имена
  упражнения, RPE, фактические значения или fact history origin не образуют связь.
- Для группы выбирается детерминированный physical anchor: source program,
  week index, physical ID. В существующем LINEAGE ledger используется его ключ;
  workouts/exercises/sets сохраняют **собственные** physical→native IDs. Source
  reorder/replay не меняет anchor/UUID. Нет placeholder IDs или второй проекции
  с подменёнными IDs.
- SIMPLE/template lineage не добавляется этим механизмом. Archive plan adapter
  использует ту же обработку внутри восстановленного snapshot; live shared group
  в архиве по-прежнему не реактивируется. Archive lineage metadata указывает на
  исходные archive JSON paths, не на временные adapter IDs.

После переноса native группы устойчивы к дальнейшим правкам по правилам 3.x.
Это материализация исходных областей применения в момент импорта; она не делает
native исторические факты общими между неделями или клиентами.

## Хранение и повтор

Projection version1 и scope metadata включены в точный Plans target receipt.
Raw physical source_json не меняет контракт для Execution. Новые aggregate counts
linkedWorkoutGroups/linkedExerciseGroups/lineageReviewGroups относятся к regular
source groups; archive basis хранится отдельно в metadata. Это не количество
перенесённых фактов и не показатель готовности всего переноса.

TRAINING_SCOPE_LINEAGES_REHEARSAL_V1 добавлен в одинаковый Node/mobile binding.
Older private candidate отклоняется до WAL, без upgrade/repair/overwrite. Общая
транзакция, parity, FK, source SHA и retry остались; новых production DDL, таблиц,
identity kinds или performed facts нет. Candidate по-прежнему84 tables.

## Первичные источники

Pinned `e116b42e95f70a5a5e563420ab25394944c59ffd`:

- [TrainingExerciseScopeRepository.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/data/TrainingExerciseScopeRepository.ts):
  client/program/exact workout name/position + canonical catalog exercise selector.
- [trainingWorkoutRows.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/data/trainingWorkoutRows.ts):
  canonicalExerciseIdentity, без fallback на имя для persisted scope command.
- [periodizedWeekOps.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/model/periodizedWeekOps.ts)
  и [programDraftSetFacts.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/model/programDraftSetFacts.ts):
  builder named scope и trim normalization.
- [sharedProgram.ts (application)](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/application/sharedProgram.ts)
  и [sharedProgram.ts (model)](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/model/sharedProgram.ts):
  shared clone/membership, counterpart fallback и очистка фактов при копировании.

## Проверки

scripts/r04-scope-lineages.test.ts: 12 новых tests. Full all-owner stage проверяет
однозначные недели/shared members, private pages одного book, разные workouts с
одним catalog ID, duplicate exercise/workout, несовпадение source selectors,
shared name fallback, stale membership, source reorder/UUID replay, checkpoints,
target tamper/before-WAL mode guard с positive control и source SHA.

Два physical source результата 20×10 с одинаковой датой остаются разными фактами.
Здесь b0 имеет явный source historyOriginId, b1 — другой собственный source fact ID:
повторение historyOriginId означало бы ту же запись, а не второй результат.
Правильный shared clone fixture очищает фактические/исторические поля, как pinned
writer. Prod guards CURRENT_CONFIRMATION_CONFLICT не ослаблены ради фикстуры.

Actual Expo adapters через SDK mocks + host Worker termination до commit:
rollback → restart без selected-source → replay без allocation, сохраняются7 facts.
Native Clients/Plans прошли actual 3.x snapshot/restore в полную синтетическую
ordinary schema. Fresh Worker с importer-ban и positive probe использует обычный
Plans repository: правка всех недель/двух участников проходит; последующая
индивидуальная правка сохраняется, при массовом изменении появляется1 conflict.
Physical exercise IDs/lineage IDs не меняются. Это не proof переноса всех Execution
facts в normal runtime, UI rendering, custom catalog или полного provenance/review
backup/removal.

142/142 targeted PASS, включая все12 новых, Plans/portable/archive/Execution,
builders/view/coverage dependencies. Root/mobile TypeScript, scoped lint, source
baseline73/arch619, secrets и staged diff PASS. Foundation,
full R04 profile/bundle/APK/Android не запускались. Goal ACTIVE, не100%.

## Следующая обнаруженная проблема и оставшийся объём

Pinned source setRestSeconds пишет **data.restSeconds**, integer0…1859.
[WorkoutExerciseLogCard.tsx](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/ui/WorkoutExerciseLogCard.tsx)
считает0 выключенным, при отсутствии number использует
[RestTimerProvider.tsx](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/providers/RestTimerProvider.tsx)
DEFAULT_REST_SECONDS=120. Текущий projector читает restSec и не переносит эту
семантику. Следующий mapping должен сохранить явные значения, zero-off и исходный
default120, без округления/обрезки и подмены на новый native default90. В этом срезе
rest mapping не менялся; raw поля сохранены, проблема не объявляется решённой.

Ещё открыты неоднозначные связи/прочие поля/legacy actor, постоянные WorkData/
Exercise/Execution/provenance/review модели, production admission, UI/cutover,
полный ordinary backup/removal, JSON/другие variants и Android interruption/
low-disk/concurrency/GC/release gates.
