# R04 — клиент и workspace: кандидат source identity

**Статус: SOURCE IDENTITY CANDIDATE / NOT TARGET-MAPPED / NO TARGET WRITES.**
Вход — `clients` только из явно выбранного account-scoped build120 `.atbackup`,
в том же read-only SQLite-снимке, что R02 gate и R04 coverage. Product §10.2
требует имя для Client; §15 сохраняет архивную карточку и её доменные данные.
Stage 3 §06 требует provenance `(sourceDatabase, sourceTable, sourceRowId)`.

| Source | Проверка / кандидат | Открыто до target mapping |
|---|---|---|
| `account_database_binding.scope_key` + `clients.id` | отдельный source identity key; совпадение ID в другом account scope не сливается | Полный inventory всех account DB, target Client ID map |
| `clients.workspace_id` | сохраняется как source owner; несколько исходных workspace не сворачиваются автоматически | Утверждённая D01 TrainerWorkspace и правило отображения source owner |
| `clients.name` | непустое имя по Product §10.2; значение остаётся только в памяти | Валидация target display name и безопасный перенос PII |
| `clients.archived_at` | valid timestamp → кандидат `ARCHIVED`; отсутствие → `ACTIVE` | Сохранение lifecycle/данных и target archive semantics |
| `clients.deleted_at` | отдельный `DELETED_SOURCE`, перенос блокируется до политики | Нельзя молча восстановить как Active или удалить зависимые факты |
| `created_at`, `updated_at` | explicit timestamp shape проверена; неверный timestamp виден как issue | Target timestamp semantics и parity |

Некорректная дата архива даёт `UNRESOLVED`, а не уверенный `ARCHIVED`.
Одновременный archive+delete и повреждённая дата удаления остаются отдельными
issues. По source ID запрещён `first wins`; повтор строки того же account scope
блокирует итог. Никакие телефон, анкета, `profile_json`, вес, счётчики пакетов
или другие PII/доменные поля в этом шаге не маппятся в Client.

На предоставленном файле — 27 физических клиентов, один исходный workspace,
25 кандидатов `ACTIVE`, 2 `ARCHIVED`, 0 с `deleted_at`, пустым именем,
отсутствующим workspace или неверным временем. Это **не** подтверждает
корректность связей всех 43 legacy-таблиц, других account DB и target parity.
Target-mapped Clients = 0, target writes = 0; восстановление в приложении
остаётся закрытым до R03/R04, D01/D04 и D03/D05 gates.

Для R04 добавлена pure TypeScript staging-проекция client identity. Она
принимает **явную** карту source workspace/client → кандидат UUID и только
при полной валидности всех строк возвращает draft rows с именем, lifecycle,
временем создания/обновления и исходным archive timestamp в provenance.
Любой отсутствующий ID, повтор target Client ID, свёртка разных source
workspace в один target, удалённая или некорректная строка блокируют **весь**
результат: частичного успешного списка нет. Это проверяемый контракт
преобразования, не утверждённая D04 ID policy, не production DDL, не запись
в 3.0 и не готовый импорт. Целевые ID для настоящей миграции должны быть
стабильно сохранены в staging и проверены после D01/D04.

## Прямые `client_id`-ссылки во всём source-файле

После R02 и сверки формы 43 таблиц R04 проходит каждую таблицу с прямой
колонкой `client_id` в **том же** read-only снимке. Для каждой физической
строки различаются: существующий Client, пустой/необязательный ключ и
непустой ключ без Client. При неожиданном размножении строк JOIN аудит
останавливается. Отчёт не содержит имён таблиц, client ID или значений.

В предоставленном файле 22 таблицы имеют прямой `client_id`; в них 34 113
физических строк, из которых 34 074 указывают на существующего клиента,
39 не имеют ключа, 0 имеют orphan-ключ. Отдельный read-only подсчёт
подтвердил, что все 39 пустых ключей находятся в Calendar: ранее
классифицированные 38 гостевых и 1 неназначенная запись. Это не 39
«потерянных клиентов», но неназначенной записи по-прежнему нужна
доменная сверка. 1 407 строк с прямой ссылкой принадлежат двум архивным
клиентам; их нельзя отбрасывать из-за отсутствия в активном roster.

34 113 — **сумма физических строк разных таблиц**, а не число уникальных
фактов или ожидаемых target-строк. Этот проход не видит ссылки внутри JSON
и косвенные связи через workout/exercise/set, не проверяет другие account DB,
не утверждает семантический mapping и не пишет в target.
