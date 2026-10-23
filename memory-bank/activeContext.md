# Active context — 2026-10-23

«Дневник атлета», audit/training-fixes. Цель ACTIVE: полный перенос2.0→3.0 и
backup/restore не завершён; не100%. Task R06→R03, D05→D01/R06, D03→R04/R05.
Product §46, поздние §§53–56; migration/overlay/signing/release gates OPEN.

База текущего среза7eb66d9: общий snapshot engine+media, GuardedRestore,
RuntimeMaintenance15holders+workflow, whole-command gate, v2 routing/point completion.
ReturnPointCompletion/ExpoReturnPointStore: полный private return.atbackup с фото;
intent→pending→swap→point state в одной closed lease. Point одна, меняется после
успеха, Return без обратной точки. Settled receipt предотвращает resurrection
после consume/delete. Cold reader подключён, missing LIVE не создаёт пустую DB.

Текущий срез: RestoreActionsService/public opaque preview, ApplyPreparedRestore.
Whole-command picker/prepare, apply вне gate; frozen ID, двойное подтверждение,
Back/cancel, stale preview, recovery retry. Closed LIVE logical pin принимает
harmless WAL checkpoint, отклоняет business write; raw INCOMING pin, capacity
callback. Expected preflight rejection возвращает здоровую LIVE через reopen;
protocol uncertainty вызывает real cold recovery в той же lease до reopen.
12controller+13realSQLite/maintenance новых host tests; native job adapter/UI
ещё НЕ подключены. Не выдавать Android probe за проверку этих новых компонентов.

Владелец сообщил «вроде получилось установить»: отдельная com.fitcoach.r07sqlite
0.0.1 действительно установлена. Native v2 normal35/35; force-stop после swap
доCOMMITTED rollback12/12; force-stop послеCOMPLETED до point-state publication
recovery13/13. Оба force-stop/newPID подтверждены, перед последним state отсутствовал.
Return сохранил client/recipe/revision/date/точное фото после удаления оригиналов;
point consumed, поздние записи/cold replay сохраняются. Synthetic данные только.
Reinstall/picked restore6/6: private folder preference отсутствовала, выбрана только
точная известная synthetic Downloads-копия, внешний SHA равен до-uninstall SHA.
2.0com.fitcoach.app build128/личные копии не затронуты; не открывать их/секреты.
Не вводить/сохранять графический ключ. Новая установка не нужна.

Foundation1076/1076, root/mobile/spike typecheck, lint, arch490, source/secrets/diff
OK; Android JS/Hermes bundle5607modules/1185assets. Новый код/отчёты этой точки
зафиксировать R06 commit без push. Docs: R06_RESTORE_ACTIONS.md,
R06_MANAGED_ANDROID_REPORT.json, R06_PUBLICATION_ANDROID_REPORT.json.
Предыдущие native Downloads20/20, SAF19/19; module compiled JDK17/Gradle9.3.1,
JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true, TLS не ослаблялся.

Продолжить: ExpoRestoreJobs+createRestoreActions в app/composition, приватные UUID
jobs/ownership, picker→private copy→stage→logical preview pin, space/capacity,
cleanup только своих unpublished previews без activepoint/pending/LIVE media.
Подключить runtime.restoreActions→BackupScreen и retry recovery BootGate.
Gate уже unmounts UI nonACTIVE; добавить generation remount при быстром maintenance.
OS rest signals после restore/boot reconcile без запроса permission. Потом auto30min/
changed-data/3dailyrotation; native UI/providers/lowstorage/publicationdeath/full-owner.
Legacy full mapping/staging/stableIDs/provenance/parity/retry OPEN, LOAD_REPS для
2.0 (20×10кг), equipment/groups неизвестные не угадывать. Excel потом: GitHub
библиотеки, затем2.0 read-only; UI/темы позже. Данные dev64таблицы/1150строк и
старые файлы сохранены. Manual backup screen работает только native production.

Metro: native8097handle99958watch, main8096handle16439stdinclosed из прежнего turns;
перед использованием проверить live. Scrcpy Phone screen оставить. Не рестартовать
из-за timeout. Нет pending native kill probe: последний commit-gap report завершён.
