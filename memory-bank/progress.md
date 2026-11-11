# Progress — 2026-11-11

Прежняя версия — `archive/progress-before-bkp-audit-2026-11-11.md`.

## Сделано
- **ARCH-HARDEN-1 (11 ноября):** 4 среза 1a–1d, см. `activeContext.md` и отчёт; стенд `apps/mobile/scripts/boot-bench.ts` (артефакты `artifacts/arch-hardening`). Техдолг из отчёта: `pending.json` не удаляется после восстановления (R1); 10–12 SQL на запись подхода (R2); `previousOf` и `listActiveWorkouts` без подходящего индекса (R3, R4); учёт и анкета по одному клиенту в `rosterOverview.ts:151` (R5).
- **UIX-FIT-11 (11 ноября):** 11a запуск/сводка/KAV, 11b таймер без вопроса + настройка, 11c карусель дней, 11d чип/подсветка/фильтры. typecheck, lint, arch, secrets, source PASS; test:foundation 1291/1291. На телефоне не проверено. Техдолг: мемоизация карточек приёмов `NutritionDiaryScreen.tsx` не сделана (нужен замер); `compactTimerCount` (`restPanelRules.ts:35`) не учитывает более широкий завершённый чип при нескольких таймерах.
- **UIX-FIT-10 (11 ноября):** 16 замечаний владельца к build52 — реализованы, кроме п. 4 (вес до сотых), п. 8 (свой календарь), п. 16 (замер). Новые чистые правила с тестами: `VisibleSetState`, `restPanelSettleTarget`, `sheetSettle`, `daySwipeOf/swipedDay`, `SideLabels`, `parseNumberRange`, `diaryDateChip`, `HealthSyncText`. На телефоне не проверено.
- **build52 (11 ноября):** APK собран (BKP-AUDIT-1 + UIX-FIT-09), все проверки PASS, давняя ошибка ESLint `extended.ts` исправлена. На телефоне не проверен. Lint под Node 24 ломается об `artifacts/r7-check` (старая копия проекта) — запускать из bash/Node 22.
- **BKP-AUDIT-1 (11 ноября, ADR-069):** см. `activeContext.md` и `docs/BKP_AUDIT_2026-11-11.md`. Новые коды ошибок восстановления, тихая фаза `LOADING`, отмена подготовки только кнопкой, этапы применения (проверка → точка возврата → замена), проверка по SHA-256 один раз на содержимое, пин `writeToken`, построчная проверка преобразования фото, нативный Kotlin-хеш с самопроверкой и JS-арбитром. Стенд: `apps/mobile/scripts/support/{restore-world,expo-backup-boundary}.ts`, замер `scripts/restore-bench.ts` (артефакты `artifacts/bkp-audit`). Тесты: `restore-pipeline.test.ts` (15), `restore-actions.test.ts` (+4), `native-hash-fixture.test.ts`.
- UIX-FIT-04…09 (UI-OWN-086…088, 10 ноября): «Питание» со статистикой значком, анкета/«Резервные копии»/конструктор по макету, «Создать программу» без прокрутки, таймеры в нижней панели по макету. Проверено в эмуляторе, на телефоне нет.
- build51/50 (10 ноября): подготовка восстановления (keyset вместо OFFSET, один входной проход), explicit `allowMissingOnUpgrade` для health, карточки 2×2, заставка ~2 с; APK build51 не установлен на телефон.
- REVIEW-R1…R7 (`docs/REVIEW_FIXES_2026-11-10.md`), AUDIT-ALL-1 (ADR-066), SIDE-RPE-1 (ADR-063), UIX-01…17 (Health Connect, `769d7a9`).

## Открыто / техдолг
- **BKP:** BUG-01 не воспроизведён — нужен код ошибки с телефона; Kotlin-хеш не запускался на устройстве; время Hermes/телефона и копия ~70 МБ не измерены; `BackupExclusive.ts` без таймаута нативного вызова; `BackupStorageModule.kt` читает файл трижды при публикации; `AutomaticBackupService.ts` не сверяет внешние файлы без записей. Остаточный риск F1 (native-хеш при создании без JS-подтверждения).
- Из ревью (`docs/REVIEW_FIXES_2026-11-10.md`): жесты `TimelineGrid.tsx:194,278` без `useMemo`; read-model ростера «нет данных календаря» = ноль; `restTimerDiagnostics.render` убрать после приёмки p50/p95; маршруты `WorkspaceDev`/`SqliteDev` в `PrototypeShell.tsx` без входа; `tabBarStyle: {height: 0}` (`RootTabs.tsx`, `ClientWorkspaceNavigator.tsx`); `ApplicationServices.weekCopy/weekSwap` без потребителей.
- UI: статусы IMPLEMENTED_NOT_DEVICE_VERIFIED не равны приёмке; остатки в `docs/ui/UIX_BACKLOG.json`. INPUT-LAG-1: если p95 заметен — memo-карточка упражнения в `WorkoutScreen.tsx`. REST-INSET-1: погрешность нескольких dp.
- AUD28-10 SegmentedControl; WorkoutsEditor/Sortable.Grid (медленная смена недели — решение владельца); CA-23 большие книги; CA-24 inline requires; CA-19 нет react-hooks lint; CA-12 не трогать.
- I01-USER-PARITY: 544 значения и 243 занятия без даты. REL-ANDROID: debug-подпись, releaseReady:false.
Подробный журнал — `docs/PROJECT_STATUS.md`.
