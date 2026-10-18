# Architecture

## Стек

- Expo SDK 57, React Native 0.86.3, React 19.2, TypeScript strict
  (корень 5.8.3, `apps/mobile` 6.0.3).
- Навигация: React Navigation 7 (bottom-tabs + native-stack).
- Данные: `expo-sqlite`; жесты/анимации: react-native-gesture-handler 2.32,
  Reanimated 4.5 + react-native-worklets 0.10 (`scheduleOnRN`).
- Прочее: react-native-view-shot, expo-sharing, safe-area-context, screens.
- Тесты: Node 24 `--experimental-strip-types` + `node --test`, без Jest.
- Линт: ESLint 10 + typescript-eslint.

## Структура

```text
FitCoach_3/
  AGENTS.md              правила (источник истины, gates, запреты)
  docs/PROJECT_STATUS.md подробный журнал срезов (новое — сверху)
  docs/ui/               UI-решения владельца, спецификации экранов, матрица
  scripts/               проверки и тесты (*.test.ts), source/secrets/arch
  apps/mobile/
    App.tsx              __DEV__ → DevBootGate, иначе FoundationScreen
    scripts/             mobile.ts (запуск Metro), тесты с импортом .tsx
    src/app/             bootstrap, composition (createDevServices), navigation
    src/features/<f>/    domain/ data/ presentation/ public.ts README.md
    src/workflows/       кросс-модульные команды в одной транзакции
    src/read-models/     QueryRegistry, производные запросы (только чтение)
    src/shared/          db (SQLite, WriterCoordinator), ui (компоненты, темы)
  spikes/                изолированные эксперименты, в src не переносятся
```

## Правила зависимостей

- Экран → `public.ts` фичи → domain и порты → data-адаптер.
- Соседняя фича — **только через её `public.ts`**; нельзя импортировать
  `data/`, `presentation/`, `internal` чужой фичи. Проверяет `npm run arch:check`.
- UI не импортирует SQLite.
- Composition root: `app/composition/createDevServices.ts` собирает
  репозитории и передаёт порты; DI явный, без контейнера.

## Данные

- Один dev-файл БД `fitcoach_f04_clients_dev.db` через `SharedSqliteDatabase`.
- У каждого владельца свой журнал миграций (`calendar_schema_migrations`
  v1–v5, `measurement_schema_migrations`, `questionnaire_schema_migrations`…).
- Запись — только через `WriterCoordinator.write(tx => …)` (очередь,
  эксклюзивная транзакция, `quiesce` для обслуживания).
- Оптимистичная блокировка: CAS по `revision`. Уведомление подписчиков
  (`publish`) — после commit.
- Чтение в UI: `QueryRegistry` / `useQuerySnapshot`, подписки на
  committed-изменения.
- Все репозитории сейчас `Dev*Repository` — production DDL (gate D01) не начат.
- Планы тренировок: dev-миграции v8; мезоциклы/недели принадлежат конкретному участнику, соответствия — по lineageId.
  Порядок программ хранится в участии (`sort_position`), мезоциклов — в их `position`; выбор хранится отдельно.
  Дневник — независимый владелец с миграциями v6, факты не удаляются при структурной правке плана.

## Состояние и UI

- Глобального стора нет: состояние экрана — React state + снимки read-models.
- Темы: `shared/ui/theme` (`theme-catalog.v1.json` → `catalog.generated.ts`,
  `npm run theme:check`), `usePrototypeTheme()`.
- Общие компоненты: `shared/ui/components/public.ts` (AppButton, TextField,
  SelectionChip, ClientRosterCard, ConfirmDialog, AsyncStates…).
- Стили — `StyleSheet.create` в каждом файле, цвета только из токенов темы.

## Именование

- Файлы компонентов `PascalCase.tsx`, логика `PascalCase.ts`/`camelCase.ts`.
- Порты `*Port.ts`, правила `*Rules.ts`, модель `*Model.ts`, dev-адаптеры
  `Dev*Repository.ts` / `Dev*Catalog.ts`.
- Импорты с явным расширением `.ts`/`.tsx`.
- Тексты UI на русском; комментарии в коде — по-английски, кратко.
