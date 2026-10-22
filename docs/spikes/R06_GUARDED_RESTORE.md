# R06 — протокол восстановления закрытой базы

2026-10-22. **PROTOTYPE / HOST VERIFIED; ANDROID GATE OPEN.**

Входы: D01 production identity/schema catalog, синтетические SQLite-файлы с полной
текущей схемой, Product §§46.1–46.6, 52 AUD-02 и §§53–56; Feature Spec
`18-backup-upgrade.md`, BU-01/03. Task R06 зависит от R03; D05 остаётся закрыт
для production-подключения до R06. Production DDL не меняется.

## Протокол

План фиксирует operationId, SHA-256 входящего файла и текущей базы. Подтверждение
устаревшего preview отклоняется до изменения live. Адаптер обязан остановить
все DB readers/writers/handles и scheduler, изолировать private slots от внешних
URI и сериализовать операции. Обычный runtime запускается только после recovery.

1. Проверка обеих SQLite-баз: собственная identity, версии/checksum owner migrations,
   полный inventory, integrity_check и foreign_key_check. Пустая/чужая/повреждённая
   база не подходит; валидация не создаёт схему и не мигрирует входящий файл.
2. Независимая копия SAFETY и повторная проверка её SHA/integrity.
3. Сохранение PREPARED guard до первой замены.
4. Атомарные отдельные rename LIVE→PREVIOUS и INCOMING→LIVE. Между rename live
   может отсутствовать; до UI следующий boot обязан выполнить recovery.
5. Read-only reopen/проверка новой live; сохранение решения COMMITTED, затем
   COMPLETED receipt. До этого результат не считается успешным.

PREPARED восстанавливает старую базу; COMMITTED заканчивает проверку новой.
Rollback сохраняет отвергнутый файл в REJECTED, не удаляет SAFETY. Если PREVIOUS
недоступен, recovery готовит ROLLBACK из проверенной SAFETY. Неизвестные файлы
не перезаписываются. Повреждённый guard/неверные контрольные суммы блокируют
операцию с сохранением файлов. Повтор восстановления и прерывание самого
rollback не дублируют замену. Final receipts допускают обычные последующие
записи в live; постоянное сравнение с прежним SHA ошибочно отвергало бы их.

## Доказательство и ограничения

`npm run r06:test`: настоящие SQLite-файлы в случайных временных каталогах,
запуск отдельного Node-процесса и его SIGKILL на границах guard/rename,
включая прерывание восстановления. Проверяются точные байты старой/новой базы,
неизменность SAFETY, повторный запуск, старый preview, чужой/повреждённый файл,
двойное нажатие, I/O error, неизвестные занятые slots и блокировка WAL sidecars.
На Windows sandbox может запрещать spawn дочерних процессов; этот набор требует
разрешённого запуска subprocess и не пропускает такие тесты молча.

Host adapter использует только заранее закрытые DELETE-journal fixtures.
Файл guard записывается во временный файл с fsync и затем rename; portable
directory fsync на Windows отсутствует. Это проверка process death, **не**
доказательство сохранности при отключении питания или Android lifecycle.

Открыты: native quiescence и файловый adapter, native backup API, independently
recoverable manifest/container `.atbackup`, внешнее хранилище SAF, full-owner
roundtrip фактов/медиа, Android kill/low-storage, boot/UI/scheduler integration,
scope/confirmation preview в приложении и совмещение с переносом 2.0.
Существующее приложение/телефон/личные базы не затрагиваются.
