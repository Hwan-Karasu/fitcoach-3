# R04: проверка чисел в JSON анкет и планов

2026-10-25, база `9ec7615`. Входы: raw `schema_json`/`value_json` анкет,
`settings_json`/`data_json`/`week_state_json` планов и архивные snapshot JSON.
Зависимости: общий переносимый SourceJson lexer и транзакция all-owner staging.
R04→R03, Product §§49–50,53–56 / INT-03–12. Только private synthetic candidate,
`finalizable:false`; production DDL, реальная миграция, Android overlay,
signing/release gates остаются OPEN.

## Что исправлено

Обычный JSON.parse превращал `1.0000000000000001` в `1` до проверки версии анкеты
или количества недель. Значение могло пройти Number.isSafeInteger/проверку
версии уже после потери точности. Сохранение raw JSON само по себе это не исправляет.

`shared/migration/SourceJson.ts` теперь также предоставляет
`parseRoundTripSourceJson` для владельцев, у которых целевой JSON хранит Number.
Lexer сохраняет исходный токен; десятичный коэффициент и порядок сравниваются
с сериализованным целевым числом без преобразования исходника в double для сравнения.
Эквивалентные экспоненты и завершающие нули допустимы: `1.1000` → `1.1`,
`2.000e0` → `2`. Строки остаются строками, типы метаданных не меняются.

Дополнительная проверка точного целого через BigInt нужна потому, что
Number("1000000000000000100") сериализуется тем же текстом, хотя его точное
целое значение — 1000000000000000128. Проверка только кратчайшей записи пропустила
бы это округление. Точные большие целые допускаются парсером, но сохраняют
ограничения конкретного владельца; NUMBER анкеты по-прежнему ограничен по модулю 1e9.

Overflow, ненулевой underflow, изменение десятичного значения и negative zero
дают фиксированный код без исходного содержимого или cause. Здесь negative zero
не поддерживается целевым JSON: JSON.stringify теряет его знак. Другие владельцы
по-прежнему могут сохранять произвольные точные токены своим callback в parseSourceJson.
Требование не означает математическую двоичную точность всех дробей: обычное `1.1`
допустимо, потому что его исходное десятичное значение сохраняется в целевом JSON.

Проекция анкеты сохраняет raw строку и причину review, не создаёт округлённый ответ.
Composition повторно проверяет raw независимо от candidate projection. Plans и
Archive Plans используют ту же проверку до структурного преобразования, включая
неизвестные числовые метаданные. Неподдерживаемое значение блокирует и откатывает
всю транзакцию кандидата; исходная БД остаётся неизменной. Soft-deleted нечитаемый
архив сохраняет прежний путь raw retention, без нового обязательного разбора.

Это внутренняя диагностика. Пользовательский preview/review и постоянное хранение
неподдержанных значений ещё не реализованы; технические коды здесь не UI.

## Проверки

Новые `scripts/r04-json-number-parity.test.ts`: 9 тестов с несколькими наборами
значений. Проверяют сохранение обычных дробей/экспонент/строк, скрытое округление
больших целых, underflow/overflow/-0, malformed JSON без содержимого в ошибке,
native duplicate-key/__proto__ semantics и fresh Worker без source-aware reviver.

All-owner app composition на реальной синтетической SQLite проверяет invalid
answer/schema version/plan counts/archive counters/positions/metadata, полный
rollback всех предыдущих owners/IDs/receipts, повторный отказ, FK/integrity,
закрытие handles и неизменный SHA источника. Положительные случаи проверяют
сохранённый ответ, стабильный field ID, повторный запуск без смены client IDs,
корректные архивы/планы и прежние шесть фактов выполненных подходов.

Targeted SourceJson + новые тесты + portable Q/Plans: 33/33 PASS.
Итоговый профиль `r04:plans:test`: 562/562 PASS (114,7 с); это профиль переноса,
не полный foundation приложения. Отдельная существующая проверка изоляции
Nutrition history backup также прошла: 1/1. Root/mobile TypeScript, scoped lint,
source baseline 73, arch 609, secrets и staged diff PASS.
Новых зависимостей, production DDL и изменений реальной пользовательской БД нет.
Foundation, bundle, Hermes runtime, APK и телефон в этом этапе не проверялись.

## Что остаётся

Проверка закрывает конкретный путь скрытого округления в этих JSON-входах.
Она не доказывает все варианты 2.0, полноту source coverage/preferences/lineage,
переносимость каждого старого значения или окончательную модель review/provenance.
Permanent models/admission, source namespace без clients, UI/cutover,
полный 3.x backup/removal, Android/Hermes runtime, interruption/low disk/GC/
power loss и release proof остаются открытыми. Goal ACTIVE, не 100%.
