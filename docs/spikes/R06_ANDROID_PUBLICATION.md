# R06 — публикация копий в общем хранилище Android

Дата: 2026-10-23. **NATIVE BUILD + SYNTHETIC PUBLICATION VERIFIED**; R06/D05 OPEN.
Изолированная APK собрана и проверена: Downloads 20/20, SAF 19/19. Обычный
runtime/UI подключён через manual controller, в Expo Go/dev отключён. Эти native
проверки не заменяют E2E штатного интерфейса. [Отчёт](R06_PUBLICATION_ANDROID_REPORT.json),
[ручное копирование](R06_MANUAL_BACKUP.md), [журнал восстановления](R06_JOURNALED_RESTORE.md).

Входы: общий snapshot engine, D01 production identity, проверенный private
`.atbackup` с неизменяемым именем. Зависимости D05: D01/R06; D03: R04/R05.
Product refs: §§46.1–46.3, 46.12, 46.15–46.16, 46.20, 46.25, поздние §§53–56.
Перенос/overlay/signing/release gates не закрываются этим срезом.

## Реализация

`apps/mobile/modules/athlete-backup-storage` — локальный Expo Android module без
новой сторонней библиотеки. Kotlin нужен для платформенных MediaStore и
DocumentsContract API: SDK File.rename работает с java.io.File и не переименовывает
SAF content URI. Обычный Expo Go локального модуля не содержит; нужна изолированная
тестовая APK, затем штатный native build. Приложение 2.0 не заменяется.

- Default на API 29+: новая MediaStore.Downloads запись в
  `Download/Дневник атлета/`, `IS_PENDING=1`; запись, fsync, SHA-256/размер и
  повторное чтение до снятия pending, повторная проверка после публикации.
  Pending скрывает незавершённую запись от других приложений по
  [контракту Android](https://developer.android.com/training/data-storage/shared/media).
  Это не утверждение power-loss durability данного адаптера.
- Выбранная папка: только SAF tree с сохранённым read/write grant. Создаётся новый
  `.partial` document, проверяются возможности create/rename; запись/readback,
  DocumentsContract.renameDocument, повторный readback и проверка имени. Неподдержанный
  provider отклоняется; универсальная атомарность произвольных providers не заявлена.
- Источник — только существующий `.atbackup` внутри canonical app filesDir;
  SQLite header, размер и SHA проверяются до внешней записи. Не принимается LIVE
  или путь из импортированного manifest. Чтение и запись блоками 256 КиБ на IO dispatcher.
- Имя содержит UTC-время и UUID, overwrite отсутствует. Ошибка удаляет только URI,
  возвращённый create/insert этой операции. Предыдущие копии не перечисляются и
  не удаляются. Нативные ошибки выходят фиксированными кодами без путей/данных.
- API ниже 29 не использует Downloads автоматически; требуется разрешённая папка.
  При process death pending/partial может остаться; recovery/retention/чистка
  осиротевших технических файлов ещё не подключены.

`BackupPublication.ts` связывает receipt с точными backupId/датой/именем/размером/
SHA и content URI. NativeBackupPublisher проверяет наличие модуля через optional
lookup, не требует его при загрузке Expo Go, маскирует платформенные исключения.
Это boundary-контракт; его тесты не доказывают корректность Android IO.
`publicationTreeUri` убирает только завершающий сырой `/`, добавляемый Expo
Directory.uri; сохранённый Android tree grant такого слеша не содержит. Encoded
document ID, включая `%2F`, остаётся прежним; native требует точного grant.

## Фактические проверки

- Автоподключение Expo распознало локальный module и точный Kotlin classifier
  в основном mobile app и в `spikes/sqlite` (пакет `com.fitcoach.r07sqlite`).
- Java Maven-запросы заработали с `JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true`.
  JDK 17.0.10, Gradle 9.3.1; TLS и версии framework не менялись. Найденные ошибки
  исходника исправлены: `defaultConfig.versionName` для Expo Maven plugin и import
  `expo.modules.kotlin.functions.Coroutine`. `:athlete-backup-storage:compileDebugKotlin`
  и `:app:assembleDebug -PreactNativeArchitectures=arm64-v8a` завершились успешно.
- APK `com.fitcoach.r07sqlite` debug 0.0.1 установлена отдельно от 2.0. Downloads
  **20/20**: hash/size/header/missing source/ungranted tree negatives, receipt,
  независимый readback, отказ от duplicate без изменения первой копии, удаление
  исходной БД/snapshot/фото, staging из внешней копии, открытие всех 15 holders,
  клиент/рецепт и точные bytes восстановленного фото.
- SAF **19/19**: те же проверки в специально созданной тестовой папке. После
  нового процесса использован сохранённый read/write grant без повторного picker.
  Первый запуск обнаружил реальный trailing-slash mismatch; исправление проверено
  на телефоне и отдельной host-регрессией.
- Каждая внешняя копия содержит 1 044 480 bytes синтетических данных; имена
  намеренно имеют дату 2000-01-01. SHA/имена/checks зафиксированы в JSON-отчёте.
  Ни личные backup-файлы, ни рабочая база 2.0 не читались.
- Тестовая APK действительно удалена; конкретная копия Downloads осталась на
  месте. Владелец затем завершил установку. Отсутствие private настройки папки
  подтвердило чистое app storage. Выбран только известный synthetic файл:
  **picked-file restore6/6**, клиент/рецепт/точное фото. Независимый SHA публичного
  файла совпал с SHA до удаления APK. 2.0 build128 и личные копии не затронуты.

Открыты: обычный restore controller/confirmation, scheduler/rotation, native
publication process-death/partial cleanup/low-storage/другие providers/full-owner
matrix. v2 writer и Return с фото теперь проверены на Android: normal35/35,
rollback12/12, commit-gap recovery13/13 ([отчёт](R06_MANAGED_ANDROID_REPORT.json)).
Полный legacy mapping/staging и Excel остаются в прежней очереди.
