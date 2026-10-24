# R04: отдельная файловая копия для анализа SQLite

2026-10-24, база aad8901. Входы: выбранный SQLite candidate, operation UUID,
общий mobile reader трёх доменов. Зависимости R03/R04; Product §§46.6,48.5.7,
49–50,53–56 / INT-03–12. Production DDL/migration/overlay/signing/release gates
OPEN. Только синтетические private файлы; без телефона, пользовательской БД и UI.

## Протокол

`prepareLegacyInspectionCopy` получает source-bound файловый port:

1. Проверяет UUID до обращения к файлам и вычисляет SHA-256/bytes источника.
2. Резервирует новую operation directory и нулевой `source.partial`. Существующая
   папка не перезаписывается; незавершённый слот повторно не используется.
3. Копирует источник только в собственный нулевой partial. Источник не переименовывается,
   не удаляется и не открывается через SQLite.
4. Снова вычисляет source hash, проверяет SHA/bytes partial, SQLite magic/minimum
   size и отсутствие private WAL/SHM/journal. Изменение/обрыв не исправляется.
5. Публикует закрытый `source.sqlite`, затем отдельный строгий receipt через
   `receipt.partial` → `receipt.json`. После readback receipt/hash/header возвращает
   metadata: kind/version/operationId/sha256/bytes, без source URI/имени/аккаунта.

Receipt означает **проверенную копию байтов SQLite candidate**, не успешный импорт
или подтверждение формата 2.0. Header не заменяет integrity_check, manifest/version,
account binding, source ownership, semantic/parity gates или поддерживаемую схему.
SQLite JSON/чужой формат не становится допустимым из-за расширения имени файла.

`readLegacyInspectionCopy` проверяет receipt и private hash/header/sidecars,
вызывает общий reader на operation-owned private path и повторяет проверку после
закрытия SQLite. Изменение файла при чтении не позволяет вернуть успешный результат.
Старый внешний источник для чтения готовой копии больше не нужен. AccountScope
пока задаёт caller; его извлечение/допуск по manifest/binding ещё не подключены.

## Expo adapter

`ExpoLegacyInspectionFiles` создаёт только
`Paths.document/legacy-source-copies/<UUID>/...`. Имена файлов фиксированы;
source URI не участвует в выборе destination. Reserve/copy/seal требуют слот,
созданный этим экземпляром; read может открыть проверенный sealed slot после
перезапуска без живого source File. Нет удаления файлов или рабочего DB routing.
SHA использует существующий `expoFileSha256`/`localFileSha256`: chunks ≤256 КиБ,
с yield при больших файлах, без database-sized JS buffer.

Проверены установленные SDK signatures: File.copy и File.move асинхронны.
Новый File.move в Android `CopyMoveStrategy` допускает fallback copy+delete.
Поэтому публикация использует **await moveAsync из expo-file-system/legacy**:
его Android file:// path вызывает renameTo либо бросает исключение. Обе стороны
находятся в одной private operation directory. Это source review и host contract
proof, не наблюдение фактического rename/SAF на Android.

Повтор с тем же UUID получает SOURCE_COPY_EXISTS; новый UUID может повторно
скопировать неизменённый источник с тем же digest. UUID файла не является ID факта.
Receipt до публикации недоступен: обрыв после file rename или receipt write
оставляет unreadable slot. Обрыв после готового receipt допускает readback recovery.
Собственный cleanup orphan slots/GC пока не подключён. Не обещается directory fsync,
power-loss durability, process-kill recovery приложения или low-space UX.

Все IO исключения протокола заменяются фиксированными кодами без source content/
путей; доменные ошибки чтения сохраняются. Технические коды не подключены к UI.

## Доказательства

9 новых `r04-inspection-copy.test.ts`:

- real host files: SHA/bytes copy, только private path в SQLite open, source bytes
  неизменны; исходные непроецированные таблицы остаются в полной файловой копии;
- invalid UUID/strict receipt/no overwrite; инъекция ошибки на каждой наблюдаемой
  границе copy/publication, исходник сохранён, retry новым UUID;
- source/destination drift, non-SQLite/tiny/sidecars блокируются до SQLite;
- обрывы после file publish/receipt write/readiness, восстановление чтения без
  доступа к синтетическому source, drift receipt/file во время SQLite read;
- фактический `ExpoLegacyInspectionFiles` исполняется в fresh Worker с SDK mocks:
  **реальные Node files и намеренно задержанные async copy/rename**. Он ждёт
  завершения копии и обоих rename, затем открывает только private file с
  useNewConnection:true; новый экземпляр читает без source File. SDK mocks не Android.

106/106 targeted copy/source/Calendar/Measurements/Nutrition/SourceJSON/streamingSHA
PASS. TypeScript root/mobile, scoped lint, source baseline73/arch531/secrets/diff
PASS. Новые тесты зарегистрированы в r04:plans:test/r04:test/test:foundation.
Полный foundation, APK/bundle и Android не запускались. Предыдущие 687 area tests
этим срезом не повторялись целиком: изменения локальны новому файловому пути.

## Далее

Общий mobile формат/manifest/binding/integrity/FK admission, остальные collectors,
mobile writer, permanent Execution/review/provenance, schema admission/composition,
backup всех перенесённых данных, SQLite/JSON 2.0 restore, Android kill/retry и оба
выпуска остаются незавершёнными. Production caller не подключён, cutover отсутствует.
