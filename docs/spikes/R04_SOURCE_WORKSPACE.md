# R04: анкета без клиентов и явный namespace источника

2026-10-25, база `fb0442d`. Входы: проверенная canonical-v25 inspection copy,
clients.workspace_id, questionnaire_templates/revisions.workspace_id и явная
training_programs.template_workspace_id, если колонка присутствует. Зависимости:
admission/общий read snapshot, Q composition, all-owner staging и persistent jobs.
R04→R03, Product §§49–50,53–56 / INT-03–12. Private synthetic, finalizable:false;
production DDL/migration/overlay/signing/release gates OPEN.

## Обнаруженные случаи

Владелец раньше определялся только по clients. Анкета без клиентов получала
null namespace и блокировалась при composition. Физически существующие, но пустые
таблицы анкет также ошибочно считались неполной историей вместо неиспользованных stores.

У этих данных разные связи. По закреплённой миграции018 templates/revisions
анкеты имеют workspace_id и могут существовать без клиентов.
[Схема анкет 2.0](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/018_questionnaire_builder.ts).
У training_programs client_id обязателен, FK удаляет программу вместе с клиентом;
реальный orphan не разрешается создавать или исправлять выдуманным клиентом.
[Исходная схема](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/001_initial.ts).
Миграция027 добавляет явный неизменяемый template_workspace_id; его binding
проверяется отдельно от автора-клиента.
[Владелец шаблона](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/027_template_ownership.ts).
Это pinned source semantics, не перенос старых auth/backend правил в 3.x.

## Изменение

Строгий admission в том же pinned read snapshot сверяет явные namespace полей
clients, анкет и шаблонов. Нет клиента — можно получить владельца из самой анкеты.
Нет ни одного наблюдения — остаётся null. Идентификаторы не нормализуются,
не берутся из подписей, произвольного JSON или app_settings.

Каждая дополнительная таблица проверяется через physical columns. DISTINCT
использует BINARY, не исходную NOCASE collation; LIMIT2 достаточно для обнаружения
разных значений. Нестроковое SQL storage экранируется до native bridge. NULL,
BLOB, whitespace-only ID и конфликт с другой таблицей блокируют admission.
Отсутствующий template_workspace_id старого формата не создаётся: representability
шаблона по-прежнему проверяет владелец Plans. Общий legacy inventory остаётся
историческим aggregate report; его client counts не переименовываются в число
владельцев анкет. Дополнительное разрешение namespace относится к strict admission.

Пустые Q stores получают начальную схему 3.x с датой импорта; это не старая
публикация. Профильные ответы сохраняются, даже если конструктор никогда не
использовался. Receipt различает отсутствующие stores и физически пустые массивы,
в том числе null/пустую таблицу changes. При наличии любой исторической строки
действуют прежние строгие проверки, без fallback на пустую анкету.

Для непустой анкеты без клиентов сохраняются исходная публикация, отдельный
черновик, field ID и raw provenance. Новые client rows/ID/ответы/факты не создаются.
Общий каталог собственных упражнений также переносится независимо от клиентов.
Параметры job остаются на диске; повторный runtime заново проверяет namespace
из sealed copy, не обращаясь к первоначальному файлу.

## Проверки

`scripts/r04-source-workspace.test.ts`: 10 новых тестов, включая несколько наборов.
Реальная синтетическая SQLite и фактический app composition: Node/mobile admission
одинаковы, ноль клиентов с Q history/custom exercise, отдельный draft, raw receipt,
пустые stores с/без клиентов и changes, без выдуманного namespace, одинаковые IDs
и полные target rows на replay. Conflicting scopes/NOCASE/NULL/BLOB/whitespace/
missing column/FK orphan блокируют target creation и domain SELECT *.
Частичная история блокируется; before-commit interruption откатывает всех owners;
retry сохраняет IDs, target drift не переписывается. Каждый новый namespace SELECT
проверен на I/O failure/закрытие handles/успешный retry. Source/copy SHA неизменны.

Fresh Worker запускает actual Expo file/job/SQLite adapters и app runtime через
SDK contract mocks на реальных host files/SQLite: start и resume zero-client Q,
readback request, стабильные строки/дата/ID, forbidden source access/allocation.
Это не Android/Hermes runtime или power-loss proof.

Итог: 56/56 targeted (новые/admission/inspection/Q/Plans/numeric parity),
25/25 dependencies (profile/training source + persistent jobs) PASS. После
усиления before-collection assertions новые тесты повторно прошли: 10/10.
Root/mobile TypeScript, scoped lint, source baseline73 и arch609 PASS.
Secrets/staged diff PASS.
Полный foundation, общий R04 profile, bundle, APK и телефон в этом этапе не запускались.

## Остаётся

Coverage/preferences/lineage, постоянные модели Execution/review/provenance и
production schema admission, пользовательский import/cutover, полный 3.x backup/
removal, другие варианты источников, Android interruption/low disk/concurrency/GC/
power loss и release proof. Goal ACTIVE, не100%.
