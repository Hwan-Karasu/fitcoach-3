# F01 — кандидат мобильного стека

**Статус 2026-10-15: CANDIDATE / EXPO GO + EAS APK DEVICE PASS; F01 NOT DONE.**

## Входы и открытые gates

- Backlog F01: зависимости `S02,R07`, Architecture §12, Technical Stage 3 §04;
  `ui_gate=none`. S02 остаётся `READY_FOR_REVIEW`; R07 имеет Expo Go device
  evidence, но custom Android APK не проверен.
- Product §§1,2,4,46.6,53–56: offline trainer-only; dev package не должен
  заменить установленный `com.fitcoach.app`; release package/signing,
  migration и конкретные UI screens — отдельные gates.
- Версии выбраны по результатам независимых R07/R08 TypeScript spikes и
  проверены против официальной [матрицы Expo SDK](https://docs.expo.dev/versions/latest/),
  не скопированы автоматически из build120.

## Воспроизводимый кандидат

`apps/mobile/package.json` + `package-lock.json` (SHA-256
`404fdfe28a72879677cfd5e5c0ab17aab963bf7edaf715addd666cced7cd10c3`)
содержат Expo 57.0.29, RN 0.86.3, React 19.2.3, React Navigation 7
(`@react-navigation/native` 7.5.1),
expo-sqlite 57.0.4 и TypeScript 6.0.3. Для Metro используется локально
установленный Node 24.3.0; системный Node 22.12.0 ниже engine requirement
RN 0.86.3 и не считается утверждённой средой сборки.

Текущий `app.json` использует **только dev** ID `com.fitcoach.v3dev`;
это сознательная защита установленной 2.0. Release ID `com.fitcoach.app` и
`versionCode` задаются после signing/migration gate, без silent overlay.

## Проверено / не проверено

| Проверка | Результат |
|---|---|
| `npm ci` из lockfile | PASS, 498 packages; lockfile SHA-256 не изменился |
| TypeScript strict | PASS |
| Expo Doctor | PASS 21/21 |
| Android JS bundle | PASS после исправления navigation peer deps, `index.ts` |
| Expo Go на RMX3706 Android 16 | PASS: ADB UI tree содержит `Основной проект запущен` и F01 label |
| Android Debug/Release APK | PARTIAL: EAS internal standalone dev APK установлен пользователем на RMX3706; cold/warm launch и диагностический экран подтверждены через ADB. Локальный Gradle заблокирован на `org.gradle.toolchains.foojay-resolver-convention:1.0.0`; отдельный Debug APK не собран. |
| Реальный продуктовый UI/SQLite | OPEN: диагностический экран не business implementation |

`npm ls @react-navigation/native @react-navigation/elements --depth=2`
теперь проходит без peer-конфликта. После обновления пакета TypeScript,
Expo Doctor 21/21 и Android JS bundle повторно прошли.

`npm audit --omit=dev` показал 22 записи (7 moderate, 15 high) в дереве
зависимостей. Автоматический `audit fix --force` предлагает несовместимый
скачок на Expo 44/RN 0.72; он **не выполнялся**. Уязвимости нужно
триажировать по реальной достижимости и совместимым версиям до принятия F01.

Для native smoke применить официальный путь
[development build](https://docs.expo.dev/develop/development-builds/introduction/)
и [Android APK](https://docs.expo.dev/build-reference/apk/) на отдельном
dev package; Expo Go не заменяет этот gate.

Prebuild подтвердил в сгенерированном Android проекте
`applicationId com.fitcoach.v3dev`, `versionCode 1`. Официальный
[Gradle Plugin Portal](https://plugins.gradle.org/plugin/org.gradle.toolchains.foojay-resolver-convention)
публикует нужный plugin; прямой HTTP HEAD с хоста возвращал 200, но Gradle
resolver в этой локальной среде его не загрузил. Debug log Gradle 9.3.1
показывает `java.net.SocketException: Permission denied: no further information`
при подключении JVM к `repo.maven.apache.org:443`; этот gate нельзя обходить
фиктивным APK. Нужен разрешённый сетевой доступ для Java/Gradle или
воспроизводимое заранее заполненное Gradle-хранилище зависимостей.

Для альтернативного native smoke подготовлен EAS Build-профиль `dev-apk`
в `apps/mobile/eas.json`: internal Android APK, Node 24.3.0 и отдельный
`com.fitcoach.v3dev`. В `.easignore` корня репозитория и приложения исключены
локальные БД, секреты, ключи, сгенерированный Android-проект и временные
артефакты. EAS CLI 24.14.0 запускается через `npx`, не добавляется в
зависимости приложения (Expo Doctor 21/21).

EAS-проект создан отдельно: `@hwankarasu/fitcoach-3-development`, ID
`698a26af-08d4-44f4-9507-747143ad4f02`. На Windows `build:inspect` при
обычном Git-режиме включал соседние папки и `.git` даже при локальном
`.easignore`; поэтому для пробной сборки задан `EAS_NO_VCS=1` и абсолютный
`EAS_PROJECT_ROOT=E:\ProjectFitCoach\FitCoach_3\apps\mobile`.
Повторная инспекция показала 37 файлов / 277806 байт, только приложение,
без `.git`, соседних документов, локальных БД и high-confidence секретов.
Это одноразовый обход для изолированного F01-кандидата, не готовая CI-схема.
EAS build `78858330-c64c-4d39-815b-99492e3fcf88` завершился `FINISHED`;
cloud dev-keystore создан. APK сохранён в
`artifacts/f01-dev-apk-78858330.apk` (83 924 199 байт, SHA-256
`708dea27012de160627fc712373030a38b82b4e6668c77e904d9d2b6bdd9c0c3`).
`aapt` подтвердил `com.fitcoach.v3dev`, `versionCode=1`, `versionName=0.0.1`,
`apksigner verify` — валидную подпись с SHA-256 сертификата
`a5fdc8cb817bbe8d1ef5de8d68a1ee1a24d0e26a2b8e7d031b3280fad69a7186`.
Первая ADB-install на RMX3706 остановилась на штатной Realme/Oppo Enhanced
installation protection; защиту автоматически не отключали. После установки
пользователем ADB подтвердил оба отдельных пакета: `com.fitcoach.v3dev`
0.0.1 / versionCode 1 и нетронутый `com.fitcoach.app` 2.0.0 /
versionCode 128. `MainActivity` dev-пакета запустилась; UI tree содержит
`Основной проект запущен` и F01 label. Повторный запуск после Home и cold
launch после `am force-stop` прошли, процесс остаётся живым. Это только
foundation smoke: полноценный продуктовый UI, реальные SQLite adapters,
профилирование и отдельный Debug APK ещё открыты. F01 остаётся `NOT DONE`.
