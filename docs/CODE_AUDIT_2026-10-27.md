# Технический аудит приложения — 2026-10-27

Охват: весь отслеживаемый репозиторий (1128 файлов, ≈96 тыс. строк TS: `apps/mobile/src` 55 тыс., `scripts` 35 тыс.,
`apps/mobile/scripts` 5 тыс., `spikes` 1 тыс.), ветка `perf/week-participant-navigation`, HEAD `e284cb7`.
Метод: статический граф импортов (скрипт во временной папке, не в репозитории), поиск по именам во всех типах файлов,
чтение критичных модулей, прогон проверок на **чистом HEAD с патчем** (git worktree), потому что рабочее дерево содержит
чужие незакоммиченные правки (импорт Excel, черновики конструктора) и само по себе красное.

Фактический стек уже, чем в постановке: офлайн-приложение одного тренера (AGENTS.md: V1 — offline trainer-only). Fastify, Supabase,
Zod, серверной синхронизации и очередей в репозитории нет; разделы аудита про них неприменимы. Хранилище — expo-sqlite,
синхронизация заменена собственным форматом бэкапа и переносом через Excel.

## Базовое состояние

| Проверка | HEAD `e284cb7` | HEAD + правки этого аудита | Рабочее дерево (с чужими правками) |
|---|---|---|---|
| `typecheck` (root + mobile) | зелёный | зелёный | **красный** (CA-10) |
| `lint` | зелёный | зелёный | зелёный |
| `arch:check` | зелёный* | зелёный* | **красный** (CA-10) |
| `test:foundation` | — | 1389/1389 | не запускался |
| `arch:test`, `theme:test` | — | 11/11, 30/30 | не запускались |
| `source:verify`, `secrets:check` | — | — | зелёные |

\* в worktree `arch:check` ругается только на картинки упражнений (`assets/exercises/` в `.gitignore`, их там нет); других нарушений нет.

## Реестр

### Исправлено

| ID | Пр. | Где | Суть и доказательство | Проверка |
|---|---|---|---|---|
| CA-01 | Med | `app/bootstrap/DevBootGate.tsx`, `FoundationScreen.tsx`; `app/composition/createDevServices.ts`; `shared/ui/theme/AccentSwatch.tsx`; `features/training/plans/presentation/{MesocycleCopyScreen,WeekCopyFlow,WeekSwapPanel}.tsx`; `shared/ui/components/MetricTile.tsx`; `features/questionnaire/presentation/QuestionnairePreview.tsx` | Ни одного импорта в коде, тестах, скриптах и конфигурации (граф + поиск по имени); `App.tsx` использует `ApplicationBootGate`/`createDevRuntime`/`createProductionRuntime`. Первые три — алиасы и экран раннего этапа F01–F05. Копирование недели есть в `workflows/copyTrainingWeek.ts`; последние правки этих экранов — 2026-10-18…21, после чего их никто не подключал. | typecheck, lint, 1389 тестов |
| CA-02 | Low | `isStandardDuration`, `activeFilterCount`, `COMMON_EQUIPMENT`, `MESOCYCLE_TITLE_MAX`, `PROGRAM_KINDS`, `moveWorkout` (+ хелпер `move`), `verdictLabels`/`verdictKinds` | Экспорты, имя которых не встречается больше нигде в репозитории (проверено поиском по слову). Хвосты — три неиспользуемых импорта — убраны, lint чистый. | lint, calendar 19/19, exercises 9/9, training 258/258 |
| CA-03 | Low | `apps/mobile/package.json` | `@expo-google-fonts/inter` не импортируется: шрифт заменён на Manrope (UI-OWN-048, `typography.ts`, `fontAssets.ts`). Удалён из манифеста и lock (`--package-lock-only`, `node_modules` не тронут). | typecheck, тесты |
| CA-04 | Low | `CLAUDE.md`, `apps/mobile/src/app/README.md`, `memory-bank/architecture.md` | Висячие ссылки на удалённые файлы и устаревший «Шрифт Inter». | чтение |
| CA-05 | Low | `.theme-foundation-results.log` | Локальный сгенерированный лог 268 КБ в `.gitignore`, ссылок нет. Удалён. | — |

### Открыто

| ID | Пр. | Где | Суть | План / риск |
|---|---|---|---|---|
| CA-10 | **High** | чужие правки: `features/import/domain/BuilderWorkbookImport.ts`, `TrainingTransferPort.ts` → `training/public.ts`; `PeriodizedBuilderScreen.tsx:352` | Домен `import` импортирует публичный API фичи `training` (правило `DOMAIN_TO_FEATURE`), а тот реэкспортирует `.tsx` — отсюда 62 ошибки TS6142 в корневом `tsc` (в корень не подключён `--jsx`). Плюс TS2367 (сравнение объекта со строкой) в многоцикловом конструкторе. Не мои правки и не откатывал. | Владельцу параллельной работы: типы переноса вынести в порт `import/domain` или в `shared/`, а не тянуть `training/public.ts`. Проверка: `npm run typecheck`, `arch:check`. |
| CA-11 | Med | `isLocalDate` ×5: `AccountingRules.ts:3`, `CalendarRules.ts:27`, `MeasurementRules.ts:74`, `DiaryRules.ts:22`, `ExecutionRules.ts:265` | Одно понятие — пять реализаций с разными краями: год 0 и <100, UTC против локального `Date` (`ExecutionRules` — локальное время), `year > 0` только в замерах. Общего модуля дат нет. | Сначала тест паритета на корпусе дат (валидные 1900–2100, 30 февраля, месяц 13, годы <1000), затем один `shared/domain/LocalDate.ts`. Не делал: меняет валидацию пяти доменов ради малой выгоды. |
| CA-12 | Med | `DevTrainingPlansRepository.ts` 1711 строк; 28 `Dev*Repository` в `createLocalRepositories.ts`; «Preview/Prototype» в именах рабочих экранов (11 файлов) | Одна сущность на 1700 строк, суффиксы «Dev»/«Preview» у production-кода вводят в заблуждение. | Разрезать по агрегатам (программы / мезоциклы / шаблоны / версии) отдельным срезом с тестами `training:test`; переименование — отдельный механический коммит. Высокий риск регрессии, не в этом проходе. |
| CA-13 | Med | `package.json` / `apps/mobile/package.json` | TypeScript 5.8.3 в корне и 6.0.3 в mobile: скрипты и код проверяются разными компиляторами. | Выровнять с согласия владельца; сначала прогон корня на 6.0.3. |
| CA-14 | Low | 13 репозиториев данных | Цикл «уведомить слушателей, проглотить ошибку наблюдателя после commit» продублирован, семантика одинаковая и закомментирована. | Оставлено: 2 строки на репозиторий, выгода меньше риска. |
| CA-15 | Low | `DevTrainingExecutionRepository.ts:158-167` | `exportTransfer` читает тренировку отдельным запросом на каждую сессию клиента (N+1). | Разовая ручная операция экспорта. Замерить на клиенте с ≥1000 сессий, при необходимости загрузить пакетом. |
| CA-16 | Low | `pad`×8, `shortDate`×6, `MONTHS`×4, `monthRange`×3 и т. п. | Мелкие форматтеры повторены по фичам. | Объединять только вместе с CA-11 и после сверки формата. |
| CA-17 | Low | `memory-bank/activeContext.md` и `progress.md` | 28 из 49 длинных строк `progress.md` дословно повторяют `activeContext.md`; оба на пределе 5000 символов. | При ближайшем «смена»: оставить в `progress.md` только сделанное и техдолг. |
| CA-18 | Info | `docs/` | `PROJECT_STATUS.md` 415 КБ; две записи про переключение недель (`docs/perf/WEEK_SWITCHING_2026-10-25.md` и `docs/ui/WEEK_NAVIGATION_PERFORMANCE_2026-10-24.md`); пять отчётов `docs/ui/*_2026-10-24.md` без входящих ссылок; `UI_STYLE_DECISIONS.md` (UI-OWN-007) всё ещё описывает Inter. | Решение владельца: свернуть/архивировать. Без сверки с `PROJECT_STATUS.md` не удалял. |

## Что проверено и дефектов не найдено

- Типизация: `@ts-ignore`/`@ts-expect-error` — 0, явный `any` — 0, `TODO/FIXME/HACK` — 0, `eslint-disable` — 2 (оба в генерируемых файлах). Касты `as X` — 217, `!` — 76, сгруппированы на границах разбора (Excel, нативные пробы); отдельных дефектов не найдено.
- Запись данных: `WriterCoordinator` сериализует очередь, ошибка не «отравляет» её, сбой диагностики не меняет исход транзакции; `foreign_keys=ON`, WAL, `integrity_check`/`foreign_key_check` после миграций.
- Подписки и таймеры: все `subscribe`/`Keyboard.addListener` возвращают отписку; таймеры без handle — ref-счётчики с отложенным dispose или обращения через `ref?.`.
- Проглоченные ошибки: все 53 пустых `catch` имеют обоснование (наблюдатели после commit, повторяемая очистка); проглоченные отклонения в UI — чтение с guard `active`.
- Длинные списки: 12 файлов используют `FlatList`/`SectionList`; журнал замеров виртуализирован по дням, история списаний ограничена выбранным месяцем.
- Диагностика в релизе: `installWorkoutNavigationProbe` выходит при `!__DEV__`; пробы R06 используются только отдельным `spikes/sqlite`.
- Секреты: `secrets:check` чист; `.jks/.pem/keystore.properties/.atbackup` лежат вне репозитория и не открывались.
- Тесты: из 150 тестовых файлов не подключён ни к одному npm-скрипту один — `spikes/navigation/src/safeRoute.test.ts` (изолированный spike).

## Зависимости (`apps/mobile`)

| Пакет | Вывод |
|---|---|
| `@expo-google-fonts/inter` | не используется — **удалён** (CA-03) |
| `@shopify/flash-list` | не импортируется (использовался в T05, коммит `e90e22e`). Это выбор владельца; оставлен как кандидат для длинных списков — **решение владельца** |
| `expo-linear-gradient` | прямых импортов нет, но это peer-зависимость `react-native-gifted-charts` (`require` по строке) — **оставлен** |
| `react-native-screens`, `babel-preset-expo`, `@types/*`, `expo-doctor` | peer/инструменты сборки — оставлены |
| `xlsx` (tgz с cdn.sheetjs.com) | 0.20.3 — версия с исправлением известных уязвимостей; источник не из npm, обновлять вручную |

`npm audit` и `expo-doctor` требуют сети и не запускались.

## Оставлено сознательно

`read-models/useQuerySnapshot.ts` (задокументированный шов, ADR F06); `shared/assets.d.ts` (типы); `scripts/r06/*-crash-worker.ts`
(запускаются через `spawnSync` по пути); `apps/mobile/scripts/navigation-profile-server.ts` (описан в `docs/perf`);
`scripts/refresh-source-manifest.ts`, `scripts/navigation-theme-audit.ts` (генераторы документов, вне `package.json` — подключить или
удалить по решению владельца); токены `space`/`fontSize` в `style.ts` (дизайн-токены «Зефирки»); `spikes/*` (изолированные эксперименты
с `mobile:sqlite`/`mobile:navigation`); весь `scripts/r04`, `scripts/r06`, `docs/spikes` — доказательства гейтов, а код миграции
по AGENTS.md удаляется только после подтверждённого переноса.

## Ограничения этого прохода

- Производительность не измерялась на устройстве (по правилам проекта владелец проверяет на телефоне сам); опираюсь на уже записанные
  профили недель (`docs/perf/WEEK_SWITCHING_2026-10-25.md`). Сравнения «до/после» для рендеринга нет.
- Не запускались: сборка bundle/APK, `npm audit`, `expo-doctor`, наборы `r04:*`, `r06:test`, `d01:*` вне `test:foundation`.
- В рабочем дереве продолжается чужая работа; правки CA-01…CA-05 проверены на чистом HEAD с патчем, а не в самом дереве.
