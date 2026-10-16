# S02 — аудит синхронизации Stage 2/3/4

**Статус: KNOWN_CONFLICTS_CORRECTED / READY_FOR_REVIEW.** Пакет
`FitCoach_3_DOCUMENTS_SYNCED_2026-10-14` остаётся единственным источником
истины. С разрешения владельца 2026-10-15 исправлены Stage 2/3/4 и R08;
Product Contract не изменён. История до/после сохранена в
`00-S02_REVISION_LOG.md` пакета. Это не означает, что все 20 спецификаций
прошли ручную семантическую ревизию или готовы к коду.

Проверка `npm run source:verify` фиксирует 73 файла по SHA-256; команда
`npm run source:stage-audit` проверяет наличие §§53–56, реестров в пяти
сводных документах, поздних дополнений в 20/20 feature-файлах и отсутствие
известных устаревших фрагментов. Проверка по шаблонам **не является полной семантической
ревизией** каждой feature-spec.

## Действующая норма для реализации

| Область | Применять | Источник и статус |
|---|---|---|
| Trainer shell | Нижние `Клиенты / Календарь / Архив`; Settings — отдельный маршрут из меню, Bell — отдельный Notification Center | Product §53.1–53.2 `APPROVED`; точный screen layout требует UI gate |
| Client Workspace | Четыре нижних controls `Главная / Питание / Тренировки / Ещё`; из «Ещё» доступны `Анкета / Архив / Статистика` как самостоятельные destinations | Product §53.3 `APPROVED`; оболочка «Ещё» ещё UI design detail |
| Client Home | Полный визуальный редизайн без изменения утверждённых бизнес-фактов и функций | Product §53.4, §56.2 `APPROVED`; пиксельный экран не утверждён |
| Notification Center | Локальные события, read/dismiss, unread-only badge, retention по умолчанию 90 дней и настройка внутри | Product §54 `APPROVED`; Android delivery/UI gestures — `OPEN` |
| Themes | Девять независимых тем × три совместимых акцента, без обязательного Light/Dark/System | Product §§55–56 `APPROVED`; конкретные goldens/Android contrast — `OPEN` |

Старый `SafeRoute` заменён в Stage 4. При реализации следует сохранить правило: `settings`
не является значением root tab, а `questionnaire/archive/statistics` не
являются дополнительными нижними controls. При проектировании typed route
registry разделить `RootTab(3)`, отдельные `SettingsRoute` и
`NotificationCenterRoute`, `ClientControl(4)` и шесть смысловых client
destinations. Safe snapshot должен содержать только разрешённые route/IDs и
проверяться перед восстановлением (Architecture ADR-A08; Stage 3 §03).

## Исправленные фрагменты исходного снимка

Пути ниже указаны относительно папки источника; номера строк относятся к
зафиксированному manifest от 2026-10-14. Одинаковый текст встречается в
сводном документе и отдельном модуле — оба места требуют корректной редакции.

| Файл/строки | Устаревший смысл | Чем заменён |
|---|---|---|
| `03-Data-Technical/DATA_TECHNICAL_DESIGN_SYNCED.md:436,449,455` | 4 root tabs; frozen Home; Back для 4 tabs | Product §53.1/§53.4: 3 tabs, полный редизайн; Back для трёх root tabs |
| `03-Data-Technical/design-notes/03-STATE-AND-NAVIGATION.md:61,74,80` | Те же три устаревшие нормы | Product §53.1/§53.3/§53.4; Stage 3 поздний раздел после §§53–56 |
| `04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.md:287,293,302` | 4 root tabs; Home visually frozen; `settings` внутри `SafeRoute.root.tab` | Product §53; поздний реестр в начале и cross-norm в конце Stage 4 |
| `04-Feature-Specifications/features/01-app-shell.md:10,16,25` | Те же три устаревшие нормы в самостоятельном файле | Product §53; собственный поздний cross-norm файла не исправляет старый TypeScript snippet автоматически |
| `06-Implementation/TASK_BACKLOG.json`, задача `R08`; `IMPLEMENTATION_PLAN_SYNCED.md:112` | Ссылка `TECH T08` у navigation spike | `T08` в Stage 3 §07 — fact identity/versions. Ссылка исправлена на Product §§2,53, Architecture ADR-A08, Stage 3 §03 в JSON/CSV, Plan MD/HTML и runbook. |

Также в Architecture Design §7 исправлены прежние четыре root-пункта и
визуальный freeze Главной; §10 с концепцией модулей сохранён. Другие
устаревшие правила §51 убраны из §§0,11,14–16 и синхронной HTML-копии.

Старые формулировки сохранены только в `00-S02_REVISION_LOG.md` как история;
в нормативных файлах заменены. Полный список изменённых файлов и исходный SHA
manifest находятся там же.

## 20 feature specifications

Проверено наличие отдельного файла и позднего cross-norm в каждом 01–20.
`01-app-shell` исправлен в трёх указанных местах;
`16-client-home-settings` и `17-notifications-rest-timers` содержат явные
обновлённые секции по Home и Notification Center. Для 02–15 и 18–20
автоматическая проверка подтверждает **наличие** общего позднего дополнения,
но не доказывает отсутствие всех скрытых семантических конфликтов. Поэтому
приёмочный пункт S02 «20 specs не противоречат» пока не объявляется закрытым.

Дополнительный тематический проход выявил и исправил старый визуал Главной в
Feature 14/15 и сузенный тип стартового раздела в Feature 16. Результаты по
каждому из 20 файлов зафиксированы в [матрице проверки](S02_FEATURE_REVIEW.md).

## Что требуется для закрытия S02

1. Пройти ручную семантическую ревизию всех 20 specs на соответствие Product
   §§53–56; автоматические проверки покрывают только известные противоречия.
2. Зафиксировать review и только после него закрыть `S02`. Product Contract
   не изменять без отдельного решения владельца; UI screens не повышать до
   `APPROVED` без отдельных screen gates.
