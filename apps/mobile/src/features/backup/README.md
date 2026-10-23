# BackupRestoreUpgrade

Обычный runtime получил `ManualBackupService` и экран настроек «Резервные копии»:
ручное создание/одноразовый экспорт через общий snapshot engine и native publisher.
В Expo Go и dev-режиме операции отключены; экран проверен на телефоне. Реальная
публикация требует сборки с локальным Kotlin module. Он скомпилирован и проверен
отдельной synthetic APK: Downloads20/20, SAF19/19; это не E2E обычного UI.
Ошибки отображаются понятным текстом, без внутренних кодов и путей.
Подробности и границы: `docs/spikes/R06_MANUAL_BACKUP.md`.

`application/GuardedRestore.ts` — кандидат протокола R06: проверка исходного и
входящего SHA-256, закрытая база, независимая страховочная копия, сохранённый
guard перед заменой и восстановление при следующем запуске. Публичные ошибки
не содержат исходных SQLite/файловых сообщений и путей.

`RestoreStorage` требует эксклюзивной остановки всех читателей, очередей записи,
SQLite-соединений и планировщика. Протокол сам не обеспечивает эту остановку.
После `recover()` обычный boot обязан проверить/открыть БД до UI. `COMPLETED` и
`ROLLED_BACK` — сохранённые результаты операции: повтор не заменяет данные,
которые пользователь успел изменить после завершения.

Синтетический host-adapter, SQLite `.atbackup` и process-kill тесты находятся в
`scripts/r06`. Они не подключены к живой БД. Format candidate — обычный SQLite
snapshot с manifest, без ZIP/шифрования. Restore удаляет snapshot-only metadata
только из отдельного staging. Host-прототип включает фото рецептов блоками BLOB
до 256 КиБ, проверяет SHA/длины/полноту ссылок, восстанавливает новые private
файлы и меняет URI только в staging. Native snapshot/lifecycle проверены отдельным
синтетическим Android стендом; полная parity всех доменов,
publication process-death/low-storage и restore UI остаются открытыми. Это не готовая миграция
и не закрытый R06/D05.

`ReturnPointCompletion` и `ExpoReturnPointStore` добавляют одну полную app-private
точку с embedded media. Routing journal v2 требует completion intent и завершение
активации/погашения точки до reopen; v1 сохранён для прежнего technical rehearsal.
Однократный Return не создаёт обратную точку. Atomic return-state.json хранит
settledOperationId даже после явного удаления: cold boot не воскрешает точку.
Cold production adapter подключён. Следующий срез подключил ExpoRestoreJobs,
preview/confirmation/Return/delete к production composition и BackupScreen;
в dev/ExpoGo они отключены. Границы UI/native proof описаны в
`docs/spikes/R06_APPLICATION_RESTORE.md`.
32 host-проверки включают 14 реальных SIGKILL. Native v2 normal35/35,
rollback12/12 и commit-gap recovery13/13 прошли; reinstall/picked restore6/6 тоже.
Новые RestoreActionsService и ApplyPreparedRestore дают pure controller и логический
pin с учётом WAL (25 host-проверок исходного среза). Адаптер теперь использует этот core.
Подробности: `docs/spikes/R06_RETURN_POINT.md`.
