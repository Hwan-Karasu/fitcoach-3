# Active context — 2026-10-23

Продукт «Дневник атлета», ветка audit/training-fixes. Цель ACTIVE: полный
перенос 2.0→3.0 и backup/restore не завершены; 100% не заявлять. Task R06.
R06→R03, D05→D01/R06, D03→R04/R05; Product §46 и §§53–56.
Migration/overlay/signing/release gates OPEN; UI/темы позже.

HEAD до текущего среза faf5fce: native publication + atomic restore journal.
Текущий срез добавляет private Return point и обязательную v2 finalization.
ReturnPointCompletion общий pure TS, ExpoReturnPointStore private FS adapter;
models в features/backup/domain/RestoreCompletion.ts. RestoreProtocolError и
RestoreOutcome вынесены в domain, прежний public API/reexports сохранены.

Одна closed lease: pin/валидация LIVE/INCOMING → полный return.atbackup из LIVE
(с фото) → completion.json → v2 pending.json → GuardedRestore → atomic
return-state.json → reopen/cleanup прежней точки. State хранит settledOperationId
и одну point либо null; explicit delete/Return сохраняют receipt, cold boot не
воскрешает точку. При rollback прежняя point сохраняется; повреждение нового
неиспользованного candidate не мешает безопасному cold rollback.
Guard version всё ещё1, routing v2 требует completion; v1 оставлен для прежних
technical probes. Cold production reader подключён. Новый Restore сначала
завершает finalization прежнего terminal v2 job перед сменой routing pointer.
Обычный Restore UI/controller/preview/confirmation ещё НЕ включён.

Host return-point32/32: цепочка30→25→30 + точный PNG после потери исходника,
restart/поздние записи, следующий Restore, ошибки подготовки/swap/state/cleanup,
corrupt intent, реальные RuntimeMaintenance gate/reopen. 14 настоящих SIGKILL
Restore/Return; новая reader/finalizer связка проверена на host.
Foundation1051/1051, root/mobile/spike typecheck, lint, arch487, source/secrets/diff
OK. Android JS/Hermes bundle5605modules/1185assets. Native point/v2 не запускались.

Ранее native build успешен: JDK17.0.10/Gradle9.3.1,
JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true решает MavenPermissionDenied.
Local Expo module versionName/Coroutine import исправлены; TLS не ослаблять.
Isolated com.fitcoach.r07sqlite: Downloads20/20, SAF19/19; native+JS readback,
duplicate/input negatives, restore client/recipe/photo после удаления оригиналов,
15holders; SAF grant после нового процесса. Исправлен trailing raw slash URI.
Тестовая APK удалена, внешний synthetic Downloads-файл остался. Reinstall/picked
restore НЕ выполнены: пользователь не может установить, продолжать БЕЗ APK.
Не запускать новые установки. 2.0com.fitcoach.app build128 и личные backup целы;
личные .atbackup/секреты не открывать. Ключ/рисунок не сохранять и не вводить.
Scrcpy Phone screen оставить открытым (старыйPID12676). MainMetro8096handle16439
stdin закрыт; nativeMetro8097handle99958watch. Не перезапускать без нужды.

ManualBackupService и экран настроек подключены, операции ExpoGo/dev отключены.
Dev baseline fitcoach_dev_baseline_v3.db: сохранены64таблицы/1150строк, parity
в транзакции; старые dev файлы/журналы сохранены. Shared runtime15owners+workflow,
physicalclose/reopen, whole-command gate, фото readiness7регрессий.
Прежние native snapshot19/recovery7 и runtime25/recovery11 не доказывают новый v2.

Далее без APK: общий Restore/Return/delete controller/UI port, picker/preview/
logical pin с WAL, явное подтверждение, free-space preflight, job orphan cleanup,
OS rest signal reconcile; затем auto30min/changed-data/3daily rotation. Native
v2/reinstall/providers/low-storage/full-owner matrix и полный legacy mapping/
staging/IDs/provenance/parity/retry OPEN. LOAD_REPS для2.0(20×10кг), отсутствующие
equipment/groups не угадывать. Excel после backup/restore: сначала GitHub
библиотеки, затем2.0 read-only. Подробно docs/HANDOFF_BACKUP_MIGRATION.md,
docs/spikes/R06_RETURN_POINT.md и R06_PUBLICATION_ANDROID_REPORT.json.
