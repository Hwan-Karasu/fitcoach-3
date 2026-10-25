# R04 — общий SQLite календарь и композиция candidate import

2026-10-24–25, база `c53985c`, отдельная `work/r04-legacy-restore`.
R04 → R03; Product §§49–50, 53–56, INT-03–12. Только private synthetic candidate
staging, `finalizable:false`. Production DDL/реальная миграция/overlay/signing/
release gates OPEN; пользовательские файлы и телефон не использовались.

Входы Calendar: physical appointments, только Calendar-owned planner setting,
unsupported accounting table inventory, client identities, immutable import time.
Зависимости: Profile/Questionnaire/WorkData/registry/Plans/Templates/Archives/
Executions/Measurements/Nutrition и существующая схема владельца Accounting.

## Writer и границы владельцев

Source DTO/columns перенесены в shared; чистая projection находится у Calendar.
Старые script paths/API сохранены через re-export/Node wrappers. Общий generator
содержит schema/write/parity/read для Node и async SQLite, SHA256 — установленный
noble без новой зависимости. Реальные UUID выдаются в прежнем порядке, pending
SQL collision checks/reservations выполняются до rows/checkpoints в общей tx.

Calendar не импортирует другой feature: Accounting предоставляет immutable
snapshot своих existing D01 statements; composition root передаёт его Calendar
координатору. Определения baseline не менялись; source SQL не исполняется. Schema
и raw snapshots захватываются до await, mode Calendar V1 не переключается на
чужой/предыдущий staging файл. Новые production migrations не создавались.

Семантика прежняя: schedules не превращаются в outcomes/workouts/credits;
связь с клиентом только по ID, гостевой текст не объединяется по имени. Soft delete
сохраняет видимость CANCELLED, не утверждает исход встречи. Notes не обрезаются.
Четыре 3.x initial session-type defaults не выдаются за legacy facts; personal
credit policy=1 сочетается с imported appointment credit_bypass=1. Accounting
начинается UNTRACKED, без pack/ledger/payment/reservation facts. Наблюдённые
неподдержанные финансовые stores блокируют запись, вместо их молчаливой потери.

## Внутренняя композиция приложения

`app/composition/stageLegacyImportCandidate.ts` собирает все восемь owner extensions
в неизменном порядке поверх client transaction. Он захватывает client raw rows,
все owner payloads, context, clocks, native factory и allocator до первого await;
возвращает именованные owner results/IDs и `finalizable:false`.
`features/legacy-import/public.ts` экспортирует только source contract, не SQL API.

Вызов предполагает уже admitted pinned inspection snapshots + matching SHA и
фабрику независимых native handles к private staging. Пользовательский экран,
source file routing, publication/cutover не подключены. Это внутренний проверенный
composition entry point, не доказательство завершения пользовательской функции.

## Проверено

12 новых tests: 9 Calendar + 3 app composition. Настоящий SQLite через async
Expo-shaped port/`openIsolatedSqliteConnection`; host proof, не Android runtime.

- Admitted canonical-v25 source со всей цепочкой Q/WorkData/registry/programs/
  archive/execution/measurement/nutrition/calendar. Async == Node по всем rows,
  IDs, receipts; source SHA не меняется, FK check пуст, handles закрыты.
- 4 appointments, 4 initial types, 3 DUTY/BLOCKED intervals; outcome/outcome_at NULL,
  soft-deleted CANCELLED; guest остаётся guest даже с совпадающим client name.
  Planner 07:00–23:00/1010001; raw notes и другие owner settings не присваиваются
  календарю. UNTRACKED, ноль финансовых facts; шесть execution facts неизменны.
- Каждое повторение after-calendar-rows, after-ids/receipt/before-commit откатывает
  всех владельцев; retry/reopen/reordered replay не выделяют новых ID. COMMIT/close
  acknowledgement loss не создаёт дублей appointments/types/intervals.
- Raw/schema capture, unsupported finance, duplicate IDs, scope, cross-owner UUID
  collision, mode before-WAL, schema/row I/O rollback/retry проверены.
- Drift appointment/type/planner/interval/accounting/ID/source/target/SHA блокирует
  guarded read и replay. Planner JSON `7.0000000000000001` остаётся raw review;
  округлённая настройка не создаётся.
- App composition == manual owner chain по всем таблицам; полный replay без новых
  UUID. Изменения client/note/measure/food/context/clocks/factory/allocator после
  вызова не влияют на ожидаемую запись. Early/final interruption откатываются;
  complete retry проходит.

Усилены before-WAL tests Execution/Nutrition/Calendar: matcher учитывает реальные
пробелы native SQL и проверяется positive control на первоначальном открытии.
Ранее literal без пробелов не распознавал реальный SQL, хотя код исполнял inspector
до configure. Теперь и отсутствие WAL после отказа, и активность matcher доказаны.

Независимое сравнение со старым writer из
`git show c53985c:scripts/r04/LegacyCalendarStage.ts` прошло: empty, calendar и
unsupported planner precision — все 79 таблиц/ID/receipts совпали. Ignored
executables/logs `.cache/r04-calendar-baseline`, исключительно synthetic data.

| Сценарий | SHA256 сериализованных rows |
| --- | --- |
| empty | `aba524f512cd3d104040ee60bf5c854de8ac384919fb8081e6f04becc629cdd4` |
| calendar | `8a407fcf464c1acc8cbdfa66437676a7d5d83c916c48c0cfe342778148a80953` |
| precision | `d7a3c7c122517226c36d0b98dd2bd10bd1907d8b82a97b47fe33c23a48f39a05` |

Проверки: targeted Calendar/Execution/Nutrition 31/31; исходные Calendar+SourceJson
21/21. Root/mobile TypeScript, scoped lint, source baseline73, boundaries603,
sensitive-files check прошли. Заключительный `r04:plans:test` — 531/531.
Foundation/bundle/Hermesruntime/APK/Android не запускались.

## Осталось

Полный coverage/preferences/lineage и Q/Plan numeric JSON audit; permanent
Execution/provenance/review models + schema admission; source-copy/admission/
staging workflow и пользовательский вход; publication/cutover; ordinary full
backup/restore всего перенесённого результата, normal3.x без importer; Android
interruption/retry/low disk/concurrency/GC/power loss и release gates.
Все owner writers переносимы, но полная цель ACTIVE и R04 не DONE/не100%.
