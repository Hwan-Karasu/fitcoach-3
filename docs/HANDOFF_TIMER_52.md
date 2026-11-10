# Передача Claude — остановка по просьбе владельца, 2026-11-10

Владелец попросил сделать коммит и остановиться из-за лимита. Это сохранение работы, НЕ финальная приёмка build52. Последние требования: уменьшить высокие таймеры; нижняя навигация должна целиком заполнять низ экрана единым контейнером с таймерами, не быть плавающей пилюлей; обязательно проверить возврат к исходному упражнению нажатием на таймер.

## Что доказано

- **Причина вылета найдена на настоящем Android runtime**, не предположение: синтетическая тренировка, release x86_64, Android 16/API36, Hermes/New Architecture. `RestTimerDock` удерживал pooled event в `setWidth(old => ...event.nativeEvent.layout.width)`. Отложенный reducer получал nativeEvent=null → JavascriptException → процесс закрывался. Исправлено на немедленное чтение `setWidth(event.nativeEvent.layout.width)`. Regression test очищает событие после dispatch: RED до правки, GREEN после.
- Даже после замены AnimatedTextInput на обычный Text вылет воспроизводился, пока не исправлен layout. Source map точно указала строку 136:76. Старый build47 этого обработчика не имел.
- С исправленным layout прошли **30 реальных циклов**: очистка/повторное заполнение подхода → один запуск → сворачивание/разворачивание жестами и кнопкой. PID2862 сохранялся, MainActivity оставалась RESUMED. Логи `artifacts/timer-native/cycles.log`, результаты `cycles.json`.
- Пройдены в эмуляторе: два независимых таймера, ±15, пауза/продолжение, пропуск одного, фон, блокировка, kill процесса в фоне и восстановление обоих pausedLeftMs; возврат со списка клиентов к первому и второму упражнению с прокруткой. `extended.json`, `navigation-*.xml/png`.
- Системное уведомление действительно доставлено в фоне (`notification-delivered.txt`), но его нажатие обнаружило ещё один баг: openTarget ничего не делал, если уже открыта та же тренировка, даже когда нужно другое упражнение.
- Общий прогон после исправления layout: **1228/1228 PASS** (`foundation-final.log`); профильные таймеры31/31. Это состояние ДО последних правок компактности/нижней панели и перехода внутри уже открытого дневника.

## Что изменено после этих проверок — обязательно проверить

1. `exerciseFocusAction.ts` + PrototypeShell + ClientPrimaryNavigators + WorkoutScreen: targeted SET_PARAMS на nested workout stack, focusExerciseRequest для повторных нажатий, эффект прокрутки уже измеренных карточек без нового onLayout. Экран не заменяется, ввод не должен теряться. Добавлен тест в notification-target.test.ts. Последняя правка — guard undefined root state и совместимость PartialState; итоговый native-прогон ещё НЕ выполнен. Проверить: в уже открытом дневнике уйти к другому упражнению и нажать на таймер; повторить для того же упражнения; повторить по системному уведомлению после фона.
2. Агент timer_native_rca уменьшил RestTimerDock: время справа в заголовке, четыре кнопки48dp одним рядом; карточки min232–256dp, горизонтальная прокрутка уже при2. UnifiedBottomPanel теперь full-width, navigation-фон дониза, safe area внутри, без floating shadow/внешних отступов/нижних скруглений. Геометрия6/6 PASS для320/360/412 и fontScale1/1.3/2; **визуально в Android НЕ проверено**. Не откатывать немедленное чтение nativeEvent.
3. Повторить TypeScript/профильные тесты, затем native сборку и проверки последних изменений. Старые `cycles.ts` и `extended.ts` используют координаты ПРЕЖНЕЙ высокой панели, их надо адаптировать. `device.ts dump` требует idle: работающий секундный Text может мешать uiautomator; сначала поставить на паузу или использовать screenshot. Скрипт отказывается от устаревшего XML.

При передаче после последнего guard: **mobile TypeScript PASS; notification-target + rest-panel 12/12 PASS** (`handoff-tests.log`). Это не заменяет оставшийся Android-прогон. Эмулятор остановлен командой `adb -s emulator-5554 emu kill`.

## Сборки, окружение и оставшиеся gates

- app.json уже **versionCode52**, generated Android build.gradle тоже52. **Готового финального APK52 в artifacts/apk нет.** Промежуточный `apps/mobile/android/app/build/outputs/apk/release/app-release.apk` собран ДО последних изменений выше, не выдавать его за финальный. Он dual ABI arm64-v8a,x86_64. Исходные APK47–51 оставлены неизменными.
- Эмулятор создан отдельно в `artifacts/timer-native/avd/timer36.avd`; system image `artifacts/timer-native/system-image/x86_64`, официальный Google Android36_r02, SHA1 829c076e8ff448a336097ae25a355b495ba36e2c проверен. Только синтетические TimerTest/TimerRegression; личных БД нет. Эмулятор остановлен при передаче (проверь adb devices).
- Для старта: ANDROID_AVD_HOME=абсолютный artifacts/timer-native/avd, ANDROID_USER_HOME=artifacts/timer-native/android-user, ANDROID_SDK_ROOT=`C:/Users/brazh/AppData/Local/Android/Sdk`; emulator.exe -avd timer36 -no-window -no-audio -no-snapshot -gpu swiftshader -no-metrics. Start-Process только WindowStyle Hidden.
- Node24: `node_modules/node/bin/node.exe`. Host-тесты `--experimental-strip-types --test-isolation=none`. Общий npm run test:foundation требует вне sandbox для проверок child-process death (иначе EPERM, это не дефект приложения).
- JDK17 `C:/Users/brazh/AppData/Local/Programs/Microsoft/jdk-17.0.10.7-hotspot`; Node24 в PATH, ANDROID_HOME как выше, CI=1, NODE_ENV=production. Из apps/mobile/android: `gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a,x86_64 --console=plain --max-workers=2 --offline --init-script E:/ProjectFitCoach/FitCoach_3/artifacts/build49/health-connect.init.gradle`. Нужен доступ к существующему глобальному Gradle cache.
- После окончательной сборки проверить aapt/apksigner и обновление без удаления данных, скопировать как artifacts/apk/athlete-diary-3.0.0-build52.apk, записать hash. Прежний cert SHA256 fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c.
- Физический телефон владелец подключить не может. Его прошивка/arm64/глубокий сон и личная копия70МБ остаются непроверенными. Не утверждать приёмку на телефоне.
- Все предыдущие изменения восстановления47/запуска/2сек заставки/карточек2×2 сохранены. Их подробности: BUILD51_FIXES_2026-11-10.md, RECOVERY_BUILD50_2026-11-10.md. Причина замедления хеширования проверена на синтетике, реальное время на телефоне не измерено.
- Пользовательское фото photo_2026-11-09_16-12-02.jpg и ранее существовавшие docs/ui/concepts не относятся к этой работе, оставлены вне коммита. Push не запрошен.
