# Active context — 2026-10-23

«Дневник атлета», audit/training-fixes. Goal ACTIVE: полный перенос2.0→3.0 и
backup/restore не завершён, не100%. Task R06→R03, D05→D01/R06, D03→R04/R05;
Product §46, §§53–56. Migration/overlay/signing/release gates OPEN.
UI/темы потом; Excel послеbackup/restore: сначалаGitHubбиблиотеки, потом2.0read-only.

Важно: владелец попросил целевые проверки вместо постоянного полного прогона.
Выбирать tests по изменённому коду/зависимостям; full foundation только на крупных
контрольных этапах. Не повторять все тесты после мелких isolated изменений.

База текущего среза24b8344 (Androidv2/Return +confirmedcore).
Теперь подключены ExpoRestoreJobs/createRestoreActions→ApplicationRuntime→BackupScreen:
SDK57picker→private inspection/staging/photos→online current copy logicalpin→preview
ID/date/clientcounts→Alert explicitconfirm. Dev/ExpoGo отключены; productioncapability
требуетnative module. Apply физически закрывает15holders+workflow, проверяетlogicalLIVE/
rawINCOMING/availableDiskSpace до v2point/journal/swap. Stale businesswrite требуетновый
выбор, harmless WALcheckpoint допустим. cancel/lateprepare cleanup внутриcommandgate;
apply внеgate безself-deadlock. Generationkey сбрасывает UI/drafts дажеприReactbatching;
после reopen Backup route с рабочимBack. Recovery retry вместо требованияrestart.

Private owner.json/UUID jobs. Discard/orphancleanup не трогаютunknown/corrupt metadata,
pending/activepoint. Terminalбольшиеinspection/preview/SAFETY/PREVIOUS удаляются;
guard/completion/pending/active return.atbackup остаются. GC generatedrestore images
толькоclosedruntime: всеrecipe refs включаяархив, protectedpreviews, verifyactivepoint.
Удаляютсятолькоunreferencedgeneratedfiles; повреждениеJSON останавливаетGC.
Незавершённыйprocessdeath cleanup до следующегоprepare ещёможетоставитьorphan.

RestTimerService.suspendSignals ждётlate schedules; boot/reopenrecoverreconciles OS.
ClearRestSignals фильтруетactualOSdata.kind=rest-timer, включаяshown/launchresponse.
ImportedsignalIDs неавторизацияcancelcalendar/otherkinds. НовыйID/прежнийendAt/
paused/expired/nopermissionprompt; OSfailure неубираетvisualtimer. Latepausedsignal
отменяется, failedIDpersistence отменяетfreshsignal. NativeOSsignalE2EещёOPEN.

NativeACTIONS24/24 (284130ms всяfixture, неRestorelatency): тотжеjobs/controller/core,
15holders/workflow; preview/cancel/stale/reopen/orphans, Restore/точноефото/Return/
mediaGC послеembeddedpoint, laterwrites, secondRestore/delete/noresurrection.
Послепоследнихrecoveryreceiptправок focusedACTIONS_RECOVERY3/3 за6463ms на тойжеfixture.
RecoveryсвязываетreceiptсpreviewID:commit успех,rollback прежниеданные,oldreceipt CHECKED.
PointsummaryIOпослеverifiedrecovery неблокируетздоровуюLIVE; refreshповторяемый.
Reports docs/spikes/R06_RESTORE_ACTIONS_ANDROID_REPORT.json и R06_APPLICATION_RESTORE.md.

Validation: foundation1086/1086 наинтеграционномсрезе; послеfinalisolatedrecoverychanges
целевыеcontroller15/15 (fullповторноНЕзапускался). Root/mobile/spikeTS, fullintegration
lint+finalchangedfiles, arch494, source/secrets/diff; bundle5614modules1185assets.
ПредыдущийAndroidv2 normal35/rollback12/commitgap13; reinstallpicked6, Downloads20/SAF19.
Владелецзавершилустановкуотдельнойcom.fitcoach.r07sqlite0.0.1; новыхустановокненужно.
2.0com.fitcoach.appbuild128/version2.0.0целы. ЛичныеDB/backup/секретынеоткрывать;
графическийключневводить/несохранять. Dev64tables1150rows/oldfilesсохранены.

Далее: enabledordinaryUI E2E (picker/Alert/Back/remount/recovery), nativeOSsignals;
auto30min/changeddata/3dailyrotation, first-runrestorechoice, publicationdeath/partial/
ENOSPC/providers/fullpopulatedowners. Полныйlegacy mapping/staging/stableIDs/provenance/
parity/retry OPEN; LOAD_REPS2.0(20×10кг), unknownequipment/groupsнеугадывать.
Неподменятьцельготовым3.0snapshot:2.0→3.0всехданныхещёнеподключён.

NativeMetro8097handle99958WATCH подтверждёнlive; main8096handle16439старыйнепроверен.
Phone testPID9181, последнийfocusedreportзавершён; nopendingkillprobe. Reverse8081→8097.
ScrcpyPhone screenоставить. Переддействиямипроверятьforeground/lock; нерестартовать
процессыиз-заtimeout. Подробно docs/HANDOFF_BACKUP_MIGRATION.md.
