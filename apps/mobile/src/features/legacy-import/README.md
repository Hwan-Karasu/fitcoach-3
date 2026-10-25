# Переходный импорт

Отдельная граница для будущего мобильного импортёра 2.0. Здесь переносимый разбор
точных чисел JSON, общее чтение Nutrition/Measurements/Calendar/Plans/Execution,
Clients/ExerciseCatalog/Questionnaire и
подготовка отдельной файловой копии. `public.ts` экспортирует source/copy contracts,
валидатор receipt и безопасную доменную ошибку, без SQL API.
Внутренняя `app/composition/stageLegacyImportCandidate.ts` собирает всех владельцев
в одну запись private staging, всегда `finalizable:false`. Пользовательский экран
и переключение активной БД ещё не подключены. Host-проверки R04 используют тот же
код; это не доказательство полного импорта на Android. Production migration/release
gates OPEN.

`app/composition/stageLegacyInspectionCandidate.ts` связывает sealed copy,
source admission и общий writer. Scope/workspace/SHA берутся из проверенного
источника; копия повторно проверяется до commit и после него. Возобновление
использует только private copy, без повторного обращения к выбранному файлу.
Изменение после commit оставляет исключительно неактивный private candidate.
Genuine empty source сохраняет `sourceWorkspaceId:null`, без выдуманного source ID;
такая identity не разрешает client rows/reservations. Workspace-specific Q/template
без наблюдённого workspace всё ещё требует отдельного разрешения source identity.

`domain/LegacyCandidateJob.ts` задаёт immutable request для продолжения после
перезапуска. `ExpoLegacyCandidateJobs` хранит его через partial → atomic rename
в `Paths.document/legacy-import-jobs/<job UUID>/request.json`, открывает исключительно
соседний `candidate.sqlite` с новым соединением. Незавершённые/повреждённые запросы
отличаются от готовых request; чужие пути не читаются и не удаляются.

`createLegacyCandidateRuntime`/`runLegacyCandidateJob` собирают реальные Expo
adapters: start сохраняет параметры, resume повторно читает request/copy/SQLite
receipts, сохраняет import time/reference day и committed IDs. Request не является
completed-state. Проверки request перед открытием, до commit и после него
не допускают verified результата при изменении параметров во время работы.
Это внутренняя Android-композиция, не пользовательский restore/cutover API.

`domain/SourceJson.ts` реэкспортирует общий `shared/migration/SourceJson.ts`.
Он использует стандартный JSON.parse для проверки синтаксиса
и создания объектов. Временные числовые теги выбираются без совпадений с исходными
строками, не выходят из функции и не сохраняются. Вторая разборка нужна потому,
что Hermes закреплённой версии не передаёт reviver исходное написание числа.
Значения первого разбора нужны только для проверки синтаксиса/коллизий; округлённые
числа из него никогда не передаются преобразователю. Исключения синтаксиса имеют
фиксированный текст без фрагментов пользовательских данных.

`data/LegacySourceReadPlans.ts` — общий алгоритм запросов для sync Node и async
SQLite. Сохраняет полные строки, null/empty, Calendar-owned settings и неизвестные
поля, проверяет shape/count. Непредставимые SQL INTEGER/нефинитные REAL блокируются
до передачи строк в JS. Пока это отказ от импорта, а не точное хранение таких
SQL-значений в модели 3.x; исходная копия сохраняется.

`data/LegacySqliteSource.ts` принимает фабрику нового Expo-совместимого соединения
с отдельной inspection copy. Проверяет connection pragmas, держит один read
transaction через выбранных владельцев, откатывает его и закрывает handle при любом
результате. Файловую копию готовит `LegacyInspectionCopy` с
`ExpoLegacyInspectionFiles`: новый UUID slot, hash до/после копирования, header,
проверка private bytes, закрытая копия и отдельный receipt. Чтение проверяет их
до/после SQLite; внешний файл SQLite не открывает. Перед бизнес-строками общий
`LegacyBackupReadPlans` проверяет canonical-v25 metadata, размеры/revision,
integrity/FK и согласованность manifest/account binding в том же read transaction.
AccountScope извлекается из источника. Это кандидат формата, не полная проверка
всех доменных связей/схемы и не готовый restore. JSON 2.0 и другие schema versions
этот путь ещё не читает. Production composition/Android gates остаются OPEN.
Не передавать внешний или рабочий файл прямо в readLegacyDomainSnapshots.

При удалении переходного импортёра из обычного выпуска 3.x эта граница может
удаляться целиком. Обычные читатели истории, её схема и резервное копирование
не должны зависеть от неё.

`LegacyTrainingReadPlans` читает программы/недели/тренировки/подходы, состояние
библиотек и архивы, сессии/сегменты/историю/снимки тренировок. Это те же полные
строки, что ранее собирал Node reader. Новый файловый путь после admission
читает программы и результаты в общем snapshot. Отсутствующие optional tables — null,
пустые — []; partial session store и wrong kind не скрываются. Преобразования
Plans/Execution и полный writer пока host-only: наличие raw mobile snapshots не означает готовую миграцию.

`LegacyProfileReadPlans` добавляет полные clients/exercise_catalog и все версии,
ответы, указатели и change history анкеты. File entry после admission теперь
собирает восемь владельцев в одной транзакции; partial questionnaire (в том числе
только change history) и view вместо таблицы блокируют чтение.

Чистые преобразования находятся у владельцев в `clients`, `exercises` и
`questionnaire`, внутри `domain/legacy-import/`. Общие входные контракты и значения —
`shared/migration/LegacyProfileSources.ts` и `LegacyValues.ts`. Node wrappers
исполняют те же mobile read plans и преобразования. Для SHA256 идентификаторов
анкеты используется существующая `@noble/hashes`; прежние UTF8 ID сохранены.
Эти файлы также относятся к удаляемому переходному импортёру, а не к обычным
читателям 3.x. Raw JSON остаётся исходной строкой; это не утверждение точной
переносимости всех числовых JSON-ответов в конечную модель.

Первый асинхронный writer — внутренний
`clients/data/legacy-import/LegacyClientStaging.ts`. Он использует общий с Node
`LegacyClientStagePlan` и existing isolated SQLite adapter: новый handle,
foreign keys до BEGIN IMMEDIATE, проверка принадлежности файла до WAL и повторно
под lock, ID reservation/client write/parity в одной транзакции. Входные raw client
rows копируются и перепроецируются до первого await. Чужой файл не пересоздаётся.
Результат `finalizable:false`: по умолчанию это частный client-only candidate mode,
его нельзя подключать как готовую восстановленную БД или расширять сменой binding flags.
Полный writer/composition/cutover и Android proof остаются следующими этапами.

`questionnaire/data/legacy-import/LegacyQuestionnaireStaging` предоставляет
неизменяемое расширение, передаваемое при создании нового staging job. Его schema,
mode tags и expected objects сразу входят в binding. Версии, draft, answers и
profile receipt записываются в той же tx после clients/IDs, до итоговой parity и
COMMIT. Client workspace index создаёт владелец клиентов; questionnaire writer не
импортирует другой feature. Асинхронные checkpoints ожидаются до продолжения tx.
Host profile writer использует тот же генератор, а composition перенесён в
questionnaire/domain/legacy-import. Ни client-only, ни profile-only job не
превращается в другой mode на месте. Полный набор остальных owners ещё не добавлен.

`clients/data/legacy-import/LegacyClientWorkDataStaging` добавляет заметки, метки,
назначения и PENDING_REVIEW записи через общий `LegacyClientWorkDataStagePlan`.
Он подключается после profile/Q расширения функцией `combineLegacyStageExtensions`;
порядок, зависимости, tags/objects фиксируются до создания job. Неверный порядок
или попытка добавить WorkData к существующей Q-only DB блокируются до записи.
Все owner stages используют один allocator и одну tx. Общий bridge helper
`LegacyProfileWorkData` извлекает прежние raw значения для Q receipt и client owner;
правила full profile validation, нормализации меток и сохранения note text не менялись.
WorkData пока записывается в private R04 owner-shaped tables. Это не утверждение,
что постоянная production модель, обычный backup, UI или Android уже подключены.

Каталог подключается `exercises/data/legacy-import/LegacyExerciseCatalogStaging`
после Q и WorkData. Он захватывает raw catalog и physical clients/workouts/
exercises/history из того же admitted snapshot. Общие read/table guards вынесены
в `shared/migration/LegacyReadPlan`; прежние entry points сохранены re-export.
Владение ссылками определяется по точным физическим ID; duplicate workouts и
исходные поля, совпадающие с join aliases, блокируются без затирания данных.
Общий registry write/parity/ID-read/candidate catalog-read plan использует и Node.
Неизвестные категории/оборудование не угадываются, используется LOAD_REPS.
Registry остаётся private R04 candidate, не production custom_exercises или cutover.

`training/plans/data/legacy-import/LegacyPlansStaging` добавляет Plans/Templates/
Archives после registry в ту же tx. Чистые projections/prescription находятся у
владельца plans; shared legacy kg→grams converter не зависит от execution feature.
Новые настоящие IDs назначаются в прежнем порядке pure projection, включая keys
дочерних template slots с реальным parent ID. Затем generator проверяет collisions
и сохраняет pending ID rows в SQLite до записи структуры. Placeholder/reproject
passes нет. Общий schema/write/parity/mapping-read plan исполняется также Node.
Опции templates/archives фиксируются при создании новой job; archive требует templates.
Структура не становится выполненной работой; неподключённый полный writer/cutover,
production admission и Android proof по-прежнему открыты.
