# R04: заметки и свидетельства состояния тренировок

2026-10-24, база `e93a4c8`. Task R04 → R03, Product §§48.5.7, 48.44,
48.51–48.52, 48.67, 48.84–48.86, 49–50, 53–56, INT-03–12.
Входы: замороженные Plans/Execution snapshots, проверенные plan aliases и
канонические source facts. Production/migration/overlay/signing/release gates OPEN.

`LegacyWorkoutContexts` сохраняет физические представления тренировок независимо
от наличия выполненных подходов: текущие, архивные и canonical cache строки 2.0.
В private R04 добавлена `r04_execution_contexts`, стабильный ID kind `CONTEXT`,
binding `TRAINING_EXECUTIONS_REHEARSAL_V2` и target manifest contextProjectionVersion1.
Это седьмая private Execution table вместе с IDs/receipt, не production DDL.

## Что записывается

- Клиент, account/workspace, источник и физический workout key; проверенная связь
  с plan alias. У свободной тренировки target план может отсутствовать. Название,
  совпадающий логический слот и одинаковые значения не объединяют контексты.
- Workout data.note и exercise data.diaryNote — отдельно от exercise.note,
  который остаётся указанием плана. Пустое/не заданное/явный null различаются.
  Строки не обрезаются и не trim-ятся. Недопустимый активный тип заметки вызывает
  полный rollback, не превращается в пустую заметку. Raw источники сохраняются.
- Ограничения D01 помечаются: отсутствующее поле общей заметки тренировки и
  превышение лимита текущих notes. Эти сведения не объявляются совместимыми с
  runtime записью. Восстановление/редактирование заметок в приложении ещё не сделано.
- Удалённое/шаблонное представление не становится активной фактической тренировкой.
  Заметки удалённого live представления остаются raw без интерпретации. Удалённые
  archive entries сохраняются в родительском Plans receipt; contexts не создаются
  из неподтверждённого содержимого. Это не исправление unreadable JSON источника.
- Root/cycle mirrors архивной тренировки используют один context ID после проверки
  обеих plan aliases. Сохраняются canonical и корневой raw paths/values. Разные
  архивы и текущий дневник имеют разные контексты даже при общем sourceFactId.
- session_id связывает контекст с уже доказанным графом выполненных фактов только
  по физическому source workout key. Notes-only/пустой/шаблонный контекст не создаёт
  такой session. Canonical session count не является числом проведённых занятий.
- Известная ссылка архива на чужую текущую программу помечает контекст
  OWNERSHIP_REVIEW; он не получает session_id и не меняет владельца на владельца
  чужой программы. Cache без подходов тоже не может сослаться на чужой workout.

## Состояние 2.0 и исход 3.x

Сохраняются raw status с признаком присутствия и отдельно результат наблюдавшегося
алгоритма live карточки 2.0: число полных подходов с completion marker, общее число
подходов и planned/in_progress/completed. Проверка полноты повторяет только
предикат card rule; исходные числа не округляются и не переписываются.
Архивный persisted status и live derived status могут различаться — это явно
отмечается. Нераспознанная метка остаётся review, canonical cache не считается
свидетельством исхода всей тренировки. targetOutcome остаётся null: эти
свидетельства не объявляются ручным подтверждением исхода 3.x.

Окончательное сопоставление исходов с runtime workout identity всё ещё требуется.
В частности, независимые даты фактов и несколько исторических представлений
графа нельзя молча свести к одной дате/одному исходу. Сохранение источников этих
решений здесь реализовано; окончательная нормализация и UI результата — нет.
Точный legacy ref и ссылки на исходники: [предыдущий аудит](R04_EDITABLE_EXECUTION_VALUES.md).

## Проверка

- 317/317 `r04:plans:test`, включая30 canonical Execution tests (8 новых).
- Notes-only, пустой свободный workout, длинный текст, instruction vs diary,
  current/archive differences, root/cycle aliases, template/deleted lifecycle,
  status conflict/cache ambiguity, foreign owner без facts, invalid note values.
- Все23 границы общей транзакции: полный rollback всех владельцев/Client IDs и
  чистый retry. Source immutable и read-only, target reopen, перестановка строк
  и порядка свойств объектов, повтор без allocator, byte-identical target и IDs.
- Guarded `loadExecutionDraftContexts()` проверяет общий manifest через fact/plan
  guards. Изменение notes/owners/ID/target rows или source не проходит; старые
  binding/schema/manifest не объявляются совместимыми автоматически.
- Root/mobile TypeScript, ESLint собственных изменённых файлов, source73,
  sensitive-files и diff check прошли. Runtime source не менялся: новые
  bundle/fullfoundation/APK/телефон/native проверки не запускались.

`finalizable:false`. Production D01, реальный legacy restore, рабочие команды
редактирования и остальные владельцы полного переноса не закрыты. Цель ACTIVE.
Параллельная работа над темами сохраняется отдельно от этого коммита.
