# R04 — persistent candidate requests и Expo staging runtime

2026-10-25, база `dcac694`, `work/r04-legacy-restore`. R04 → R03;
Product §§49–50, 53–56, INT-03–12. Private synthetic candidate только;
`finalizable:false`. Production DDL/реальная миграция/overlay/signing/release
gates OPEN. Телефон и пользовательские файлы не использовались.

Входы: проверенная sealed copy receipt, target namespace и однократно снятые
import time/reference day. Зависимости: copy/admission/all-owner writers и
`stageLegacyInspectionCandidate`. Metadata request не подтверждает завершение.

## Хранение и реальные adapters

Чистый `LegacyCandidateJob` V1 содержит job UUID, receipt исходной копии,
target workspace, importedAt/referenceDay. Exact fields, safe values и вложенный
receipt проверяются до I/O; объект/receipt frozen. Job UUID отличается от copy
operation UUID: новую попытку можно создать поверх той же sealed copy.
Общий target workspace validator теперь также требует string, без coercion.

`ExpoLegacyCandidateJobs` создаёт только собственные UUID slots в
`Paths.document/legacy-import-jobs`. `request.partial` записывается до legacy
Android file:// rename в `request.json`; готовый файл перечитывается. Existing slot
не перезаписывается. Read требует canonical JSON, совпадение job ID с папкой,
ограничение 8192 bytes и корректную модель. Partial не выдаётся за ready request.
List сообщает INCOMPLETE/INVALID/UNAVAILABLE отдельно, не трогая чужие paths.

SQLite открывается исключительно как `<job UUID>/candidate.sqlite` с
`useNewConnection:true`, после проверки request против ожидаемого. Ни исходный
выбранный файл, ни inspection copy, ни LIVE path нельзя передать через metadata.
Готовый request без candidate DB допустим: resume должен действительно выполнить
или проверить перенос, а не доверять статусному файлу.

`runLegacyCandidateJob` captures store/source methods до await, читает сохранённые
параметры и вызывает copy-bound all-owner staging. Request перепроверяется перед
каждым открытием, перед commit и после результата. Job I/O errors content-free;
изменение во время операции возвращает LEGACY_JOB_CHANGED. Изменение после commit
не активирует private candidate и не возвращает verified success.

`createLegacyCandidateRuntime` связывает actual Expo job/file/SQLite adapters и
уже установленный `expo-modules-core` UUID, без новой зависимости. Start сохраняет
request; resume использует его часы/target, а не новые часы устройства. Живой
same-instance Promise защищён от повторного resume; guard удаляется в finally.
Нет persisted RUNNING/completed flags, stale file не считается живым процессом.
Runtime пока не подключён к пользовательскому экрану/активной БД.

## Доказательства

11 новых tests выполняют реальные application/adapters в независимых Node Workers
с SDK contract mocks, real files и настоящим SQLite. Это не Android runtime.
File mock дополнен Directory.list, UUID и полным native-shaped SQLite API; прежний
actual Expo inspection-copy test продолжает проходить с тем же порядком событий.

- Full canonical-v25 source copy → request → candidate: 6 execution/12 measurement/
  4 nutrition/4 calendar facts. Второй Worker читает request и повторяет проверку
  с clock2050 без новых UUID, сохраняя все rows/IDs и source bytes.
- Metadata-only request обнаруживается после restart, но не создаёт DB до resume.
  Partial before/after-write не перезаписывается и не запускается; новый job
  переиспользует sealed copy без внешнего source access. Rename ACK loss оставляет
  корректный discoverable request, который можно продолжить.
- List различает incomplete/corrupt slots, оставляя foreign files/dirs без изменения.
  Mismatched slot ID, malformed/oversized/noncanonical JSON не открывают SQLite.
- Canonical params drift после готового candidate отклоняется по SQL binding до
  WAL (с positive control), не изменяя rows. Drift до commit откатывает всех
  владельцев; после commit оставляет unverified private rows. Restored request
  проходит replay, committed IDs повторно не выделяются.
- Worker реально terminate в подтверждённом before-commit checkpoint: после выхода
  SQLite rows откатились, FK/integrity OK. Новый Worker завершает кандидат, ещё
  один подтверждает ID-stable replay без allocation. Это termination test host
  isolate, не убийство Android-процесса и не проверка потери питания.
- Same runtime не открывает файлы при concurrent resume его живого job; после
  completion повторный resume проходит без новых UUID. Все обычные handles закрыты.

Проверки: `r04:plans:test` 553/553; новые 11/11; прежние copy tests 10/10.
Root/mobile TypeScript, scoped lint, source baseline73, boundaries609,
sensitive-files check прошли. Foundation/bundle/Hermesruntime/APK/Android не запускались.

## Оставшийся объём

Actual Android SDK execution, cross-instance/process concurrency, fsync/power-loss,
low disk и orphan retention/GC ещё не доказаны. Partial slots оставляются; cleanup
не добавлен. Request — единственная immutable конфигурация; SQLite/source receipts
остаются проверкой результата. Не предполагается защита от произвольного переписывания
валидного request до первой записи внутри доверенного private app storage.

Дальше: coverage/preferences/lineage и Q/Plan numeric JSON audit; source namespace
для Q/templates без клиентов; permanent Execution/provenance/review/schema gates;
пользовательский вход/publication/cutover; ordinary full backup/restore всего
результата, normal3.x без importer и release gates. Полная цель ACTIVE, не100%.
