# R04: старые снимки training_workout_logs

2026-10-24, база `3015bdd`. R04 → R03; Product §§48.5.7, 48.44,
48.51–48.52, 49–50, 53–56, INT-03–12. Входы: замороженные Plans/Execution,
проверенные clients/catalog/plan aliases. Migration/production DDL/overlay/
signing/release gates OPEN. Изменён только private synthetic staging.

## Доказательство формата

Read-only legacy ref `Hwan-Karasu/fitcoach@e116b42e95f70a5a5e563420ab25394944c59ffd`:
[миграция021, строки119–240](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/021_training_sessions.ts#L119),
[sourcePriority/sourceVersionId](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/021_training_sessions.ts#L615),
[сохранение source_fact_id](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/021_training_sessions.ts#L694).
Эта миграция читает `exercises` как массив либо объект; элемент содержит массив
`sets` либо сам является массивом подходов. Cache ID конструируется из log ID,
exerciseId/id/ключа элемента и позиции подхода. В session metadata записываются
вид источника2 и физический ID снимка. Логические/name matchers старого SQL,
выбор удобной версии и восстановление дат по неделе не перенесены.

Наличие этих правил чтения не доказывает семантику неизвестного старого writer:
его подтверждение подхода, set.id/sourceFactId и logged_at нельзя автоматически
приравнять к современному факту/дате. Снимок не объявляется завершённой тренировкой.

Дополнительная проверка 2026-10-24: в просмотренных первоначальном/current
TrainingWorkoutRepository writer этой таблицы не найден. Найден
[LegacyJsonBackupImporter, строки192–203](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/backup/services/LegacyJsonBackupImporter.ts#L192),
который записывает workoutLogs.dataJson из резервной копии. Его
[схема, строки107–114](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/packages/validation/src/backup-schemas.ts#L107)
допускает произвольные свойства dataJson и не доказывает completion/identity
внутри них. Это объясняет путь появления строк, но не разрешает слияние их
вложенных подходов с current/history/archive по значениям или позиции.

## Реализация

- `training_workout_logs` — шестая optional Execution source table. Отсутствие
  остаётся null; при наличии требуются все известные столбцы, строки не фильтруются.
  Источник не мигрируется и не исправляется. Непонятная активная JSON/вложенная
  форма блокирует общую транзакцию вместо превращения в пустой массив.
- Каждый снимок имеет стабильный CONTEXT ID и полную исходную строку, включая
  исходный data_json, техническую дату и неизвестные поля. Удалённая строка
  сохраняется даже с нечитаемым JSON, без возрождения подходов. Отсутствующий
  текущий workout допускается; известная ссылка на чужого клиента блокируется.
- Представления подходов получают физические escaped JSON paths и source kind
  SNAPSHOT. Подтверждение и общий fact ID допускаются только при наблюдаемом
  cache source_fact_id, metadata sourcePriority2/sourceVersionId того же снимка,
  том же клиенте/account и точном физическом workout reference. Каталог берётся
  из явной ссылки снимка либо уже доказанного cache catalog, без поиска по имени.
- Разные log IDs с одинаковой составной строкой ID различаются по sourceVersionId.
  Повторённый exercise ID внутри одного снимка не позволяет доказать отдельный
  подход: при наблюдаемом cache alias блокируется неоднозначное объединение.
  Значения/сегменты/тип/усилие/RPE должны согласоваться с cache; конфликт откатывает
  всех владельцев. Факт учитывается один раз вместе с обоими provenance views.
- Без такого свидетельства значения остаются typed editable/confirmed:false.
  Полные числа, status/completedAt в неизвестном формате снимка и вычисленный
  составной ID сами по себе не создают факт. Снятое подтверждение/удалённый cache
  не возрождаются. Другой клиент не может подтвердить исходный снимок.
- Числовые JSON metrics в снимках и cache segments читаются с исходным токеном
  Node24 JSON reviver: `0.10000000000000001` не округляется до `0.1`. В исходной
  строке сохраняются исходные типы; typed metric view хранит точный текст токена.
  Недопустимая для exact converter точность/форма остаётся review либо блокирует
  подтверждённый факт. В частности, научная запись здесь не нормализуется.
- Общая транзакция, source receipt/SHA и target parity охватывают снимки.
  Binding V3 и snapshotProjectionVersion1 не принимают прежнее private задание
  за проверенное новое. Новых таблиц не добавлено; production D01 не изменён.

## Фактическая проверка

330/330 `r04:plans:test`, включая43 Execution tests (13 новых). Проверены форматы,
доказанный alias/недостающие metadata, составные ID, чужой owner/workout, различие
значений, numeric DROP segments, отсутствие/удаление/шаблон, malformed source.
Все23 границы общей транзакции теперь включают доказанный snapshot/cache alias:
полный rollback, Client IDs и чистый retry. Read-only source/reopen/reorder/
byte-identical target/стабильные IDs также проверены со снимком и его cache.
Замороженный input, source drift и отсутствие manifest version проверены.
Root/mobile TypeScript, ESLint изменённых файлов, source73, sensitive-files и
diff check прошли.

`finalizable:false`. Это сохранение и проверка ещё одного источника внутри private
стадии, не подключённый legacy restore. Полная семантика старого writer, соотношение
снимков с другими физическими ID current/history/archive, окончательные workout
identity/outcomes, production storage и приложение ещё требуют завершения.
Новые bundle/APK/native/телефон/fullfoundation проверки не запускались.
