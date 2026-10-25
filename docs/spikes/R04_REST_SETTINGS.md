# R04 — перенос настроек отдыха

2026-10-25; база `3c3be01`; R04→R03, Product §§48.5.7,49–50,53–56 / INT03–12.
Входы: admitted pinned source, Exercise aliases, Plans/templates/archives,
native builder recovery. Только private synthetic staging / `finalizable:false`.
Production DDL, реальная миграция, overlay/signing/release gates остаются OPEN.

## Контракт

Источник — `exercise.data.restSeconds`, целевое поле — `restSec` / `rest_sec`.
Отсутствующее значение переносится как прежние 120 секунд, числовой 0 — как
native `null` (таймер выключен), целые 1…1859 — без изменения. Поле `restSec` в
старом JSON не является подтверждённым alias: сохраняется raw и отмечается
`REST_SEC_NOT_SOURCE_FIELD`, но не заменяет `restSeconds` или прежний default.

Нечисловые значения неоднозначны: карточка 2.0 использовала проверку типа, а
обработчик завершения подхода — `Number(...)`. Например, `null` показывался с
default120, но превращался в 0 при запуске таймера. Такие значения, дроби,
отрицательные числа, -0 и значения выше1859 останавливают подготовку с внутренней
причиной `R04_ID_LEDGER_PLANS_REST_UNREPRESENTABLE`. Нет округления, обрезки,
coercion или назначения случайной длительности. Исходная копия не изменяется,
общая транзакция откатывается. Пользовательский экран разбора таких случаев ещё
не подключён; внутренний код не является текстом сообщения пользователю.

Общая проекция охватывает Simple, недельные overrides, periodized, templates и
архивы. Восстановленный черновик существующего упражнения сохраняет настройку
base, включая выключенный таймер. Новое упражнение старого черновика получает120.
Это намеренное сохранение настройки при восстановлении: старый draft-save helper
вообще не включал rest в новый exercise data. Default новых упражнений самой3.x
остаётся90. Выполненные подходы, даты, физические IDs и source facts не меняются.

Plans receipt содержит основание каждого значения и `restProjectionVersion:1`.
Node и async adapter используют одинаковый новый mode
`TRAINING_REST_SETTINGS_REHEARSAL_V1`. Старый private candidate отклоняется до
включения WAL; режим не добавляется к нему задним числом. Physical source JSON в
Plans receipt остаётся прежним, чтобы не нарушить зависимую Execution parity.
Новых таблиц, production DDL и видов идентификаторов нет; private schema84tables.

## Первичные источники

Все ссылки зафиксированы на одном commit 2.0
`e116b42e95f70a5a5e563420ab25394944c59ffd`:

- [TrainingExerciseScopeRepository.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/data/TrainingExerciseScopeRepository.ts):
  setter `restSeconds`, integer0…1859.
- [WorkoutExerciseLogCard.tsx](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/ui/WorkoutExerciseLogCard.tsx)
  и [RestTimerProvider.tsx](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/providers/RestTimerProvider.tsx):
  display getter, zero-off, default120.
- [SharedProgramWorkoutProvider.tsx](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/providers/SharedProgramWorkoutProvider.tsx)
  и [RestTimerCoordinator.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/model/RestTimerCoordinator.ts):
  completion handler coercion и runtime integer1…1859 guard.
- [exerciseSaveData.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/model/exerciseSaveData.ts):
  builder-save helper не сериализует поле отдыха.

## Границы доказательства

Новые7 tests покрывают default/off/bounds/неправильный alias, все формы Plans и
drafts, точность JSON, source capture, target tamper, before-WAL mode guard,
rollback/retry и потерю подтверждения COMMIT. Actual Expo adapters проверяются
через SDK mocks с реальным завершением host Worker до commit и restart/replay.
Это не Android/Hermes/process-death/power-loss проверка.

Отдельный тест переносит native Clients/Plans/Templates/drafts в полную
синтетическую3.x schema, создаёт и восстанавливает actual3.x backup. Fresh Worker
с importer-ban и positive probe читает, изменяет отдых и публикует старый черновик
через обычный repository. Проверены off/default/custom1859 и новый default90.
Это узкое доказательство native rest/drafts, а не полный перенос Execution,
custom catalog, private provenance/reviews, UI или удаление всего импортёра.

Финальный целевой запуск:85/85 PASS (новые7 + Plans/portable/archive/builders/
scope-lineages). Root/mobile TypeScript, scoped lint, source baseline73 и
arch619 PASS. Foundation/full R04 profile/bundle/APK/phone не запускались.

Полный goal остаётся ACTIVE: прочие semantic fields/legacy actor/unsupported
recovery, постоянные WorkData/Exercise/Execution/provenance/review модели,
production admission, UI/cutover, весь ordinary backup/removal, варианты входа,
Android interruption/low-disk/concurrency/GC и release gates ещё открыты.
