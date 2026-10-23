# Progress — 2026-10-23

Перенос 2.0→3.0 и backup/restore ACTIVE, не 100%. Task R06; gates OPEN.

Сделано:

- D01 identity/owner baselines без dev_ и seeds, FK/целостность/устойчивый JSON.
- Общий SQLite snapshot engine: manifest/typed hash/media, staging/photo relocation,
  независимый Node oracle. Guarded restore: SAFETY/guard/receipts, rollback/replay.
- Runtime gate целых команд, 15 holders + workflow lease, physical close/reopen,
  cache reset; private journal recovery до boot. Поздний WAL после receipt сохраняется.
- Android synthetic snapshot normal19/recovery7 и runtime normal25/recovery11,
  deliberate force-stop и новый процесс. Не обычный UI E2E или full owner history.
- Готовность фото: copy awaited, save lock, cleanup ждёт commit/unmount; 7 регрессий.
- Native MediaStore/SAF publication module + TS receipt binding; autolinking найден.
  Kotlin compile и внешний IO не доказаны (см. ниже).
- ManualBackupService и экран настроек подключены: ручная копия/экспорт/папка,
  полная операция держит runtime gate; папка вне SQLite. Отмена/ошибки/duplicate
  admission/receipt/cleanup проверены. В Expo Go/dev операции отключены.
- Реальный Node snapshot пригоден после удаления исходной установки (publisher
  заменён на FS boundary). 12 новых controller/integration tests, 4 URI tests.
- Телефон: исправлены native path→file URI и dev boot mismatch, сохранены исходные
  dev-файлы/журналы. В baseline dev-базу перенесены 64 таблицы/1150 строк;
  добавлены parity и unsafe-integer rollback. Boot/settings/backup screen/re-entry
  проверены; копирование в Expo Go отключено. 2.0 build128 не трогали.
- JS/Hermes Android bundle 5600 modules/1136 assets; typecheck/lint/arch (480),
  source/secrets/diff прошли. Итоговый foundation 1002/1002.

Открыто:

- Native compile BackupStorageModule.kt: foojay plugin не закеширован, Java Maven
  Permission denied, PowerShell POM200. Без TLS/framework ослаблений нужны зависимости
  и изолированная APK; MediaStore/SAF readback/rights/kill/low-storage/reinstall.
- Restore controller/preview/confirmation/job writer, Return с фото, autoscheduler,
  три ежедневных auto copies/rotation, full-owner matrix. UI пока лишь manual copy.
- RestTimerService.recover: reconcile прежних/восстановленных OS-сигналов после
  замены без permission prompt при обычном boot. Drain уже проверен.
- Полный legacy mapping/staging всех owners/историй, IDs/provenance/parity/retry.
  LOAD_REPS утверждён; отсутствующие equipment/groups не угадывать.
- После backup/restore — Excel import/export: сначала GitHub, потом 2.0 read-only.
- Ручной photo-picker E2E и последующая шлифовка UI/тем.

Точка продолжения: docs/HANDOFF_BACKUP_MIGRATION.md,
docs/spikes/R06_MANUAL_BACKUP.md. Историческая память в archive/.
