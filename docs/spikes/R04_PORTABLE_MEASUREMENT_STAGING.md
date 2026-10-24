# R04 — общий SQLite writer замеров и дневного веса

2026-10-24, база `61fbb4c`, `work/r04-legacy-restore`. R04 → R03;
Product §§49–50, 53–56, INT-12; остальные правила связей §§48.5.7/INT-03–11.
Private synthetic candidate staging, `finalizable:false`. Production DDL,
реальная миграция, overlay/signing/release gates остаются OPEN.

Входы: сырые `client_measurements`, `client_day_facts`, raw карточки с profile
weight, scope/workspace/устойчивые ID клиентов, зафиксированные importedAt и
referenceDay. Зависимости: Profile → Questionnaire → WorkData → registry →
Plans/Templates/Archives → Executions. Пользовательские файлы/телефон не читались.

## Изменения

Чистые source projections, expansion широких строк, точное преобразование в
десятые и weight reconciliation находятся у владельца Measurements. Общий
`LegacyClientDaySource` в shared сохраняет независимую семантику веса, шагов и
текстовой отметки тренировки; такая отметка не создаёт Workout/Credit facts.
Shared source DTO не требует зависеть от feature импортера. Node readers
сохраняют исходные API и делегируют классификацию тем же чистым source functions.

`LegacyMeasurementStagePlan` выполняет существующие D01 определения только внутри
изолированной R04 базы, затем резервирует ID, записывает строки, receipt и проверяет
все целевые таблицы. Node wrapper и async SQLite driver выполняют один generator.
SHA256 через установленный noble совпадает с прежним Node crypto; новых
зависимостей/lockfile нет. Typed fact rows выдаются после полной parity-проверки.

Extension захватывает raw SQL cells до await, фиксирует mode V2 + referenceDay
и требует всех предшествующих владельцев. Изменение дня на повторе отклоняется;
текущее время не меняет cutoff. Все owner rows, ID и receipts принадлежат одной
транзакции клиента. Отсутствующее хранилище отличается от наблюдённого пустого.

Правила переноса не менялись: точные десятые без округления/обрезания; исходные
даты без добавления минут; method MANUAL, createdAt/updatedAt = import time с
явным происхождением. Несколько наблюдений за один день сохраняются отдельно;
неуказанная сторона тела не угадывается, primary не выбирается автоматически.
Profile weight остаётся UNKNOWN snapshot без target measurement ID даже при
совпадении с дневным весом. Непредставимая точность, нулевые/невалидные значения,
невалидные/будущие даты остаются raw + review в private receipt.

Общий admitted training fixture вынесен из Execution test в support, чтобы
следующие владельцы проверялись поверх той же реальной цепочки и файла источника.
Отдельный синтетический measurement seed также доступен следующему этапу.

## Доказательства

9 новых async контрактных тестов используют настоящий SQLite через Expo-shaped
port и `openIsolatedSqliteConnection`. Это host proof, не Android/Expo runtime.

- Admitted canonical-v25 source с настоящей published/draft анкетой/ответом,
  WorkData, registry, программами, архивами, snapshot/cache и execution facts.
  Wide rows + same-day + другой клиент дают 10 circumference facts; два дневных
  веса дают 801/801. Ещё 6 значений требуют review; profile snapshot ровно один.
  Async == Node по всем owner rows/IDs/receipts; source SHA не меняется; FK пуст.
- Десятые, unsided ARM, null minute, import timestamps и отсутствие daily primary
  проверены явно. Profile equality остаётся только signal, без ещё одного факта.
  Исходные десятичные строки и extras сохранены в receipt.
- Все 3 measurement boundaries + before-commit откатывают предыдущих владельцев;
  retry/reopen/reordered replay не выделяют новые ID и не создают дублей.
- Потеря подтверждения COMMIT и ошибка close после commit позволяют повтор.
  Raw capture устойчив к изменениям до await/из callback предыдущего владельца.
- Чужой owner, duplicate source atoms, другой scope и collision UUID не оставляют
  owner writes. Fact/primary/ID/source/target/SHA drift блокируют read и replay.
- Binding referenceDay, обязательность execution mode, отсутствие/пустота stores,
  schema/row I/O rollback/retry и закрытие handles проверены.

Независимая одноразовая проверка сравнила именно старый writer из
`git show 61fbb4c:scripts/r04/LegacyMeasurementStage.ts` с новым: пустые stores
и полный seed совпали по всем 48 таблицам, ID и receipts. Ignored executables/logs:
`.cache/r04-measurement-baseline`, исключительно синтетические данные.

| Сценарий | SHA256 сериализованного результата |
| --- | --- |
| empty | `3a9770c4d0b28e06311a11a4416a67b0085b0e64928c2a2802513a7dea5370db` |
| observations | `2629e285b20e2c46fc5f9d7fc4cebc292c97165a49f88cc4e32a45b0405c6d1b` |

Профиль `r04:plans:test` — 509/509; отдельно новые 9/9, исходные measurement
stage/projection 27/27, source preflight + measurement projection 92/92.
В профиле также прошли прежние regular repository и
ordinary full 3.x backup/restore tests для native measurement IDs/values без
importer tables. Это не доказывает backup private review/profile provenance.
Root/mobile TypeScript, scoped lint, source baseline73, boundaries589,
sensitive-files check прошли. Foundation/bundle/Hermes/APK/Android не запускались.

## Оставшийся объём

Пользовательский перенос ещё не подключён. Нужны Nutrition/Calendar portable
writers, остальные source coverage/preferences/lineage и аудит Q/Plan numeric JSON;
постоянные Execution/provenance/review модели и schema admission, полная композиция
и cutover, backup/restore всего результата, normal3.x без importer, Android
interruption/retry/low disk/concurrency/GC/power loss и release gates. Эта работа
не закрывает полную цель и не переводит source backlog R04 в DONE.
