# FitCoach 3.0

Новая независимая реализация offline Android-приложения для тренера.

## Текущий статус

- Новый репозиторий создан с нуля; код FitCoach 2.0 не копировался.
- Размечены production-модули в [apps/mobile/src](apps/mobile/src/README.md)
  и создан запускаемый TypeScript/Expo F01 candidate с диагностическим экраном.
- Актуальный источник истины — соседняя папка
  `../FitCoach_3_DOCUMENTS_SYNCED_2026-10-14`.
- Зафиксированы source baseline (`S00`) и первичная карта конфликтов с build120
  (`S01`).
- Проектные скрипты написаны на TypeScript strict; изолированные R07 SQLite и
  R08 navigation spikes проходят typecheck, Expo Doctor, Android bundle и
  проверены в Expo Go на подключённом телефоне.
- Бизнес-runtime, production DDL, Android signing, миграция и screen approvals
  ещё не выполнены. Доказательства custom Android APK пока открыты.

## Что строим

- Android, React Native/Expo как выбранное архитектурное направление.
- TypeScript strict, React Navigation, локальная SQLite как канонический SoT.
- Offline trainer-only V1 без client auth, backend/cloud sync, подписок
  приложения и Health Connect.
- Три корневых раздела: Клиенты, Календарь, Архив; отдельные Settings и Bell.
- Client Workspace: Главная, Питание, Тренировки, Ещё.
- Девять тем и по три совместимых акцента.

Кандидат точных версий зафиксирован в F01 lockfile, но ещё не принят без
native Debug/Release smoke; production-схема фиксируется отдельно в `D01`.

## Документы проекта

- [Индекс](docs/README.md)
- [Source baseline](docs/SOURCE_BASELINE.md)
- [Карта legacy-конфликтов](docs/LEGACY_CROSSWALK.md)
- [Аудит Stage 2/3/4](docs/STAGE_SYNC_AUDIT.md)
- [Текущий статус](docs/PROJECT_STATUS.md)
- [Кандидат стека F01](docs/adr/F01_STACK_CANDIDATE.md)
- [Кандидат проверок F02](docs/adr/F02_CHECKS_CANDIDATE.md)
- [Кандидат boot gate F03](docs/adr/F03_BOOT_CANDIDATE.md)
- [Кандидат каталога тем F07](docs/adr/F07_THEME_CANDIDATE.md)
- [Структура production-модулей](apps/mobile/src/README.md)
- [SQLite spike и его доказательства](docs/spikes/R07_SQLITE_STATUS.md)
- [Android package/signing evidence R01](docs/spikes/R01_ANDROID_IDENTITY.md)
- [Navigation spike и его доказательства](docs/spikes/R08_NAVIGATION_STATUS.md)

## Проверка источников

```powershell
npm run source:verify
npm run arch:test
npm run arch:check
npm run secrets:test
npm run secrets:check
npm run lint
npm run typecheck
npm run theme:check
npm run theme:test
npm run boot:test
```

## Основной проект на телефоне

После установки зависимостей в корне и в основном проекте:

```powershell
npm ci
npm --prefix apps/mobile ci
npm run mobile
```

`npm run mobile` запускает **основной TypeScript-проект**, пока с диагностическим
экраном F01. Это не утверждённый продуктовый UI. Нужны Expo Go и ровно одно
Android-устройство в состоянии `device` через ADB. Команда настраивает USB
reverse, поднимает Metro на localhost:8083 и открывает проект в Expo Go.

SQLite spike R07 отдельно: `npm run mobile:sqlite` после
`npm --prefix spikes/sqlite ci`.

Для отдельной проверки навигации R08:

```powershell
npm --prefix spikes/navigation ci
npm run mobile:navigation
```

R08 открывается в Expo Go через USB reverse на порту 8082; основной
интерфейс FitCoach эта команда также не запускает.

