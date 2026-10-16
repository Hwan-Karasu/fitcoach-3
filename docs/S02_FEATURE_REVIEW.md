# S02 — проверка 20 feature-spec против Product §§53–56

Дата: 2026-10-15. Это редакционная проверка требований, не runtime/UI-приёмка.
Сопоставлены `Product Contract` §§53–56 и разделы scope, routes, states,
приёмки и поздние addenda 20 отдельных feature-spec. Отдельно выполнен поиск
старых норм о четырёх root tabs, frozen Home, `SettingsTab`, Light/Dark/System,
шести нижних client-кнопках, Notification Center и устаревших checksum.

| Feature | Область §53–56 | Результат проверки |
|---|---|---|
| 01 App shell | Root/Client routes, Back | Исправлены 3 tabs, отдельные Settings/Bell, 4 controls/6 sections, `SafeRoute` и query стартового раздела; build120 routes оставлены только read-only reference. |
| 02 Clients roster | Root Clients | Противоречий §53–56 в собственных маршрутах/сценариях не найдено. |
| 03 Client editor | Переход из roster/client | Противоречий не найдено. |
| 04 Client archive | Root Archive | Различает архив клиентов и клиентский архив; противоречий не найдено. |
| 05 Calendar | Root Calendar | Противоречий не найдено; календарные настройки остаются внутри Calendar. |
| 06 Session accounting | Calendar/Client data | Противоречий не найдено; уведомление не становится business commit. |
| 07 Questionnaire | Client «Ещё»/Settings builder | Маршруты доступны; противоречий не найдено. |
| 08 Exercise catalog | Client Training | Противоречий не найдено. |
| 09 Training builders | Client Training/Back | Противоречий не найдено. |
| 10 Training execution | Client Training/rest | Противоречий не найдено. |
| 11 Structural edits | Training/data facts | Визуальная тема не меняет факты; противоречий не найдено. |
| 12 History/statistics | Client Statistics/Archive | Статистика — самостоятельное назначение; противоречий не найдено. |
| 13 Training archive | Client Archive | Отдельно от root Archive; противоречий не найдено. |
| 14 Nutrition diary | Client Home redesign | Исправлено требование сохранять старый визуал Главной. |
| 15 Nutrition targets/measurements | Client Home redesign | Исправлены маршрутное описание, `NT-07` и UI-spike коридоров в новой Главной. |
| 16 Client Home/settings | Home, Settings, themes, start section | Уточнены шесть стартовых destinations и тип `ClientSection`; прежний скриншот build120 не является визуальным эталоном нового Home. |
| 17 Notifications/rest timers | Bell, badge, retention | Поздний §13 спецификации содержит правила §54; противоречий в его сценариях не найдено. |
| 18 Backup/upgrade | Settings, notification data | Противоречий не найдено; восстановление остаётся отдельным gate. |
| 19 Import | Client Training | Противоречий не найдено. |
| 20 Cross-feature read models | Home/Calendar/Training data | Противоречий не найдено; read model не меняет канонические факты. |

Во всех 20 заголовках указаны §§53–56. Исторический checksum v0.9 помечен
как таковой; рядом указан SHA-256 текущего Product Contract. Исправлены
отдельные feature MD, сводный MD и HTML. Проверка по известным формулировкам
автоматизирована `npm run source:stage-audit`.
Отдельный проход по сопровождающим документам устранил два сохранившихся
требования frozen Home в Stage 3 traceability и Stage 4 risks/gates.

**Граница уверенности:** проверка была тематической по §§53–56, а не полным
доказательством внутренней согласованности всех доменных сценариев и не
утверждением пиксельных экранов. `S02` остаётся `READY_FOR_REVIEW`; backlog
`PLANNED` не повышается до `DONE` без приёмки и доказанных gates.
