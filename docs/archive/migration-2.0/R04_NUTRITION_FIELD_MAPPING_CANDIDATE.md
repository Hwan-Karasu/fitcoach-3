# R04 — кандидат сопоставления пищевой записи build120 → 3.0

Исторический source-only кандидат ниже не описывает текущую реализацию.
С 2026-10-24 есть [частичный synthetic Nutrition staging](R04_NUTRITION_STAGING.md)
на существующей D01 с масштабом ×10, ID/parity и проверкой обычной копии 3.x.
Review/provenance и полный legacy restore ещё не подключены; production gates OPEN.
Старые ×100/targetWrites=0 ниже относятся только к первоначальному аудиту.

**Статус: FIELD-MAPPING CANDIDATE / NOT APPROVED / NO TARGET WRITES.**
Источник истины: Product §§49.1–49.7, 49.22–49.24; Stage 3 Technical
Design §06 и `reference-only/sql/001_reference_schema.sql`. Последний SQL —
справочный, не production DDL. Вход: один предоставленный build120 `.atbackup`,
прочитанный с `readOnly` и `PRAGMA query_only` в общем R04 SQLite-снимке.
Зависимости R03/R04, D01/D04 и R05 открыты; это **не** разрешение загружать
бэкап в приложении.

| Поле будущего `FoodDiaryEntry` | Legacy источник | Доказательство / открыто |
|---|---|---|
| source provenance | account binding + `nutrition_days(client_id,date_key)` + meal slot + `entry.id` | Стабильность ID в одном файле проверена; глобальный `sourceDatabase` и другие account DB ещё не сверены. |
| `clientId` | `nutrition_days.client_id` | Владелец существует в этом файле; target Client ID и workspace scope ждут D04. |
| `foodEntryId` | вложенный `entry.id` | 5/5 непустые и уникальные в этом файле. Collision по account scope блокирует **все** вхождения; перенос/генерация target ID ждёт D01/D04. |
| `localDate`, `mealSlot` | `date_key`, ключ одного из 4 meal-массивов | Даты и форма массивов прошли source-check; enum/точность даты закрепить в D01. |
| `sourceType`, `sourceId` | `productId` или `recipeId` | 5/5 указывают на существующий legacy-продукт, нет recipe-записей в этом файле. Целевой ID каталога ждёт D01 и миграции каталога. |
| `sourceSnapshot` | вложенный `productSnapshot`/`recipeSnapshot` | 5/5 снимков имеют совпадающий source ID. Снимок сохранять независимо от последующих правок каталога. У 1/5 КБЖУ в снимке — числовые строки; правило конверсии не утверждено. |
| `amount_g_x100` | `entry.grams` | 5/5 положительны и представимы ровно с масштабом ×100; никакого округления. |
| `kcal/protein/fat/carbs ×100` | итоги самой `entry`, не текущий каталог | 5/5 имеют представимые неотрицательные числа, 0 неизвестных полей в этом файле. Для иных файлов missing остаётся `NULL`, не `0`; из снимка не пересчитывать молча. |
| `enteredAt` | `entry.createdAt` | 5/5 имеют явный timestamp с timezone. |
| `updatedAt` | отдельного `entry.updatedAt` нет | **5/5 не имеют этого поля.** `nutrition_days.updated_at` относится ко всему дню и не доказывает время правки каждой записи. D01 должен определить честное представление неизвестной точности; фиктивный timestamp не подставлять. |

Отдельно: `meals_recorded` не создаёт пищевой факт; вода хранится независимо.
Статистика включает дату только при наличии фактической пищевой записи (§49.22).
Текущие агрегаты `shapeCompleteButUnverified=4`, `targetMappedEntries=0`,
`targetWrites=0` не являются утверждённым сопоставлением.

Перед переводом в adapter/production нужны: решение D01 по `updatedAt` и
snapshot-типам; catalog/client ID map с provenance; идентичность source DB
среди всех account DB; fixture для recipe, water-only, missing macro,
повторного entry ID и редактированной записи; SQLite staging parity по
количеству и значениям без PII в отчёте; Android interruption/restore gates.
