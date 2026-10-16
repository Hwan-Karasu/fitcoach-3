# S01 — build120 → FitCoach 3.0 crosswalk

**Статус:** `READY_FOR_REVIEW`. Матрица предотвращает перенос устаревшей
архитектуры. Она не разрешает автоматически удалять или мигрировать данные.

| Область build120 | Действующее правило FitCoach 3.0 | Решение для новой реализации |
|---|---|---|
| Четыре trainer tabs, включая `SettingsTab` | Три tab destinations: Клиенты, Календарь, Архив; Settings — отдельный route | Не переносить четвёртую вкладку; спроектировать drawer/menu route |
| Клиентская панель из пяти вкладок | Четыре controls: Главная, Питание, Тренировки, Ещё; шесть самостоятельных destinations | Анкета, Архив и Статистика доступны через «Ещё» |
| Auth boot, trainer/client roles и отдельный client app | V1 только для тренера, без client login | Не включать auth/role routing в новый composition root |
| Fastify/PostgreSQL/backend и custom sync | V1 полностью локальный, SQLite — SoT | Не создавать API workspace и sync engine |
| Account-scoped DB registry | Один локальный trainer workspace; legacy source mapping ещё не доказан | Исследовать только в `R02`; при неоднозначности safe stop |
| Light/Dark preference | Девять независимых тем × три совместимых акцента | Реализовать `themeId + accentId`, без обязательного System mode |
| Старые визуальные ограничения Client Home | Полный редизайн разрешён §53.4 при неизменной бизнес-семантике | Использовать старый экран только как поведенческий reference |
| Client Inbox / proposal events | Локальный Notifications Center тренера | Не переносить чат, cloud inbox или approval workflow |
| Notification scheduling | Schedule/delivery не являются бизнес-фактом | Отделить OS adapter от persisted notification center и доменных команд |
| Health Connect | Исключён из V1 | Не добавлять экран, permissions и runtime adapter |
| Appointment, Workout и списание могли быть связаны UI-потоком | Три независимых источника; settlement инициирует Calendar workflow | Не завершать Workout и не менять Ledger скрытым side effect |
| Структура программы и выполненные подходы | Факты независимы от ревизий плана | Stable fact identity; обычная правка не удаляет историю |
| SQLite текущей версии | Не является автоматически production schema 3.0 | Legacy изучается для migration; DDL утверждается в `D01` |
| `com.fitcoach.app`, versionCode 120 | In-place upgrade — цель, но signing не проверен | Package сохраняется как кандидат; versionCode и certificate проверяет `R01` |
| Старый UI и assets | Только визуальный/reference материал | Использовать выборочно после проверки лицензии, качества и нового UI gate |

## Обязательные проверки перед runtime bootstrap

1. `S03`: карта утверждения экранов и расхождение 43 atlas entries / 48 registry records.
2. `S04`: удалённый build120 зафиксирован commit/tag и остаётся внешним reference.
3. `R01`: package/signing/versionCode без раскрытия ключей.
4. `R02`: инвентаризация legacy DB только на копиях.
5. `R07`, `R08`, `F01`: SQLite transactions, navigation lifecycle и exact stack.

