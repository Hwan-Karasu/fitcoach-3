# Аудит остатка переноса 2.0 → 3.x

2026-10-26. Основа: HEAD `bf3cbce` и текущие незавершённые изменения каталога.
Объём: исходная полная цель переноса и backup/restore, решение о переходном
выпуске с импортёром и следующем выпуске без него. Excel и шлифовка UI/тем идут
после этого объёма. Task R04→R03; Product §§20.2,22.2–22.3,31,39,46,48.5.7,49–50,
53–56; INT03–12. Технические/release gates не объявляются пройденными.

## Как считается оценка

Ниже26 обязательных контрольных пунктов. Подтверждённый пункт имеет ограниченную
явную область доказательства; host-проверка не объявляется Android-проверкой.
Частичный пункт не засчитывается как закрытый. В частности, сохранение raw source
не засчитывается как обычный рабочий owner, а проверка отдельного owner не
засчитывается как восстановление всех данных.

**11 подтверждено,9 частично,6 открыто. Закрыто11/26 =42,3% контрольных пунктов;
15 пунктов ещё не закрыто.** Это счётчик критериев с разной трудоёмкостью, а не
процент написанного кода, оставшихся часов или готовности релизной сборки.
Оценку70–90% готового переноса факты сейчас не подтверждают.

| ID | Контрольный пункт и область проверки | Статус | Авторитетное основание / недостающий результат |
|---|---|---|---|
| A01 | Независимая sealed copy поддерживаемого SQLite источника, проверка байтов/SHA | Подтверждено | LegacyInspectionCopy; inspection-staging tests. Исходный файл не меняется. |
| A02 | Строгий допуск canonical SQLite v25, namespace/manifest/schema/integrity | Подтверждено | LegacyBackupReadPlans/LegacySqliteSource; source-admission tests. Это конкретный поддерживаемый формат. |
| A03 | Runtime чтение остальных требуемых экспортов2.0, включая JSON v1/v2 | Открыто | Нет app маршрута JSON backup→all-owner import. JSON в SQL-поле не является JSON backup adapter. |
| A04 | Census всех таблиц и raw SQL retention без молчаливого пропуска неизвестных stores | Подтверждено | LegacySourceCoverage; source-coverage tests. Semantic mapping рассматривается отдельно. |
| A05 | Полное смысловое сопоставление всех исходных полей и допустимых неоднозначностей | Частично | Основные owners есть; unsupported recovery/legacy actor/варианты/часть review semantics ещё открыты. |
| A06 | Устойчивые ID, sourceFactId dedup и изоляция workspace/client в private stage | Подтверждено | Identity ledger + owner projections; stage/job/coverage tests и phase proofs. |
| A07 | Одна транзакция all-owner private staging и полный откат при отказе | Подтверждено | stageLegacyImportCandidate; inspection-staging fault/retry tests. |
| A08 | Parity исходника и private staging, защита от source/target drift | Подтверждено | Owner receipts/readback + source coverage. Это не parity финальной native DB. |
| A09 | Persistent job, restart/replay с прежними параметрами/ID на host/SDK mocks | Подтверждено | ExpoLegacyCandidateJobs/createLegacyCandidateRuntime; candidate-jobs tests/host Worker kill. |
| A10 | Imported Exercise IDs реально обслуживаются обычным каталогом | Частично | Новые незакоммиченные изменения начаты; сквозной тест отсутствует, arch выявил1 нарушение границы. Не засчитано готовым. |
| A11 | Полный Execution в обычной3.x модели: даты/unknown precision/partials/segments/context/notes | Частично | Private typed facts и date domain есть; постоянная запись/обычные commands/readmodels ещё не закончены. |
| A12 | Обычный WorkData owner и его самостоятельный snapshot proof на candidate schema | Подтверждено | 4fe0abe; SqliteClientWorkDataRepository и13 native-work-data tests. App/schema admission ниже отдельны. |
| A13 | Поддержанные native Plans/templates/recovered drafts читаются после3.x snapshot без importer | Подтверждено | Native repository proofs, в том числе rest-settings tests. Разрешение exercise IDs отдельно A10. |
| A14 | Остальные владельцы целиком работают в3.x, включая исторические/нестандартные значения | Частично | Clients/Q/Measurements/Nutrition/Calendar/Settings имеют существенные реализации и узкие native proofs; нет общего доказательства всех source representations. |
| A15 | Все retained/review/provenance объекты постоянно хранятся и читаются без importer | Частично | Native WorkData evidence есть, часть остальных объектов остаётся в private r04_* моделях/candidates. |
| A16 | Общая native candidate DB всех owners, materialization/parity/ID checks в одном процессе | Открыто | Сейчас all-owner результат private/finalizable:false; отдельные native proofs не соединены в этот результат. |
| A17 | Допуск полной схемы3.x и forward migrations всех новых owners | Частично | D01 baseline/identity/migration runner реализованы; WorkData и imported registry candidates не включены в approved runtime registry. |
| A18 | Действующий3.x snapshot engine: целый SQLite/WAL/hash/media/restore | Подтверждено | SqliteSnapshotEngine/SqliteBackup; свежий sqlite-backup test roundtrip/guarded replacement. |
| A19 | Полный путь2.0→bridge→3.x backup→обычная сборка без importer, все owners/ID/точность | Открыто | Есть отдельные importer-ban owner proofs; полного пути всех данных нет. |
| A20 | Legacy app workflow: picker/preview/confirm/resume/безопасный cutover в рабочую DB | Частично | Внутренние jobs и3.x restore есть раздельно. createServices не подключает legacy runtime; ExpoRestoreJobs работает с3.x. |
| A21 | Базовый3.x maintenance/close holders/guarded replace/return point/cold recovery | Подтверждено | Existing runtime и return-point/sqlite-backup tests, включая настоящий host process death. Расширение под новых owners остаётся в A20. |
| A22 | Полный legacy путь на Android: реальные прерывания/повтор/low storage/providers | Открыто | Исторические Android3.x backup probes и SDK mocks этого не доказывают. |
| A23 | Signing/distribution gates и артефакты переходного/обычного выпусков | Открыто | Решение описано, нет полного проверенного release пути/tag/подписанной bridge сборки/checksum/instructions и сборки без importer. |
| A24 | Пользовательское объяснение legacy ошибок/review/Retry без технических кодов | Частично | Shared read issues/безопасные внутренние причины и3.x restore UI есть; полный legacy экран/сценарий не подключён. |
| A25 | Оставшиеся backup края: clock/DST, GC, first-run, SAF/ENOSPC/provider interruption | Частично | Много3.x проверок реализовано; полный обязательный device matrix остаётся открытым. |
| A26 | Финальная интеграционная/Android приёмка всего результата | Открыто | Полного результата пока нет; targeted зелёные тесты не заменяют эту приёмку. |

## Свежая проверка при аудите

Запущены8 целевых файлов: r04-source-admission, r04-inspection-staging,
r04-candidate-jobs, r04-source-coverage, r04-native-work-data, r04-rest-settings,
r06-sqlite-backup и r06-return-point.

В обычной изоляции90/104 PASS; остальные14 остановились на `spawnSync EPERM`
при попытке создать собственный дочерний процесс для аварийного завершения.
Все эти14 отдельно повторены с разрешением на запуск дочерних Node процессов:
14/14 PASS. Итого104 разных целевых проверки подтверждены двумя запусками.
Телефон/пользовательские файлы не использовались; не заявляется Android crash test.

Mobile TypeScript текущего worktree PASS. Architecture check текущего WIP FAIL:
новый readNativeLegacyExerciseSeed импортирует внутренний Clients domain вместо
разрешённой границы. Поэтому новую интеграцию каталога A10 нельзя считать готовой.
Полный foundation/full R04 profile/APK/Android сейчас не запускались.

## Сколько работы осталось практически

15 незакрытых пунктов складываются в четыре крупных результата:

1. Завершить обязательные source semantics/formats и рабочие native owners,
   прежде всего каталог, Execution и постоянные retained/review записи.
2. Собрать всех owners в одну native DB, пройти schema admission и доказать полный
   backup/restore без importer с полной сверкой исходных данных.
3. Подключить это к реальному legacy workflow приложения, всем maintenance/restore
   holders, deletion и понятным пользовательским статусам/ошибкам.
4. Пройти полный Android matrix и gates двух выпусков, собрать необходимые артефакты.

Самые дорогие незакрытые участки — A11/A16/A19/A20/A22. Наличие большого количества
готовой инфраструктуры не сокращает их до финальной полировки. Надёжной оценки
оставшихся часов пока нет: время крупных интеграционных задач не измерено.
Дальнейший отчёт опирается на ID этого списка; новый объём добавляется явно, с
основанием, вместо незаметного изменения знаменателя.

Основной порядок работы: [критический путь](LEGACY_RESTORE_DELIVERY.md).
Полная цель остаётся ACTIVE, не выполнена и не сужается до этого аудита.
