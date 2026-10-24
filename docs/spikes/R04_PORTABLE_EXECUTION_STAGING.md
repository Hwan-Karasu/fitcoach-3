# R04 — общий SQLite writer выполненных тренировок

2026-10-24, база `5332754`, отдельная ветка `work/r04-legacy-restore`.
R04 → R03; Product §§48.5.7, 49–50, 53–56; INT-03–12.

Входы: проверенные снимки Plans (10 физических хранилищ) и Execution
(6 хранилищ), карточки/устойчивые ID клиентов, registry/reference links,
проверенный reader сопоставлений программ. Предыдущие владельцы Profile,
Questionnaire, WorkData, Exercises, Plans/Templates/Archives обязательны.

Production DDL, реальная миграция, overlay APK, signing/release gates остаются
OPEN. Здесь только private synthetic candidate staging, `finalizable:false`.
Файлы пользователя и телефон не использовались.

## Реализация

Существующие чистые projection-модули подходов, дат, редактируемых значений,
физических представлений, контекстов и старых снимков тренировок перенесены к
владельцу `training/execution/domain/legacy-import`. Старые script paths теперь
re-export; правила объединения и дат не менялись. Точный JSON lexer перенесён
в `shared/migration/SourceJson`; прежний путь также сохранён re-export.
Тест обычного Nutrition reader без импортера дополнительно запрещает весь
`shared/migration`, включая новый путь lexer.

`LegacyExecutionStagePlan` содержит общий generator schema/write/parity/read.
Node wrapper и асинхронное SQLite-подключение выполняют один план. Семь CREATE
выполняются отдельными запросами внутри общей транзакции, SQL-схема прежняя.
SHA256 receipt теперь вычисляется установленным `@noble/hashes`; новых зависимостей
и изменений lockfiles нет.

Execution получает reader сопоставлений через shared port. Композиция передаёт
`legacyLoadPlanMappingsPlan(true)` владельца Plans: проверка всего plan receipt
выполняется в той же транзакции, без импорта чужого feature из Execution.
Контракты исходных Execution-строк и Plan mappings/target rows вынесены в shared.

Projection получает настоящие UUID в прежнем порядке. SQL-проверки коллизий и
резервирование новых ID выполняются после чистого projection и до записи его
таблиц/первого execution checkpoint. Нет временных ID и повторного projection.
Откат охватывает всех предшествующих владельцев, reservation, факты и receipt.

`legacyExecutionStagingExtension` захватывает исходные SQL cells до первого await,
фиксирует `TRAINING_EXECUTIONS_REHEARSAL_V3`, требует полную предшествующую
композицию и не переводит plan-only файл в execution mode. Loader проверяет
версии projection, SHA исходного payload, все пять целевых таблиц и ID ledger.

## Проверено

9 новых контрактных тестов используют настоящий SQLite через асинхронный
Expo-shaped port и `openIsolatedSqliteConnection`; это host tests, не Android.
Источник — синтетический файл canonical-v25 с admission metadata, анкетой
published/draft + ответом, WorkData, двумя клиентами, простыми/периодизированными
программами, архивными циклами, текущими подходами/историей/cache и workout log.

- Полная запись async совпадает с Node по всем таблицам, UUID и receipt.
  Шесть физических фактов: наблюдённая связь snapshot/cache даёт один факт;
  одинаковые значения без такой связи не объединяются. Сохраняются 20×10 кг,
  DROP + failure + RPE и два сегмента, частичный ввод 5 повторений/пустой вес,
  UNKNOWN без выдуманного времени. FK check пуст; source SHA не меняется.
- Все семь execution checkpoints и before-commit откатывают предыдущих владельцев;
  retry/reopen/reordered replay сохраняют ID и строки без нового allocation.
- Потеря подтверждения COMMIT и ошибка закрытия после commit допускают повтор
  без дублей фактов/контекстов. Проверяются освобождённые handles.
- Захват raw защищает от изменений до await и callback предшествующего владельца.
  Коллизия UUID, частичный session cache, history drift, другой Plans source и
  account scope не оставляют частичную запись.
- Неполная композиция отклоняется; plan-only файл отклоняется до настройки WAL.
  Drift фактов/сегментов/представлений/контекстов/сессий/ID/source/target receipt
  блокирует чтение и повтор, не перезаписывая данные.
- Сбой native CREATE/INSERT откатывает схему либо все owner rows; retry работает.
  Числовой JSON `2.5000000000000001` остаётся с исходной точностью и ошибкой
  редактируемого веса; округлённый выполненный подход из него не создаётся.

Независимая одноразовая проверка против именно прежнего writer из
`git show 5332754:scripts/r04/LegacyExecutionStage.ts` также прошла: baseline,
snapshot/cache, unknown-date и unsupported-precision сценарии совпали по всем
44 таблицам, включая строки ID и receipts. Исполнители сравнения находятся
в ignored `.cache/r04-execution-baseline`, содержат только синтетические данные.
SHA256 сериализованных результатов:

| Сценарий | SHA256 |
| --- | --- |
| baseline | `3008de70f97206d4568bd6578c8e7607cbba01f02ab665dc847cfa780901a6e7` |
| snapshot | `ec8008f43b077f5a87e33d7870886596890157e5825d90521ad93181b1dc4c6f` |
| undated | `884e6abbce2a175237274ad21557de609ac7d55d4c01b1b32ad71f635950ff0d` |
| precision | `1d0c4c893c79fa036052a252acdca46f6ec16d2d09c564035f13e10dee44080f` |

Проверки этого этапа: профиль `r04:plans:test` — 500/500; отдельно новые 9/9
и начальные Execution + SourceJson 54/54. Root/mobile TypeScript, scoped ESLint,
source baseline (73), module boundaries (581), sensitive-files check прошли.
Полный foundation, bundle/Hermes runtime, APK и Android не запускались.

## Осталось

Этот writer ещё не подключён к пользовательскому переносу. Действующая постоянная
модель должна получить допуск на UNKNOWN/DERIVED dates, editable drafts, контексты,
provenance/review и ограничения старых метрик; текущий D01 не покрывает всё это.
Нужны остальные portable writers, coverage/preferences/lineage, аудит JSON numeric
tokens в Q/Plans, постоянная схема и полная композиция/cutover, backup/restore всего
перенесённого результата, normal3.x без importer, Android interruption/retry,
low disk/concurrency/GC/power loss и release gates. Полная цель ACTIVE, не 100%.
