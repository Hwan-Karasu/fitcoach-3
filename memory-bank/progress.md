# Progress — 2026-11-03

## Сделано
- 2026-11-10 UIX-05 срезы d, e (aa4859a, 99e6a35): КБЖУ без «Сохранить БЖУ»; «Расчёт» листом. Кружок «Сон» (cbb2619).
- 2026-11-10 UIX-08/09: экраны показателей (MetricScreen, useMetricSeries, MealMacroStats), статистика веса и % жира (NutritionStatsScreen, statsOfPoints); шапка «Главной» у стека HomeStack.
- 2026-11-10 UIX-07: дневник питания (DayTotalsCard, подписи колонок, карточки радиуса 26); логика не менялась.
- 2026-11-10 UIX-06: «Профиль и активность» с «По обхватам | По рисунку», лист рисунков (18 webp), метод замера VISUAL_ESTIMATE (миграция v2 замеров, ADR-060); test:foundation 1111; на телефоне не проверено.
- 2026-11-10 UIX-05 срез c (1aee11e): данные дня кружками/плашками, ввод листом. test:foundation 1107.
- 2026-11-09 UIX-05 срезы a, b (3d22843): абонемент и общий выбранный день; AUD26-01 (f8f1694). Ранее UIX-01, UIX-02 (логика, UI, карточка), UIX-03, UIX-04, UIX-10 (логика): коммиты ff6336b…502c7c1 (git log --grep UIX); test:foundation 1105/1105; ревью reviewer по UIX-02/03/04 без блокирующих; на телефоне не проверено, APK не собирался. Остальное — docs/ui/UIX_BACKLOG.json.
- 2026-11-09 Health Connect: границы V1 изменены (AGENTS.md, README, projectbrief, LEGACY_CROSSWALK + дополнение владельца), ADR-059 APPROVED, распространение — APK «для своих», декларация Google Play отменена (заготовка сохранена); код не менялся.
- 2026-11-09 Закрыты остальные открытые вопросы плана (закрытие записи без подтверждения, рисунки, сон, Google Play); gate Health Connect остаётся.
- 2026-11-09 Ответы владельца на открытые вопросы плана внесены (ONLYFITS_IMPLEMENTATION_PLAN.md, UIX_BACKLOG.json, UI_STYLE_DECISIONS.md, ADR-059); разрешена библиотека Health Connect, gate — границы V1 и Google Play.
- 2026-11-09 UI-концепт «в духе Onlyfits»: решения UI-OWN-059…085 (PROPOSED), план `docs/ui/ONLYFITS_IMPLEMENTATION_PLAN.md`, задачи UIX-01…17 в `docs/ui/UIX_BACKLOG.json`. Код не менялся, на телефоне не проверено.
- 2026-11-09 (ADR-058) REST-END-1, CAL-DONE-1, REST-INSET-1, INPUT-LAG-1: окончание таймера из трёх источников и один раз, «Отдых окончен»;
  «Завершить» отмечает и не начавшуюся запись, «Сегодня» держит только запись без исхода; запас под панель таймеров = перекрытие;
  показанный слот не вытесняется коммитом собственной записи. Тесты: rest-timer, workout-calendar-outcome, roster-overview,
  rest-dock-spacer (новый), training-snapshot-cache. На телефоне не проверено; вклад INPUT-LAG-1 в задержку не измерен.
- 2026-11-03 (ADR-057) BKP-DIAG-1, BKP-LOCK-1, BKP-STAGE-1, BKP-PERF-1/2/3, BKP-BUSY-1: причина сбоя копии по этапу и код на экране,
  одна очередь ручной/авто, этапы/процент/время, хеш порциями по ключу, одна копия SQLite, без записей — без копирования. build47.
  Тесты: backup-coordination (новый), r06-portable-snapshot (keyset = оракул), r06-backup-media (seal с известным хешем),
  shared-database-maintenance (changeToken). Замер ПК: scripts/backup-bench.ts. На телефоне не проверено.
- 2026-10-28 и ранее — memory-bank/archive/progress-before-backup-audit-2026-11-03.md.

## Открыто / техдолг
- INPUT-LAG-1: причина задержки ввода у владельца не измерена; если после новой сборки p95 («Report cell input latency») заметен —
  следующий срез: вынести карточку упражнения WorkoutScreen в memo-компонент (WorkoutScreen.tsx, блок `supersetRuns(...).map`).
- REST-INSET-1: `RestDockSpacer` считает низ окна по `useWindowDimensions` (Android edge-to-edge может дать погрешность в несколько dp).
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
- AUD26-01 закрыт 2026-11-09 (см. activeContext); AUD26-04 sync-v2-workbook.ts читает соседнюю папку FitCoach_2_Excel.
- CA-23 импорт больших книг; CA-24 inline requires; CA-19 нет react-hooks lint; CA-12 DevTrainingPlansRepository.ts — решено не трогать.
- I01-USER-PARITY: 544 значения и 243 занятия без даты. REL-ANDROID: debug-подпись, releaseReady:false.

Архив: memory-bank/archive/progress-before-audit-fixes-2026-10-28.md (журнал TEXT-LOG/EXCEL-AI и build33–37),
progress-before-retire-2026-10-27.md (блоки R04).
