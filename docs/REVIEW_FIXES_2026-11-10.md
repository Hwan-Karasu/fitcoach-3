# Исправления по код-ревью 2026-11-10 (план передачи работы)

Документ написан так, чтобы любой исполнитель (в том числе другой ассистент) мог закончить работу без контекста чата. Статусы в колонке «Ст.» обновляются по ходу: `[ ]` не проверено, `[v]` подтверждено кодом, `[x]` ложное срабатывание (причина — в примечании), `[f]` исправлено (коммит), `[d]` отложено владельцем/в техдолг.

## Контекст
После правок Codex (коммиты `SIDE-RPE-1`, `REST-DOCK-2`, `UIX-CLEAN-1`, `AUDIT-ALL-1`, база сравнения `83dc580`) 16 агентов-ревьюеров прочитали разделы приложения (только чтение). Блокирующих дефектов не найдено; ниже — «важные» и «мелкие» находки. **Все находки сначала перепроверяются по коду** (агенты читали частично и могли ошибиться), затем исправляются срезами. Базовые проверки на момент ревью: typecheck, lint, arch:check, source:verify, secrets:check зелёные, `test:foundation` 1198/1198.

## Решения владельца (2026-11-10, окончательные)
1. `composition/legacyDevImport.ts` + `shared/db/LegacyDevImport.ts` + `scripts/legacy-dev-import.test.ts` — **удалить**, если нигде не нужны (проверить ссылки: D01, документы, `result.tables`-ожидания в других тестах).
2. Health Connect, недостижимая ветка очистки шагов (`workflows/syncHealthConnect.ts`) — **убрать** ветку и тест, который её держит (адаптер не отдаёт дни с нулём).
3. Тоннаж одностороннего подхода и дроп-сета с пустой частью — **показывать «Неполные данные»**: если подтверждённая часть (сторона или мини-сет) невычислима, увеличивать `incompleteSets`; `delta` месяца тогда «ненадёжна» (без разницы).
4. Всё остальное — перепроверить по коду, затем исправить.

## Правила работы (из CLAUDE.md проекта — коротко)
- Ответы владельцу по-русски; коммиты по-русски `<ID>: что сделано`, trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; `git push` не делать; коммитить **поимённо** (`docs/ui/concepts/`, `photo_2026-11-09_16-12-02.jpg` не добавлять; `*.atbackup/*.jks/*.pem/keystore.properties` не открывать).
- Правки файлов — через Write/Edit или `.cjs`-скрипт в scratchpad (не heredoc с обратными кавычками); файлы часто CRLF — скрипты правок сохраняют перевод строк.
- Запись в БД только `WriterCoordinator.write`, `publish` после commit; новая таблица/колонка — миграция в журнале владельца (старые не править); новые данные клиента — участник окончательного удаления.
- UI: цвета из токенов темы, шрифт `fonts.*`, иконки lucide, hit-area ≥ 48 dp (`TOUCH_TARGET` в `shared/ui/theme/style.ts` = 44 — сверить), `accessibilityLabel`; подписки/таймеры снимаются в cleanup `useEffect`.
- Тесты: Node 24 (`node_modules/node/bin/node.exe --experimental-strip-types --test-isolation=none --test <файл>`); тест, импортирующий `.tsx` через `public.ts`, — в `apps/mobile/scripts` (иначе ломается корневой `tsc`); новый тест — в строку `test:foundation` корневого `package.json`.
- Проверки после каждого среза: `npm run typecheck`, `lint`, `arch:check`, `test:foundation` (в конце ещё `source:verify`, `secrets:check`).
- Память: после завершения — `memory-bank/{activeContext,progress,decisions}.md` (≤ ~5000 символов у первых двух: activeContext уже ~4950 — сократить/архивировать устаревшее в `memory-bank/archive/`), `docs/PROJECT_STATUS.md` (новая запись сверху).
- Ревьюер-агент после среза — не обязателен; запускать один раз на срез с данными/схемой.

## Порядок срезов
1. **R1 данные и корректность** (A*) → тесты на каждую правку.
2. **R2 устаревшие данные и ошибки в экранах** (B*).
3. **R3 доступность, жесты, производительность** (C*).
4. **R4 мёртвый код, дубли, документы** (D*).
5. **R5 вторая проходка по непрочитанному** (E*) — узкими агентами (≤ 5 файлов, задание «верни отчёт к 10-му ходу»).
Каждый срез — отдельный коммит; после каждого обновлять этот файл (статусы) и коммитить вместе со срезом.

## Находки

### A. Данные и корректность
| ID | Ст. | Где | Суть | Что сделать |
|---|---|---|---|---|
| A1 | [f] | `training/execution/presentation/useWorkoutDiary.ts` (блок `sidesRpe` в `saveSet`) | Если у факта `sided=0`, а упражнение стало односторонним (импорт 2.0), `fact.sides===null` → RPE сторон = null, RPE подхода теряется (нарушение «факты не уничтожаются») | Стартовое RPE сторон брать из `fact.rpe`; тест в `scripts/training-side-rpe.test.ts` |
| A2 | [f] | `calendar/presentation/WeekPager.tsx:36`, `CalendarScreen.tsx:415`, `useCalendarWeek` | Заготовка страницы получает `monday` новой недели, а `data` — прошлой; чужие записи показываются и кэшируются (`RangeCache`) | Добавить `monday` в `CalendarWeekData`, передавать `seed` только при совпадении; тест |
| A3 | [f] | `training/analytics/presentation/trainingStats.ts:72-87` `factTonnage` | Частично известный односторонний подход/дроп считается полным без «неполных» | **Решение 3**: невычислимая подтверждённая часть → `incompleteSets+1` (kg остаётся суммой известных частей), `delta` ненадёжна; тест в `apps/mobile/scripts/training-stats.test.ts` |
| A4 | [d] | `read-models/rosterOverview.ts` `buildRosterOverview` | При отказе календаря `todayCount/weekCount` = 0 («занятий нет») | Различать «неизвестно» (null) — проверить, как читает UI клиентов (`ClientListsPreview`, `RosterSummaryCard`, `ClientRosterFilters.summarizeRoster`); тест `apps/mobile/scripts/roster-overview.test.ts` |
| A5 | [f] | `workflows/syncHealthConnect.ts` (`value < 1 → clearSteps`), `apps/mobile/scripts/health-sync.test.ts` | Ветка недостижима на устройстве | **Решение 2**: убрать ветку и тест; описание в `docs/ui/UIX_BACKLOG.json` UIX-16 / ADR-061 поправить |
| A6 | [f] | `shared/db/IsolatedSqliteConnection.ts` (`discardWriter`, `writeHandle`) | После неудачного ROLLBACK и неудачного `closeAsync` `writerBroken` навсегда: записи падают до рестарта | Один повтор `closeAsync` у сохранённого handle, при успехе сбросить флаг; тест на `sqlite-isolated-connection.test.ts` |
| A7 | [d] | `training/plans/data/DevTrainingPlansRepository.ts:579-609` `setExerciseRest` | Меняет `revision` программы без CAS (`expectedRevision`), для простой программы без `preserveSimple` | Проверить сигнатуру порта/вызывающих; добавить CAS или зафиксировать ADR/комментарием (если осознанно — отдых из дневника) |
| A8 | [f] | `plans/data/PeriodizedStore.ts` `insertMesocycle`/`TrainingPlanTransfer.ts` | Дубль `lineageId` у одного клиента → UNIQUE в `training_navigation_members`, падает весь импорт | Воспроизвести тестом; если реально — `INSERT OR IGNORE`/проверка |
| A9 | [d] | `workflows/saveClientCard.ts` (вес), `ClientEditorRoute.tsx:178` | Несколько записей веса за сегодня без основной → откат всей карточки | Проверить; вариант: вес пишется только если изменён (уже), при `MEASUREMENT_AMBIGUOUS_DAY` — понятная ошибка, не блокировать остальное — решить по коду |
| A10 | [f] | `training/plans/domain/StoredWorkbookShape.ts:6-9` | RPE стороны 1..10, общего `fact.rpe` — любое целое | Привести к одному правилу (1..10 или null) |
| A11 | [d] | `nutrition/data/DevNutritionTargetsRepository.ts:46-53` | `count()` участника удаления не считает `nutrition_target_days` | Проверить использование `count`; добавить или задокументировать |
| A12 | [d] | `DevFoodCatalogRepository.ts:16`, `DevNutritionTargetsRepository.ts:39`, `DevRecipeCatalogRepository.ts:39` | `JSON.parse` без проверки формы | Низкий приоритет: `readStoredJson`-подход, если без риска |
| A13 | [d] | `calendar/presentation/CalendarSettingsScreen.tsx:86-101` `stabilizeTypeColors` | Перекраска чужих типов отдельными транзакциями до create/update | Проверить; вариант — одна транзакция в репозитории |
| A14 | [f] | `calendar/data/DevCalendarRepository.ts:301,904` | `getSettings()`/`previewClearWeek()` не `async` → синхронный throw | Сделать `async` |
| A15 | [f] | `app/…/HealthOperationQueue.ts:23` | `sync()` во время идущего sync после link вернёт прежний результат | Низкий: сбрасывать `running` при link/unlink |
| A16 | [d] | `calendar/data/DevCalendarRepository.ts:860` `pasteWeek` | Одна невалидная запись откатывает вставку, общее сообщение | Низкий |

### B. Устаревшие данные и ошибки в экранах
| ID | Ст. | Где | Суть | Что сделать |
|---|---|---|---|---|
| B1 | [f] | `nutrition/presentation/NutritionHomeCards.tsx:212-242` | КБЖУ-кольцо и «съедено/цель» без проверки `stale` при смене дня | `fresh = data !== null && !stale` |
| B2 | [f] | `NutritionDiaryScreen.tsx:108-120` `waterRequests` | Кэш воды живёт вечно | Чистить при `pending===0` в любом исходе |
| B3 | [f] | `MealMacroStats.tsx:37,60,74`, `useNutritionGuide` | Ошибка расчёта → статистика молча пропадает | Пробросить `failed` из `useCalcData`, показать `InlineNotice` |
| B4 | [f] | `accounting/presentation/ClientAccountingScreen.tsx:86-90` | `load()` без защиты от устаревших ответов и размонтирования | Счётчик поколения/флаг `active` |
| B5 | [f] | `clients/presentation/ClientRosterSettingsScreen.tsx:43-56`, `BirthdaySettingsSaveQueue.ts` | После сбоя записи в поле остаётся несохранённое число | В ветке отказа `setLeadDays(String(saved…))`, `setLeadInvalid(false)` |
| B6 | [f] | `clients/presentation/ClientListsPreview.tsx:84-86` | Ошибка `port.load` проглатывается → вечный скелетон | Флаг ошибки + «Повторить» |
| B7 | [f] | `notifications/presentation/NotificationCenterScreen.tsx:51-84` | `reload()` без защиты от гонки/unmount; undo теряется при двух свайпах; открытый свайп при ошибке | Счётчик поколения, `active`, стек undo или принять, `ref.close()` |
| B8 | [f] | `TrainingStatisticsScreen.tsx:43`, `MonthlyReportScreen.tsx:48`, `ClientExerciseScreen.tsx:192,226-231` | `now = new Date()` по умолчанию + `progressMetrics()` на каждый рендер сбивают `useMemo` | `useMemo/useRef` для `now`, `useMemo` для `metrics` |
| B9 | [f] | `useMetricSeries.ts:67`, `MetricScreen.tsx:140,161-162` | `failed` мигает при смене периода; «Максимум/Минимум» приёмов с десятой («5,0») | Сброс `failed` при смене ключа; целый формат для min/max |
| B10 | [f] | `NutritionHomeCards.tsx:36,50,69,308` | Ошибки чтения шагов/отметки/веса глушатся; устаревший текст «в разделе «Питание»» | Текст → «в «Расчёте»»; ошибки — оставить значение с пометкой или показать |
| B11 | [f] | `plans/presentation/ProgramLibraryScreen.tsx:349` | `restoreForClient(...).catch(reload)` без сообщения | `actionError` как в `run` |
| B12 | [f] | `PeriodizedBuilderScreen.tsx:718` и др. `pickDate(...).then` без `.catch` (также `ClientAccountingScreen.tsx:216,226`) | Необработанный отказ | Добавить `.catch` |
| B13 | [x] | `ThemeCatalogPreview.tsx:40-53,83` | Возможная вторая дублирующая «←» | Проверить, есть ли шапка навигатора |
| B14 | [f] | `NotificationSettingsScreen.tsx:56,67` | `save` молча возвращается при занятом замке; `onChanged()` внутри `try` | Вынести `onChanged()`; сообщение |
| B15 | [d] | `HealthConnectSection.tsx` `run()` | setState после unmount | флаг `active`/ref |
| B16 | [d] | `useHealth.ts`/прочие мелочи по отчётам | — | по ходу |

### C. Доступность, жесты, производительность
| ID | Ст. | Где | Суть | Что сделать |
|---|---|---|---|---|
| C1 | [d] | `calendar/presentation/TimelineGrid.tsx:194,278,280` | `Gesture.Pan/Tap/Exclusive` без `useMemo` | refs + `useMemo` |
| C2 | [f] | `shared/ui/components/BarChart.tsx:39` | `accessible` на корне при `onPressItem` → столбцы недоступны для TalkBack | не ставить `accessible` на корень, если есть `onPressItem` |
| C3 | [f] | список ниже | hit-area < 44–48 dp | `hitSlop`/`minHeight` |
| C4 | [f] | `app/navigation/RootTabBar.tsx:32`, `BottomPanel.tsx:25` | `navigation: <JSX/>` новый объект каждый рендер → лишние публикации | `useMemo` |
| C5 | [d] | `app/navigation/UnifiedBottomPanel.tsx:42-51` | Пустая полоса под стеком без панели | Проверить замысел (футеры не добавляют inset) → вернуть `null` без панели/таймеров или оставить с комментарием |
| C6 | [f] | `shared/ui/components/ProgressBar.tsx:11` | `NaN` → `width: "NaN%"` | `Number.isFinite` |

Список C3 (hit-area): `RootTabBar.tsx:99-104` (tab compact 30/36, стрелки 36), `ClientsListShortcut.tsx:25` (36), `PeriodizedBuilderScreen.tsx:796-800,871,873,883,885` (точки типа недели ≤22+hitSlop, copyChip 36, choice 40, date 42), `ChoiceSegments.tsx:24` (34), `SegmentedControl.tsx:95-96` (режимы scroll/wrap ≈32), `TrainingStatisticsScreen.tsx:142-148,225` (строки «Исходы» 36), `CalendarScreen.tsx:505,519` (dayToggle 36, segment 38), `DutyDaySheet.tsx:194` (32), `CalendarSettingsScreen.tsx:292,296` (32, 34), `SessionTypeEditor.tsx:97,100` (38), `AccountingHistory.tsx:153,156` (38, 40), `ClientHomePreview.tsx:155` (44), `RosterSearchBar.tsx:64` (46), `ClientRosterSettingsScreen.tsx:151` (44), `NutritionHomeCards.tsx:274,280,334` (28+hitSlop 8), `NutritionDiaryScreen.tsx:189,260` («+» 32+hitSlop → 44), `EntryEditorDialog.tsx:234` (40), `ThemeCatalogPreview.tsx:83` (44). Правило проекта 48; `TOUCH_TARGET`=44 — при расхождении принять 48 и поправить константу/документ.

### D. Мёртвый код, дубли, документы
| ID | Ст. | Где | Что сделать |
|---|---|---|---|
| D1 | [f] | **Решение 1**: `app/composition/legacyDevImport.ts`, `shared/db/LegacyDevImport.ts`, `scripts/legacy-dev-import.test.ts` | Удалить; убрать из `test:foundation`; поправить ссылки в документах/комментариях (`createServices.ts` комментарий к `DEV_DATABASE`) |
| D2 | [f] | `shared/db/SqliteDirectoryUri.ts` + `scripts/sqlite-directory-uri.test.ts` | Удалить, если нигде не нужен |
| D3 | [f] | `health/domain/HealthPorts.ts:35` `revokeAll`, `ExpoHealthConnectAdapter.ts` (импорт `revokeAllPermissions`), фейки в `apps/mobile/scripts/health-sync.test.ts`, `artifacts/audit-nutrition-health-races.test.ts`, `health/README.md`, docstring `HealthConnectSection.tsx` | Удалить метод; текст «Отключение снимает привязку; доступ отзывается в настройках Health Connect» |
| D4 | [f] | `plans/presentation/ProgramLibraryScreen.tsx:206-224` проп `soon`; `settings/presentation/SettingsDrawerPreview.tsx:17-18` пропсы `onOpenWorkspaceDev`/`onOpenSqliteDev` (+ `RootTabs.tsx`, `PrototypeShell.tsx`); `weekCopy`/`weekSwap` протяжка (`PrototypeShell:252` → `ClientWorkspaceNavigator` → `ClientPrimaryNavigators.TrainingNavigator`); `routeCatalog.ts` (`RootTabName`, `WorkspaceTabName`, `MoreDestinationName`, `clientSections`, `ClientSectionName`); `tabBarStyle: {height: 0}` (`RootTabs.tsx:99`, `ClientWorkspaceNavigator.tsx:238`); `ClientHeader.tsx:51-78` дубль `rightControls`; `ClientPrimaryNavigators.tsx:425-444` одинаковые ветки `popTo`; `renderWeightStats?/renderMetric?` сделать обязательными | Удалить/свернуть (проверить вызывающих grep'ом до удаления) |
| D5 | [f] | Дубли: `localToday()` (`questionnaire/data/DevQuestionnaireRepository.ts:14-17`, `accounting …today()`) → `shared/domain/LocalDate.localDateText`; `weekStart` в `rosterOverview.ts` и `trainingWeek.ts`; `mondayOf`/`datesBetween` в `nutrition/domain/NutritionStats.ts` vs `MetricPeriods.ts`; `shortDate`/`Tile`/`unitOf`/`spaced` в nutrition presentation; `isCalendarDay` vs `isLocalDate` | Свести к одному; не ломать публичные API |
| D6 | [f] | `rgba(0,0,0,…)` скримы в `BottomSheet.tsx:41`, `ConfirmDialog.tsx:103`, `TimeWheelPicker`, `ProgramLibraryScreen.tsx:356`, `BuilderDraftExitDialog`, `SaveTemplateDialog`, `DiaryEditDialog`, nutrition (7 мест), calendar (5), `ClientAccountingScreen.tsx:252`, `ActionSheet`, `FieldEditorSheet`, `SettingsDrawerPreview`, `ClientMeasurementsScreen` | Завести токен/константу `scrim` в `shared/ui/theme/style.ts` и использовать; hex `#FFFFFF`/`#000` в `TimelineGrid.tsx:375`, `CancelUndo.tsx:196` — токены темы |
| D7 | [d] | Отладка: `restTimerDiagnostics.render(...)` в `RestTimerDock.tsx:~84`, `WorkoutScreen.tsx:~119`, `RootTabBar.tsx:23`, `UnifiedBottomPanel.tsx:18` | Убрать после замеров или под `__DEV__` — спросить/решить; `console.info("[backup-timing]")` в 5 файлах backup — оставить, отметить в документе |
| D8 | [f] | `apps/mobile/scripts/rest-dock-spacer.test.ts` (имя от удалённого `RestDockSpacer`) | Проверить содержимое → переименовать или удалить |
| D9 | [f] | Мелочи: `createServices.ts` дубли импортов и осиротевший комментарий «Shared port bindings…», имя проверки `all_fifteen_repository_holders…` (`runR06PublicationProbe.ts:76`); `PeriodizedBuilderScreen.tsx:729,763,272,295-298`; `statsParts.tsx:122,159`; `ChoiceSegments.tsx:5,17` (английский комментарий); `SavedMealEditorDialog.tsx:12,44,47,76`; `exerciseProgress.ts:6-7`; `DevNutritionDiaryRepository.ts:339,354` пустые блоки; `FoodModel.ts:25-26` JSDoc; `MetricPeriods.ts:92` комментарий; лишние `export` у типов; `monthInsights.loadSetsOf` vs `recordValues` (DROP) — унифицировать или комментарий; `useStatisticsCaption(todayOf)` стабильность | По ходу R4 |
| D10 | [ ] | Документы: `CLAUDE.md` (корень) ветка `rewrite/fitcoach-3.0` ≠ фактическая `perf/week-participant-navigation`; `memory-bank/decisions.md` порядок ADR (066,065,064,063,060,062,061); `questionnaire/README.md`, `workflows/README.md`, `read-models/README.md`/`useClientHomeSummary` (обещание «прежний снимок»), `scripts/d01/history/README.md` | Поправить |

### E. Не прочитано ревьюерами (вторая проходка, узкими агентами)
- `training/plans/presentation`: `WorkoutsEditor.tsx` (жесты, `worklet`, `useMemo/useCallback`), `ProgramScreen`, `WeekEditorScreen`, `ParticipantSwitcher`, `ArchivedProgramsPanel`, `MesocycleBook`, `SimpleWorkoutEditorScreen`, `DiaryEditDialog`, `SaveTemplateDialog`, `Participant*`, `PlacementRows`, `ScopeMenu`, `StructureEditPreview`, `SimpleTemplatesPanel`, хуки `use*`.
- `training/plans/domain`: `MesocycleBuilder`, `PeriodizedModel/Rules`, `PlanCopy`, `PlanDeletion`, `Program*`, `RecoveryDraftQueue`, `SimplePlan*`, `SupersetRules`, `Template*`, `Week*`, `DraftRebase`, `ImportedFacts`, `Mesocycle*`, `SlotKeys`, `StructureVersion`, `Builder*`.
- `training/execution`: `ProgramMatrixScreen`, `ProgramWeeksPanel`, `matrixHtml`, `programMatrix`, `setFormat`, `SetPickers`, `TrainingSettingsScreen`, `WorkoutSharePoster`, `shareFormat`, `useWorkoutSnapshot`, `useActiveWorkoutCards`, остальное `DevTrainingExecutionRepository` и участники (`ExecutionCleanupParticipant`, `WeekCopyParticipant`, миграции), `archive/*` экраны.
- `features/backup` (`application/*`, `data/*`, `domain/*`), `features/import` (`MatrixWorkbook`, `ExpoWorkbookFiles`, `WholeWorkbookImport`, `WorkbookReviewSession`, `LegacyExcel`, `TransferIds/Completion`, `IssueCorrections`), `shared/training-transfer/*`.
- `app/bootstrap/*`, `app/runtime/*`, `composition/{ExpoRestoreJobs,createManualBackup,createTrainingTransfer,expoRestSignal,expoNotificationOpen,ExpoRuntimeRestoreJournal}`, `diagnostics/runF04Probe`.
- `questionnaire`: `QuestionnaireBuilderScreen.tsx` с 426 строки, `FieldEditorSheet`, `QuestionnaireRules/Builder/Model`.
- `nutrition/presentation`: `AddFoodScreen`, `FoodEditorScreen`, `RecipeEditorScreen`, `RecipeBrowseControls`; `measurements/presentation/MeasurementsCard`; workflows `delete*`, `saveTraining*`, `swapTrainingWeeks`, `copyTrainingWeek`, `completeWorkoutWithAppointment`, `syncNotifications`, `saveCalcProfile`.
- Тесты `read-models` и `db` (покрытие `failedOpen`/`SqliteOpenCloseError`); `calendar/ShareWeekPoster`, `CalendarRules`, хвост `CalendarSettingsScreen` (с 166 строки).

## Как продолжить, если работа прервалась
1. `git log --oneline -10` и `git status` — какие срезы R1–R5 уже закоммичены; сверить с колонкой «Ст.» этого файла.
2. Взять первую строку со статусом `[ ]`, перепроверить по коду (Read/Grep), поставить `[v]`/`[x]`, исправить, прогнать проверки, закоммитить срез вместе с обновлённым файлом.
3. Не повышать статусы «проверено на телефоне» — APK не собирался (build49 только по подтверждению владельца).

## Итоги среза R1 (2026-11-10)
Исправлено `[f]`: A1 (`sidesRpeAfter`), A2 (`monday` в данных недели), A3 (частичный тоннаж — «Неполные данные»), A5 (сужена ветка шагов HC: >100 000 снимает проекцию, нулевая ветка убрана), A6 (повтор `closeAsync` потерянного writer), A8 (`registerNavigationCopy` не падает на втором родстве клиента), A10 (одно правило RPE 1…10), A14 (`async`), A15 (смена привязки обнуляет идущий sync).
Отложено/намеренно `[d]`: A4 (нет данных календаря = ноль задокументировано; нужен признак `calendarKnown` и правка `RosterSummaryCard`), A7 (`setExerciseRest` — точечная правка из дневника, ревизия растёт, чтобы конструктор получил конфликт; в production не вызывается), A9 (атомарность карточки+веса намеренна, ошибка понятная, форма сохраняется), A11 (дни — дочерние строки версий, счёт по версиям корректен), A12 (JSON пишет само приложение; низкий риск), A13 (фиксация показанных цветов безвредна и идемпотентна), A16 (общее сообщение при невалидной записи вставки — низкий приоритет).


## Итоги среза R2 (2026-11-10)
Исправлено `[f]`: B1 (`fresh` для колец и «съедено»), B2 (кэш воды освобождается), B3 (`failed` расчёта в статистике БЖУ), B4/B7 (поколение чтения, закрытие смахнутой строки при сбое), B5 (поле дней после отказа), B6 (ошибка сводки + «Повторить»), B8 (стабильный `now`, `useMemo` метрик), B9 (ошибка привязана к ключу; max/min целые), B10 (текст «в «Расчёте»»; ошибки чтения шагов/веса остаются «нет данных»), B11 (восстановление из архива через `run`), B12 (`pickDate` не отклоняет промис), B14 (`onChanged()` вне `try`).
Ложное: B13 `[x]` — у маршрута Appearance навигаторская шапка скрыта (`headerShown:false`). Отложено `[d]`: B15 (React 19 без предупреждения и утечки), B16 (без конкретики), в B14 — молчаливый возврат при занятом замке (элементы и так `disabled={busy}`).

## Итоги среза R3 (2026-11-10)
Исправлено `[f]`: C2 (`BarChart` не склеивается в один элемент при `onPressItem`), C4 (публикация нижней панели по полям + `useMemo` узла кнопок), C6 (`ProgressBar` с нечисловым значением), C3 частично — вертикальный `hitSlop` у ClientsListShortcut, ChoiceSegments, действий типа занятия, кнопки удаления типа и выбора цвета (вид не меняется).
Отложено `[d]`: C1 — стабилизация `Gesture.*` в `TimelineGrid` требует перечисления всех захваченных значений и проверки жестов на телефоне, прежний код работает (пересоздание жестов каждый рендер — только производительность); C5 — пустая полоса под стеком намеренна (экраны без панели не добавляют inset), добавлен комментарий; в C3 остальные пункты списка (плотные чипы/сегменты 32–40 dp) — решение о геометрии за владельцем: в `UI_STYLE_DECISIONS.md` одновременно «≥48 через hitSlop» и «ровно 44».

## Итоги среза R4 (2026-11-10)
Сделано `[f]`: D1 — удалён `app/composition/legacyDevImport.ts` и два теста, которые его вызывали; `shared/db/LegacyDevImport.ts` и остальной `legacy-dev-import.test.ts` ОСТАЛИСЬ: загрузчик исторических фикстур `scripts/support/import-historical-fixture.ts` (его используют 9 тестов хранилищ) вызывает `importLegacyDevData`. D2 — удалены `SqliteDirectoryUri.ts` и его тест. D3 — `revokeAll` убран из порта, адаптера и фейков. D4 — убраны проп `soon`, цепочка `onOpenWorkspaceDev/onOpenSqliteDev`, неиспользуемые типы `routeCatalog`, протяжка `weekCopy/weekSwap` через навигаторы, дубль `rightControls` в `ClientHeader`, одинаковые ветки `popTo`, `renderWeightStats/renderMetric` обязательные. D5 — `localToday()`/`today()` заменены на `localDateText`. D6 — токен `scrim` в `shared/ui/theme/style.ts` вместо 26 литералов `rgba(0,0,0,…)` (прозрачность выровнена до 0,45). D8 — `rest-dock-spacer.test.ts` → `bottom-panel-padding.test.ts`. D9 — дубль импорта и осиротевший комментарий в `createServices.ts`, английский комментарий `ChoiceSegments`, имя проверки `all_repository_holders_open_the_restored_file`.
Не сделано: D7 `[d]` — `restTimerDiagnostics.render` это инструмент замеров p50/p95 (REST-PERF-1), нужен до приёмки на телефоне. Остаток D4/D5/D9 (маршруты `WorkspaceDev`/`SqliteDev` теперь без входа в меню — решить, удалять ли; `tabBarStyle: {height: 0}`; `ServiceS.weekCopy/weekSwap` в композиции; дубли `weekStart`/`mondayOf`/`shortDate`; мелкие пункты D9 по отдельным файлам) — в техдолг. D10 — вместе с обновлением памяти.

## Итоги среза R5 — вторая проходка (2026-11-10)
Пять узких ревьюеров прочитали раздел E (планы: экраны и домен; дневник/архив/матрица; копии/импорт/перенос; запуск/composition/workflows). Блокирующих по данным нет; заявленное «блокирующим» подтверждено и исправлено.
Исправлено: коллизия id сета после выхода первого участника (`freshSupersetId` в `SupersetRules.ts`, `PeriodizedRules.ts`; тест `training-superset.test.ts`); порядок упражнений/тренировок с повтором id не принимается; повторы 0 в матрице (теперь правило дневника `parseField`); вес плана матрицы 1,1 кг → 1100 г и дробные секунды/метры отклоняются (`MatrixPlan.ts`); строка из пробелов в ячейке матрицы не превращается в 0; копия книги в кэше удаляется при отмене/сбое чтения (`ExpoWorkbookFiles.ts`); устаревший ответ переименования программы не показывается при смене участника; `hitSlop` у чипов участников и «Удалить тренировку»; `.catch`/try-finally в `ApplicationBootGate`, `AutomaticBackupScheduler`, `expoNotificationOpen`; мёртвая ветка `messageKind` и литерал «80 символов».
В техдолг (не исправлено, перепроверить перед правкой): `DraftRebase.rebaseBuilderWeeks` теряет добавленные недели при неизменной длине черновика; `rebaseSimpleProgram` добавляет `lineageId` в Простую программу; `CycleState` подставляет `hypertrophy`/`today` вместо «не задано»; `diffWeek` при переносе упражнения между тренировками (порядок remove/add); `ImportedFacts` группирует по `plannedExerciseId` без сессии; `StoredPlanShape` не проверяет границы недель и уникальность id; `ProgramMatrixScreen`: `structureKey` не включает названия и цвета (устаревший HTML), состояние не сбрасывается при смене программы, `volumeKg` 0 вместо «нет данных», ячейки WebView 26 px; `TrainingSettingsScreen` гонка двух нажатий; `HistoryProgramScreen` прокрутка/состояние при смене входа; `createTrainingTransfer.ts` кросс-модульная запись вне `workflows/` и проверка `activeExerciseIds()` до транзакции; разные предикаты «есть результаты» в `saveTrainingMesocycle`/`saveTrainingWeek`/`saveTrainingSimplePlan`; `sheet_to_json({raw:false})` теряет точность веса и дату (`ExpoWorkbookFiles.ts:50`, `LegacyExcel.ts:86`); `ExpoRestoreStorage.ts:106-110` проверка sidecar LIVE (подтвердить на устройстве); `BootCoordinator` повторный open после сбоя темы.
Не прочитано и во вторую проходку: `WorkbookReviewSession.ts`, вторая половина `TransferReceiptStore.ts`, `features/backup/data/{ExpoSnapshotMedia,SnapshotMedia,SqliteSnapshotEngine,ExpoManualSnapshotJobs,NativeBackupPublisher,SnapshotContentHash}.ts`, `features/backup/domain/{AutomaticBackup,BackupPublication,SnapshotManifest}.ts`, `questionnaire/QuestionnaireBuilderScreen.tsx` с 426 строки, экраны питания `AddFoodScreen`/`FoodEditorScreen`/`RecipeEditorScreen`.
