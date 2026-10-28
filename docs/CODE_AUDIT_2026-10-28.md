# Аудит среза 2026-10-28 — повторный проход (HEAD 4aad7fe, build40)

Диапазон: b2066e1~1…4aad7fe (весь день). Первый проход делался на f3a1ffb; после него были TEXT-LOG-REMOVE, AI-REMOVE,
TEMPLATE-OPEN-2/EDIT, CYCLE-STRIP-2/3, EXCEL-AI-2 (ImportSample), build38–40. Аудит только читает; телефон не использовался.

## Базовая линия (HEAD, Node 24.3)
| Проверка | Результат |
|---|---|
| typecheck, lint, arch:check (600 файлов), source:verify, secrets:check | PASS |
| test:foundation | 1051/1051 |
| excel:test | 99/99 (I06 исправлен после первого прохода) |
| training:test / calendar:test | 278/278 / 29/29 |
| Новые тест-файлы (cycle-state, import-sample, template-cycles) | включены в package.json |

## Статус находок первого прохода
| ID | Статус |
|---|---|
| AUD28-01 красный I06 | **закрыто** (тест исправлен) |
| AUD28-05 области нажатия в TextLogImport | **снято** (экран удалён) |
| AUD28-06 `logNameKey`, `expo-clipboard` | **снято** (код и зависимость удалены; `expo-clipboard` убран из apps/mobile/package.json) |
| AUD28-02, 03, 04 | **остаются** (workflow, календарь, тренировки не менялись) |

## Статус исправлений (AUDIT-FIX-1, ADR-052)
Исправлены с регрессионными тестами: **AUD28-02, AUD28-03, AUD28-04** (владелец: откатывать; `unsettle`), **AUD28-09**; мелочи **AUD28-06, AUD28-11, AUD28-12**.
Остаётся: **AUD28-10** (проверка на телефоне). Описания ниже сохранены как история находок.

## Открытые находки

### AUD28-02 (средняя) — отмена завершения уведомляет календарь не за ту дату
`workflows/completeWorkoutWithAppointment.ts:38` берёт `session.actualDate`, а отмеченная запись могла быть в другой день
(дату тренировки правят `setActualDate` после завершения). `RangeCache` сбросит не тот день → запись остаётся «Проведена» в
кэше недели. Фикс: `clearIfCompleted` (`DevCalendarRepository.ts:499`) возвращает `localDate` записи, уведомлять по ней; тест
«завершить → сменить дату → отменить → кэш».

### AUD28-03 (средняя) — удаление клиента не публикует изменение календаря
`devCalendarClientDeletionParticipant.detach` (`DevCalendarRepository.ts:196`) отменяет будущие записи и обезличивает прочие без
`publish`. Пока лента смонтирована, кэш показывает удалённого клиента. Проверить также восстановление из копии. Фикс:
`calendar.notify("ALL")` после commit в workflow удаления.

### AUD28-04 (вопрос владельцу) — «Отменить завершение» не возвращает списание
`clearIfCompleted` снимает исход, но `accounting.settle` (USED) из `resolveIn` (`:483`) не откатывается; прежний `clearOutcome`
ведёт себя так же. Нужен тест «завершить → отменить → завершить» с проверкой баланса и решение, считать ли это нормой.

### AUD28-09 (средняя) — шаблоны: черновики правки не чистятся при удалении шаблона
`deleteTemplate` (`DevTrainingPlansRepository.ts:1260`) удаляет только строку шаблона. Черновики `template:<id>` и
`builder:template:<id>` (TEMPLATE-EDIT; ключи `PeriodizedDraft.ts:47`, `DevTrainingPlansRepository.ts:62`) остаются в
`training_builder_drafts` навсегда: мусор, недостижимый из UI. Фикс: в той же транзакции
`DELETE … draft_key IN (?, ?)` (по всем клиентам). Тестов на ключи правки шаблона нет (`template-cycles.test.ts` их не трогает).

### AUD28-10 (низкая) — SegmentedControl со скольжением (`shared/ui/components/SegmentedControl.tsx`)
- `layouts` обновляются в `onLayout` только пока id совпадает с выбранным в момент события; индикатор не пересчитывается, если
  сменился текст выбранной вкладки (например, переименование цикла) — ширина индикатора устареет до следующего переключения.
- До первого `onLayout` выбранный сегмент без подложки (opacity 0, `selected && !sliding`) — возможно мигание при первом показе.
- `useEffect(…, [selectedId, sliding])` использует `moveTo` вне зависимостей (react-hooks lint отсутствует — CA-19).
Проверить на телефоне; тест компонента есть только в `workbook-ui.test.ts`.

### AUD28-11 (низкая) — навигация: `as never` ×8
`ClientPrimaryNavigators.tsx`: `navigation.navigate(route.name, route.params as never)` повторяется в 4 местах (две пары
`onEdit`/`onOpenInBuilder`). Вынести один помощник `openTemplate(navigation, route)` с локальным комментарием причины.

### AUD28-12 (низкая) — банк памяти и документы
- `activeContext.md` — 7907 символов (лимит ≈ 5000), `progress.md` — 5206. В activeContext остаётся устаревшее
  «перенос — … и теперь текст заметок» (импорт из заметок удалён, ADR-049/051), цепочка build35/36 дублируется.
- В `progress.md` нет срезов после TEXT-LOG (TEMPLATE-OPEN/EDIT, CYCLE-STRIP-3, TEXT-LOG-REMOVE, AI-REMOVE, EXCEL-AI-2);
  записи об «Импорте из заметок» и `expo-clipboard` подаются как сделанное, без пометки «удалено».
- `LegacyExcel.ts:12` и `WorkoutsEditor.tsx:219` ссылаются на EXCEL-AI/TEXT-LOG в комментариях — поправить на актуальные.
- ADR-049…051 есть; `TRANSFER_BACKLOG.json` не содержит срезов дня.

### AUD28-06 (низкая, остаётся)
- `SimplePlanStore.ts:121` два оператора в одной строке (`const changed … ; await upsertRows`).
- `RestTimerDock.tsx:140` `signalled` не очищается от id ушедших таймеров.
- `RestTimerDock.tsx:59` `as never` в `animatedProps` — добавить комментарий о причине.

## Проверено без замечаний
- CAL-WORKOUT-LINK: одна транзакция, notify после commit, повторное «Завершена» не ищет запись заново.
- PERF-PLAN-BATCH: порядок upsert/удаления, отсутствие UNIQUE по `position`, проверка свободных id.
- CYCLE-STRIP-3 (`CycleState.ts`, `PeriodizedBuilderScreen.tsx`): переключение цикла сбрасывает `restoreDone`, при «сохранить
  черновик» пишет под прежним scope до смены (`beforePublish`), гонка чтения черновика отсечена `scopeRef`; `applyCycleState`
  отбрасывает устаревшие ответы статусов (`statusRequest`).
- ImportSample (формат 2.0), удаление ИИ/заметок: ссылок на удалённые модули в коде нет, граница слоёв чистая.
- В добавленных строках нет hex-цветов, `fontWeight`, `console.*`, `@ts-*`, `eslint-disable`, областей нажатия < 48dp.

## Не проверено (нужен телефон)
1. Скольжение индикатора циклов, перенос длинных названий, мигание при первом показе.
2. Открытие шаблона любого вида в конструкторе, правка шаблона, возврат и «Назад» после переключения цикла.
3. Таймеры (`AnimatedTextInput`), завершение/отмена тренировки с записью, переключение неделя↔день.
4. Скачивание «Образца для импорта» и его разбор импортом на телефоне.

## Порядок исправлений
AUD28-02 (+тест) → AUD28-03 → AUD28-09 (+тест) → AUD28-04 (решение владельца + тест) → AUD28-12 (память, один срез) →
AUD28-06/11 мелким срезом → AUD28-10 после проверки на телефоне.
