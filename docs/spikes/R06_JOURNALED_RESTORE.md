# R06 — публикация журнала подтверждённого восстановления

Дата: 2026-10-23. **HOST + SYNTHETIC ANDROID v2 VERIFIED**. R06/D05 OPEN.
Владелец завершил установку отдельной тестовой APK. v2 writer/point protocol:
normal35/35, rollback12/12, commit-gap recovery13/13; оба force-stop подтверждены
новым процессом. [Отчёт](R06_MANAGED_ANDROID_REPORT.json). Обычный UI подключён следующим
срезом; [его scope и проверки](R06_APPLICATION_RESTORE.md).
Следующий срез добавил v2 routing и обязательную finalization полной Return-точки:
[R06_RETURN_POINT.md](R06_RETURN_POINT.md). Ниже — исходный контракт v1 writer.

Входы: private staging INCOMING, проверенная D01 identity, подтверждённый план,
GuardedRestore и RuntimeMaintenance. Зависимости: D05 → D01/R06; D03 → R04/R05.
Product refs: §§46.7–46.11, 46.20, 46.24 и поздние §§53–56. Migration/overlay/
signing/release gates остаются OPEN. Production DDL и данные 2.0 не изменяются.

## Что сделано

`restoreWithRuntimeJournal` удерживает одну закрытую database lease на всём пути:
проверка прежней операции → pin LIVE/INCOMING → запись и readback pending.json →
GuardedRestore. Между публикацией указателя и заменой нет reopen, который позволил
бы новой записи сделать cold recovery неоднозначным. Внутренний протокол получает
адаптер уже закрытой БД, повторный вход в maintenance не нужен.

Строгий routing record содержит только version=1, UUIDv4 operationId и два SHA256.
Parser копирует значения до первого await: изменение объекта вызывающим кодом
не меняет поставленное в очередь подтверждение. Внешних путей в записи нет.

Новый job не затирает незавершённую старую операцию: прежний guard должен точно
совпадать с routing record и иметь COMPLETED или ROLLED_BACK. Все scratch slots
нового job свободны, оба файла валидны и повторно сверены до публикации. Повтор
той же terminal operation не публикует указатель и сохраняет поздние записи.
Исчезнувшая LIVE не создаётся заново ради replay.

`ExpoRuntimeRestoreJournal` использует фиксированный private root, jobs/UUID и
guard.json. Временный уникальный pending-UUID.next сначала записывается и читается
обратно, затем переименовывается в pending.json; записи ограничены 8192 bytes.
Cold reader использует тот же адаптер; отсутствие pending в обычном production
boot по-прежнему не создаёт каталоги и не открывает SQLite.

Это запись routing journal и файловый протокол. Полная пользовательская точка
возврата с фотографиями и её атомарная публикация остаются обязанностью будущего
контроллера. Обычный Restore UI до этого не включён.

## Доказательства на компьютере

В `scripts/r06-runtime-recovery.test.ts` проверяются реальная SQLite и временные
файлы, в том числе единая lease, порядок journal-before-swap, stale source,
неудачная публикация/искажённый readback, отказ от перезаписи незавершённой операции,
terminal replay, пропавшая LIVE и неизменность подтверждения после async-вызова.

Новый дочерний `journal-crash-worker.ts` действительно завершается SIGKILL в пяти
точках: записанный, но не опубликованный pending.next; опубликованный pending.json
до PREPARED; сохранённый PREPARED; INCOMING→LIVE; сохранённый COMMITTED. Родитель
подтверждает достижение конкретной точки, ненулевое завершение и отсутствие ошибки
вместо kill. Cold reader с новым storage object восстанавливает точные прежние
или новые bytes; следующая законная запись сохраняется при повторном boot.
Это проверка process death на host, а не отключения питания Android.

Целевой файл тестов: **33/33**. Полный foundation и общие проверки отражены в
`docs/PROJECT_STATUS.md`. Прежний Android normal25/recovery11 относился к reader/
runtime и GuardedRestore с ручной записью pending; он не засчитывается как native
доказательство нового writer. Стенд обновлён для повторной проверки позже.

## Дальнейшая интеграция

Контроллер выбора/preview/подтверждения, logical pin с учётом WAL, capacity/job
lifecycle; затем scheduler, ротация дневных копий и согласование OS-сигналов
таймеров. Полная Return-копия и её прерывания уже проверены общим v2 protocol.
Переустановка с picked-file restore6/6 также завершена; low-storage, process death
при внешней публикации, другие providers и полные доменные истории ещё открыты.
