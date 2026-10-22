# R06 — закрытие shared database перед заменой

2026-10-22. **HOST VERIFIED; LIVE RESTORE NOT CONNECTED.**

Входы: D01 SharedSqliteDatabase/WriterCoordinator, R06 GuardedRestore;
Product §46, Feature Spec 18 §5–8 (exclusive quiescence). Production schema
не меняется. Android/SAF/scheduler и открытые R06/D05 gates остаются открыты.

## Гарантии инфраструктуры

- Acquire/release сериализованы; новый native handle не открывается, пока
  предыдущий не закончил close. До изменения прежний release обнулял lease до
  await drain/close, позволяя параллельному acquire открыть второе соединение.
- Lease facade отслеживает незавершённые чтения и direct transactions. Last
  release запрещает новые обращения, останавливает очередь и ждёт все ранее
  принятые операции перед native close. Старый lease больше не пригоден.
- `withClosedDatabase(stopHolders, task)` немедленно закрывает admission для
  acquire/direct reads/new writes; принятые ранее transactions заканчиваются.
  stopHolders освобождает все repository/workflow leases. При оставшемся
  владельце task не запускается; writer возвращается в прежний рабочий режим.
- Ошибка file task сохраняет `RECOVERY_REQUIRED`: новые leases запрещены до
  успешного следующего maintenance recovery. Ошибка подготовки recovery не
  снимает этот запрет. Неопределённый native close запрещает повторное открытие;
  process restart необходим для повторной native-проверки.
- WriterCoordinator получил optional admission callback; standalone writers
  и существующий diagnostics API сохраняют прежнее поведение. Принятые до
  maintenance команды не переоценивают admission при исполнении.

## Обязанности будущей orchestration

До maintenance остановить UI/business commands и notification scheduler.
stopHolders обязан дождаться initialization, reads, close всех repositories и
отдельного workflow lease в createServices. Из SQLite transaction callback
нельзя повторно acquire/release тот же shared lifecycle. После восстановления
выполнить обычный boot/schema gate, восстановить read models/целевой route и
затем запустить scheduler. Сам shared DB не знает UI, notifications и backup URI.

Подключения живого Restore сейчас нет: этим изменением не заявляется, что
в createServices уже добавлена полная остановка runtime.

## Доказательство

Восемь focused lifecycle-тестов проверяют interleaving close/reacquire,
незавершённое чтение и запись, admission/concurrent maintenance, забытый holder,
неудачный file task/recovery setup, uncertain close, open retry и внешнюю
writer quiescence. Прежние production boot tests проходят.

Файловый integration test использует настоящий SharedSqliteDatabase,
ClientRepository, SQLite .atbackup и GuardedRestore: repository закрывает
handle до замены, затем initialize читает исторического клиента из новой базы.
Клиент прежнего live не сливается со snapshot и сохраняется в SAFETY.
