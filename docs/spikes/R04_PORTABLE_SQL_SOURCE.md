# R04: общее чтение источника для mobile и host

2026-10-24, база 99c318f. Входы: полные строки шести Nutrition stores,
client_measurements/client_day_facts, calendar_appointments и Calendar-owned key
app_settings. Зависимости R03/R04; Product §§48.5.7,49–50,53–56 / INT-03–12.
Production DDL, реальная миграция, overlay, signing/release gates OPEN.
Работа только на синтетических private источниках. Нет activation/cutover/phone.

## Что изменилось

Типы snapshots/наборы полей перенесены в mobile `legacy-import/domain`.
`LegacySourceReadPlans` — один алгоритм сбора полных строк в виде generator
плана read-only SQL-запросов. Node synchronous executor и mobile async executor
исполняют один и тот же план. Старые три source collectors теперь тонкие обёртки,
которые сохраняют прежние точки импорта и shape результатов для staging.
Не создаётся вторая независимая реализация правил чтения для Android.

Общий план проверяет вид объекта/обязательные физические столбцы/число строк;
optional absence остаётся null, present empty — []. Представление не считается
отсутствующей таблицей. Возвращаются полные строки, без нормализации/JSON repair/
обрезания/подстановки default. Неизвестные столбцы, raw malformed JSON и BLOB
сохраняются в исходном снимке; это не доказательство их постоянного хранения 3.x.
Settings читаются только по Calendar-owned key, остальные ещё не покрыты.

Перед выдачей строк SQLite проверяет, есть ли INTEGER за пределами JS safe integer
и REAL ±Infinity. Если есть — `R04_SOURCE_SQL_NUMBER_UNREPRESENTABLE`, без округления
и передачи повреждённого значения дальше. Это консервативный отказ от импорта,
а не полноценное точное представление таких SQL-значений в постоянной модели.
Текстовые десятичные значения не меняются; JSON numeric tokens сохраняются ранее
добавленным SourceJson. Исходная копия не изменяется и остаётся доступной.

Для проверки всех видимых столбцов используется `pragma_table_xinfo`: обычный
table_info пропускает generated columns, хотя SELECT * их возвращает. Поэтому
unsafe INTEGER в дополнительном generated column тоже не проходит в JS. Имена
столбцов экранируются как SQL identifiers; значения фильтра передаются bindings.
Известные обязательные поля должны быть физическими столбцами legacy shape.

## Асинхронное соединение

`readLegacyDomainSnapshots(open, accountScope)` принимает фабрику отдельного
нового соединения с **inspection copy**, совместимого с установленным
`Pick<expo-sqlite.SQLiteDatabase, getAllAsync | execAsync | closeAsync>`.
Настраивает и проверяет query_only=1, foreign_keys=1, read_uncommitted=0,
trusted_schema=0. Затем BEGIN без write reservation и первый schema read фиксируют
снимок; все три домена читаются до ROLLBACK/CLOSE. Нет journal_mode/WAL switching,
миграций, DDL, записей или открытого SQL handle в результате.

Native open/read/configuration exceptions заменяются фиксированным кодом без
имени файла/исходного содержимого. Ошибки shape/coverage сохраняются. При ошибке
ROLLBACK или closeAsync результат не возвращается как успешный; первоначальная
ошибка чтения не скрывается ошибкой cleanup. Close всегда предпринимается.

Это **внутренний data adapter**, не public restore API. Expo SQLiteOpenOptions
установленной версии не содержит readonly flag; query_only не защищает сам факт
открытия произвольного файла или обращения к его sidecars. Поэтому caller обязан
сначала создать свежую private inspection copy и подтвердить её допуск, hash,
владение и неизменяемость. Такого production caller/файлового допуска ещё нет.
Передавать picker/SAF source или working database прямо в open нельзя.

Локальная первичная проверка установленного исходника: expo-sqlite SQLiteOpenOptions
в `src/NativeDatabase.ts`; INTEGER → JLong в Android NativeStatementBinding.cpp;
JLong разворачивается и long/long long преобразуются в double в
expo-modules-core JNIToJSIConverter.{cpp,h}. Это анализ установленного кода,
не наблюдение моста на телефоне.

## Проверки

9 новых portable-source tests и одна интеграционная проверка в Calendar suite:

- async и sync дают одинаковые full snapshots, включая странное имя столбца,
  BLOB, неизвестные поля, malformed JSON, null/empty, scoped settings;
- реальный host SQLite WAL writer меняет вес и календарь между чтениями:
  Nutrition/Measurements/Calendar видят один прежний снимок;
- ошибка на каждой наблюдаемой границе native configure/read/BEGIN приводит
  к close, исходные bytes неизменны; повтор новым handle даёт прежний результат;
- оба executor блокируют unsafe integers/Infinity до SELECT *; generated column
  также проверяется, MAX_SAFE_INTEGER допускается без изменения;
- wrong kind/shape, missing rows и несовместимые pragmas не маскируются;
- ошибки ROLLBACK/CLOSE сообщаются без утечки исходной native ошибки и без
  потери предыдущей ошибки чтения;
- mobile async snapshots подаются в существующий общий staging: receipt-phase
  failure откатывает предыдущих владельцев, retry/replay сохраняет IDs/receipt,
  повтор не вызывает allocator, credit ledger остаётся пустым/finalizable:false.

687/687 area+dependencies PASS. После проверки generated columns — последние
74/74 source+Calendar/Measurements/Nutrition PASS. Root/mobile TypeScript,
scoped lint/source baseline73/arch528/secrets/diff PASS. Три новых mobile modules
скомпилированы локальным закреплённым hermesc в HBC. Это syntax/host adapter proof,
не Hermes execution, Android bridge, process death, source-format admission,
полная миграция или полный foundation/bundle/APK.

## Оставшийся объём

Остальные source collectors ещё Node-specific. Сам mobile staging/writer,
постоянная Execution/review/provenance модель, coverage настроек/lineage/unknown
values, schema admission/composition, backup всех перенесённых данных, полное
восстановление SQLite/JSON 2.0, Android interruption/retry и release-removal proof
остаются открытыми. Этот срез убирает дублирование трёх source readers и даёт
проверяемый мобильный data path к существующему staging, не закрывает D03/R04.
