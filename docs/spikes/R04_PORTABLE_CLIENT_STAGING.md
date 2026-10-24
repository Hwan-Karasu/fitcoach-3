# R04: общий план записи клиентов и асинхронный SQLite writer

2026-10-24, база `85c7e32`. Входы: CandidateIdentityLedger, проверенные identity/
card projections и D01 client baseline, isolated SQLite adapter, canonical25
admission и mobile source snapshots. R04 зависит от R03; Product §§48.5.7, 49–50,
53–56; INT-03–12. Production DDL/реальная миграция/overlay/signing/release gates
OPEN. Только private synthetic staging, `finalizable:false`; без телефона/UI.

## Изменение

`shared/migration/LegacyIdentityBinding` содержит прежний контекст и проверку
source keys. `ProjectClientIdentityDraft` перемещён к clients/domain/legacy-import;
старый script entry point re-export, алгоритм сохранён.

`clients/data/legacy-import/LegacyClientStagePlan` — общий генератор запросов для:
проверки объектов и binding файла, создания прежней private identity/client схемы,
резервирования ID, загрузки mapping, записи карточек и parity/integrity/FK checks.
`shared/migration/LegacyWritePlan` исполняет его асинхронно через SQLite port;
`scripts/r04/NodeLegacyWritePlan` — синхронно. Генератор не начинает и не завершает
транзакцию, allocator и checkpoints явно передаются исполнителем.

Существующий полный host CandidateIdentityLedger теперь использует этот же план.
Его внешний API, binding versions и транзакция всех остальных владельцев сохранены.
Checkpoint `after-clients` возвращает управление прежним nested owner writers
внутри той же транзакции, до итоговой parity/commit. Отдельного дублирующего
Node client-write алгоритма больше нет. Production baseline не менялся; ранее
существовавший R04 DDL перемещён, не применяется к runtime/source.

`LegacyClientStaging` — внутренний асинхронный candidate writer. Фабрика должна
открывать независимые handle к одному private staging file. Этот модуль не выбирает
файлы и не выполняет cutover. Он проверяет существующий файл до настройки WAL,
затем ещё раз под BEGIN IMMEDIATE. Foreign keys включаются на новом writer handle
до BEGIN существующим `openIsolatedSqliteConnection`.

Initial schema creation атомарна. Сервис умеет reserve/load IDs и записывать clients;
исходные raw SQL rows и context захватываются до первого await, идентичность и card
fields вычисляются заново из raw. Unknown SQL columns/BLOB сохраняются в прежнем
private payload; непредставимые SQL числа/объекты отклоняются. Все clients/IDs
откатываются вместе; ранее отдельно committed ID reservations остаются устойчивыми.
Ошибки native IO/allocator/checkpoint возвращаются фиксированным кодом без cause,
SQL или персональных значений. Никаких новых пользовательских сообщений/UI нет.

Привязка совпадает с host client-only mode. Это **не** полный staging состав:
нельзя открыть эту partial DB как готовый runtime или добавить прочих владельцев
сменой flags. Полный writer должен сразу иметь полный неизменяемый binding/schema.
Mode service/result явно `finalizable:false`. Source SHA/account/workspace в полном
coordinator должны приходить из проверенной inspection copy, а не UI аргументов.

## Проверки

10 новых тестов `r04-portable-client-staging.test.ts` используют реальные Node
SQLite файлы через асинхронные методы native-compatible port и настоящий existing
isolated adapter. Это host SDK contract proof, не Android/native Expo execution.

- canonical25 admission → mobile raw snapshot → async staging даёт те же строки,
  payload и ID, что общий host ledger; same-name clients не сливаются, archived
  lifecycle и точный height сохраняются, исходный файл SHA неизменен;
- after-ids/after-client/before-commit failures откатывают всех clients/IDs;
  retry, reordered replay и повторное открытие не вызывают allocator;
- отдельно committed ID reservations переживают последующий rollback;
- выполненный COMMIT с потерянным подтверждением восстанавливается через parity
  replay без новых строк/ID; то же после close failure уже committed handle;
- ошибки INSERT/COMMIT-before и искусственный parity drift откатываются, native
  detail/cause не выходят из внутреннего writer;
- source/foreign DB и изменённые hash/account/workspaces отвергаются до WAL/write,
  bytes не меняются; все открытые handle закрываются;
- caller mutation после вызова не меняет захваченные name/height/context;
  неподдержанные values не подменяются defaults;
- invalid/colliding/throwing allocator не оставляет частичных ID;
- interruption initial schema creation оставляет пустую DB, preparation retry
  создаёт согласованную схему.

459/459 owner/dependency profile `r04:plans:test` PASS; initial44 и initial8 PASS.
Root/mobile TypeScript, scoped lint, source73/arch548/secrets/staged diff PASS.
Результаты и оставшийся объём — в handoff.
Полный foundation, bundle/APK, Hermes runtime, Android/process/power-loss proof
этим срезом не выполняются.

## Остаётся

Полный portable writer всех владельцев, оставшиеся projections/source coverage/
preferences/lineage, permanent Execution/review/provenance storage, production
schema admission, app composition/cutover, ordinary backup/restore всех imported
данных, JSON/other2.0 variants, Android interruption/retry/concurrency/low disk,
GC/powerloss/removal/release proof. R04/D03 и общий goal не завершены.
