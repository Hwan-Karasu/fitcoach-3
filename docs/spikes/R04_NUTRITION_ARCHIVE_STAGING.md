# R04: исторические недельные снимки питания

Продолжение: [самостоятельная модель 3.x и candidate storage/backup proof](R04_NUTRITION_HISTORY_STORAGE_CANDIDATE.md).
Production admission и подключение остаются OPEN; ниже исходный private staging.

2026-10-24, база b048d05. R04→R03; Product §§49.5, 49.14–49.24,
49–50, 53–56; INT-03–12/15. Входы: frozen полные nutrition_archive_weeks,
проверенная client ID map, snapshots Nutrition/Measurements и все предыдущие
владельцы. Production DDL/migration/overlay/signing/release gates OPEN.
Только synthetic private staging; finalizable:false.

Исходная D01 не имеет storage для недельных исторических снимков. Этот срез
готовит их отдельное представление с устойчивыми ID в private job. Это не
разрешает добавление production DDL и не означает перенос архивов обычной копией
3.x. Production representation, включение в обычный backup и UI ещё обязательны.

Проверенные read-only источники на exact ref
Hwan-Karasu/fitcoach@e116b42e95f70a5a5e563420ab25394944c59ffd:

- [006_client_history_archive](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/006_client_history_archive.ts):
  physical week ID/client/period/saved_at, отдельные REAL aggregates и days_json.
  Начальный days_json='{}' означает отсутствие подробностей, а не семь дней нулей.
- [NutritionHistoryRepository](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/data/NutritionHistoryRepository.ts):
  дневные поля из JSON принимались только как числа, строковые числа не доказывают
  прежний факт. Ошибки чтения раньше превращались в пустой массив; это не повторяется.
- [nutritionHistory](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/model/nutritionHistory.ts):
  различает days и legacy residual aggregates; более поздние снимки и текущие
  данные могли перекрывать поля. Этот алгоритм не становится нормативной логикой 3.0.

## Реализация

LegacyNutritionArchive сохраняет физическую версию недели и каждый элемент массива
days_json с устойчивым UUID. Week identity: account/table/client/physical week ID;
day identity: неделя + исходная позиция массива. Дата/значения/название не служат
matcher. Повторные даты сохраняют отдельные IDs и DUPLICATE_DAY_DATE; сведения
другого клиента имеют независимые IDs и не попадают в чужую выборку.

Числа имеют ABSENT / UNKNOWN / VALUE / UNSUPPORTED. VALUE хранит sourceDecimal
текстом: JSON token не округляется JS Number и не подгоняется под точность D01.
SQLite REAL сохраняется через прочитанное числовое значение; прежнюю строку ввода
из REAL не восстанавливаем. Zero/null/absence различаются. Строковые числа JSON и
объекты не принимаются за числовые факты. Отрицательное/нефинитное/неподдержанное
значение получает issue; оригинал остаётся в полном source receipt.

Это архивные наблюдения, не валидированные современные дневные факты. Дробные
средние/большие значения/точные дроби остаются в архиве. Не создаются Measurement/
FoodDiary/Workout/Calendar/Credit, недельные средние не распределяются по дням.

Даты элементов, период и saved_at проверяются отдельно. Неизвестные даты остаются
null с причинами, время импорта не подставляется. Перевёрнутый период помечается,
не исправляется. Label сохраняется как есть. Неизвестные поля остаются в raw.
ARRAY / LEGACY_EMPTY_OBJECT / ABSENT / UNSUPPORTED различаются. '{}' — старый
DDL sentinel без подробностей. Ошибка JSON не стирает агрегаты; некорректный элемент
массива сохраняет позицию/ID/причину. Ошибки allocator/identity не перехватываются
как ошибка JSON, а откатывают транзакцию.

Перекрытия периодов одного клиента имеют ссылки на archive IDs. Присутствие текущих
nutrition_days/client_day_facts внутри периода отмечается датой и source stores;
это не доказательство равенства/дубликата фактов. Нет last-write-wins, слияния по
startDate или суммирования с дневником. Старый merge алгоритм не переносится в 3.0.

## Запись, чтение и предел доказательства

Private r04_nutrition_archive_weeks хранит ID/workspace/client/sourceKey/payload JSON,
FK на клиента. ARCHIVE_WEEK/ARCHIVE_DAY входят в общий ID ledger/collision guards.
Полные source rows/столбцы сохранены. Archive rows/IDs/representations включены в
source SHA/manifest SHA/full target parity. Запись в общей транзакции после всех
предыдущих владельцев, frozen source до callbacks. Сбой откатывает весь job.

NUTRITION_REHEARSAL_V3/projectionVersion3 отклоняют старые private jobs без
автоматической пересборки. loadNutritionDraftArchiveWeeks требует mapped target
client; проверяет предыдущих владельцев/SHA/parity и возвращает только его архивы.
Неизвестный target client не становится пустой успешной выборкой.

Каждый архив имеет ARCHIVE_PRODUCTION_STORAGE_REQUIRED; nutritionArchiveWeekRows
не означает production готовность. nutritionNativeTables — прежняя D01,
nutritionTargetTables включает private archive. Старый ordinary backup proof
покрывает только native facts и явно проверяет отсутствие архивов в fixture.
Он не доказывает прохождение private archive через обычную копию 3.x.

601/601 area+deps: R04 Plans/previous owners, measurements projection/preflight,
SQLite backup, Nutrition catalog/recipes/diary/edit/energy/stats/calc store/targets/
calc. Восемь новых archive tests, 30 Nutrition total. Exact tokens сверх safe integer/
длинной дроби, zero/null/absence/string-number, повторные/неверные даты и элементы,
повреждённый JSON, overlap/source presence, owner/duplicate keys/collision/freeze/
source-target drift/guarded read проверены.

Все write boundaries/before-commit теперь с профилями и тремя архивами: полный
rollback priorowners/IDs и retry. Cross-owner fixture содержит также выполненные
тренировки/планы/замер/питание/калькулятор/архив; receipt failure откатывает всё,
retry не создаёт Workout. Readonly/reopen/reordered rows+properties/byte identity/
ID reuse включает архивы и их guarded read.

Root/mobile TypeScript, scoped ESLint, source73/secrets/arch/diff pass. Fullfoundation/
bundle/APK/Android/phone не запускались. Реальные источники/2.0 и concurrent UI/theme
не затрагивались. Goal ACTIVE, finalizable:false; production gates OPEN.

Осталось production representation/retention/provenance/review, ordinary 3.x backup/
restore и отображение архивов; остальные owners Calendar/Ledger/неподдержанные формы;
full parity, app SQLite/JSON legacy restore, Android и bridge→normal без importer.
Ни parser, ни private storage не закрывают эти требования.
