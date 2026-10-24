# Переходный импорт

Отдельная граница для будущего мобильного импортёра 2.0. Здесь переносимый разбор
точных чисел JSON, общее чтение Nutrition/Measurements/Calendar/Plans/Execution,
Clients/ExerciseCatalog/Questionnaire и
подготовка отдельной файловой копии. Модуль не подключён к композиции приложения
и не активирует перенесённую БД. Host-проверки R04 используют тот же код; это не
доказательство полного импорта на Android. Production migration/release gates OPEN.

`domain/SourceJson.ts` использует стандартный JSON.parse для проверки синтаксиса
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
Результат `finalizable:false`: это частный client-only candidate mode, его нельзя
подключать как готовую восстановленную БД или расширять сменой binding flags.
Полный writer/composition/cutover и Android proof остаются следующими этапами.
