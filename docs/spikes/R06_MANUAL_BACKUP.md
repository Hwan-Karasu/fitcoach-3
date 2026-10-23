# R06 — ручная копия и экспорт из настроек

2026-10-23. **APPLICATION WIRED / NATIVE PUBLICATION NOT VERIFIED**.
Task R06; D05 зависит от D01/R06, реальный D03 — от R04/R05. Входы: общий
SqliteSnapshotEngine, RuntimeCommandGate, native publication boundary.
Product refs: §§46.1–46.3, 46.12, 46.15–46.16, 46.20, 46.25, поздние §§53–56.
Gates production migration/overlay/signing/release остаются OPEN.

## Подключение

- `ManualBackupService` сериализует создание/выбор папки/одноразовый экспорт.
  Полная операция, включая picker, отдельный SQLite reader, публикацию и cleanup,
  удерживает RuntimeCommandGate. Restore должен дождаться её завершения.
- Согласованная SQLite-копия делается online backup API; metadata и фото добавляются
  только в новый private job. Отсутствующий LIVE не создаётся открытием SQLite.
  Изменившееся/потерянное фото запрещает публикацию неполной копии.
- Внешний файл считается готовым только после receipt с точным именем, UUID,
  SHA и размером. Предыдущая успешная копия остаётся в статусе при новом отказе.
  Уход с экрана снимает подписку, но не прерывает принятую файловую операцию.
- Папка хранится в private `runtime-backup/production/location.json`, отдельно
  от рабочей SQLite и её снимков. Восстановление данных не возвращает чужие
  OS-разрешения. Повреждённая настройка не подменяется папкой Downloads молча.
  Выбор папки сохраняется; отмена не меняет настройку. Разовый экспорт не меняет
  папку следующих копий. Доступ к выбранной папке проверяется native publisher.
- Настройки → «Резервные копии»: создание, выбор/сброс папки, экспорт,
  состояния ожидания, понятные ошибки без кодов/путей и предупреждение о копии
  без пароля. UI не получает DB/files handles. Возврат к экрану использует тот же
  controller. Expo Go и development mode отключают операции до чтения LIVE.

## Найденное на телефоне

1. `expo-sqlite` Android возвращает defaultDatabaseDirectory как native path,
   а Expo filesystem требует абсолютный URI. Создание Directory вызывало
   «URI is not absolute» до открытия БД. Добавлен проверяемый `sqliteDirectoryUri`;
   backup jobs создаются лениво, cold recovery без pending.json не трогает LIVE.
2. Переходный `fitcoach_dev_v3.db` содержал старые журналы из архивной цепочки,
   а runtime ожидал baseline. Диагностика показала отсутствие клиентов и доменных
   фактов в этом файле; исходная наполненная dev-база сохранилась в
   `fitcoach_f04_clients_dev.db`. Назначение baseline теперь
   `fitcoach_dev_baseline_v3.db`: перенесены **64 таблицы / 1150 строк** исходника
   до инициализации репозиториев. Каждый набор строк проверяется внутри общей
   транзакции до отметки успеха. Старые файлы и их журналы не переписаны/удалены.
   Несовпадение данных откатывает перенос; unsafe JS integer отклоняется без
   округления исходной SQLite. Это dev-перенос, не миграция пользовательской 2.0.
3. Expo Go может скрывать native SQLite directory от своего scoped filesystem
   API. Проверка File.exists не доказывает отсутствие dev-файла. Для исходника
   сохранён прежний путь через SQLite, а публикация в Expo Go отключена.

Отладочные логи убраны. На телефоне проверены обычный boot, наличие сохранённых
dev-клиентов и переход Настройки → Резервные копии, возврат и повторный вход.
Экран честно сообщает недоступность операции в этой сборке. Снимки экрана
остаются игнорируемыми локальными артефактами; пользовательская 2.0 не изменялась.

## Доказательства и ограничения

- Итоговый `npm run test:foundation`: **1002/1002**; typecheck, lint,
  arch:check (480 sources), source:verify, secrets:check, diff --check прошли.

- 12 controller/integration checks: cancellation, duplicate admission, runtime drain,
  settings persistence, invalid receipts, errors/cleanup/unsubscribe. Настоящая
  Node SQLite-копия переносится во внешний каталог и восстанавливается после
  удаления исходной установки; OS publisher в этом тесте заменён на FS boundary.
- Четыре URI-регрессии и dev-import parity/unsafe integer rollback проверки.
- Android JS/Hermes bundle: **5600 modules / 1136 assets**. Первое sandbox-исполнение
  не смогло запустить Hermes (spawn EPERM); повтор с разрешением прошёл.
  JS bundle не является компиляцией Kotlin или проверкой внешней записи.
- Нативный модуль ещё не скомпилирован: см. [R06_ANDROID_PUBLICATION.md](R06_ANDROID_PUBLICATION.md).
  Реальные MediaStore/SAF, повторное чтение, permissions, process death при
  публикации, low storage и uninstall/reinstall остаются OPEN.
- Restore UI/controller/job writer, protected Return point с фото, autoscheduler,
  rotation и reconcile OS rest signals ещё не подключены. Полная миграция
  2.0→3.x также не закончена. Excel следует после backup/restore, затем UI/темы.
