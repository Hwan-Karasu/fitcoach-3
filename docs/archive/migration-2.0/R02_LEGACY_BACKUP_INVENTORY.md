# R02 — инвентаризация предоставленного legacy `.atbackup`

**Статус:** `PARTIAL / NOT DONE`, read-only исследование от 2026-10-15.
**Нормы:** Product §46.6, TECH T02, backlog R02; зависимость S04.
Исходник расположен вне Git-репозитория. Строки клиентов, идентификаторы
аккаунтов, заметки и другие персональные значения не выводились и не
копировались в проект.

## Повторяемый инспектор (2026-10-15)

- `scripts/r02/LegacyBackupInspector.ts` открывает SQLite через read-only
  `DatabaseSync` в CLI и проверяет минимальную shape, manifest, ledger,
  binding, `integrity_check`, FK и агрегаты. Возвращаемый JSON не содержит
  значений строк, scope key или пути файла. `candidate` — только пригодность
  для дальнейшего исследования, **не** готовность к импорту.
- `scripts/r02/LegacySourceSelection.ts` принимает обнаруженные источники и
  блокирует неоднозначность: несколько DB, неизвестный marker, неподтверждённый
  binding/shape и дублированный source ID. Он не открывает/сливает БД.
- `npm run r02:test` использует только синтетические SQLite `:memory:` fixtures:
  один источник, две account DB, unknown marker, несовпадение binding,
  несовместимую схему, несколько workspace и повреждённый FK.
- Для локального smoke создать приватную временную **копию** вне Git и выполнить
  `npm run r02:inspect -- <temporary-copy.atbackup>`. Исходный файл напрямую
  CLI не передавать. Копию после проверки удалить, оригинал оставить.
- На копии переданного файла CLI вернул `status=candidate`, 0 integrity/FK
  ошибок, 43 таблицы, 27 клиентов и подтверждённый binding. Временная копия
  удалена. Это не подтверждает полноту app-private источников на устройстве.

## Проверенный файл

| Признак | Результат |
|---|---|
| Формат | SQLite 3, несжатый `.atbackup` |
| Размер | 324 919 296 байт |
| SHA-256 исходника и временной копии | `9ee5e1f60bc23e27207888fa0bd90e60f0d1665983859d485637494b6a30c303` — совпали |
| `integrity_check` / `foreign_key_check` | 0 ошибок / 0 ошибок |
| Таблицы | 43 |
| `PRAGMA user_version` | 0; сам по себе не определяет legacy schema |
| Backup manifest | 1 запись; `type=manual`, `formatVersion=1`, `appVersion=2.0.0` |
| Версии в manifest | `schemaVersion=25`, `sourceSchemaVersion=28` — ожидаемый compatibility export по Product §46.5 |
| `schema_migrations` | 25 записей, версии 1–25 |
| `account_database_binding` | 1 непустая запись; scope совпадает с `accountScopeKey` manifest |
| `clients.workspace_id` | 1 различное непустое значение среди 27 клиентов |

Проверка выполнялась `sqlite3 -readonly` на временной побайтовой копии;
исходный `.atbackup` не открывался SQLite и не изменялся. После проверки
временная копия удалена. Содержание `accountScopeKey` и других ID не
публикуется.

## Размеченная схема и контрольные количества

| Область legacy | Таблицы / контрольный count |
|---|---|
| Identity / client | `account_database_binding`, `clients` (27), `training_workspaces`, questionnaire, measurements (5), client day facts |
| Training plans / facts | `training_programs` (118), `training_weeks` (902), `training_workouts` (6 501), `training_sessions` (802), `training_session_sets` (20 973 строк источника, не подтверждённых фактов), logs, history, archive (6), library |
| Calendar | `calendar_appointments` (392) |
| Nutrition | `nutrition_days` (17), `nutrition_recipes` (0), `food_products` (1), KBJU state, archive weeks |
| Catalog / app | `exercise_catalog` (106), exercise identity unresolved, app settings, notifications/inbox, backup/import state |
| Legacy sync | cursors, operations, revisions; **не** целевая подсистема offline V1 |

Для непустых `client_id` в `training_programs`, `training_sessions` и
`calendar_appointments` не найдено ссылок на отсутствующего клиента (0/0/0).
Это дополнительная выборочная проверка, не замена семантической сверке всех
бизнес-фактов. `clients.workspace_id` не равен `account_database_binding.scope_key`:
это разные поля, их нельзя молча отождествлять.

## Неопределённости / следующий gate

Read-only попытка device inventory 2026-10-15: подключённое Android-устройство
видит установленный `com.fitcoach.app`, `versionCode=128`. Команда `run-as`
возвращает `package not debuggable`; прямой `ls` приватного каталога приложения
возвращает `Permission denied`. В `pkgFlags` нет `ALLOW_BACKUP`. Поэтому
app-private пути и количество account DB **не подтверждены** через ADB.
Root, обход sandbox, uninstall, clear-data или переустановка 2.0 не выполнялись.
Без штатного экспорта/диагностики самой версии 2.0 либо иной разрешённой
копии инвентаризация остаётся открытой.

1. Наличие одного binding **внутри этого файла** не доказывает, что на устройстве
   нет других account-scoped DB. Для in-place migration нужен отдельный
   read-only inventory app-private путей и identity binding. При неоднозначности
   — `BLOCKED_AMBIGUOUS_SOURCE`, без автоматического объединения.
2. Product §46.5 прямо описывает `BACKUP_COMPATIBILITY_SCHEMA_VERSION=25`:
   рабочая схема 28 экспортирует совместимый snapshot с ledger 1–25. Это
   объясняет метаданные, но фактическое наличие/семантика колонок всё равно
   проверяются перед mapping. `appVersion=2.0.0` не доказывает, что файл
   получен именно из build120; установленный APK ранее имел versionCode 128.
3. Синтетическая R03-fixture есть, но нет обезличенной **реальной** fixture и
   проверенного source→target mapping. Этот личный backup не включать в Git/CI
   и не считать миграционным golden.
4. R03/R04/D01 остаются открытыми; никакой production DDL, restore или cutover
   по итогам этой инвентаризации не выполнялся.
