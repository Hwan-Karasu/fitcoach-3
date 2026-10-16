# F02 — кандидат автоматических проверок

**Статус 2026-10-15: PARTIAL / NOT DONE.**

## Входы и зависимости

- Backlog F02: `S04,F01`; Architecture ADR-A03; `ui_gate=none`.
- S04: старый build120 сохранён только как внешний read-only reference; новый
  репозиторий независим. Реальных redacted SQLite/backup fixtures пока нет,
  поэтому зависимость не объявляется закрытой.
- F01: основной TypeScript/Expo проект запускается в Expo Go и проходит JS bundle,
  но native Debug/Release smoke ещё открыт. Поэтому F02 нельзя закрыть по одному
  зелёному статическому CI.
- Product §§53–56 и Architecture §4: новая навигация и владельцы данных;
  feature API только через `public.ts`, UI не обращается к SQLite напрямую.

## Что подготовлено

- `scripts/check-module-boundaries.ts` разбирает TypeScript AST основного приложения:
  статические/dynamic imports, re-export и строковые `require`. Проверяются
  владельцы feature, направление слоёв, чистота domain, запрет UI→SQLite/data,
  отсутствие локальных import cycles и неразрешённых относительных путей.
- `scripts/module-boundary-rules.test.ts` содержит десять отрицательных и
  положительных контрактных тестов. Локально: 10/10 PASS; `arch:check` PASS на
  68 нынешних TypeScript-файлах. Это guard для будущего кода, а не доказательство
  того, что ещё не написанные модули уже корректны.
- `.github/workflows/foundation.yml` запускает locked install, TypeScript strict
  для main/R07/R08, ESLint 10.12.0, единый foundation suite, архитектурный граф,
  theme snapshot check, Expo Doctor, secret guard и Android JS bundle на PR и `main`.
  Workflow пока только локальный кандидат; удалённый GitHub run не проверен.
  Он намеренно не содержит signing secrets и не выдаёт JS bundle за APK.
- `secrets:check` сканирует исходные файлы на PEM private key headers,
  характерные токены и случайно добавленные `.env`/JKS/SQLite-файлы;
  два теста проходят. Он печатает только путь/код находки, не значение ключа.
  Это ограниченный high-confidence guard, а не полная DLP-проверка.
- Корневой lockfile фиксирует Node 24.3.0, ESLint 10.12.0,
  typescript-eslint 8.71.2 и Jiti 2.7.0 для TypeScript-конфигурации
  `eslint.config.ts`. Локальный `npm run lint` проходит после устранения
  одного lint-замечания в R08 spike без изменения семантики маршрута.
  Повторный `npm ci` проходит; SHA-256 корневого `package-lock.json`:
  `1c21678fe8484c920b96dbeb75ef9f326f6b06613a1a83a15d0c4f42ee4f0bc4`.

## Открыто до F02 acceptance

- Foundation suite из 29 проверок и воспроизводимый SQLite integration test
  появились, но feature-level unit/integration matrix ещё зависит от реальных
  owner modules и D01/D04; Node SQLite не заменяет custom APK native smoke.
- Нет Android native build smoke в CI; F01 native Gradle gate открыт.
- Полный запрет секретов не доказан: простой локальный guard не покрывает
  все форматы и исключает сгенерированные каталоги; нужен отдельный
  security scan и проверка настроек удалённого репозитория.
- Обязательные status checks на PR требуют настройки branch protection в
  удалённом репозитории; локальный YAML это не включает автоматически.
- `source:verify` проверяет соседний документарный пакет и поэтому не включён
  в workflow одного Git checkout. Его нужно запускать локально до изменения
  нормативных документов или обеспечить отдельную доверенную доставку пакета.

## Дополнение 2026-10-15 — единый foundation suite

- `npm run test:foundation` выполняет все текущие unit/contract tests одной
  командой: 29/29 PASS. В набор входят архитектурные правила, guard секретов,
  темы, числовой ввод, boot, синтетический F04 core и пять integration tests
  на настоящем SQLite `:memory:` через Node 24. Режим `--test-isolation=none`
  проверен локально: sandbox запрещал Node test runner создавать дочерние
  процессы; в CI также используется закреплённый Node 24.3.0.
- Workflow на каждый PR теперь запускает единый suite, graph check,
  `theme:check`, Expo Doctor и существующие typecheck/lint/secrets/Android JS
  bundle. Два контрактных теста проверяют ключевые команды и read-only
  permissions самого YAML. Локальный Expo Doctor 21/21 прошёл после разрешения
  создания дочернего процесса; обычный sandbox запуск выдавал `spawn EPERM`.
- `secrets:test` явно проверяет запрет `.atbackup`. Содержимое потенциального
  пользовательского бэкапа не открывалось и в Git не добавлялось.
- После изменений: suite 29/29, typecheck, lint, arch:check, Android JS bundle,
  source:verify и local Expo Doctor проходят. Удалённого GitHub run, обязательной
  branch protection и native APK smoke по-прежнему нет; F02 — `PARTIAL`.

Пока эти пункты открыты, F02 остаётся `PARTIAL`, а нормативный backlog —
`PLANNED`. Никаких `APPROVED`/`DONE` статус не предполагает.
