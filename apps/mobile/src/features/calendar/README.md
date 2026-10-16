# Calendar

Appointments, duty/blocked slots и расписание. Не создаёт Workout Session;
финансовые эффекты проходят через явный workflow с Accounting.

Dev-only вертикальный срез K01 (`data/DevCalendarRepository.ts`) хранит данные
в общем dev-файле с Clients (`shared/db/SharedSqliteDatabase.ts`), со своим
журналом миграций `calendar_schema_migrations`. Время — локальная дата и
минуты от полуночи с шагом 30 минут; интервалы полуоткрытые.

- `domain/CalendarRules.ts` — чистая арифметика дат, проверка слота, рабочего
  окна (`start + duration <= конец дня`), участника и шаблона недели.
- Пересечения записей запрещены; Blocked запрещает записи и не ставится поверх
  записи; Duty — фон и сосуществует с записями.
- Copy/Paste Week — многоразовый шаблон без ID и исходов; существующая запись
  побеждает, пропуски считаются. Clear Week отменяет только SCHEDULED.
- `devCalendarClientDeletionParticipant` подключается composition root к
  окончательному удалению клиента (§15.8): будущие записи отменяются, все
  записи теряют связь с клиентом, имя и заметку.

Не реализовано: credit/reservation (L01/L02), исходы записей, управление типами
занятий и настройками, Month Grid, плотная Week/Day timeline и жесты (K02/R09),
Share Week.
