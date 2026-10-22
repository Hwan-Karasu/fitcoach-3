# R04 — единый source ledger подходов

Статус: PARTIAL / NO TARGET WRITES. Входы — session sets, current set logs,
exercise history и физические вхождения архивов в одном read-only snapshot.
Зависимость R03; Product §48.5.7, §§49–50, Feature 12/13/18.

`LegacyFactLedger.ts` сохраняет raw payload каждого атома и группирует доказуемые
source IDs по `(accountScope,clientId,sourceFactId)`. Physical source key включает
таблицу/ряд; у архива — archive ID и JSON path. Отсутствующие logical IDs не
вычисляются из позиции/метрик и остаются отдельными unresolved atoms.

Совпадение ID другого клиента/account не объединяет факты. Ни один raw атом
не удаляется при группировке. Проверяется полнота физических session/current/
history rows относительно уже прочитанных данных и сумма всех grouped/unresolved
atoms. Повтор физического key отклоняется. Исходные payload, даты и признаки
удаления не переписываются.

Метрики проходят общий точный конвертер. `METRIC_CONFLICT` означает расхождение
корректно разобранных значений; невалидные/пустые значения не дополняются из
другого представления. Lifecycle/deletion/completion warnings остаются на сверке.
`CONSISTENT_METRICS` означает только согласованность чисел: не факт выполнения,
не готовность к переносу, не разрешение выбрать приоритетный source.
История и архив всегда сохраняют отдельную причину отсутствия proof выполнения.
Все targetFactId остаются null, targetFactsCreated/targetWrites — 0.

Единый `r04:full` выводит только агрегат `factLedger`: counts по четырём видам,
source groups, unresolved, cross-source/repeated representations и конфликты.
Имена, client IDs, source IDs и raw payload не выводятся.

Синтетические проверки: owner/account isolation, отсутствие identity, разные
источники и root/cycle mirrors, конфликты без source priority, точная нормализация,
неполные метрики, повреждённая history, deletion/completion warnings, coverage
mismatch и безопасный агрегат. Файловая интеграция R04 проверяет учёт atoms и
неизменность источника. Реальная база не открывалась.

Открыты: доказательство canonical performed facts, сегменты и effort/set kinds,
историческая структура, questionnaire/другие unmapped tables, ID allocation,
target parity и прерываемый staging/cutover. Ledger не снимает R04/R05 gates.
Нельзя объявлять это реализованным восстановлением или закрытым переносом 2.0.
