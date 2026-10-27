# Progress — 2026-10-27

## Сделано
- R04-RETIRE (ADR-043): удалены scripts/r02, r03, r04 и 29 файлов r0x-*, команды r02–r04 в package.json,
  nutrition history reader/port/snapshot, ClientWorkDataModel. Два теста (workout-date-evidence,
  training-history) переписаны на литералы WorkoutDateEvidence. Проверено: typecheck, lint, arch (579),
  source:verify, secrets, test:foundation 955/955 (было 1395 — ушли тесты r0x), excel:test 95/95,
  r06:test 248/248, d01:test 26/26, training:test 258/258.
- Аудит готовности переноса: путь прямой миграции был ≈ 30 % (отменён), путь Excel ≈ 55–60 %.
- CA-аудит (docs/CODE_AUDIT_2026-10-27.md): этапы A–E сделаны; CA-22, CA-25, CA-27 закрыты; Excel I07 = 2e7e0fe.
- IMPORT-V2: S1 (69e48e1), S2 (f357369) готовы.

## Открыто / техдолг
- IMPORT-V2 S3–S5; AUD26-01 удаление клиента (training_transfer_receipts); AUD26-03/04 CI не гоняет excel:test,
  тест 2.0 читает соседнюю папку FitCoach_2_Excel.
- CA-23 импорт больших книг падает (ждём владельца); CA-24 inline requires; CA-15 DevTrainingExecutionRepository.ts:158 N+1;
  CA-19 нет react-hooks lint; CA-12 DevTrainingPlansRepository.ts 1711 строк — решено не трогать.
- I01-USER-PARITY: 544 значения и 243 занятия без даты (дата остаётся «неизвестно»).
- REL-ANDROID: debug-подпись, release-подпись не проверялась; releaseReady:false.

Архив: memory-bank/archive/progress-before-retire-2026-10-27.md (в нём блоки R04 2026-10-23/24).
