# R04: асинхронный перенос рабочих данных клиента

2026-10-24, база `3d094b4`. Входы: host WorkData mapping/schema/write/parity,
проверенный ClientWorkDataModel и tag naming policy, общий client/Q async writer,
canonical25 admission/mobile snapshots. R04 зависит от R03; Product §§48.5.7,
49–50, 53–56; INT-03–12. Production DDL, реальная миграция, overlay/signing/release
gates OPEN. Только private synthetic staging, `finalizable:false`; без UI/телефона.

## Изменение

WorkData schema/write/parity перенесены в `clients/data/legacy-import` как
`LegacyClientWorkDataStagePlan`; прежний script writer — thin Node executor.
Используются прежние шесть private tables, ограничения/FK, ID keys, сортировка,
source/target receipts и parity checks. Production baseline не менялся.

Общий `shared/migration/LegacyProfileWorkData` извлекает raw intake values для
questionnaire receipt и client owner без feature-to-feature зависимости.
Full profile validation остаётся в Q этапе; WorkData проверяет свои поля и scope
и повторно извлекает значения из raw profile_json, не доверяет производному объекту.
Host wrapper также сохраняет full profile validation. Проекция Q с 37 полями
использует тот же извлекатель, остальные mappings не изменены.

Заметка сохраняет исходные пробелы/переносы. Её created/updated time в candidate
означает import time; неизвестное source note time явно отмечено в provenance.
Raw client updated time хранится отдельно, не становится датой заметки. Метки
объединяются только по прежнему NFC/whitespace/Russian-case правилу; raw variants,
порядок и source labels сохраняются в receipt. Нет name-based client merges.
Исходные health/unwantedLoad значения остаются PENDING_REVIEW, не активными
ограничениями, не автоматическими метками и не медицинскими выводами.

`LegacyStageExtension` расширен общим allocator и required mode tags.
`combineLegacyStageExtensions` захватывает упорядоченный состав до создания job,
проверяет зависимости/дубли tags и objects, последовательно исполняет schema и
write plans. Client owner создаёт общий workspace index один раз. Неправильный
порядок Q/WorkData блокируется до открытия файла; WorkData-only не обходит профиль.
Mode schema/binding существующей DB не меняются на месте.

`LegacyClientStaging` ожидает все owner plans и async checkpoints внутри прежней
exclusive transaction. Clients/IDs, Q publications/draft/answers, WorkData ID map,
notes/tags/assignments/reviews/receipts коммитятся и откатываются вместе.
Full host CandidateIdentityLedger использует тот же WorkData generator;
существующие последующие owners остаются в его общей транзакции.

Это переносимое исполнение прежнего **R04 rehearsal**, не постоянная production
WorkData модель. Обычные 3.x backup/restore/readers/deletion/UI и удаление importer
пока не доказаны для private WorkData rows. Результат остаётся finalizable:false.

## Проверки

8 новых `r04-portable-work-data-staging.test.ts`: реальные файлы Node SQLite через
async native-compatible port и existing isolated adapter. Fixtures содержат
canonical25 source с двумя same-name clients, archived owner, реальную custom Q
publication/draft/answer и рабочие данные. Это host contract proof, не native Expo.

- admitted source → clients/Q/WorkData async chain равна host ledger по всем
  строкам, ID и receipts; source SHA неизменен, handle закрыты, target FK чистые;
- точные заметки/unknown note time, shared Unicode tags/assignments, archived
  owner и custom answer сохраняются; explicit clearance плюс health text не
  создают ACTIVE restriction;
- все четыре WorkData write boundaries и before-commit failures откатывают
  предыдущих owners, ID и receipts; retry/reopen/reordered replay не аллоцирует ID;
- COMMIT с потерей подтверждения повторяется без новых notes/tags/reviews/IDs;
- caller mutation между Q и WorkData не меняет захваченные note/tags/provenance;
- отсутствующие dependencies, неверный owner order/duplicates и Q-only DB не
  принимаются как новый WorkData mode;
- invalid tag controls/types и ID collision блокируют весь batch; modified note,
  assignment, review или receipt обнаруживаются без overwrite;
- native INSERT/schema failure откатывает batch/initial schema и допускает retry.

475/475 owner/dependency profile `r04:plans:test` PASS; initial focused40/7 и latest8
PASS. Root/mobile TypeScript, scoped lint, source73/arch556/secrets/staged diff PASS.
Результаты также зафиксированы в handoff.
Полный foundation/bundle/APK/Hermes runtime/Android/process/power-loss не запускались.

## Открытый объём

Portable registry/Plans/Execution/Measurement/Nutrition/Calendar writers/other
projections, полная source coverage/preferences/lineage, permanent Execution и
WorkData/review/provenance model, schema admission, app composition/cutover,
ordinary backup/restore всех imported rows, JSON/other2.0 variants, Android
interruption/retry/low disk/concurrency, GC/powerloss/removal/release proof.
Числовая точность Q и unknown raw provenance не доказаны простым сохранением строки.
Общий goal/R04/D03 остаются открытыми, не100%.
