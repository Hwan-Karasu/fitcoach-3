# Progress — 2026-10-28

## Сделано
- 2026-10-28 (ADR-048) PERF-PLAN-BATCH, PERF-REST-DOCK, CAL-WORKOUT-LINK: пачечная запись плана, таймеры на UI-потоке, исход тренировки
  отмечает запись календаря. test:foundation 1042/1042, training 276/276, calendar 24/24. На телефоне не проверено.
- 2026-10-28 (ADR-047) TEXT-LOG-3: «Импорт из заметок» по макету — единый список, пикер тренировки, дубль/копирование подходов,
  панель «Будет создано», шаг «Тренировки» (название обязательно). test:foundation 1030/1030, excel 99/99, training 265/265. На телефоне не проверено.
- 2026-10-28 (ADR-045/046): IMPORT-HINT-SCROLL, CYCLE-PRESETS, TEXT-LOG (импорт из заметок), EXCEL-AI (образец+промпт, синонимы),
  BUILDER-FACTS (факты в карточке конструктора) + исправления ревью (7bb8ccc). test:foundation 1028/1028, training 265/265,
  excel 98/99 (I07, старая поломка). На телефоне не проверено.
- build33 (2026-10-28): техдолг закрыт — тест I07 (excel 99/99), ExerciseCard из ExerciseCardShell, expo-clipboard
  («Скопировать промпт»); правки UI-CHART-SUPERSET/build32 закоммичены. APK собран, на телефон не ставился.
- UI-MATRIX-READ / CAL-PAST-EDIT / CAL-DUTY-DAY (ADR-044): матрица недель крупнее и разделена по блокам (масштаб 0,9); прошедшая запись правится как будущая, кнопки исхода одним рядом; дежурство и пресеты — касанием дня в шапке. test:foundation 1013/1013, calendar:test 23/23; на телефоне не проверено, в APK не входит (docs/PROJECT_STATUS.md).
- BOOT-ROUTE-1: отделён стартовый маршрут от generation обслуживания. Проверка журнала/повтор запуска ведут на главный экран, операция из APP_READY возвращает к копиям. 47/47 целевых тестов PASS; в build29 не входит.
- UI-HEADER-WRAP: метаданные дневника переносятся целыми элементами, длинный текст пилюль ограничен карточкой; подпись программы без многоточия. Typecheck/lint/source/diff PASS. Собран build29 arm64; aapt/apksigner PASS, сертификат совпадает с build28. Визуальная проверка ширин и шрифта открыта (docs/PROJECT_STATUS.md).
- R04-RETIRE (ADR-043): удалены scripts/r02, r03, r04 и 29 файлов r0x-*, команды r02–r04 в package.json,
  nutrition history reader/port/snapshot, ClientWorkDataModel. Два теста (workout-date-evidence,
  training-history) переписаны на литералы WorkoutDateEvidence.
- CA-аудит (docs/CODE_AUDIT_2026-10-27.md): этапы A–E сделаны; CA-15 закрыт IMPORT-V2 S4 (CA-29), CA-22, CA-25, CA-27 закрыты.
- IMPORT-V2: S1–S5 готовы (CA-29).
- POLISH-1 (проход 2 аудита): 35 документов R02–R04 + HANDOFF → docs/archive/migration-2.0; CI: шаг с excel/training/r06/d01.
  Лишнего кода, зависимостей и ассетов не найдено (кроме flash-list). Проверки: test:foundation 966, excel:test 96.
- EDITOR-FIX-1: очистка плановых значений и статусы недель в редакторе (7deb80e).

## Открыто / техдолг
- Смена недели в конструкторе мезоцикла медленная (создание ~23 карточек, WorkoutsEditor.tsx / Sortable.Grid) — решено оставить; варианты в docs/PROJECT_STATUS.md.
- Решения владельца из POLISH-1 (P-01…P-07 в CODE_AUDIT): разрешения Android RECORD_AUDIO/CAMERA/SYSTEM_ALERT_WINDOW
  (app.json), icon.png 2,2 МБ, токен scrim ×26, CI arch:check без assets/exercises, flash-list, отчёты docs/ui, старые APK.
- AUD26-01 удаление клиента (training_transfer_receipts); AUD26-04 sync-v2-workbook.ts читает соседнюю папку FitCoach_2_Excel.
- CA-23 импорт больших книг (не воспроизведён); CA-24 inline requires; CA-19 нет react-hooks lint;
  CA-12 DevTrainingPlansRepository.ts 1733 строки — решено не трогать.
- I01-USER-PARITY: 544 значения и 243 занятия без даты (дата остаётся «неизвестно»).
- REL-ANDROID: debug-подпись, release-подпись не проверялась; releaseReady:false.

Архив: memory-bank/archive/progress-before-retire-2026-10-27.md (в нём блоки R04 2026-10-23/24).
