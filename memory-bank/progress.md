# Progress — 2026-10-28

## Сделано
- 2026-10-28 (ADR-052) исправления аудита: AUD28-02, 03, 09, 06, 11 (регрессионные тесты в workout-calendar-outcome и
  training-templates). test:foundation 1054/1054, training 281/281, excel 99/99, calendar 29/29. На телефоне не проверено.
- 2026-10-28 (ADR-049…051) шаблоны и циклы: TEMPLATE-OPEN-2/EDIT (шаблон любого вида открывается и правится в конструкторе),
  CYCLE-STRIP-3 (циклы переключаются на месте, CycleState.ts); удалены импорт из заметок (TEXT-LOG) и «образец и промпт для ИИ»
  вместе с expo-clipboard; добавлен «Образец для импорта» формата 2.0 (ImportSample.ts). build38–40.
- 2026-10-28 (ADR-048) PERF-PLAN-BATCH, PERF-REST-DOCK, CAL-WORKOUT-LINK, BUILDER-SLOTS, CAL-RANGE-CACHE: пачечная запись плана,
  таймеры на UI-потоке, исход тренировки отмечает запись календаря (миграция execution v4), кэш диапазонов календаря. build35–37.
- 2026-10-28 (ADR-045/046) IMPORT-HINT-SCROLL, CYCLE-PRESETS, BUILDER-FACTS, EXCEL-AI синонимы заголовков; тест I07/I06 поправлены.
  Остальное из TEXT-LOG/EXCEL-AI удалено (см. выше).
- UI-MATRIX-READ / CAL-PAST-EDIT / CAL-DUTY-DAY (ADR-044), BOOT-ROUTE-1, UI-HEADER-WRAP (build29).
- R04-RETIRE (ADR-043): удалены scripts/r02–r04, команды r02–r04, nutrition history reader, ClientWorkDataModel.
- CA-аудит (docs/CODE_AUDIT_2026-10-27.md): этапы A–E сделаны. IMPORT-V2 S1–S5 готовы (CA-29). POLISH-1, EDITOR-FIX-1.

## Открыто / техдолг
- AUD28-04: «Отменить завершение» не откатывает списание (accounting.settle) — решение владельца + тест ledger.
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
