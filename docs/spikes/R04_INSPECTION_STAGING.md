# R04 — проверенная копия источника → общая запись staging

2026-10-25, база `12c94c3`, `work/r04-legacy-restore`. R04 → R03;
Product §§49–50, 53–56, INT-03–12. Только private synthetic candidate,
`finalizable:false`; production DDL/реальная миграция/overlay/signing/release
gates OPEN. Пользовательские файлы и телефон не использовались.

Входы: sealed inspection receipt, reader только private copy, independent native
factory для staging, target workspace, immutable importedAt/referenceDay и UUID
allocator. Зависимости: byte-copy preparation/source admission/pinned snapshot,
общая all-owner composition `12c94c3`. Внешний источник в этой функции не открывается.

## Связка

`stageLegacyInspectionCandidate` использует `readLegacyInspectionCopy`, затем
`stageLegacyImportCandidate`. SHA/scope/source workspace берутся из receipt и
admitted source, не передаются вызывающим кодом как готовый source context.
Все owners читаются из одного pinned snapshot; source connection закрывается
до первого открытия staging. Caller receipt, file methods, clocks, factory,
allocator и target фиксируются до первого await.

`LegacyInspectionReadyReader` разрешает только inspectReady/openReady: для чтения
и повторного запуска sealed copy не нужны выбранный файл, копирование, reserve
или повторный запрос разрешений SAF. `verifyLegacyInspectionCopy` экспортирован
как единая проверка receipt/digest/header/sidecars. Старые prepare/read paths
используют ту же проверку без дополнительных source migrations.

Копия проверяется до/после snapshot, в before-commit после caller checkpoint и
после завершения staging. Ошибка before-commit откатывает всех владельцев;
InspectionCopyError сохраняется поверх content-free generic writer wrapper.
Если копия изменилась уже после COMMIT, результат не возвращается как проверенный:
кандидат остаётся private и не активируется. После восстановления исходных exact
bytes verified replay проверяет receipts и сохраняет ранее committed IDs.
Произвольные исключения callbacks/native I/O не раскрывают source text/paths.

## Пустой источник и identity

В private context V2 допускается `sourceWorkspaceId:null`, если наблюдённого
workspace в исходных клиентах нет. Это явное отсутствие, не выдуманный source ID;
обычные string bindings/UUID order не меняются. Genuine empty canonical-v25 source
проходит всю цепочку и повтор. Target workspace остаётся новым target namespace.

Null source workspace не разрешает client rows или reservation клиентских ID;
появившийся в таком journal CLIENT mapping считается corruption. Workspace-bound
Questionnaire composition требует наблюдённый workspace. Источники без клиентов,
но с workspace-specific Q/templates, ещё требуют отдельного разрешения source
namespace; текущий workflow не угадывает его из произвольного поля.
Production schema/identity migration этим не меняется.

## Доказательства

11 новых integration tests используют synthetic actual files и настоящий SQLite
через асинхронный Expo-shaped port; это host proof, не Android runtime.

- Full source file с Q/WorkData/registry/programs/archives/executions/measurements/
  nutrition/calendar копируется/seal/admit/read/stage; derived scope/workspace/SHA
  и lineage metadata проверены. Все staged tables/IDs/receipts совпадают с direct
  all-owner composition; selected и private copy bytes неизменны, handles закрыты.
- Receipt mismatch, post-seal corruption и format admission failure не открывают
  staging и не создают target file. Открывается только operation-owned copy.
- Изменение копии во время owner staging → SOURCE_COPY_CHANGED, полный rollback,
  verified retry. Verification I/O в before-commit сохраняет безопасный code и
  откатывает строки, без private I/O details.
- Изменение после COMMIT не выдаёт verified result; private rows остаются,
  restored-copy replay не выделяет новые ID и не дублирует данные.
- Resume не вызывает external hash/copy; early owner interruption не раскрывает
  содержимое исключения; повтор работает. Caller mutation receipt/methods/clocks/
  target/factory/allocator после вызова не меняет источник или target context.
- Случайная маршрутизация staging на inspection DB отклоняется до WAL, не меняя
  ни selected backup, ни copy. Empty source сохраняет null namespace, ноль clients;
  replay стабилен. Nonempty/reserved/corrupt client identity при null отклоняется.

Существующий real-file inspection adapter вынесен в test support с handle tracking;
прежние copy tests не ослаблены. Их 10/10 включают actual Expo file driver с SDK
mock, delayed copy/rename и private SQLite open. Новый workflow пока тестируется
через real-file port; actual Android copy→stage, low disk/power loss не доказаны.

Проверки: `r04:plans:test` 542/542; новые 11/11; прежние copy tests 10/10.
Root/mobile TypeScript, scoped lint, source baseline73, boundaries604,
sensitive-files check прошли. Foundation/bundle/Hermesruntime/APK/Android не запускались.

## Осталось до полноценного переноса

Durable candidate job state/file routing/actual Expo staging factory, coverage/
preferences/lineage persistence/Q-Plan numeric JSON audit и source namespace без
clients при Q/templates; permanent Execution/provenance/review models + schema
admission; пользовательский вход/публикация/cutover; ordinary full backup/restore
всех перенесённых данных, normal3.x без importer; Android interruption/retry/
low disk/concurrency/GC/power loss и release gates. Полная цель ACTIVE, не100%.
