# R06 — подтверждение восстановления и привязка preview

Дата исходного среза: 2026-10-23. HOST VERIFIED.
Следующий срез подключил native adapter/ordinary UI:
[R06_APPLICATION_RESTORE.md](R06_APPLICATION_RESTORE.md). Ниже — первоначальный core.
Входы: общий snapshot engine, RuntimeMaintenance, v2 routing/completion.
R06→R03, D05→D01/R06; Product §46 и §§53–56. Migration/release gates OPEN.

RestoreActionsService принимает только opaque preview ID, дату и числа клиентов.
Пути, SQL, hashes и технические сообщения не выходят в feature/UI port. Picker
и preview учитываются whole-command gate; apply/recovery проходят отдельно,
иначе maintenance ждала бы собственную команду. Back освобождает только preview;
двойное подтверждение не запускает вторую замену. Неопределённый результат
держит RECOVERY_REQUIRED до recovery; сообщения используют фиксированные коды.

ApplyPreparedRestore сравнивает logical content pin после закрытия runtime, затем
raw INCOMING pin и capacity. Обычный WAL checkpoint не делает preview устаревшим,
но intervening business write требует нового выбора. Ожидаемый отказ до файловых
изменений возвращается через maintenance с reopen здоровой исходной базы. Ошибка
protocol вызывает тот же cold recovery внутри уже закрытой lease; только доказанный
terminal результат позволяет reopen. Подтверждение копируется до async ожидания.

12 controller tests и 13 real SQLite/RuntimeMaintenance tests прошли в полном
foundation **1076/1076**. Есть WAL checkpoint, изменённая LIVE/INCOMING, нехватка
места, failed point prep/swap/state write, safe reopen и recovery retry. Расчёт
места проверен на overflow; native free-space и job/media cleanup ещё не подключены.
Root/mobile/spike typecheck, lint, arch490, source/secrets/diff прошли; текущий
Android JS/Hermes bundle **5607 modules/1185 assets**. Этот bundle не доказывает UI E2E.

Отдельный Android probe напрямую использует v2 writer/finalizer, а не новый
ApplyPreparedRestore/controller: normal35/35, rollback12/12, commit-gap13/13.
[Его границы и результат](R06_MANAGED_ANDROID_REPORT.json).
