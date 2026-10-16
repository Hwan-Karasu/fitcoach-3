# FitCoach 3 mobile — F01 candidate

Это первый запускаемый TypeScript-проект в production-дереве. Пока он
показывает только диагностический экран F01; это не утверждённый UI FitCoach и
не реализованные бизнес-модули. Исходный код находится в `src/` по
[границам архитектуры](src/README.md).

Android dev package — `com.fitcoach.v3dev`, чтобы не затронуть установленный
`com.fitcoach.app` 2.0. Release package/signing/versionCode и реальная
миграция остаются отдельными открытыми gates. `F01` нельзя объявлять DONE до
Android Debug/Release smoke и завершения зависимостей S02/R07.

После `npm ci`: `npm run typecheck`, `npm run doctor`,
`npm run android:bundle`, `npm run mobile` (Expo Go через USB, порт 8083).

Для отдельного Android APK подготовлен профиль `dev-apk` в `eas.json`.
Он использует internal distribution, Node 24.3.0 и package
`com.fitcoach.v3dev`; с установленной версией 2.0 он не конфликтует.
Для проверенной изолированной сборки из этой папки в PowerShell:

```powershell
$env:EAS_NO_VCS = '1'
$env:EAS_PROJECT_ROOT = (Resolve-Path .).Path
npx --yes eas-cli@24.14.0 build --platform android --profile dev-apk
```
До отправки архива необходимо проверить исключения в `.easignore` и состав
архива через `eas build:inspect`; ключи, `.env`, реальные БД и PII
передавать нельзя. EAS CLI намеренно не установлен в зависимостях проекта:
Expo Doctor запрещает такую установку.

Для текущего F01 smoke EAS использует изолированный корень приложения:
`EAS_NO_VCS=1` и абсолютный `EAS_PROJECT_ROOT` на эту папку. На Windows
инспекция обычного Git-архива включала соседние файлы; перед каждой
облачной сборкой повторять `build:inspect` и проверку содержимого.
