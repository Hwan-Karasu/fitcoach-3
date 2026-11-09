# Progress: блоки 2026-10-29 (ADR-053…055), вынесены 2026-11-09

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
