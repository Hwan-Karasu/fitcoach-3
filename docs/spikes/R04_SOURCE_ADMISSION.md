# R04: проверка SQLite-кандидата до чтения бизнес-строк

2026-10-24, база229e880. Входы: закрытая inspection copy и проверенный bytes/SHA
receipt, legacy metadata/schema_migrations/clients/backup_state. R04→R03;
Product §§46.6,48.5.7,49–50,53–56 / INT-03–12. Production DDL/migration/overlay/
signing/release gates OPEN; только синтетические private источники, без телефона.

## Общий путь

`LegacyBackupReadPlans` исполняется теми же sync Node и async mobile executor.
Исторический `inspectLegacyBackup` теперь возвращает прежний aggregate inventory
из общего плана и держит собственный read snapshot только если caller его не открыл.
Он остаётся предварительным отчётом, не доказательством допуска полноценного файла.
Новый Node `admitLegacyBackup(db,fileBytes)` и mobile admission используют один
строгий план. Внешний CLI output не получает account/database/client identities.

`readLegacyInspectionCopy` больше не принимает произвольный accountScope.
После проверки byte receipt открывается только private copy. В одном pinned BEGIN:
проверка формата/metadata/ownership consistency → извлечение scope/workspace →
collectors Nutrition/Measurements/Calendar. При отказе бизнес-строки не читаются.
После закрытия SQLite повторно сверяются hash/header/sidecars/receipt.

## Что проверяется

- Физические required tables/columns и canonical-v25 training table presence.
  Представление не заменяет обязательную таблицу, generated column — physical field.
- Manifest formatVersion1/schemaVersion25, ровно одна metadata row, id1.
  Обязательные appVersion/type/createdAt/backupId/databaseId/dataRevision/databaseSize.
  sourceSchemaVersion остаётся optional; если есть — целое не меньше25, без defaults.
- Журнал содержит ровно INTEGER1…25 без дыр/повторов/текстовой подмены.
  MAX и CASE-выборка не передают unsafe SQLite INTEGER в JavaScript.
- Manifest databaseSize совпадает с receipt bytes и page_count × page_size;
  backup_state singleton/id1/database_id/data_revision совпадает с manifest.
- PRAGMA integrity_check даёт ровно одну строку ok, foreign_key_check — ноль строк.
- Непустой manifest accountScopeKey точно совпадает с единственной binding row.
  Сравнение JS exact, без влияния SQLite NOCASE. Workspace считается с BINARY
  identity; NULL/non-text/пустые, в том числе JS whitespace-only строки, блокируют
  неоднозначного владельца. Для действительно пустой clients workspaceId=null.

Это **согласованность namespace источника**, не авторизация/логин и не серверная
проверка владельца. Старые роли/permissions/backend не включаются в продукт3.x.
Строки с одинаковыми именами не объединяются, target workspace не угадывается.

Metadata JSON читается с точными числовыми токенами: длинная дробь не становится
целой версией, underflow не становится нулём. Точные целые с exponent spelling
принимаются. Не представимые как safe integer значения не превращаются в defaults.
Manifest ограничен длиной16384 в SQL и повторно в JS. Наружу ошибок выходят агрегаты и
фиксированные причины, без raw JSON/идентификаторов/SQL integrity diagnostic text.

## Первичные источники

Проверен pinned legacy commit e116b42e95f70a5a5e563420ab25394944c59ffd:

- [sqliteBackupFormat.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/backup/services/sqliteBackupFormat.ts):
  format1, optional sourceSchemaVersion, обязательные поля, file size и revision checks.
- [backupTypes.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/backup/backupTypes.ts):
  структура manifest manual/auto, account scope и revision metadata.
- [BackupRevisionRepository.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/BackupRevisionRepository.ts):
  backup_state id1/database_id/data_revision.
- [sqliteDatabaseValidation.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/sqliteDatabaseValidation.ts):
  integrity/FK и required training tables, включая technical permissions table.
- [accountDatabaseBinding.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/accountDatabaseBinding.ts):
  singleton binding и источник account scope; startup/auth flow не переносится.

Canonical25 — текущий поддержанный SQLite candidate, зафиксированный ещё R02.
Это не универсальный допуск всех SQLite/JSON файлов 2.0 или неизвестных версий.
Другие варианты требуют собственных проверенных адаптеров, а не запуска миграций
на source. Даже прошедший candidate ещё требует полного R04 schema/row coverage,
relations, provenance, mapping/parity; сам по себе он не разрешает cutover.

Private admission сохраняет проверенные sourceDatabaseId/dataRevision/backupId/
createdAt для последующей lineage; эти поля не входят в публичный aggregate report.
Export createdAt не используется как дата тренировок, замеров или других фактов.

## Доказательства и границы

10 новых admission tests +1 file-entry rejection +1 existing-tx ownership test:
Node strict == mobile strict; matching metadata derives scope, data follows gate;
bad binding/version/ledger/revision/singleton/shape/NULL/Unicode whitespace/NOCASE,
malformed/oversized/missing fields, size mismatch, fractional/exponent/underflow
tokens, unsafe revision/storage, real orphan FK, synthetic non-ok integrity,
empty clients, every observed native IO failure closes/retries. PII markers do
not appear in report/errors. Byte-perfect SQLite with wrong binding fails through
the actual copied-file entry before domain SELECT *, source bytes unchanged.

152/152 targeted inventory/fixtures/preflight/copy/source/JSON/admission PASS.
После JS-whitespace validation16/16, после сохранения verified lineage metadata
последние20/20 PASS. Root/mobile TypeScript,
scopedlint/source73/arch533/secrets/diff PASS. Mocked Expo driver теперь проходит
этот gate на реальных host-файлах; это не Android/SAF или process-kill evidence.
Полный foundation/687 area/bundle/APK не запускались.

Остаются остальные collectors, full schema/relations/lineage coverage, постоянная
Execution/review/provenance модель, mobile writer, production admission/composition,
backup всех данных, JSON/другие source variants, orphanGC/powerloss/Android kill,
полный restore и proof выпуска без импортёра. Goal ACTIVE, не100%.
