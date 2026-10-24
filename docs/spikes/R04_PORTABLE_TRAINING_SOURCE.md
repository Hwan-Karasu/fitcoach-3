# R04: мобильное чтение программ и результатов

2026-10-24, базаe1d7484. Входы: проверенные source collectors Plans10tables и
Execution6tables, текущие projections/staging/identity ledger. Зависимости R03/R04;
Product §§48.5.7,49–50,53–56 / INT-03–12. Production DDL/реальная миграция/overlay/
signing/release gates OPEN. Только synthetic private sources, без UI/телефона.

## Изменение

Типы/имена таблиц Plans и Execution перенесены в mobile LegacySourceSnapshots.
Новый LegacyTrainingReadPlans использует общий full-table reader предыдущего среза:
physical shape/xinfo/count/wrong-kind/unsafe SQL number guards, полный набор полей,
никаких JSON repair, фильтрации deleted/draft, default values или name joins.
Два старых Node source reader теперь исполняют этот же план запросов.
Plan/Execution projections, канонизация фактов, source keys и генерация IDs не менялись.

Plans сохраняет mandatory первые5таблиц и optional library/workspace/view/preference/
archive stores. Execution сохраняет шесть stores, required exercise_history,
optional session cache/segments/workout logs; из первых трёх session tables допустимы
либо все, либо ни одной. Частичный набор не считается пустой историей. View вместо
optional table больше не исчезает как якобы отсутствующий store. Источник остаётся
нетронутым; при отказе не возвращается частичный набор данных.

Raw rows сохраняют JSON ровно как строки, неизвестные столбцы, BLOB, NULL, исходные
индексы/ссылки/soft deletion. Переносимый read path не интерпретирует значения и не
превращает планы/снимки в выполненные факты. SQL unsafe integers/Infinity блокируются
до bridge, не округляются. Это отказ от неподдержанного source value, не его
постоянное хранение/отображение в3.x.

Low-level `readLegacyTrainingSnapshots` держит один private read transaction для
проверок/будущей композиции. Существующий low-level readLegacyDomainSnapshots
сохраняет прежний контракт трёх владельцев. Оба внутренние, без file routing.
Файловый `readLegacyInspectionCopy` после обязательного canonical25 admission
теперь собирает **все пять владельцев** в том же pinned transaction, затем проверяет
закрытый файл по receipt/SHA. Scope берётся из verified metadata, не из caller.

Synthetic metadata fixtures расширены настоящими читаемыми training fields вместо
id-only заглушек. Это тестовый source DDL, не target schema или migration. Остальные
коллекторы (в частности Clients/Catalog/Questionnaire) пока не portable; fixture
не заявляется полной production копией всех полей2.0.

## Доказательства

6 новых raw-source tests:

- Node==mobile full rows: два владельца с одинаковым названием, deleted program,
  draft с NULL weight, raw malformed archive/workout logs и точные JSON digits;
  unknown quoted column name/BLOB не теряются;
- optional missing отличается от empty; mandatory program/history absence блокирует;
- partial session store/wrong-kind view не скрывают данные; all-absent cache допустим;
- unsafe SQL set indices блокируются до SELECT *;
- реальный WAL concurrent writer меняет программу и session set между чтениями:
  оба владельца видят один прежний pinned snapshot;
- потеря строки в любом владельце обнаруживается count parity.

1 новый async→shared staging integration test: frozen-equivalent источники дают
5 canonical facts; receipt-boundary exception откатывает всех предыдущих owners,
retry/replay сохраняет факты/contexts/receipt/IDs, повтор не вызывает allocator;
FK target чистые. Это host staging, не mobile writer/native commit proof.

441/441 целевые owner/dependency проверки профиля r04:plans:test PASS.
52/52 initial training+Execution, 20/20 admission+copy PASS. Новые assertions в
admission/copy SDK fixture проверяют, что оба training snapshots доходят до
проверенного файлового входа. Root/mobile TypeScript, scoped lint, source73/
arch534/secrets/diff PASS. Полный foundation, bundle/APK/Hermes runtime/Android
не запускались. Вызовов к пользовательским файлам/БД нет.

## Открытый объём

Clients/Catalog/Questionnaire/identity/preferences/остальная coverage и lineage,
portable projections/writer, постоянная Execution/review/provenance модель,
schema admission/composition, полный ordinary backup/restore всех перенесённых
данных, JSON/other2.0 variants, Android interruption/retry, orphanGC/powerloss и
release-removal proof остаются незавершёнными. R04/D03 не закрыты, не100%.
