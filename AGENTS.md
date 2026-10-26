# FitCoach 3.0 — правила работы

## Единственный источник истины

Дополнение владельца от 2026-10-26 имеет приоритет для переноса и выпуска:
`docs/INDEPENDENT_V3_AND_EXCEL.md`. 3.0 устанавливается отдельно; бэкап только
собственного формата; перенос тренировок через Excel-матрицы. Прямая миграция
2.0 → 3.0 больше не является release gate. Удалять оставшийся migration-only код
можно после подтверждённого переноса пользовательских тренировок. Текущие задачи:
`docs/TRANSFER_BACKLOG.json`. Исторический пакет ниже сохраняется как baseline.

Для любой задачи использовать пакет
`E:\ProjectFitCoach\FitCoach_3_DOCUMENTS_SYNCED_2026-10-14`.

Приоритет:

1. `00-SOURCE_OF_TRUTH.md` и Product Contract, особенно поздние §§53–56.
2. Architecture Design.
3. Data & Technical Design.
4. Feature Specifications.
5. UI/UX Design и Screen Atlas с учётом их статусов.
6. Implementation Plan и `TASK_BACKLOG.json`.

GitHub `Hwan-Karasu/fitcoach`, ветка `stable/v2.0.0-build120`, — только
устаревший read-only референс внешнего вида, поведения и legacy-данных. Код,
архитектуру, auth/backend/sync и старые продуктовые правила из него не переносить
автоматически.

## Рабочий порядок

- Работать по одному task ID из актуального backlog.
- До изменений перечислять входы, зависимости, Product refs и открытые gates.
- Не превращать `OPEN`, `PROPOSED` или `PLANNED` в `APPROVED`, `VERIFIED` или
  `DONE` без фактического доказательства.
- Не начинать production DDL, реальную миграцию, overlay APK или release до
  прохождения соответствующих gates.
- Не помещать в Git секреты, JKS/PEM, пароли, реальные пользовательские БД и PII.
- Новый исходный код и проектные скрипты писать на TypeScript strict; `.js`/`.mjs`
  не добавлять без отдельного платформенного основания.
- UI не обращается к SQLite напрямую. Calendar, Workout и Credit Ledger имеют
  независимую семантику. Структурные правки не уничтожают факты.
- V1 — offline trainer-only. Client login, backend/cloud sync, client chat,
  подписки приложения и Health Connect исключены.

## Проверки

- Источники: `npm run source:verify`.
- Проверка TypeScript: `npm run typecheck`.
- Остальные команды добавляются только вместе с фактическим tooling и не
  объявляются успешными заранее.

