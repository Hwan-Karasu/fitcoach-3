# Progress — 2026-10-23

Полная цель data migration 2.0→3.0 и backup/restore не завершена; работа ACTIVE.
Текущий task R06, production migration/overlay/signing gates остаются OPEN.

Реализовано и проверено:

- D01 production identity/owner baselines без dev_ и dev seeds, preflight;
  устойчивая обработка повреждённых JSON и ограничения целостности.
- Host single SQLite `.atbackup`, typed digest/manifest и embedded recipe photos,
  staging с сохранением всех полей кроме проверенного photoUri relocation.
- GuardedRestore с SAFETY/guard/receipts, rollback/replay; SharedSqliteDatabase
  quiescence ждёт readers/writers/native close перед файловой заменой.
- Общий mobile snapshot engine и Node/Expo adapters; forward migration checksum
  совместим с прежним форматом. INTEGER int64/REAL edge fixtures совпадают с
  независимым Node oracle на host и Android. Short photo reads собираются точно;
  изменение исходного файла откатывает metadata transaction.
- Photo readiness: async store/copy, save lock, lifecycle cleanup ждёт DB commit,
  late-copy после unmount удаляется; own-image path guard. Семь новых регрессий.
- Foundation 946/946, typecheck/lint/arch/source/secrets/diff и Android JS bundle.
  Android normal full-format 19/19, actual force-stop/recovery
  нового процесса 7/7. Отчёт: `docs/spikes/R06_FULL_SNAPSHOT_REPORT.json`.

Открыто:

- R06/D05: runtime controller, boot recovery, release всех repository/workflow
  leases и scheduler, UI confirmation/reopen/read models, SAF folder/file rights
  и publication, rotation/Return, native negative/low-storage/reinstall/full-owner.
- Ручной picker E2E для photo readiness пока не выполнен; lifecycle проверен
  автоматическими тестами, UI скомпилирован production JS bundle.
- R04/D03/D04: закончить semantic mapping и staging всех legacy owners/историй,
  устойчивые IDs/provenance/parity/retry/kill/low-storage. Текущие audits и client
  rehearsal не равны полной миграции всех данных. LOAD_REPS для 2.0 утверждён
  владельцем; неизвестное оборудование/мышечные группы не угадывать.
- После backup/restore — Excel import/export по запросу владельца; сначала
  GitHub-исследование библиотек, затем 2.0 как образец. Пока не начато.
- UI/темы — последующая шлифовка.

Историческая память: `archive/progress-before-backup-2026-10-23.md`.
Актуальная подробная точка продолжения: `docs/HANDOFF_BACKUP_MIGRATION.md`.
