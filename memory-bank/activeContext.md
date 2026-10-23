# Active context — 2026-10-23

Ветка audit/training-fixes, продукт «Дневник атлета». Цель ACTIVE:
полный перенос 2.0→3.0 и backup/restore не завершены; 100% не заявлять.
Task R06; D05 зависит от D01/R06, D03 от R04/R05. Product §46 и §§53–56;
migration/overlay/signing/release gates OPEN. UI/темы позже.

Последний зафиксированный срез до текущего: 941db8c (ручная копия/runtime/UI,
dev boot). Текущий срез фиксирует native publication и atomic restore journal.
ManualBackupService/экран настроек подключены; Expo Go/dev операции отключены.
Runtime gate держит всю команду; папка вне SQLite, ошибки UI без системных кодов.
Dev baseline fitcoach_dev_baseline_v3.db: сохранены 64 таблицы/1150 строк из
старого prefixed файла, проверена parity в транзакции; старые файлы/журналы целы.

Native build теперь РАБОТАЕТ: JDK17.0.10, Gradle9.3.1,
JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true решает Java Maven PermissionDenied.
Исправлены defaultConfig.versionName и Coroutine import локального Expo module.
compileDebugKotlin и assembleDebug arm64-v8a успешны; TLS/framework не ослаблялись.
Isolated com.fitcoach.r07sqlite отдельно от 2.0: Downloads20/20, SAF19/19.
Native и независимый JS readback, input/duplicate negatives, удаление исходных
DB/snapshot/photo, restore внешней копии с клиентом/рецептом/точным PNG, 15 holders.
SAF persisted grant пережил новый процесс. Исправлен trailing raw slash Directory.uri,
encoded ID не меняется. Отчёт docs/spikes/R06_PUBLICATION_ANDROID_REPORT.json.

Тестовая APK удалена; public Downloads-файл сохранился. Reinstall/picked-file
restore НЕ выполнены: пользователь не может установить и велел продолжать БЕЗ APK.
Ожидание adb install остановлено, повторно установку не запускать. Это не общий
blocker. 2.0 com.fitcoach.app build128 не затронута; личные .atbackup не открывать.
Scrcpy Phone screen оставить открытым; Android скрывает защищённый ввод ключа.
Ключ/рисунок не сохранять/не вводить. PID окна может измениться; старый12676.
Main Metro8096 handle16439 stdin закрыт; native spikeMetro8097 handle99958 watch.
Не перезапускать без нужды, не считать наличие Metro доказательством APK.

JournaledRestore удерживает одну closed lease для pin/validation/journal/readback/
GuardedRestore, не затирает незавершённую старую операцию. ExpoRuntimeRestoreJournal
пишет private pending-UUID.next→pending.json; cold reader использует тот же adapter.
Parser копирует значения до await; terminal replay сохраняет поздние записи.
Host runtime recovery33/33, включая пять настоящих SIGKILL нового writer;
foundation1019/1019, root/mobile/spike typecheck/lint/arch483/source/secrets/diff OK.
Новый writer на Android ещё НЕ проверен. Прежний native normal25/recovery11 относится
к reader/runtime + ручному pending, не выдавать за новый writer E2E.
Обычный Restore UI не включён: Return с фото/controller confirmation ещё нужны.

Далее без телефона: Restore controller preview/confirmation, full Return snapshot
с фото/атомарное завершение после COMMITTED и cold recovery этой стадии; затем
auto30min/changed-data/3 daily rotation, OS rest signals. Native reinstall/writer/
publication death/low-storage/providers/full-owner matrix отложены, не закрыты.
Полный legacy mapping/staging/IDs/provenance/parity/retry ещё не завершён; audits/
client rehearsal не равны полной миграции. 2.0 упражнения LOAD_REPS (20×10кг),
equipment/groups не угадывать. После backup/restore Excel import/export, сначала
GitHub библиотеки, затем 2.0 read-only образец.

Подробная точка: docs/HANDOFF_BACKUP_MIGRATION.md,
docs/spikes/R06_JOURNALED_RESTORE.md и R06_ANDROID_PUBLICATION.md.
