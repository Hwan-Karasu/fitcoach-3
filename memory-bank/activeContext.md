# Active context — 2026-10-23

Ветка audit/training-fixes, продукт «Дневник атлета». Цель ACTIVE:
полный перенос 2.0→3.0 и backup/restore не завершены, 100% не заявлять.
Текущий task R06; migration/overlay/signing/release gates OPEN. UI/темы позже.

Текущий срез подключил ManualBackupService, отдельный snapshot job, настройку
папки вне SQLite и экран Настройки → Резервные копии. Полная операция держит
RuntimeCommandGate до закрытия reader и завершения публикации/cleanup. Отмена,
ошибка и повторный тап не создают ложный успех. Разовый экспорт не меняет папку.
UI показывает понятные сообщения без кодов/путей. В Expo Go/dev операции отключены.

На телефоне исправлены startup bugs: SQLite default directory — native path,
файловому API нужен file URI (SqliteDirectoryUri); jobs теперь ленивые,
cold recovery без pending.json не конструирует LIVE. Пустой переходный
fitcoach_dev_v3.db имел старые журналы. Назначение baseline теперь
fitcoach_dev_baseline_v3.db: из наполненного fitcoach_f04_clients_dev.db
перенесены 64 таблицы/1150 строк, проверены внутри транзакции. Прежние файлы и
журналы сохранены; dev-клиенты видны. Unsafe JS integer отклоняется без округления.
В Expo Go filesystem может скрывать native SQLite directory: File.exists не
доказывает отсутствие dev-источника. Не подменять SQLite-проверку этим API.

Телефон: boot, настройки, экран копий, возврат/повторный вход проверены. Установленная
2.0 build128 и её данные не затронуты; личные backup-файлы не открывались.
Scrcpy «Phone screen» оставить открытым; владелец разблокировал телефон сам.
Ключ/рисунок не сохранять и не повторять попытки ввода.
Android JS/Hermes bundle: 5600 modules/1136 assets, не Kotlin/APK proof.
Предыдущий HEAD 0e0ffe4; текущий срез ещё фиксируется. Проверки/границы:
docs/spikes/R06_MANUAL_BACKUP.md, docs/PROJECT_STATUS.md.
Итоговый foundation 1002/1002, typecheck/lint/arch/source/secrets/diff зелёные.
Main Metro offline8096 (handle16439) и ADB reverse оставлены для продолжения;
у процесса закрыт stdin, перезагрузка через cold/warm Expo Go URI при необходимости.

Native publication module athlete-backup-storage (MediaStore pending + SAF
partial/rename/readback) автоподключается, но Kotlin ещё не скомпилирован:
нет cached foojay plugin, Java Maven Permission denied, PowerShell POM 200.
Агентский HTTPS_PROXY — заглушка. Не отключать TLS и не менять framework ради
сборки. Нужны доступные зависимости и изолированная APK, потом реальный IO proof.

Ранее проверены общий snapshot engine/фото/scalar parity, runtime gate целых
команд, 15 holders + workflow lease, maintenance close/reopen/cache, cold journal
reader и receipts с поздним WAL. Android synthetic runtime normal25/recovery11,
полный snapshot normal19/recovery7 после deliberate force-stop. Это не обычный
UI restore E2E, не заполненная история всех owners и не OS scheduler.

Далее: native compile/publication; restore controller с явным подтверждением,
job/journal writer, Return point с фото, autoscheduler/rotation, OS rest signals,
native low-storage/reinstall/full-owner. Полный semantic mapping/staging всех
legacy owners ещё впереди: audits/projections и client rehearsal не равны полному
переносу. 2.0 упражнения LOAD_REPS (20 повторений ×10кг), неизвестные оборудование
и мышечные группы не угадывать. После backup/restore — Excel import/export,
сначала GitHub-исследование библиотек, затем 2.0 как read-only образец.

Подробная точка продолжения: docs/HANDOFF_BACKUP_MIGRATION.md.
Историческая память: archive/activeContext-before-backup-2026-10-23.md.
