# Progress — 2026-11-03

## Сделано
- 2026-11-03 (ADR-057) BKP-DIAG-1, BKP-LOCK-1, BKP-STAGE-1, BKP-PERF-1/2/3, BKP-BUSY-1: причина сбоя копии по этапу и код на экране,
  одна очередь ручной/авто, этапы/процент/время, хеш порциями по ключу, одна копия SQLite, без записей — без копирования. build47.
  Тесты: backup-coordination (новый), r06-portable-snapshot (keyset = оракул), r06-backup-media (seal с известным хешем),
  shared-database-maintenance (changeToken). Замер ПК: scripts/backup-bench.ts. На телефоне не проверено.
- 2026-10-29 (ADR-055) AUTO-BACKUP-1/2/3, WRITE-PATH-1: нативный хеш файла автокопии, порции ≤ 8 мс, автокопия ждёт паузы в тренировке,
  одно соединение записи, одно перечитывание на серию подходов. Тесты: time-slice, local-file-sha256, automatic-scheduler,
  sqlite-isolated-connection, training-navigation. На телефоне не проверено.
- 2026-10-29 (ADR-054) SET-DONE-1, TPL-KIND-1, BUILDER-TABS-1, PROG-MENU-1, PART-DOCK-1, REST-NAV-1, UI-COMPACT-1, REST-PERF-1:
  см. docs/PROJECT_STATUS.md. Новые тесты: participant-group-state, TPL-KIND (training-transfer, training-templates, template-cycles),
  SET-DONE-1 (rest-timer, training-execution), REST-NAV-1 (notification-target), PART-DOCK-1 (training-navigation). На телефоне не проверено.
  Техдолг: триггер перечитывания дневника в живой сессии не установлен (useWorkoutSnapshot.ts: перечитывание того же слота закрывает
  ввод — ячейки теперь дописываются после загрузки, но причину перечитывания нужно поймать логом на телефоне); переход с таймера
  внутри того же клиента по-прежнему пересоздаёт экран клиента (PrototypeShell.tsx openTarget, `StackActions.replace`).
- 2026-10-29 (ADR-053) REST-FIX-1…7: см. docs/PROJECT_STATUS.md; тесты PERF-REST-ALL, active-workouts, training-execution («Макс.», «Пред.»).
  На телефоне не проверено. Отклонено: точечный сброс кэша планов по клиентам (ревизия программы общая).
- 2026-10-28 и ранее — memory-bank/archive/progress-before-backup-audit-2026-11-03.md.

## Открыто / техдолг
- Первопричина «Не удалось подготовить автоматическую копию» у владельца не установлена (ADR-057): нужен код этапа с экрана build47.
  Hermes-время копии не измерено — владелец присылает строку «Создана за N с» с разбивкой.
- Автокопия без записей не сверяет внешние файлы (AutomaticBackupService.ts, ветка changeToken): удалённая извне копия пересоздаётся
  после следующей записи или перезапуска. BackupExclusive.ts без таймаута: зависший нативный вызов держит очередь.
- Нативный publish читает файл 3 раза (SHA источника, запись с проверкой, чтение назад — BackupStorageModule.kt Publisher.publish);
  проверка каждой версии в inspect — полный SHA через провайдер. Не менялось: нативное, вне JS-потока; оценить по замеру этапа «запись».
- Зависание при быстрой записи подходов (ADR-055): причина «автокопия на JS-потоке» установлена по коду, не на телефоне. Если после
  build45 зависание повторится и время автокопии с ним не совпадёт — замер на устройстве (профилировщик Android).
- AUD28-10: SegmentedControl со скольжением (SegmentedControl.tsx): индикатор не пересчитывается при смене текста выбранной
  вкладки, возможное мигание при первом показе — проверить на телефоне.
- Смена недели в конструкторе мезоцикла медленная (WorkoutsEditor.tsx / Sortable.Grid) — решено оставить; варианты в docs/PROJECT_STATUS.md.
- Решения владельца из POLISH-1 (P-01…P-07 в CODE_AUDIT): разрешения Android RECORD_AUDIO/CAMERA/SYSTEM_ALERT_WINDOW
  (app.json), icon.png 2,2 МБ, токен scrim ×26, CI arch:check без assets/exercises, flash-list, отчёты docs/ui, старые APK.
- AUD26-01 удаление клиента (training_transfer_receipts); AUD26-04 sync-v2-workbook.ts читает соседнюю папку FitCoach_2_Excel.
- CA-23 импорт больших книг; CA-24 inline requires; CA-19 нет react-hooks lint; CA-12 DevTrainingPlansRepository.ts — решено не трогать.
- I01-USER-PARITY: 544 значения и 243 занятия без даты. REL-ANDROID: debug-подпись, releaseReady:false.

Архив: memory-bank/archive/progress-before-audit-fixes-2026-10-28.md (журнал TEXT-LOG/EXCEL-AI и build33–37),
progress-before-retire-2026-10-27.md (блоки R04).
