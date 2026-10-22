# R04 — точная проекция обхватов 2.0 в MeasurementInput

Статус: PARTIAL, target-shaped inputs в памяти, без IDs и записей.
Задача R04, зависимость R03. Product §§49.14–49.18, Feature 15/18:
сохранять независимые наблюдения, отсутствие времени и точность источника.

## Подтверждение единицы

Read-only build120 `e116b42e95f70a5a5e563420ab25394944c59ffd`:
[экран ввода](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/ui/KbjuMeasurementsSection.tsx)
показывает `KBJU_COPY.cm` для всех `MEASUREMENT_SITES`;
[подписи](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/model/kbjuCopy.ts)
задают `cm: "см"` и восемь показателей;
[репозиторий](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/kbju/data/ClientMeasurementsRepository.ts)
сохраняет эти строки без пересчёта. Это proof единицы контракта 2.0,
а не утверждение о корректности каждого введённого пользователем числа.

## Соответствие и ограничения

`LegacyMeasurementProjection.ts` преобразует восемь полей в `MeasurementInput`
и проверяет их актуальным `validateMeasurement` приложения:
neck→NECK, shoulders→SHOULDERS, chest→CHEST, waist→WAIST, hips→HIPS,
upper_arm→ARM, thigh→THIGH, calf→CALF. Последние три остаются без стороны;
никакого копирования в `_L`/`_R` или выбора стороны по умолчанию.

Сантиметры переводятся в `valueX10` целочисленно. `35,5` → 355,
`35.5000` → 355, `35.55` → review с исходным значением без округления.
Переполнение безопасного integer также блокирует кандидат. Доменный диапазон
не используется для clipping: выход за него сохраняется как причина проверки.

Каждый непустой source field остаётся отдельным кандидатом с исходным значением,
provenance и причиной невозможности преобразования. Пустота не создаёт нулевой
замер. Несколько записей одного дня не усредняются и не сливаются. Исходный
client ownership проверяется ранее; его отсутствие блокирует target input.

Дата остаётся DATE, localMinute=null. Время создания source-строки не считается
временем измерения. Факты/ID и daily primary не назначаются. Текущий момент для
проверки будущей даты передаётся явно в projector, в полном аудите используется
время запуска. Старые source candidates по-прежнему сохраняют UNIT_UNVERIFIED
как исторический результат разбора; новый projector снимает эту причину только
для восьми подтверждённых обхватов. Daily weight/profile weight этим не маппятся.

В `r04:full` добавлен агрегат `measurementProjection`: только counts кандидатов
и review по precision/bounds. Не выводятся имена, IDs, даты и значения.

## Проверки и открытые этапы

Синтетические тесты: восемь полей, десятичная запятая, точность без округления,
только дата, отсутствие стороны, несколько записей в день, пустота/нуль/ошибка,
диапазон, owner/date/future, переполнение и приватность агрегата. Файловый полный
R04 проверяет успешный и неподдерживаемый по точности input в одном проходе
и сравнивает байты источника до/после.

Реальные данные не читались. Открыты IDs замеров и client mapping, date-only
target persistence, policy для неподдерживаемой точности/диапазона, масса тела,
primary parity, транзакционная запись, restore и Android. Это не автоматическое
исправление старых результатов и не завершённое восстановление.
