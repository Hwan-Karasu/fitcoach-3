# Progress

Подробности каждого среза — `docs/PROJECT_STATUS.md`. Все срезы ниже — dev,
статус `PARTIAL / NOT DONE` до production D01 и UI approval.

## Сделано (dev-срезы, проверены на телефоне)

- Фундамент: F02 контур проверок, F04 SQLite core, F05 границы модулей,
  F06 read-model подписки, F08 общие UI-компоненты, F09 навигация, F10
  диагностика; темы 9×3.
- Миграция (только аудит, без переноса): R02–R04, D01 reference probe.
- Клиенты: C01 список, C03 карточка + Recovery Draft, C04 архив и
  окончательное удаление, C05 Главная клиента, C06 замеры.
- Календарь: K01 записи/дежурства/Copy-Paste-Clear Week, K02 Month Grid,
  Week/Day, жесты RNGH, настройки, Share Week.
- Учёт: L01 абонементы и Credit Ledger, L02 исход записи и очередь
  неразобранных, отмена с undo, «Исправить клиента», гость → клиент.
- Анкета: Q01.
- UI: документ стилистики и спецификация «Клиентов» (код не менялся).
- Тесты: foundation 205/205 + отдельные `*:test`.

## Не начато

- Production DDL (D01), реальная миграция build120, overlay APK, release.
- Q02 конструктор анкеты, T01 тренировки, питание, бэкап, импорт, упражнения,
  таймер отдыха, уведомления.
- Утверждение экранов: все `PROPOSED`, goldens `MISSING`.

## Техдолг и узкие места (замечено при осмотре)

- Release-сборка показывает только `FoundationScreen` — продукт живёт за
  `__DEV__` (`App.tsx`), все хранилища `Dev*`.
- Крупные файлы: `DevCalendarRepository.ts` (856 строк),
  `DevClientRepository.ts` (569), `CalendarScreen.tsx` (442),
  `AppointmentEditorScreen.tsx` (437) — кандидаты на разбиение при следующих
  правках.
- Прототипные имена: `*Preview.tsx` в clients, `PrototypeShell`,
  `PrototypeThemeProvider`, `shared/ui/prototype/` — переименовать при
  переходе на production-экраны.
- `ClientRosterPresentation.ts`: фильтр поиска продублирован в
  `presentClientRoster` и `presentArchivedClients`; локальный `byName`
  затеняет модульный; комментарий «Local calendar date of archivedAt» стоит
  над `ageOn`, а не над `formatArchivedSince`.
- Стили размазаны по 19+ экранам (`StyleSheet.create` в каждом) — UI-OWN
  решения потребуют единых компонентов, иначе правки геометрии будут
  дублироваться.
- Иконки — самописный `TabGlyph`; шрифт системный (решено: Inter + Lucide).
- Две версии TypeScript (корень 5.8.3, mobile 6.0.3).
- Тесты, импортирующие `.tsx` через `public.ts`, приходится класть в
  `apps/mobile/scripts` (корневой tsconfig без JSX).
- Пустые папки фич: backup, exercises, import, rest-timer.
