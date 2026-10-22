# R04 — поля карточки и сохранение исходного профиля

Статус: SYNTHETIC CARD REHEARSAL / NOT PRODUCTION MIGRATION.
Задача R04, зависимость R03. Product §§10, 23–27, 46.6: значения карточки,
стабильная identity, сохранение ответов без угаданного соответствия.

## Источник

Read-only build120 `e116b42e95f70a5a5e563420ab25394944c59ffd`:
[колонки clients](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/migrations/001_initial.ts),
[чтение/запись без конверсии](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/clients/data/ClientRepository.ts),
[тип profile_json](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/packages/domain/src/index.ts),
[исходные варианты пола](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/packages/domain/src/client-form-options.ts).

## Реализовано

`LegacyClientCardProjection.ts` сохраняет все исходные колонки clients и
разбирает profile_json строго как object, без старого fallback к пустому профилю.
Базовые поля сопоставлены с актуальной карточкой 3.x:

- birthdate → birth_date: исходная ISO дата, проверка календаря и прошлого;
- height → height_cm_x10: точное число, trailing zeros не меняют точность;
- «Мужской»/«Женский» → MALE/FEMALE; пустота → null, иные варианты на сверке;
- avatar_emoji → emoji с ограничением актуального ввода;
- имя и active/archived identity — из уже проверенного source identity.

Неразбираемые/непредставимые значения, ошибка имени/даты/пола/emoji и JSON
сохраняют raw source, но блокируют проекцию. Рост не округляется. Телефон/email
не выдумываются: в показанном старом ClientRecord у них нет отдельных колонок.
Масса тела и счётчики занятий/цена не создают измерение или accounting fact.

`stageClientCards` записывает поля карточки вместе с ID mapping в одной
транзакции rehearsal-БД. Полный исходный ряд (включая profile_json, weight,
session counters и неизвестные дополнительные поля) сохраняется отдельно в
`r04_candidate_ids.source_payload_json`; это private provenance, а не публикация
ответов в новую анкету. При повторе проверяются и структурные значения, и
исходный payload: даже изменение только старых заметок не перезаписывается.
Ни один приватный payload не выводится в отчёт.

Формат candidate ledger повышен с 1 до 2 из-за добавления source payload.
Предыдущий prototype-файл отклоняется до записи, не пересобирается и не
конвертируется неявно. Это тестовый stage, пользовательские файлы не обновлялись.
Основная production-схема приложения не менялась.

Полный `r04:full` при наличии source колонок добавляет только агрегат
`clientCards`. Узкие synthetic fixtures без этих колонок имеют null секцию.
Это не объявляется успешным полным переносом профиля.

## Проверки и оставшаяся работа

Синтетические проверки: точные значения/пустота, оба пола и неизвестный пол,
точность роста, дата, emoji, повреждённый профиль, изоляция row/workspace,
атомарность карточки/ID/raw payload, отказ после insert, replay drift, coverage,
приватность агрегата, file close/reopen и отказ старому формату без изменения
байтов. Существующие identity-only тесты остаются включёнными.

Открыты: semantic mapping typed profile в ответы/заметки/предупреждения и
прочие владельцы, сохранение фотографий, анкеты и карточка в одной итоговой
базе, target parity полного клиента, job checkpoints/publish/restore/Android.
Сохранение raw profile предотвращает потерю исходника в rehearsal, но само по
себе не делает старые ответы доступными через новый UI. R04/D03 остаются OPEN.
Ни реальный backup, ни данные на телефоне не открывались и не изменялись.
