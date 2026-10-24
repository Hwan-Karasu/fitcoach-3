# R04: календарные записи и отсутствие выдуманного финансового учёта

2026-10-24, база 3c4d019. R04→R03, существующие D01 Calendar/Accounting;
Product §§13/22/48.35–48.39/49–50/53–56, INT-03–12/15. Входы: immutable
calendar_appointments и calendar_planner_settings, Client IDmap и все предыдущие
владельцы до Nutrition включительно. Production DDL/migration/overlay/signing/
release gates OPEN. Только isolated synthetic staging, finalizable:false.

Primary read-only Hwan-Karasu/fitcoach@e116b42e95f70a5a5e563420ab25394944c59ffd:
[002_calendar](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/002_calendar.ts),
[CalendarRepository](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/calendar/data/CalendarRepository.ts),
[calendar domain](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/packages/domain/src/calendar.ts).
Source содержит расписание/участника/заметку/soft-delete и три известных типа,
но не completed/missed outcome, списание или оплату. deleted_at устанавливается
также при замене активного слота и очистке недели: это не доказательство исхода
«Отменена». Elapsed date и выполненная тренировка не доказывают календарный исход.

Дополнительные источники:
[calendarDate, inclusive end hour](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/calendar/model/calendarDate.ts#L104),
[WeekSchedule/getDay](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/calendar/ui/WeekSchedule.tsx#L124).
В 2.0 endHour включает последний час, а weekdays используют JS Sunday=0.

## Реализация и семантика

LegacyCalendarSnapshot читает полные строки calendar_appointments и только
принадлежащий Calendar ключ app_settings.calendar_planner_settings. Отсутствие
таблицы, отсутствие ключа и пустой набор записей различаются. Остальные prefs
не объявляются перенесёнными. Неверная физическая форма блокирует reader.
Accounting tables поддерживаемого ref/inventory отсутствуют; наличие известных
финансовых таблиц даже без строк блокирует адаптер FINANCIAL_SOURCE_UNSUPPORTED.
Новый источник с финансами не превращается в пустой журнал без адаптера.

LegacyCalendarProjection переводит известные enums в стандартные seed IDs 3.x,
не сопоставляет по названиям клиента/занятия. Подготавливаются все четыре начальных
типа 3.x, в том числе новая «Консультация»: наличие calendar_settings запрещает
runtime повторно выполнять first-setup seeding. Поэтому неполный набор привёл бы
к отсутствующему типу. Каталожные названия/credit policy — новые defaults 3.x;
исторический snapshot session_type_name сохраняет старую «Тренировка» и другие
labels. После initialize нет дублей типов. Это не четыре legacy факта.

Клиент связывается только по source client ID. Гость с именем существующего клиента
остаётся гостем. Неоднозначный/отсутствующий участник/неизвестный client ID остаётся
raw/review, не получает чужого владельца. Notes/guest names не обрезаются и не
нормализуются trim. Исходное client_name сохраняется в provenance/raw; обычный
target использует Client relation. Неподдержанные дополнительные поля остаются
явными; status/billing extension не получает придуманную интерпретацию.

Active source → lifecycle SCHEDULED, outcome/outcome_at NULL независимо от возраста
записи и соседних Workout фактов. Source deleted_at → скрытая lifecycle CANCELLED
с outcome NULL. Это только сохранение soft-delete visibility, не подтверждение
«Отменена». cancelled_at берёт исходное время soft-delete с явным basis; metadata
не объявляет его временем выбранного тренером исхода. Ненадёжное deletion time
остаётся review. created/updated timestamps берутся из source, иначе техническое
importTime с basis, без предположений о времени проведения занятия.

Дата и HH:mm переводятся без timezone conversion/округления на 30 минут. End time
должен согласоваться с duration; ровно 24:00 представляется концом того же дня.
Переход за полночь не разделяется на вымышленные записи и остаётся review. Старые
перекрывающиеся записи сохраняют разные ID, ссылки на overlap в provenance, без
выбора победителя. Неизвестный enum не заменяется default training.

Planner endHour22 → endMinute1380 (23:00), startHour7 →420; Sunday-first числа
переводятся в Monday-first bit mask. Duty/blocked true hour flags дают отдельные
часовые интервалы, false не создаёт факт. Ровные часы/boolean/даты проверяются,
коррупция не превращается в truthy/подобранное значение. JSON numeric tokens Node24
не округляются в 7 при 7.0000000000000001. Ошибка display prefs не стирает независимые
записи/валидные flags. Новые copy/clear/undo/default-type prefs помечены new3.x defaults.

## Учёт оплат

Accounting defaults = UNTRACKED, без client overrides, пакетов, платежей, резервов
или USED/RETURNED. Исходный календарь не является финансовым доказательством.
Новая catalog credit policy для personal=1 не утверждает, что старое занятие
оплачено: каждый импортированный record получает технический credit_bypass=1.
Это сохраняет отсутствие старого учёта и защищает от автоматических списаний после
включения FITCOACH/создания нового пакета в 3.x. Применение новых финансовых правил
требует явного действия пользователя; заметка с суммой не становится платежом.

## Транзакция и повтор

LegacyCalendarStage использует неизменённые D01 Calendar/Accounting baseline только
в private job. r04_calendar_ids/receipt, account-scoped stable UUID, source SHA и
target manifest SHA, полный набор native таблиц/строк/IDs/provenance. Mode
CALENDAR_REHEARSAL_V1 требует всех предыдущих владельцев до Nutrition V3 включительно.
stageClientCalendar frozen snapshot до prior callbacks и общая транзакция с ними.
Недостаточный entry point/старый job не обходят mode/schema guards. Allocator collision
не превращается в value review, любой checkpoint failure откатывает всех владельцев.
loadCalendarDraftAppointments проверяет предыдущих владельцев и Calendar parity.

Тексты >1000, guest names >120 и представимая duration вне editor options сохраняются
полностью с review о нынешнем editor limit. Ошибочная дата/time grid, overnight,
новая status/billing capability и иные неподдержанные формы не теряются молча;
они остаются в full raw/source representations. Это не завершённая миграция этих
случаев и не доказательство их редактирования через текущий UI.

## Проверки и оставшееся

12 Calendar tests + расширенный cross-owner Execution fixture. Все Calendar write
boundaries и beforecommit проверены на rollback/retry; одновременно непустые
training facts/plans/work notes/weight/nutrition/calc/archive/calendar, сбои на
Nutrition receipt и Calendar receipt. После retry те же 5 фактов/3 компонента,
а Calendar не создаёт Workout/credits. Readonly/reopen/reordered rows+properties/
byte identity/ID reuse и source/target/provenance drift проверены.

Нормализованные native факты → полная обычная 3.x DB → действующая createSqliteBackup
→ .atbackup → prepareBackupForRestore → обычные Calendar/Accounting repositories.
Сохранены IDs/рабочие часы/типы/интервалы/NULL outcomes/скрытые soft-delete rows;
live и внешний backup bytes не меняются, restored не содержит r04 tables.
После FITCOACH и нового пакета на 5 занятий reconcile не списывает прошлые записи;
явное новое resolveOutcome сохраняет ID и bypass, без неожиданного USED.

Этот proof относится к native mapped fields. Private raw/provenance/unsupported rows
и старое client_name пока не включены в ordinary backup. Nutrition history candidate
из предыдущего среза не закрывает Calendar retention. Остаются permanent review/
provenance storage, editor compatibility, mobile adapters (host Node readers не
являются Expo importer), source raw-number parsing на Android, остальные prefs/
lineage/owners, full parity/app restore/Android/release-removal proof.
Production gates OPEN, finalizable:false; ни весь перенос, ни APK не объявлены готовыми.

669/669 area+deps: R04 Plans и все предыдущие владельцы, measurements projection/
preflight, SQLite backup, Nutrition, Calendar и Accounting stores. Root/mobile
TypeScript, scoped ESLint, source73/secrets/arch/diff pass. Full foundation, bundle,
APK/Android/phone не запускались. UI/theme относятся к параллельной работе.

Код и регистрация тестов уже сохранены общим рабочим checkpoint `6d84461`, который
создан параллельной UI-работой в том же worktree. Здесь не выполнялся откат/перезапись
этого общего коммита. После последней проверки physical table/view discriminator
дополнительно прошли 12/12 Calendar tests; итоговая память и evidence фиксируются
отдельным R04 коммитом. Schema/runtime/production gates остаются OPEN.
