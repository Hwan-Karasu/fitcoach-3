# R07 — SQLite transactions/revisions/explain на Expo Android

**Статус: DEVICE PASS / READY_FOR_REVIEW (Expo Go, не custom APK).** Изолированный sample:
[`spikes/sqlite`](../../spikes/sqlite/README.md). Это не production schema и не
утверждённый `F01` стек.

## Входы и gates

- Зависимость `S04`: read-only build120 reference зафиксирован; реальные
  SQLite/backup fixtures не предоставлены, но R07 использует только синтетику.
- Architecture ADR-A02/A04/A05, Technical T06 и backlog R07 из синхронизированного
  пакета 2026-10-14. Product screen gate здесь не применяется.
- Android-запуск и отчёт о фактических SQLite-операциях получены 2026-10-15:
  [device report](R07_DEVICE_REPORT.md). Typecheck и bundle сами по себе не
  доказывают native transaction semantics.

## Что уже проверено 2026-10-15

| Проверка | Результат |
|---|---|
| TypeScript strict (`npm run typecheck`) | PASS |
| `expo-doctor@1.20.4` | PASS, 21/21 checks |
| Metro Android export под временным Node 24.3.0 | PASS, 611 modules, Hermes bundle 1.6 MB |
| Android prebuild | PASS, сгенерированная папка Git-ignored |
| Native debug APK | BLOCKED до компиляции: Gradle 9.3.1 отсутствует в доступном кэше; Java network к `services.gradle.org` закрыт |
| Android runtime SQLite checks в Expo Go 57.0.9 | PASS: Android 16, SQLite 3.50.3, 14/14, `allPassed=true` |

Прототип на телефоне проверил `foreign_keys`, WAL, exclusive commit, rollback
двух изменений в общем transaction scope, сериализацию двух команд, post-commit
revision, targeted read-model invalidation, второе SQLite-соединение, WAL
checkpoint, FK/integrity и индексный query plan. Результат извлечён из
отображённого JSON-отчёта через ADB UI hierarchy; полный набор проверок PASS.

Локальный Node 22.12.0 ниже engine requirement RN 0.86.3. Временный Node 24.3.0
использован только для bundle/prebuild. Версия TypeScript для spike поднята до
6.0.3, потому что Expo Doctor отклонил 5.8.3. Основной проект пока не закрепляет
Expo/TS stack: это отдельная задача `F01` после `S02` и `R07`.

## Следующий воспроизводимый шаг

На хосте с Android device/emulator online и доступными Gradle/Maven-зависимостями:

```powershell
cd spikes/sqlite
npm ci
npm run doctor
npm run typecheck
npm run android
```

После запуска нажать «Запустить проверки» и подтвердить `allPassed=true`.
Для `F01` отдельно нужны custom Android Debug/Release smoke и exact package lock;
успех в Expo Go не заменяет эти проверки. При изменении SQLite-кода повторить
device report. Если проверка провалится — вернуть R07 в OPEN и исправить spike,
а не менять production DB.
