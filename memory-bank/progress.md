# Progress — 2026-10-23

Перенос 2.0→3.0 и backup/restore ACTIVE, не 100%. Task R06; gates OPEN.

Сделано:
- D01 owner baselines/identity/FK без dev_ и production seeds; устойчивый JSON.
- Общий SQLite snapshot engine manifest/typed hash/media/staging/photo relocation,
  независимый Node oracle. GuardedRestore safety/rollback/terminal receipts.
- Runtime gate целых команд, 15 holders + workflow lease, physical close/reopen,
  cold recovery до boot, поздний WAL после receipt сохраняется.
- Android synthetic snapshot normal19/recovery7 и runtime normal25/recovery11,
  deliberate force-stop. Это не full owner history или обычный Restore UI E2E.
- Фото readiness/save/unmount cleanup с семью регрессиями.
- ManualBackupService/controller/create/export/folder и экран настроек, whole-command
  admission, настройка вне SQLite. В Expo Go/dev отключено.
- Dev boot: native path→file URI, lazy jobs, baseline dev импорт64таблицы/1150строк,
  parity и unsafe integer rollback; исходные файлы/журналы сохранены.
- Native Kotlin compile и isolated arm64 APK успешны (JDK17/Gradle9.3.1/IPv4).
  Downloads20/20 и SAF19/19, persisted grant/new process, input/duplicate failures,
  restore client/recipe/photo после удаления оригиналов, все15holders. Исправлен
  trailing-slash mismatch SAF grant. Uninstall test APK оставил внешнюю копию.
- Atomic routing journal writer: одна closed lease pin→publish/readback→protocol,
  unfinished-operation protection, terminal replay, captured async confirmation.
  Host33/33 включает5настоящих SIGKILL writer+cold reader.
- Foundation1019/1019, root/mobile/spike typecheck, lint, arch483, source/secrets/diff OK.

Открыто:
- Reinstall/picked-file restore и новый writer на Android НЕ проверены. Владелец
  отложил установку; продолжать без APK, повторный install не запускать. 2.0build128
  и личные данные целы, ключ не сохранять/не вводить, scrcpy оставить открытым.
- Обычный Restore controller/preview/confirmation, full private Return с фото и
  атомарное закрепление/погашение; auto30min/changed data/3daily rotation.
- Native publication process-death/partial cleanup/low-storage/providers/full-owner.
- RestTimer OS signals reconcile после замены без permission prompt на boot.
- Полный legacy mapping/staging всех owners/историй, IDs/provenance/parity/retry.
  LOAD_REPS утверждён, отсутствующие equipment/groups не угадывать.
- Excel после backup/restore: сначала GitHub-библиотеки, затем 2.0 read-only.
- Ручной photo-picker E2E и последующая шлифовка UI/тем.

Точка продолжения: docs/HANDOFF_BACKUP_MIGRATION.md.
Доказательства: docs/spikes/R06_PUBLICATION_ANDROID_REPORT.json,
R06_ANDROID_PUBLICATION.md и R06_JOURNALED_RESTORE.md.
