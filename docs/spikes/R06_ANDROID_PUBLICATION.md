# R06 — публикация копий в общем хранилище Android

Дата: 2026-10-23. **WIP / NATIVE BUILD NOT VERIFIED**. R06/D05 OPEN.
Обычный runtime/UI пока не вызывает этот адаптер.

Входы: общий snapshot engine, D01 production identity, проверенный private
`.atbackup` с неизменяемым именем. Зависимости D05: D01/R06; D03: R04/R05.
Product refs: §§46.1–46.3, 46.12, 46.15–46.16, 46.20, 46.25, поздние §§53–56.
Перенос/overlay/signing/release gates не закрываются этим срезом.

## Реализация, ещё не доказанная на устройстве

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

## Фактические проверки

- Автоподключение Expo распознало локальный module и точный Kotlin classifier
  в основном mobile app и в `spikes/sqlite` (пакет `com.fitcoach.r07sqlite`).
- 11 новых проверок receipt: другой hash/размер/backup, private/web/неполный URI,
  лишние сырые ошибки, invalid metadata не становятся успешным результатом.
- Foundation **984/984**, mobile/spike typecheck, lint, arch:check (473 TS files),
  source:verify (73 entries), secrets:check и diff --check прошли.
- Android production JS bundle **5583 modules/1185 assets** собран. Этот результат
  не включает компиляцию Kotlin и не подтверждает работу нативного модуля.
- **Нативная компиляция не дошла до исходника**: Gradle 9.3.1 есть в пользовательском
  кеше, но отсутствует foojay-resolver-convention 1.0.0. Онлайн --info выявил
  `java.net.SocketException: Permission denied` при обращении Java к Maven.
  Проверка того же публичного plugin POM через PowerShell дала HTTP 200.
  HTTPS_PROXY окружения агента — заглушка; прокси из этого окружения не решает
  загрузку Gradle. Сертификаты/TLS-проверки не менялись, код RN/Gradle не ослаблялся.
  Журналы в игнорируемых `.cache/r06-native-build*.log`.
- APK не устанавливалась; MediaStore/SAF readback, provider failures, interrupted
  publication и uninstall/reinstall данным срезом **не проверены**.

Следующее: доступная нативная toolchain/зависимости и компиляция; подключение
manual create/export controller и экрана настроек; native-проверка default и SAF.
Далее сохраняются полная restore confirmation/job/journal writer, Return point,
autoscheduler/rotation, native negative/low-storage/reinstall/full-owner matrix,
полный legacy mapping/staging. Excel — после backup/restore, по прежней очереди.
